import type { z } from 'zod';
import { first, systemSql, toJson, withTenant } from '@/lib/db';
import { sha256Hex } from '@/lib/crypto';
import { log } from '@/lib/logger';
import { rateLimit } from '@/lib/rate-limit';
import type { OrgContext } from '@/server/http';
import { env } from '@/lib/env';
import { AIError, aiFor, estimateCostUsd, type AIProvider, type Effort, type JsonSchema, type ModelTier } from './provider';
import { PROMPT_VERSION } from './prompts';
import { currentPeriod, quotaFor, recordUsage, usageSummary, ANALYSIS_KINDS, type AiUsageKind } from './usage';
import { rememberAnswer, skipCheapFirst, sourcesKey } from './routing';

export type AiKind =
  | 'tender_analysis'
  | 'match_explanation'
  | 'profit_analysis'
  | 'bid_checklist'
  | 'bid_structure'
  | 'bid_draft'
  | 'bid_review'
  | 'weekly_overview'
  | 'tender_chat';

export interface RunAiInput<T> {
  kind: AiKind;
  usageKind: AiUsageKind;
  org: OrgContext;
  userId: string;
  tenderId: string | null;
  workspaceId?: string | null;
  /** Lagres kun for organisasjonen (inneholder private dokumenter eller bedriftsdata). */
  isPrivate: boolean;
  system: string;
  /** Kildene (lange og like for flere spørsmål om samme anbud) – bufres hos leverandøren. */
  cacheablePrefix?: string;
  user: string;
  /** 'fast' = billig modell for enkle oppgaver, 'quality' = beste modell (standard). */
  tier?: ModelTier;
  effort?: Effort;
  schemaName: string;
  schemaDescription: string;
  schema: JsonSchema;
  validator: z.ZodType<T>;
  maxOutputTokens: number;
  mockHint: () => T;
  hashExtra?: string;
  force?: boolean;
  enrich?: (data: T) => Record<string, unknown>;
  /**
   * Kvalitetskontroll for svar fra den billige modellen (tier 'fast'): en grunn når svaret ikke holder (f.eks. et
   * sitat som ikke står ordrett i kilden), ellers null. Holder det ikke, kjøres samme forespørsel med den sterkere
   * modellen – kunden får aldri et dårligere svar fordi den billige ble prøvd først.
   */
  qualityCheck?: (data: T) => string | null;
}

export type RunAiResult =
  | { ok: true; analysisId: string; result: Record<string, unknown>; cached: boolean }
  | { ok: false; code: 'not_configured' | 'quota' | 'rate_limited' | 'provider_error' | 'invalid_output'; error: string };

/** Hvor lenge en forespørsel venter på et identisk kall som allerede kjører (to modellforsøk med nye forsøk). */
const INFLIGHT_WAIT_MS = Math.max(30_000, env.AI_TIMEOUT_MS * 2 + 20_000);
/** Et kall som har «kjørt» lenger enn dette, regnes som avbrutt (prosessen stoppet), og låsen overtas. */
const INFLIGHT_STALE_MS = INFLIGHT_WAIT_MS + 60_000;
const POLL_MS = 1_000;

type Attempt<T> =
  | { ok: true; data: T; response: Awaited<ReturnType<AIProvider['generate']>>; costUsd: number; totalInput: number }
  | { ok: false; code: 'provider_error' | 'invalid_output'; error: string; response: Awaited<ReturnType<AIProvider['generate']>> | null; costUsd: number; totalInput: number; detail: string };

export async function runAi<T>(input: RunAiInput<T>): Promise<RunAiResult> {
  // Testmodus for admin-tilgang (når ekte AI er av): simulerte svar som bare lagres for organisasjonen.
  const tier = input.tier ?? 'quality';
  const { provider, demo } = aiFor(input.org, tier);
  if (!provider) {
    return { ok: false, code: 'not_configured', error: 'AI er ikke konfigurert. Administrator må legge inn en API-nøkkel (se README).' };
  }
  // Billig modell først, sterk modell som reserve: bare når de faktisk er to forskjellige modeller.
  const strong = tier === 'fast' && !demo ? aiFor(input.org, 'quality').provider : null;
  const escalateTo = strong && strong.model !== provider.model ? strong : null;
  // Nøkkelen bygger på modellen som prøves først, så et svar som måtte lages med den sterke modellen, gjenbrukes også.
  const inputHash = sha256Hex(
    [PROMPT_VERSION, input.kind, provider.name, provider.model, input.effort ?? '', input.hashExtra ?? '', input.system, input.cacheablePrefix ?? '', input.user].join('\u0000'),
  );
  const ctx = { userId: input.userId, orgId: input.org.id };
  const shared = !(input.isPrivate || demo);
  // Delte svar har én lås for alle; private svar én per organisasjon (de kan aldri gjenbrukes på tvers).
  const lockKey = shared ? `ai:${inputHash}` : `ai:${inputHash}:${input.org.id}`;
  const requestedAt = new Date();

  // 1. Hurtigbuffer: samme input → samme svar, uten ny kostnad.
  if (!input.force) {
    const hit = await fromCache(input, inputHash);
    if (hit) return hit;
  }

  // 2. Kjører den samme forespørselen allerede (en annen kunde eller et dobbeltklikk)? Vent på svaret i stedet for å
  //    betale for det to ganger. Kvoten brukes ikke når svaret kommer derfra.
  if (await inflightActive(lockKey)) {
    const waited = await waitForInflight(input, inputHash, lockKey, requestedAt);
    if (waited) return waited;
  }

  // 3. Kvote og hastighetsbegrensning.
  const summary = await withTenant(ctx, (tx) => usageSummary(tx, input.org));
  const quota = quotaFor(input.usageKind, summary);
  if (quota.limit <= 0) return { ok: false, code: 'quota', error: 'AI-funksjonen er ikke med i planen din.' };
  if (quota.used >= quota.limit) {
    return { ok: false, code: 'quota', error: `Månedens AI-kvote (${quota.limit}) er brukt opp. Den fornyes den 1. i neste måned.` };
  }
  // Gratisplanen: bekreftet e-post, kvoten gjelder per bruker på tvers av organisasjoner, og bare
  // én AI-forespørsel om gangen (hindrer omgåelse med flere kontoer/organisasjoner og samtidige klikk).
  if (input.org.entitlements.plan === 'free') {
    const free = await freeAiCheck(input.userId, quota.limit);
    if (free) return free;
  }
  if (env.AI_MONTHLY_COST_LIMIT_USD_PER_ORG > 0 && summary.costUsd >= env.AI_MONTHLY_COST_LIMIT_USD_PER_ORG) {
    log.warn('ai_cost_limit_reached', { org: input.org.id, costUsd: summary.costUsd });
    return { ok: false, code: 'quota', error: 'Organisasjonen har nådd månedens tak for AI-bruk. Kontakt oss hvis dere trenger mer.' };
  }
  if (!(await rateLimit(`ai:${input.org.id}`, 10, 60)) || !(await rateLimit(`ai-user:${input.userId}`, 60, 3600))) {
    return { ok: false, code: 'rate_limited', error: 'For mange AI-forespørsler på kort tid. Vent litt og prøv igjen.' };
  }

  // 4. Lås, og kall leverandøren. Fikk noen andre låsen akkurat nå, venter vi på deres svar.
  if (!(await acquireInflight(lockKey))) {
    const waited = await waitForInflight(input, inputHash, lockKey, requestedAt);
    if (waited) return waited;
    if (!(await acquireInflight(lockKey))) {
      return { ok: false, code: 'rate_limited', error: 'Den samme AI-forespørselen kjøres akkurat nå. Prøv igjen om litt.' };
    }
  }
  try {
    if (!input.force) {
      const hit = await fromCache(input, inputHash);
      if (hit) return hit;
    }
    const started = Date.now();
    // Rett til kvalitetsmodellen når den har nøyaktig disse kildene i leverandørens buffer, eller når den billige
    // modellen for ofte ikke holder for funksjonen – da er ett kall billigere enn to (routing.ts).
    const routeKey = escalateTo && input.cacheablePrefix ? sourcesKey(input.system, input.cacheablePrefix, shared ? null : input.org.id) : null;
    const direct = escalateTo ? await skipCheapFirst(input.kind, routeKey, provider.model, escalateTo.model) : null;
    if (direct) log.info('ai_route_quality', { kind: input.kind, reason: direct });
    let current = direct && escalateTo ? escalateTo : provider;
    let attempt = await attemptWith(current, input);
    let escalatedFrom: string | null = null;
    if (escalateTo && !direct) {
      const reason = !attempt.ok ? attempt.detail : input.qualityCheck ? input.qualityCheck(attempt.data) : null;
      if (reason) {
        // Det billige forsøket koster, men teller ikke mot kvoten (kunden ba om ett svar).
        log.info('ai_escalated', { kind: input.kind, from: provider.model, to: escalateTo.model, reason: reason.slice(0, 200) });
        await storeFailure(input, inputHash, attempt.response?.provider ?? provider.name, attempt.response?.model ?? provider.model, `Billig modell forkastet: ${reason}`, Date.now() - started, attempt.totalInput, attempt.response?.outputTokens ?? 0, attempt.costUsd);
        await withTenant(ctx, (tx) =>
          recordUsage(tx, { orgId: input.org.id, userId: input.userId, kind: input.usageKind, inputTokens: attempt.totalInput, outputTokens: attempt.response?.outputTokens ?? 0, costUsd: attempt.costUsd, cached: false, quantity: 0, escalated: true }),
        );
        escalatedFrom = attempt.response?.model ?? provider.model;
        current = escalateTo;
        attempt = await attemptWith(escalateTo, input);
      }
    }
    if (!attempt.ok) {
      await storeFailure(input, inputHash, attempt.response?.provider ?? current.name, attempt.response?.model ?? current.model, attempt.detail, Date.now() - started, attempt.totalInput, attempt.response?.outputTokens ?? 0, attempt.costUsd);
      if (attempt.response) {
        await withTenant(ctx, (tx) =>
          recordUsage(tx, { orgId: input.org.id, userId: input.userId, kind: input.usageKind, inputTokens: attempt.totalInput, outputTokens: attempt.response!.outputTokens, costUsd: attempt.costUsd, cached: false, escalated: Boolean(escalatedFrom) }),
        );
      }
      log.warn('ai_call_failed', { kind: input.kind, org: input.org.id, error: attempt.detail.slice(0, 300) });
      return { ok: false, code: attempt.code, error: attempt.error };
    }

    const { response, data, costUsd, totalInput } = attempt;
    // Modellen som svarte, har nå kildene i bufferen hos leverandøren (brukes av neste forespørsel, routing.ts).
    if (routeKey) rememberAnswer(routeKey, current.model);
    const result: Record<string, unknown> = {
      data,
      provider: response.provider,
      model: response.model,
      promptVersion: PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
      isMock: response.provider === 'mock',
      ...(input.enrich ? input.enrich(data) : {}),
    };

    // 5. Lagre. Globale analyser (kun offentlig tekst) skrives av systemet og deles av alle –
    // men simulerte svar fra testmodus deles aldri med andre organisasjoner.
    const duration = Date.now() - started;
    let analysisId: string;
    if (!shared) {
      analysisId = await withTenant(ctx, async (tx) => {
        const [row] = (await tx`
          insert into ai_analyses (kind, tender_id, org_id, workspace_id, input_hash, prompt_version, provider, model, status, result,
                                   input_tokens, output_tokens, cost_usd, duration_ms, created_by, cache_read_tokens, cache_write_tokens, escalated_from)
          values (${input.kind}, ${input.tenderId}, ${input.org.id}, ${input.workspaceId ?? null}, ${inputHash}, ${PROMPT_VERSION},
                  ${response.provider}, ${response.model}, 'completed', ${toJson(result)}::text::jsonb, ${totalInput},
                  ${response.outputTokens}, ${costUsd}, ${duration}, ${input.userId}, ${response.cacheReadTokens}, ${response.cacheWriteTokens}, ${escalatedFrom})
          returning id
        `) as unknown as { id: string }[];
        return row!.id;
      });
    } else {
      const [row] = (await systemSql()`
        insert into ai_analyses (kind, tender_id, org_id, input_hash, prompt_version, provider, model, status, result,
                                 input_tokens, output_tokens, cost_usd, duration_ms, created_by, cache_read_tokens, cache_write_tokens, escalated_from)
        values (${input.kind}, ${input.tenderId}, null, ${inputHash}, ${PROMPT_VERSION}, ${response.provider}, ${response.model},
                'completed', ${toJson(result)}::text::jsonb, ${totalInput}, ${response.outputTokens}, ${costUsd}, ${duration}, ${input.userId},
                ${response.cacheReadTokens}, ${response.cacheWriteTokens}, ${escalatedFrom})
        returning id
      `) as unknown as { id: string }[];
      analysisId = row!.id;
    }
    await withTenant(ctx, (tx) =>
      recordUsage(tx, { orgId: input.org.id, userId: input.userId, kind: input.usageKind, inputTokens: totalInput, outputTokens: response.outputTokens, costUsd, cached: false, analysisId, escalated: Boolean(escalatedFrom) }),
    );
    return { ok: true, analysisId, result, cached: false };
  } finally {
    await releaseInflight(lockKey);
  }
}

/** Ett forsøk med én modell: kall, kostnad og validering. Feil blir et resultat, ikke et unntak. */
async function attemptWith<T>(provider: AIProvider, input: RunAiInput<T>): Promise<Attempt<T>> {
  let response;
  try {
    response = await provider.generate({
      system: input.system,
      cacheablePrefix: input.cacheablePrefix,
      user: input.user,
      effort: input.effort,
      schemaName: input.schemaName,
      schemaDescription: input.schemaDescription,
      schema: input.schema,
      maxOutputTokens: input.maxOutputTokens,
      mockHint: input.mockHint,
    });
  } catch (err) {
    const message = err instanceof AIError ? err.message : 'Ukjent feil fra AI-leverandøren.';
    return { ok: false, code: 'provider_error', error: `${message} Prøv igjen om litt.`, detail: message, response: null, costUsd: 0, totalInput: 0 };
  }
  const costUsd = estimateCostUsd(response.model, response);
  // Bufrede tokens regnes med i «inn» i loggen; kostnaden over tar hensyn til lavere pris.
  const totalInput = response.inputTokens + response.cacheReadTokens + response.cacheWriteTokens;
  const parsed = input.validator.safeParse(response.data);
  if (!parsed.success) {
    const message = 'AI-svaret hadde feil format og ble forkastet.';
    const detail = `${message} ${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.') + ': ' + i.message).join('; ')}`;
    return { ok: false, code: 'invalid_output', error: `${message} Prøv igjen.`, detail, response, costUsd, totalInput };
  }
  return { ok: true, data: parsed.data, response, costUsd, totalInput };
}

/** Ferdig svar for samme input (delt, eller organisasjonens eget). Teller ikke mot kvoten; sparingen registreres. */
async function fromCache<T>(input: RunAiInput<T>, inputHash: string, newerThan?: Date): Promise<RunAiResult | null> {
  return withTenant({ userId: input.userId, orgId: input.org.id }, async (tx) => {
    const row = first(
      (await tx`
        select id, result, cost_usd::float8 as cost_usd from ai_analyses
        where kind = ${input.kind} and input_hash = ${inputHash} and status = 'completed'
          and (org_id is null or org_id = ${input.org.id})
          ${newerThan ? tx`and created_at >= ${newerThan}` : tx``}
        order by created_at desc limit 1
      `) as unknown as { id: string; result: Record<string, unknown>; costUsd: number }[],
    );
    if (!row) return null;
    await recordUsage(tx, {
      orgId: input.org.id,
      userId: input.userId,
      kind: input.usageKind,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      cached: true,
      savedUsd: row.costUsd ?? 0,
      analysisId: row.id,
    });
    return { ok: true as const, analysisId: row.id, result: row.result, cached: true };
  });
}

async function inflightActive(lockKey: string): Promise<boolean> {
  const rows = await systemSql()`
    select 1 from ai_inflight where lock_key = ${lockKey} and started_at > now() - make_interval(secs => ${INFLIGHT_STALE_MS / 1000})
  `;
  return rows.length > 0;
}

/** Tar låsen – eller overtar en lås som er så gammel at kallet må ha stoppet. */
async function acquireInflight(lockKey: string): Promise<boolean> {
  const rows = await systemSql()`
    insert into ai_inflight (lock_key, started_at) values (${lockKey}, now())
    on conflict (lock_key) do update set started_at = now()
      where ai_inflight.started_at <= now() - make_interval(secs => ${INFLIGHT_STALE_MS / 1000})
    returning lock_key
  `;
  return rows.length > 0;
}

async function releaseInflight(lockKey: string): Promise<void> {
  try {
    await systemSql()`delete from ai_inflight where lock_key = ${lockKey}`;
  } catch (err) {
    log.warn('ai_inflight_release_failed', { err });
  }
}

/**
 * Venter på et identisk kall som allerede kjører, og returnerer svaret derfra som et treff i hurtigbufferen.
 * Null når kallet ble ferdig uten svar (feil), eller ventetiden gikk ut – da kan den som venter, prøve selv.
 * Ved «kjør på nytt» (force) godtas bare et svar laget etter at forespørselen kom.
 */
async function waitForInflight<T>(input: RunAiInput<T>, inputHash: string, lockKey: string, requestedAt: Date): Promise<RunAiResult | null> {
  const deadline = Date.now() + INFLIGHT_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const hit = await fromCache(input, inputHash, input.force ? requestedAt : undefined);
    if (hit) return hit;
    if (!(await inflightActive(lockKey))) return null;
  }
  return null;
}

async function storeFailure(
  input: Pick<RunAiInput<unknown>, 'kind' | 'tenderId' | 'org' | 'workspaceId' | 'userId'>,
  inputHash: string,
  provider: string,
  model: string,
  error: string,
  durationMs: number,
  inputTokens = 0,
  outputTokens = 0,
  costUsd = 0,
) {
  try {
    await systemSql()`
      insert into ai_analyses (kind, tender_id, org_id, workspace_id, input_hash, prompt_version, provider, model, status, error,
                               input_tokens, output_tokens, cost_usd, duration_ms, created_by)
      values (${input.kind}, ${input.tenderId}, ${input.org.id}, ${input.workspaceId ?? null}, ${inputHash}, ${PROMPT_VERSION}, ${provider},
              ${model}, 'failed', ${error.slice(0, 2000)}, ${inputTokens}, ${outputTokens}, ${costUsd}, ${durationMs}, ${input.userId})
    `;
  } catch (err) {
    log.error('ai_failure_store_failed', { err });
  }
}

/** Ekstra vern for gratisplanen. Returnerer en feil, eller null når forespørselen kan gå videre. */
async function freeAiCheck(userId: string, limit: number): Promise<{ ok: false; code: 'quota' | 'rate_limited'; error: string } | null> {
  const sql = systemSql();
  const [u] = (await sql`select email_verified_at from users where id = ${userId}`) as unknown as { emailVerifiedAt: Date | null }[];
  if (!u?.emailVerifiedAt) {
    return { ok: false, code: 'quota', error: 'Bekreft e-postadressen din for å bruke AI-sammendraget i gratisplanen. Lenken står i e-posten vi sendte.' };
  }
  const [row] = (await sql`
    select coalesce(sum(quantity), 0)::int as n from usage_records
    where user_id = ${userId} and period = ${currentPeriod()} and not cached and kind in ${sql(ANALYSIS_KINDS)}
  `) as unknown as { n: number }[];
  if ((row?.n ?? 0) >= limit) {
    return { ok: false, code: 'quota', error: `Gratisplanen har ${limit} AI-sammendrag per måned, og det er brukt. Det fornyes den 1. i neste måned – eller oppgrader for flere.` };
  }
  if (!(await rateLimit(`ai-free:${userId}`, 1, 300))) {
    return { ok: false, code: 'rate_limited', error: 'En AI-forespørsel er allerede i gang. Vent litt og prøv igjen.' };
  }
  return null;
}
