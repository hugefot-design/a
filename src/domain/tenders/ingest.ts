import { systemSql, toJson, type Tx } from '@/lib/db';
import { log } from '@/lib/logger';
import {
  cleanOrgNumber,
  cpvPrefixes,
  deriveIndustries,
  laterLifecycle,
  NORMALIZE_VERSION,
  normalizedNoticeSchema,
  normalizeName,
  noticeHash,
  regionCodesFor,
  type Lifecycle,
  type NormalizedNotice,
  type SourceId,
} from './normalize';

/**
 * Importrørledning: validering → deduplisering → lagring → endringslogg → tildelinger.
 * Kjøres med systemrollen. Hver kunngjøring lagres i egen transaksjon slik at én feil
 * ikke stopper resten av importen.
 */

export interface IngestStats {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  errors: number;
  tenderIds: string[];
}

export interface ImportRun {
  id: string;
  source: SourceId;
}

export async function startImportRun(
  source: SourceId,
  trigger: 'schedule' | 'manual' | 'cli' | 'upload',
  params: Record<string, unknown>,
  triggeredBy?: string | null,
): Promise<ImportRun> {
  const rows = (await systemSql()`
    insert into import_runs (source, status, trigger, params, triggered_by)
    values (${source}, 'running', ${trigger}, ${toJson(params)}::text::jsonb, ${triggeredBy ?? null})
    returning id
  `) as unknown as { id: string }[];
  await systemSql()`update data_sources set last_run_at = now() where id = ${source}`;
  return { id: rows[0]!.id, source };
}

/**
 * Avslutter en importkjøring. `updateSource: false` brukes for kjøringer som ikke sveiper et
 * tidsvindu (f.eks. henting av enkeltkunngjøringer per Doffin-ID): de skal ikke flytte
 * `last_success_at`, som styrer hvor langt tilbake neste planlagte henting går.
 */
export async function finishImportRun(
  run: ImportRun,
  stats: IngestStats,
  fatalError?: string,
  live = false,
  opts: { updateSource?: boolean } = {},
): Promise<void> {
  const status = fatalError ? 'failed' : stats.errors > 0 ? 'partial' : 'success';
  const sql = systemSql();
  await sql`
    update import_runs set status = ${status}, finished_at = now(),
      fetched_count = ${stats.fetched}, created_count = ${stats.created}, updated_count = ${stats.updated},
      unchanged_count = ${stats.unchanged}, duplicate_count = ${stats.duplicates}, error_count = ${stats.errors},
      error_summary = ${fatalError ?? null}
    where id = ${run.id}
  `;
  if (opts.updateSource === false) return;
  if (fatalError) {
    await sql`update data_sources set last_error_at = now(), last_error = ${fatalError.slice(0, 1000)} where id = ${run.source}`;
  } else {
    // Merkes som verifisert mot live API først etter en vellykket henting fra kilden.
    await sql`
      update data_sources set last_success_at = now(), last_error = null,
        verified_live = verified_live or ${live && stats.fetched > 0}
      where id = ${run.source}
    `;
  }
}

export async function recordImportError(
  run: ImportRun | null,
  stage: string,
  error: string,
  sourceNoticeId?: string | null,
  raw?: unknown,
): Promise<void> {
  try {
    await systemSql()`
      insert into import_errors (run_id, source, source_notice_id, stage, error, raw)
      values (${run?.id ?? null}, ${run?.source ?? null}, ${sourceNoticeId ?? null}, ${stage}, ${error.slice(0, 2000)},
              ${toJson(raw === undefined ? null : raw)}::text::jsonb)
    `;
  } catch (err) {
    log.error('import_error_record_failed', { err });
  }
}

function emptyStats(): IngestStats {
  return { fetched: 0, created: 0, updated: 0, unchanged: 0, duplicates: 0, errors: 0, tenderIds: [] };
}

interface ExistingTender {
  id: string;
  title: string;
  description: string | null;
  lifecycle: Lifecycle;
  deadlineAt: Date | null;
  deadlineTimeKnown: boolean;
  estimatedValue: number | null;
  currency: string | null;
  documentsUrl: string | null;
  sourceUpdatedAt: Date | null;
  publishedAt: Date | null;
  firstSeenAt: Date;
  cpvCodes: string[];
  nutsCodes: string[];
  buyerName: string | null;
  buyerOrgNumber: string | null;
  sourceUrl: string | null;
  receivedTenders: number | null;
  textLanguage: string | null;
  questionsDeadlineAt: Date | null;
  participationDeadlineAt: Date | null;
  deadlineKind: string | null;
  lotDeadlinesDiffer: boolean;
  durationMonths: number | null;
  durationText: string | null;
  contractStart: Date | null;
  contractEnd: Date | null;
  submissionUrl: string | null;
  lots: unknown[];
  selectionCriteria: unknown[];
  awardCriteria: unknown[];
  isFramework: boolean | null;
}

async function upsertAuthority(tx: Tx, n: NormalizedNotice, orgNumber: string | null): Promise<string | null> {
  if (!n.buyerName) return null;
  const normalized = normalizeName(n.buyerName);
  if (orgNumber) {
    const rows = (await tx`
      insert into authorities (name, normalized_name, org_number, country_code, city)
      values (${n.buyerName}, ${normalized}, ${orgNumber}, ${n.countryCode}, ${n.buyerCity})
      on conflict (country_code, org_number) where org_number is not null
      do update set city = coalesce(authorities.city, excluded.city)
      returning id
    `) as unknown as { id: string }[];
    return rows[0]!.id;
  }
  const existing = (await tx`
    select id from authorities where country_code = ${n.countryCode} and normalized_name = ${normalized} limit 1
  `) as unknown as { id: string }[];
  if (existing[0]) return existing[0].id;
  const rows = (await tx`
    insert into authorities (name, normalized_name, country_code, city)
    values (${n.buyerName}, ${normalized}, ${n.countryCode}, ${n.buyerCity})
    returning id
  `) as unknown as { id: string }[];
  return rows[0]!.id;
}

async function upsertSupplier(tx: Tx, name: string, orgNumberRaw: string | null, countryCode: string): Promise<string> {
  const orgNumber = orgNumberRaw ? cleanOrgNumber(orgNumberRaw, countryCode) : null;
  const normalized = normalizeName(name);
  if (orgNumber) {
    const rows = (await tx`
      insert into suppliers (name, normalized_name, org_number, country_code)
      values (${name}, ${normalized}, ${orgNumber}, ${countryCode})
      on conflict (country_code, org_number) where org_number is not null do update set name = suppliers.name
      returning id
    `) as unknown as { id: string }[];
    return rows[0]!.id;
  }
  const rows = (await tx`
    insert into suppliers (name, normalized_name, country_code)
    values (${name}, ${normalized}, ${countryCode})
    on conflict (coalesce(country_code, '--'), normalized_name) where org_number is null do update set name = suppliers.name
    returning id
  `) as unknown as { id: string }[];
  return rows[0]!.id;
}

/**
 * Finn samme anskaffelse fra en annen kilde (f.eks. Doffin-kunngjøring som også ligger på TED).
 *
 * TED har engelsk tekst og Doffin norsk, så tittellikhet alene virker ikke på tvers av kildene.
 * Kravene: samme oppdragsgiver (org.nr. eller svært likt navn), publisert innen 45 dager, og ett av:
 *  - samme interne referanse hos oppdragsgiver
 *  - lik tittel (samme språk)
 *  - samme tilbudsfrist (±2 min) og overlappende CPV-gruppe, uten motstridende verdi (>5 % forskjell)
 */
async function findDuplicate(tx: Tx, n: NormalizedNotice, orgNumber: string | null): Promise<string | null> {
  if (!n.buyerName && !orgNumber) return null;
  const published = n.publishedAt ? new Date(n.publishedAt) : null;
  const deadline = n.deadlineAt ? new Date(n.deadlineAt) : null;
  const groups = [...new Set(n.cpvCodes.map((c) => c.slice(0, 3)))];
  const rows = (await tx`
    select t.id
    from tenders t
    where t.country_code = ${n.countryCode}
      and t.is_sample = ${n.source === 'sample'}
      and (
        (${orgNumber}::text is not null and t.buyer_org_number = ${orgNumber})
        or (${n.buyerName}::text is not null and similarity(coalesce(t.buyer_name, ''), ${n.buyerName ?? ''}) > 0.6)
      )
      and (
        (${n.buyerReference}::text is not null and t.buyer_reference = ${n.buyerReference})
        or similarity(t.title, ${n.title}) > 0.55
        or (
          ${deadline}::timestamptz is not null and t.deadline_at is not null
          and abs(extract(epoch from (t.deadline_at - ${deadline}::timestamptz))) <= 120
          and exists (select 1 from unnest(t.cpv_codes) c where left(c, 3) = any(${groups}::text[]))
          and (t.estimated_value is null or ${n.estimatedValue}::numeric is null
               or abs(t.estimated_value - ${n.estimatedValue}::numeric) <= greatest(t.estimated_value, ${n.estimatedValue}::numeric) * 0.05)
        )
      )
      and (${published}::timestamptz is null or t.published_at is null
           or abs(extract(epoch from (t.published_at - ${published}::timestamptz))) < 45 * 86400)
      and not exists (select 1 from tender_sources s where s.tender_id = t.id and s.source = ${n.source})
    order by (t.deadline_at is not distinct from ${deadline}::timestamptz) desc, similarity(t.title, ${n.title}) desc
    limit 1
  `) as unknown as { id: string }[];
  return rows[0]?.id ?? null;
}

interface UpdateEvent {
  type: 'deadline_changed' | 'cancelled' | 'awarded' | 'value_changed' | 'details_changed' | 'documents_changed' | 'new_notice';
  summary: string;
  oldValue?: unknown;
  newValue?: unknown;
}

function formatShortDate(iso: string | Date | null): string {
  if (!iso) return 'ikke oppgitt';
  return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Oslo' }).format(new Date(iso));
}

/** Ren funksjon: hvilke endringer er verdt å varsle om? */
export function detectChanges(existing: ExistingTender, n: NormalizedNotice, isNewerNotice: boolean, isNewSourceNotice: boolean): UpdateEvent[] {
  const events: UpdateEvent[] = [];
  const nextLifecycle = laterLifecycle(existing.lifecycle, n.lifecycle);
  if (nextLifecycle !== existing.lifecycle) {
    if (nextLifecycle === 'cancelled') events.push({ type: 'cancelled', summary: 'Konkurransen er avlyst ifølge kilden.' });
    else if (nextLifecycle === 'awarded') {
      const winners = [...new Set(n.awards.map((a) => a.supplierName))].slice(0, 3);
      events.push({
        type: 'awarded',
        summary: winners.length ? `Kontrakten er tildelt ${winners.join(', ')}.` : 'Det er publisert en tildelingskunngjøring.',
        newValue: winners,
      });
    }
  }
  if (isNewerNotice && n.deadlineAt) {
    const oldMs = existing.deadlineAt?.getTime() ?? null;
    const newMs = new Date(n.deadlineAt).getTime();
    if (oldMs !== null && Math.abs(oldMs - newMs) > 60_000) {
      events.push({
        type: 'deadline_changed',
        summary: `Fristen er endret fra ${formatShortDate(existing.deadlineAt)} til ${formatShortDate(n.deadlineAt)}.`,
        oldValue: existing.deadlineAt?.toISOString(),
        newValue: n.deadlineAt,
      });
    }
  }
  if (isNewerNotice && n.estimatedValue !== null && existing.estimatedValue !== null && Math.abs(n.estimatedValue - existing.estimatedValue) >= 1) {
    events.push({ type: 'value_changed', summary: 'Estimert verdi er endret.', oldValue: existing.estimatedValue, newValue: n.estimatedValue });
  }
  if (isNewerNotice && n.documentsUrl && existing.documentsUrl && n.documentsUrl !== existing.documentsUrl) {
    events.push({ type: 'documents_changed', summary: 'Lenken til konkurransedokumentene er endret.', oldValue: existing.documentsUrl, newValue: n.documentsUrl });
  }
  if (isNewerNotice && normalizeName(n.title) !== normalizeName(existing.title) && n.lifecycle === 'competition') {
    events.push({ type: 'details_changed', summary: 'Tittelen på kunngjøringen er endret.', oldValue: existing.title, newValue: n.title });
  }
  if (events.length === 0 && isNewSourceNotice && isNewerNotice && n.lifecycle !== 'awarded') {
    events.push({ type: 'new_notice', summary: 'Det er publisert en ny kunngjøring (endring eller rettelse) for denne anskaffelsen.' });
  }
  return events;
}

function rawFormatOf(raw: unknown): string | null {
  return raw && typeof raw === 'object' && typeof (raw as { format?: unknown }).format === 'string' ? (raw as { format: string }).format : null;
}

function dateOrNull(iso: string | null | undefined): Date | null {
  return iso ? new Date(iso) : null;
}

/** Nyeste ikke-tomme verdi vinner; ellers beholdes det vi har. */
function pick<T>(isNewer: boolean, incoming: T | null | undefined, existing: T | null | undefined): T | null {
  const inc = incoming ?? null;
  const ex = existing ?? null;
  return isNewer ? (inc ?? ex) : (ex ?? inc);
}

function pickList<T>(isNewer: boolean, incoming: T[] | undefined, existing: T[] | null | undefined): T[] {
  const inc = incoming ?? [];
  const ex = existing ?? [];
  if (!inc.length) return ex;
  if (!ex.length) return inc;
  return isNewer ? inc : ex;
}

async function processNotice(n: NormalizedNotice, stats: IngestStats, runStartedAt: Date): Promise<void> {
  const sql = systemSql();
  const hash = noticeHash(n);
  const orgNumber = n.buyerOrgNumber ? cleanOrgNumber(n.buyerOrgNumber, n.countryCode) : null;
  const prefixes = cpvPrefixes(n.cpvCodes);
  const industries = deriveIndustries(prefixes, n.title, n.description);
  const regions = regionCodesFor(n);
  const d = n.details ?? {};

  await sql.begin(async (rawTx) => {
    const tx = rawTx as unknown as Tx;
    const existingSource = (await tx`
      select s.id, s.tender_id, s.content_hash, s.normalize_version, s.raw->>'format' as raw_format,
             t.lifecycle as tender_lifecycle, t.first_seen_at as tender_first_seen_at
      from tender_sources s join tenders t on t.id = s.tender_id
      where s.source = ${n.source} and s.source_notice_id = ${n.sourceNoticeId}
    `) as unknown as {
      id: string;
      tenderId: string;
      contentHash: string;
      normalizeVersion: number;
      rawFormat: string | null;
      tenderLifecycle: Lifecycle;
      tenderFirstSeenAt: Date;
    }[];

    if (existingSource[0] && existingSource[0].contentHash === hash) {
      await tx`update tender_sources set fetched_at = now(), removed_at = null where id = ${existingSource[0].id}`;
      await tx`update tenders set last_checked_at = now() where id = ${existingSource[0].tenderId}`;
      stats.unchanged++;
      return;
    }

    // Doffin: en kunngjøring som er hentet som full eForms-XML, er mer komplett enn søketreffet for
    // samme Doffin-ID. Søket får ikke overskrive den – bare melde at konkurransen senere er avlyst eller tildelt.
    const incomingFormat = rawFormatOf(n.raw);
    const existing0 = existingSource[0];
    if (existing0 && existing0.rawFormat === 'eforms-xml' && incomingFormat !== 'eforms-xml') {
      await tx`update tender_sources set fetched_at = now(), removed_at = null where id = ${existing0.id}`;
      const next = laterLifecycle(existing0.tenderLifecycle, n.lifecycle);
      if (next === existing0.tenderLifecycle || (next !== 'cancelled' && next !== 'awarded')) {
        await tx`update tenders set last_checked_at = now() where id = ${existing0.tenderId}`;
        stats.unchanged++;
        return;
      }
      await tx`update tenders set lifecycle = ${next}, last_checked_at = now() where id = ${existing0.tenderId}`;
      if (existing0.tenderFirstSeenAt < runStartedAt) {
        const summary = next === 'cancelled' ? 'Konkurransen er avlyst ifølge kilden.' : 'Det er publisert en tildelingskunngjøring.';
        await tx`
          insert into tender_updates (tender_id, source, change_type, summary, old_value, new_value)
          values (${existing0.tenderId}, ${n.source}, ${next}, ${summary}, ${toJson(existing0.tenderLifecycle)}::text::jsonb, ${toJson(next)}::text::jsonb)
        `;
      }
      stats.updated++;
      stats.tenderIds.push(existing0.tenderId);
      return;
    }

    // Samme kunngjøring på nytt, men oversatt med en nyere versjon av koden – eller første gang et
    // Doffin-søketreff berikes med full eForms-XML: rett dataene uten å lage endringsvarsler
    // (det er ikke oppdragsgiver som har endret noe).
    const isRemap = Boolean(
      existing0 && (existing0.normalizeVersion !== NORMALIZE_VERSION || (incomingFormat === 'eforms-xml' && existing0.rawFormat !== 'eforms-xml')),
    );

    let tenderId: string | null = existingSource[0]?.tenderId ?? null;
    let duplicate = false;
    if (!tenderId && d.noticeIdentifier) {
      const byNotice = (await tx`
        select tender_id from tender_sources where notice_identifier = ${d.noticeIdentifier} limit 1
      `) as unknown as { tenderId: string }[];
      tenderId = byNotice[0]?.tenderId ?? null;
      if (tenderId) {
        const otherSource = await tx`select 1 from tender_sources where tender_id = ${tenderId} and source <> ${n.source} limit 1`;
        duplicate = otherSource.length > 0;
      }
    }
    if (!tenderId && n.procedureId) {
      const byProc = (await tx`select id from tenders where procedure_id = ${n.procedureId}`) as unknown as { id: string }[];
      tenderId = byProc[0]?.id ?? null;
      if (tenderId) {
        const otherSource = await tx`select 1 from tender_sources where tender_id = ${tenderId} and source <> ${n.source} limit 1`;
        duplicate = otherSource.length > 0;
      }
    }
    if (!tenderId) {
      tenderId = await findDuplicate(tx, n, orgNumber);
      duplicate = tenderId !== null;
    }

    const authorityId = await upsertAuthority(tx, n, orgNumber);
    const published = n.publishedAt ? new Date(n.publishedAt) : null;

    if (!tenderId) {
      const canonicalKey = n.procedureId ? `proc:${n.procedureId}` : `${n.source}:${n.sourceNoticeId}`;
      const rows = (await tx`
        insert into tenders (
          canonical_key, procedure_id, buyer_reference, title, description, authority_id, buyer_name, buyer_org_number,
          country_code, nuts_codes, region_codes, place_text, cpv_codes, cpv_prefixes, main_cpv, industry_ids,
          contract_nature, procedure_type, notice_type, lifecycle, estimated_value, currency, published_at,
          deadline_at, deadline_time_known, source_url, documents_url, received_tenders, is_sample,
          source_updated_at, content_hash,
          questions_deadline_at, participation_deadline_at, deadline_kind, lot_deadlines_differ, duration_months, duration_text,
          contract_start, contract_end, submission_url, lots, selection_criteria, award_criteria, is_framework, text_language
        ) values (
          ${canonicalKey}, ${n.procedureId}, ${n.buyerReference}, ${n.title}, ${n.description}, ${authorityId}, ${n.buyerName}, ${orgNumber},
          ${n.countryCode}, ${n.nutsCodes}::text[], ${regions}::text[], ${n.placeText ?? n.buyerCity}, ${n.cpvCodes}::text[],
          ${prefixes}::text[], ${n.mainCpv ?? n.cpvCodes[0] ?? null}, ${industries}::text[],
          ${n.contractNature}, ${n.procedureType}, ${n.noticeType}, ${n.lifecycle}, ${n.estimatedValue}, ${n.currency}, ${published},
          ${dateOrNull(n.deadlineAt)}, ${n.deadlineTimeKnown}, ${n.sourceUrl}, ${n.documentsUrl}, ${n.receivedTenders},
          ${n.source === 'sample'}, ${published}, ${hash},
          ${dateOrNull(d.questionsDeadlineAt)}, ${dateOrNull(d.participationDeadlineAt)}, ${d.deadlineKind ?? (n.deadlineAt ? 'tender' : null)},
          ${d.lotDeadlinesDiffer ?? false}, ${d.durationMonths ?? null}, ${d.durationText ?? null},
          ${dateOrNull(d.contractStart)}, ${dateOrNull(d.contractEnd)}, ${d.submissionUrl ?? null},
          ${toJson(d.lots ?? [])}::text::jsonb, ${toJson(d.selectionCriteria ?? [])}::text::jsonb, ${toJson(d.awardCriteria ?? [])}::text::jsonb,
          ${d.isFramework ?? null}, ${d.language ?? null}
        )
        on conflict (canonical_key) do update set last_checked_at = now()
        returning id
      `) as unknown as { id: string }[];
      tenderId = rows[0]!.id;
      stats.created++;
    } else {
      const current = (await tx`
        select id, title, description, lifecycle, deadline_at, deadline_time_known, estimated_value, currency, documents_url,
               source_updated_at, published_at, first_seen_at, cpv_codes, nuts_codes, buyer_name, buyer_org_number, source_url,
               received_tenders, text_language, questions_deadline_at, participation_deadline_at, deadline_kind, lot_deadlines_differ,
               duration_months, duration_text, contract_start, contract_end, submission_url, lots, selection_criteria, award_criteria,
               is_framework
        from tenders where id = ${tenderId} for update
      `) as unknown as ExistingTender[];
      const existing = current[0]!;
      const isNewer = !existing.sourceUpdatedAt || !published || published.getTime() >= existing.sourceUpdatedAt.getTime();
      const events =
        existing.firstSeenAt < runStartedAt && !isRemap ? detectChanges(existing, n, isNewer, !existingSource[0]) : [];

      // Norsk tekst (Doffin) foretrekkes framfor engelsk (TED) uansett rekkefølge; ellers vinner nyeste.
      const incomingLang = d.language ?? null;
      const preferIncomingText =
        incomingLang === 'nb' && existing.textLanguage !== 'nb' ? true : incomingLang !== 'nb' && existing.textLanguage === 'nb' ? false : isNewer;

      const cpvUnion = [...new Set([...existing.cpvCodes, ...n.cpvCodes])].sort();
      const nutsUnion = [...new Set([...existing.nutsCodes, ...n.nutsCodes])].sort();
      const mergedPrefixes = cpvPrefixes(cpvUnion);
      const mergedRegions = regionCodesFor({ nutsCodes: nutsUnion, countryCode: n.countryCode });
      const lifecycle = laterLifecycle(existing.lifecycle, n.lifecycle);
      const title = preferIncomingText ? n.title : existing.title || n.title;
      const description = preferIncomingText ? (n.description ?? existing.description) : (existing.description ?? n.description);
      const textLanguage = preferIncomingText ? (incomingLang ?? existing.textLanguage) : (existing.textLanguage ?? incomingLang);
      const deadline = isNewer && n.deadlineAt ? new Date(n.deadlineAt) : (existing.deadlineAt ?? dateOrNull(n.deadlineAt));
      const deadlineTimeKnown = isNewer && n.deadlineAt ? n.deadlineTimeKnown : existing.deadlineTimeKnown;
      const deadlineKind = isNewer && n.deadlineAt ? (d.deadlineKind ?? 'tender') : (existing.deadlineKind ?? d.deadlineKind ?? null);
      const value = isNewer && n.estimatedValue !== null ? n.estimatedValue : (existing.estimatedValue ?? n.estimatedValue);
      const currency = isNewer && n.estimatedValue !== null ? n.currency : (existing.currency ?? n.currency);
      const sourceUrl = n.source === 'doffin' && n.sourceUrl ? n.sourceUrl : (existing.sourceUrl ?? n.sourceUrl);
      const sourceUpdatedAt =
        published && (!existing.sourceUpdatedAt || published > existing.sourceUpdatedAt) ? published : existing.sourceUpdatedAt;
      const firstPublished =
        existing.publishedAt && published ? (published < existing.publishedAt ? published : existing.publishedAt) : (existing.publishedAt ?? published);
      const received = Math.max(existing.receivedTenders ?? -1, n.receivedTenders ?? -1);

      await tx`
        update tenders set
          title = ${title}, description = ${description}, text_language = ${textLanguage}, lifecycle = ${lifecycle},
          deadline_at = ${deadline}, deadline_time_known = ${deadlineTimeKnown}, deadline_kind = ${deadline ? deadlineKind : null},
          estimated_value = ${value}, currency = ${currency},
          cpv_codes = ${cpvUnion}::text[], cpv_prefixes = ${mergedPrefixes}::text[],
          industry_ids = ${deriveIndustries(mergedPrefixes, title, description)}::text[],
          main_cpv = coalesce(main_cpv, ${n.mainCpv}),
          nuts_codes = ${nutsUnion}::text[], region_codes = ${mergedRegions}::text[],
          buyer_name = coalesce(buyer_name, ${n.buyerName}), buyer_org_number = coalesce(buyer_org_number, ${orgNumber}),
          authority_id = coalesce(authority_id, ${authorityId}),
          buyer_reference = coalesce(buyer_reference, ${n.buyerReference}),
          procedure_id = coalesce(procedure_id, ${n.procedureId}),
          place_text = coalesce(place_text, ${n.placeText ?? n.buyerCity}),
          contract_nature = coalesce(contract_nature, ${n.contractNature}),
          procedure_type = coalesce(procedure_type, ${n.procedureType}),
          notice_type = coalesce(${isNewer ? n.noticeType : null}, notice_type),
          documents_url = ${pick(isNewer, n.documentsUrl, existing.documentsUrl)},
          source_url = ${sourceUrl},
          received_tenders = ${received >= 0 ? received : null},
          published_at = ${firstPublished}, source_updated_at = ${sourceUpdatedAt},
          questions_deadline_at = ${pick(isNewer, dateOrNull(d.questionsDeadlineAt), existing.questionsDeadlineAt)},
          participation_deadline_at = ${pick(isNewer, dateOrNull(d.participationDeadlineAt), existing.participationDeadlineAt)},
          lot_deadlines_differ = ${isNewer && n.deadlineAt ? (d.lotDeadlinesDiffer ?? false) : existing.lotDeadlinesDiffer},
          duration_months = ${pick(isNewer, d.durationMonths, existing.durationMonths)},
          duration_text = ${pick(isNewer, d.durationText, existing.durationText)},
          contract_start = ${pick(isNewer, dateOrNull(d.contractStart), existing.contractStart)},
          contract_end = ${pick(isNewer, dateOrNull(d.contractEnd), existing.contractEnd)},
          submission_url = ${pick(isNewer, d.submissionUrl, existing.submissionUrl)},
          lots = ${toJson(pickList(isNewer, d.lots, existing.lots))}::text::jsonb,
          selection_criteria = ${toJson(pickList(isNewer, d.selectionCriteria, existing.selectionCriteria))}::text::jsonb,
          award_criteria = ${toJson(pickList(isNewer, d.awardCriteria, existing.awardCriteria))}::text::jsonb,
          is_framework = ${pick(isNewer, d.isFramework, existing.isFramework)},
          last_checked_at = now(), content_hash = ${hash}
        where id = ${tenderId}
      `;
      for (const e of events) {
        await tx`
          insert into tender_updates (tender_id, source, change_type, summary, old_value, new_value)
          values (${tenderId}, ${n.source}, ${e.type}, ${e.summary}, ${toJson(e.oldValue ?? null)}::text::jsonb, ${toJson(e.newValue ?? null)}::text::jsonb)
        `;
      }
      if (duplicate) stats.duplicates++;
      stats.updated++;
    }

    await tx`
      insert into tender_sources (tender_id, source, source_notice_id, notice_type, source_url, published_at, raw, content_hash,
                                  notice_identifier, notice_version, normalize_version, change_description)
      values (${tenderId}, ${n.source}, ${n.sourceNoticeId}, ${n.noticeType}, ${n.sourceUrl}, ${published},
              ${toJson(n.raw ?? null)}::text::jsonb, ${hash}, ${d.noticeIdentifier ?? null}, ${d.noticeVersion ?? null},
              ${NORMALIZE_VERSION}, ${d.changeDescription ?? null})
      on conflict (source, source_notice_id) do update set
        tender_id = excluded.tender_id, notice_type = excluded.notice_type, source_url = excluded.source_url,
        published_at = excluded.published_at, raw = excluded.raw, content_hash = excluded.content_hash,
        notice_identifier = excluded.notice_identifier, notice_version = excluded.notice_version,
        normalize_version = excluded.normalize_version, change_description = excluded.change_description,
        fetched_at = now(), removed_at = null
    `;

    for (const a of n.awards) {
      const supplierId = await upsertSupplier(tx, a.supplierName, a.supplierOrgNumber, n.countryCode);
      await tx`
        insert into contract_awards (tender_id, supplier_id, supplier_name, lot_title, awarded_value, currency, award_date, source, source_notice_id)
        values (${tenderId}, ${supplierId}, ${a.supplierName}, ${a.lotTitle}, ${a.value}, ${a.currency ?? n.currency},
                ${a.awardDate ? a.awardDate.slice(0, 10) : null}, ${n.source}, ${n.sourceNoticeId})
        on conflict (source, source_notice_id, lower(supplier_name), coalesce(lot_title, '')) do update set
          awarded_value = excluded.awarded_value, award_date = excluded.award_date, supplier_id = excluded.supplier_id
      `;
    }
    stats.tenderIds.push(tenderId);
  });
}

/** Validerer og lagrer kunngjøringer. Returnerer statistikk. */
export async function ingestNotices(notices: NormalizedNotice[], run: ImportRun | null): Promise<IngestStats> {
  const stats = emptyStats();
  const runStartedAt = new Date();
  for (const candidate of notices) {
    stats.fetched++;
    const parsed = normalizedNoticeSchema.safeParse(candidate);
    if (!parsed.success) {
      stats.errors++;
      const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      await recordImportError(run, 'validation', msg, candidate?.sourceNoticeId, candidate?.raw ?? candidate);
      continue;
    }
    try {
      await processNotice(parsed.data as NormalizedNotice, stats, runStartedAt);
    } catch (err) {
      stats.errors++;
      await recordImportError(run, 'storage', err instanceof Error ? err.message : String(err), candidate.sourceNoticeId, candidate.raw);
      log.warn('ingest_notice_failed', { sourceNoticeId: candidate.sourceNoticeId, err });
    }
  }
  return stats;
}

/** Marker en kunngjøring som fjernet hos kilden. Hvis ingen kilder gjenstår, trekkes anbudet. */
export async function markRemoved(source: SourceId, sourceNoticeId: string): Promise<void> {
  const sql = systemSql();
  await sql.begin(async (tx) => {
    const rows = (await tx`
      update tender_sources set removed_at = now() where source = ${source} and source_notice_id = ${sourceNoticeId} and removed_at is null
      returning tender_id
    `) as unknown as { tenderId: string }[];
    const tenderId = rows[0]?.tenderId;
    if (!tenderId) return;
    const remaining = await tx`select 1 from tender_sources where tender_id = ${tenderId} and removed_at is null limit 1`;
    if (remaining.length === 0) {
      await tx`update tenders set lifecycle = 'withdrawn' where id = ${tenderId}`;
      await tx`
        insert into tender_updates (tender_id, source, change_type, summary)
        values (${tenderId}, ${source}, 'removed', 'Kunngjøringen er fjernet fra kilden.')
      `;
    }
  });
}
