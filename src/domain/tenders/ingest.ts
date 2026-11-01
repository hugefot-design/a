import { systemSql, toJson, type Tx } from '@/lib/db';
import { log } from '@/lib/logger';
import {
  cleanOrgNumber,
  cpvPrefixes,
  deriveIndustries,
  laterLifecycle,
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

export async function finishImportRun(run: ImportRun, stats: IngestStats, fatalError?: string, live = false): Promise<void> {
  const status = fatalError ? 'failed' : stats.errors > 0 ? 'partial' : 'success';
  const sql = systemSql();
  await sql`
    update import_runs set status = ${status}, finished_at = now(),
      fetched_count = ${stats.fetched}, created_count = ${stats.created}, updated_count = ${stats.updated},
      unchanged_count = ${stats.unchanged}, duplicate_count = ${stats.duplicates}, error_count = ${stats.errors},
      error_summary = ${fatalError ?? null}
    where id = ${run.id}
  `;
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

/** Finn samme anskaffelse fra en annen kilde (f.eks. Doffin-kunngjøring som også ligger på TED). */
async function findDuplicate(tx: Tx, n: NormalizedNotice, orgNumber: string | null): Promise<string | null> {
  if (!n.buyerName && !orgNumber) return null;
  const published = n.publishedAt ? new Date(n.publishedAt) : null;
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
      )
      and (${published}::timestamptz is null or t.published_at is null
           or abs(extract(epoch from (t.published_at - ${published}::timestamptz))) < 45 * 86400)
      and not exists (select 1 from tender_sources s where s.tender_id = t.id and s.source = ${n.source})
    order by similarity(t.title, ${n.title}) desc
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

async function processNotice(n: NormalizedNotice, stats: IngestStats, runStartedAt: Date): Promise<void> {
  const sql = systemSql();
  const hash = noticeHash(n);
  const orgNumber = n.buyerOrgNumber ? cleanOrgNumber(n.buyerOrgNumber, n.countryCode) : null;
  const prefixes = cpvPrefixes(n.cpvCodes);
  const industries = deriveIndustries(prefixes, n.title, n.description);
  const regions = regionCodesFor(n);

  await sql.begin(async (rawTx) => {
    const tx = rawTx as unknown as Tx;
    const existingSource = (await tx`
      select id, tender_id, content_hash from tender_sources where source = ${n.source} and source_notice_id = ${n.sourceNoticeId}
    `) as unknown as { id: string; tenderId: string; contentHash: string }[];

    if (existingSource[0] && existingSource[0].contentHash === hash) {
      await tx`update tender_sources set fetched_at = now(), removed_at = null where id = ${existingSource[0].id}`;
      await tx`update tenders set last_checked_at = now() where id = ${existingSource[0].tenderId}`;
      stats.unchanged++;
      return;
    }

    let tenderId: string | null = existingSource[0]?.tenderId ?? null;
    let duplicate = false;
    if (!tenderId && n.procedureId) {
      const byProc = (await tx`select id from tenders where procedure_id = ${n.procedureId}`) as unknown as { id: string }[];
      tenderId = byProc[0]?.id ?? null;
      if (tenderId) {
        const otherSource = (await tx`select 1 from tender_sources where tender_id = ${tenderId} and source <> ${n.source} limit 1`);
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
          source_updated_at, content_hash
        ) values (
          ${canonicalKey}, ${n.procedureId}, ${n.buyerReference}, ${n.title}, ${n.description}, ${authorityId}, ${n.buyerName}, ${orgNumber},
          ${n.countryCode}, ${n.nutsCodes}::text[], ${regions}::text[], ${n.placeText ?? n.buyerCity}, ${n.cpvCodes}::text[],
          ${prefixes}::text[], ${n.mainCpv ?? n.cpvCodes[0] ?? null}, ${industries}::text[],
          ${n.contractNature}, ${n.procedureType}, ${n.noticeType}, ${n.lifecycle}, ${n.estimatedValue}, ${n.currency}, ${published},
          ${n.deadlineAt ? new Date(n.deadlineAt) : null}, ${n.deadlineTimeKnown}, ${n.sourceUrl}, ${n.documentsUrl}, ${n.receivedTenders},
          ${n.source === 'sample'}, ${published}, ${hash}
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
               received_tenders
        from tenders where id = ${tenderId} for update
      `) as unknown as ExistingTender[];
      const existing = current[0]!;
      const isNewer = !existing.sourceUpdatedAt || !published || published.getTime() >= existing.sourceUpdatedAt.getTime();
      const events = existing.firstSeenAt < runStartedAt ? detectChanges(existing, n, isNewer, !existingSource[0]) : [];

      const cpvUnion = [...new Set([...existing.cpvCodes, ...n.cpvCodes])].sort();
      const nutsUnion = [...new Set([...existing.nutsCodes, ...n.nutsCodes])].sort();
      const mergedPrefixes = cpvPrefixes(cpvUnion);
      const mergedRegions = regionCodesFor({ nutsCodes: nutsUnion, countryCode: n.countryCode });
      const lifecycle = laterLifecycle(existing.lifecycle, n.lifecycle);
      const title = isNewer && n.source !== 'ted' ? n.title : existing.title || n.title;
      const description = (isNewer && n.description) || existing.description || n.description;
      const deadline = isNewer && n.deadlineAt ? new Date(n.deadlineAt) : (existing.deadlineAt ?? (n.deadlineAt ? new Date(n.deadlineAt) : null));
      const deadlineTimeKnown = isNewer && n.deadlineAt ? n.deadlineTimeKnown : existing.deadlineTimeKnown;
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
          title = ${title}, description = ${description}, lifecycle = ${lifecycle},
          deadline_at = ${deadline}, deadline_time_known = ${deadlineTimeKnown},
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
          documents_url = coalesce(${isNewer ? n.documentsUrl : null}, documents_url, ${n.documentsUrl}),
          source_url = ${sourceUrl},
          received_tenders = ${received >= 0 ? received : null},
          published_at = ${firstPublished}, source_updated_at = ${sourceUpdatedAt},
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
      insert into tender_sources (tender_id, source, source_notice_id, notice_type, source_url, published_at, raw, content_hash)
      values (${tenderId}, ${n.source}, ${n.sourceNoticeId}, ${n.noticeType}, ${n.sourceUrl}, ${published},
              ${toJson(n.raw ?? null)}::text::jsonb, ${hash})
      on conflict (source, source_notice_id) do update set
        tender_id = excluded.tender_id, notice_type = excluded.notice_type, source_url = excluded.source_url,
        published_at = excluded.published_at, raw = excluded.raw, content_hash = excluded.content_hash,
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
