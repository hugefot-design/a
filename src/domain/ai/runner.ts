import type { z } from 'zod';
import { first, systemSql, toJson, withTenant } from '@/lib/db';
import { sha256Hex } from '@/lib/crypto';
import { log } from '@/lib/logger';
import { rateLimit } from '@/lib/rate-limit';
import type { OrgContext } from '@/server/http';
import { env } from '@/lib/env';
import { AIError, aiFor, estimateCostUsd, type Effort, type JsonSchema, type ModelTier } from './provider';
import { PROMPT_VERSION } from './prompts';
import { currentPeriod, quotaFor, recordUsage, usageSummary, ANALYSIS_KINDS, type AiUsageKind } from './usage';

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
}

export type RunAiResult =
  | { ok: true; analysisId: string; result: Record<string, unknown>; cached: boolean }
  | { ok: false; code: 'not_configured' | 'quota' | 'rate_limited' | 'provider_error' | 'invalid_output'; error: string };

export async function runAi<T>(input: RunAiInput<T>): Promise<RunAiResult> {
  // Testmodus for admin-tilgang (når ekte AI er av): simulerte svar som bare lagres for organisasjonen.
  const { provider, demo } = aiFor(input.org, input.tier ?? 'quality');
  if (!provider) {
    return { ok: false, code: 'not_configured', error: 'AI er ikke konfigurert. Administrator må legge inn en API-nøkkel (se README).' };
  }
  const inputHash = sha256Hex(
    [PROMPT_VERSION, input.kind, provider.name, provider.model, input.effort ?? '', input.hashExtra ?? '', input.system, input.cacheablePrefix ?? '', input.user].join('\u0000'),
  );
  const ctx = { userId: input.userId, orgId: input.org.id };

  // 1. Hurtigbuffer: samme input → samme svar, uten ny kostnad.
  if (!input.force) {
    const cached = await withTenant(ctx, async (tx) => {
      const row = first(
        (await tx`
          select id, result from ai_analyses
          where kind = ${input.kind} and input_hash = ${inputHash} and status = 'completed'
            and (org_id is null or org_id = ${input.org.id})
          order by created_at desc limit 1
        `) as unknown as { id: string; result: Record<string, unknown> }[],
      );
      if (row) {
        await recordUsage(tx, { orgId: input.org.id, userId: input.userId, kind: input.usageKind, inputTokens: 0, outputTokens: 0, costUsd: 0, cached: true });
      }
      return row;
    });
    if (cached) return { ok: true, analysisId: cached.id, result: cached.result, cached: true };
  }

  // 2. Kvote og hastighetsbegrensning.
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

  // 3. Kall leverandøren.
  const started = Date.now();
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
    await storeFailure(input, inputHash, provider.name, provider.model, message, Date.now() - started);
    log.warn('ai_call_failed', { kind: input.kind, org: input.org.id, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, code: 'provider_error', error: `${message} Prøv igjen om litt.` };
  }

  const costUsd = estimateCostUsd(response.model, response);
  // Bufrede tokens regnes med i «inn» i loggen; kostnaden over tar hensyn til lavere pris.
  const totalInput = response.inputTokens + response.cacheReadTokens + response.cacheWriteTokens;
  const parsed = input.validator.safeParse(response.data);
  if (!parsed.success) {
    const message = 'AI-svaret hadde feil format og ble forkastet.';
    await storeFailure(input, inputHash, response.provider, response.model, `${message} ${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.') + ': ' + i.message).join('; ')}`, Date.now() - started, totalInput, response.outputTokens, costUsd);
    await withTenant(ctx, (tx) =>
      recordUsage(tx, { orgId: input.org.id, userId: input.userId, kind: input.usageKind, inputTokens: totalInput, outputTokens: response.outputTokens, costUsd, cached: false }),
    );
    return { ok: false, code: 'invalid_output', error: `${message} Prøv igjen.` };
  }

  const result: Record<string, unknown> = {
    data: parsed.data,
    provider: response.provider,
    model: response.model,
    promptVersion: PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    isMock: response.provider === 'mock',
    ...(input.enrich ? input.enrich(parsed.data) : {}),
  };

  // 4. Lagre. Globale analyser (kun offentlig tekst) skrives av systemet og deles av alle –
  // men simulerte svar fra testmodus deles aldri med andre organisasjoner.
  const duration = Date.now() - started;
  let analysisId: string;
  if (input.isPrivate || demo) {
    analysisId = await withTenant(ctx, async (tx) => {
      const [row] = (await tx`
        insert into ai_analyses (kind, tender_id, org_id, workspace_id, input_hash, prompt_version, provider, model, status, result,
                                 input_tokens, output_tokens, cost_usd, duration_ms, created_by)
        values (${input.kind}, ${input.tenderId}, ${input.org.id}, ${input.workspaceId ?? null}, ${inputHash}, ${PROMPT_VERSION},
                ${response.provider}, ${response.model}, 'completed', ${toJson(result)}::text::jsonb, ${totalInput},
                ${response.outputTokens}, ${costUsd}, ${duration}, ${input.userId})
        returning id
      `) as unknown as { id: string }[];
      return row!.id;
    });
  } else {
    const [row] = (await systemSql()`
      insert into ai_analyses (kind, tender_id, org_id, input_hash, prompt_version, provider, model, status, result,
                               input_tokens, output_tokens, cost_usd, duration_ms, created_by)
      values (${input.kind}, ${input.tenderId}, null, ${inputHash}, ${PROMPT_VERSION}, ${response.provider}, ${response.model},
              'completed', ${toJson(result)}::text::jsonb, ${totalInput}, ${response.outputTokens}, ${costUsd}, ${duration}, ${input.userId})
      returning id
    `) as unknown as { id: string }[];
    analysisId = row!.id;
  }
  await withTenant(ctx, (tx) =>
    recordUsage(tx, { orgId: input.org.id, userId: input.userId, kind: input.usageKind, inputTokens: totalInput, outputTokens: response.outputTokens, costUsd, cached: false }),
  );
  return { ok: true, analysisId, result, cached: false };
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
    select count(*)::int as n from usage_records
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
