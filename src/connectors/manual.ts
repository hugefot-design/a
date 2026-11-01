/**
 * Manuell import: JSON eller CSV i AnbudRadars importformat, eller råsvar lagret fra
 * TEDs søke-API ({ notices: [...] }) eller Doffins offentlige API ({ hits: [...] }).
 * Formatet er dokumentert i docs/IMPORTFORMAT.md.
 */
import { z } from 'zod';
import { cleanCpv, cleanOrgNumber, combineDateTime, parseSourceDateTime, type Lifecycle, type NormalizedNotice } from '@/domain/tenders/normalize';
import { mapTedNotice } from './ted';
import { mapDoffinHit, type DoffinHit } from './doffin';

const manualRecord = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  description: z.string().optional().nullable(),
  buyer_name: z.string().optional().nullable(),
  buyer_org_number: z.union([z.string(), z.number()]).optional().nullable(),
  buyer_reference: z.string().optional().nullable(),
  country: z.string().length(2).optional().default('NO'),
  nuts: z.union([z.array(z.string()), z.string()]).optional().nullable(),
  place: z.string().optional().nullable(),
  cpv: z.union([z.array(z.string()), z.string()]).optional().nullable(),
  contract_type: z.enum(['works', 'supplies', 'services']).optional().nullable(),
  procedure_type: z.string().optional().nullable(),
  estimated_value: z.union([z.number(), z.string()]).optional().nullable(),
  currency: z.string().length(3).optional().nullable(),
  published_at: z.string().optional().nullable(),
  deadline_at: z.string().optional().nullable(),
  status: z.enum(['planned', 'competition', 'awarded', 'cancelled', 'direct_award']).optional().default('competition'),
  source_url: z.string().optional().nullable(),
  documents_url: z.string().optional().nullable(),
  awards: z
    .array(
      z.object({
        supplier_name: z.string(),
        supplier_org_number: z.union([z.string(), z.number()]).optional().nullable(),
        lot_title: z.string().optional().nullable(),
        value: z.union([z.number(), z.string()]).optional().nullable(),
        currency: z.string().length(3).optional().nullable(),
        award_date: z.string().optional().nullable(),
      }),
    )
    .optional()
    .default([]),
});

function list(value: string[] | string | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => v.trim()).filter(Boolean);
  return value
    .split(/[;,|]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function mapManualRecord(input: unknown): NormalizedNotice {
  const r = manualRecord.parse(input);
  const country = r.country.toUpperCase();
  const cpv = [...new Set(list(r.cpv).map(cleanCpv).filter((c): c is string => c !== null))];
  const hasTime = r.deadline_at ? /T\d{2}:\d{2}/.test(r.deadline_at) : false;
  const deadline = r.deadline_at
    ? hasTime
      ? { iso: parseSourceDateTime(r.deadline_at), timeKnown: true }
      : combineDateTime(r.deadline_at, null)
    : { iso: null, timeKnown: false };
  const value = num(r.estimated_value);
  return {
    source: 'manual',
    sourceNoticeId: r.id,
    sourceUrl: r.source_url ?? null,
    noticeType: r.status,
    lifecycle: r.status as Lifecycle,
    procedureId: null,
    buyerReference: r.buyer_reference ?? null,
    title: r.title.trim(),
    description: r.description ?? null,
    buyerName: r.buyer_name ?? null,
    buyerOrgNumber: r.buyer_org_number ? cleanOrgNumber(String(r.buyer_org_number), country) : null,
    buyerCity: r.place ?? null,
    countryCode: country,
    nutsCodes: list(r.nuts).map((n) => n.toUpperCase()),
    placeText: r.place ?? null,
    cpvCodes: cpv,
    mainCpv: cpv[0] ?? null,
    contractNature: r.contract_type ?? null,
    procedureType: r.procedure_type ?? null,
    estimatedValue: value,
    currency: value !== null ? (r.currency ?? 'NOK').toUpperCase() : null,
    publishedAt: r.published_at && !Number.isNaN(Date.parse(r.published_at)) ? new Date(r.published_at).toISOString() : null,
    deadlineAt: deadline.iso,
    deadlineTimeKnown: deadline.timeKnown,
    documentsUrl: r.documents_url ?? null,
    receivedTenders: null,
    awards: r.awards.map((a) => ({
      lotTitle: a.lot_title ?? null,
      supplierName: a.supplier_name,
      supplierOrgNumber: a.supplier_org_number ? String(a.supplier_org_number) : null,
      value: num(a.value),
      currency: (a.currency ?? r.currency ?? 'NOK').toUpperCase(),
      awardDate: a.award_date ?? null,
    })),
    raw: input,
  };
}

/** Enkel RFC 4180-parser (anførselstegn, komma/semikolon, linjeskift i felt). */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return data.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

export interface ParsedImport {
  format: 'anbudradar-json' | 'anbudradar-csv' | 'ted-api' | 'doffin-api';
  notices: NormalizedNotice[];
  errors: { index: number; id: string | null; error: string }[];
}

export function parseImportFile(filename: string, content: string): ParsedImport {
  const errors: ParsedImport['errors'] = [];
  const notices: NormalizedNotice[] = [];
  const isCsv = filename.toLowerCase().endsWith('.csv');
  if (isCsv) {
    parseCsv(content).forEach((row, index) => {
      try {
        // Tomme celler betyr «ikke oppgitt».
        notices.push(mapManualRecord(Object.fromEntries(Object.entries(row).filter(([, v]) => v !== ''))));
      } catch (err) {
        errors.push({ index, id: row.id ?? null, error: err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : String(err) });
      }
    });
    return { format: 'anbudradar-csv', notices, errors };
  }
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { format: 'anbudradar-json', notices, errors: [{ index: -1, id: null, error: 'Filen er ikke gyldig JSON.' }] };
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray((data as { notices?: unknown }).notices)) {
    ((data as { notices: Record<string, unknown>[] }).notices).forEach((hit, index) => {
      try {
        notices.push(mapTedNotice(hit));
      } catch (err) {
        errors.push({ index, id: null, error: err instanceof Error ? err.message : String(err) });
      }
    });
    return { format: 'ted-api', notices, errors };
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray((data as { hits?: unknown }).hits)) {
    ((data as { hits: DoffinHit[] }).hits).forEach((hit, index) => {
      try {
        notices.push(mapDoffinHit(hit));
      } catch (err) {
        errors.push({ index, id: hit?.id ?? null, error: err instanceof Error ? err.message : String(err) });
      }
    });
    return { format: 'doffin-api', notices, errors };
  }
  const records = Array.isArray(data) ? data : [data];
  records.forEach((rec, index) => {
    try {
      notices.push(mapManualRecord(rec));
    } catch (err) {
      const id = rec && typeof rec === 'object' && 'id' in rec ? String((rec as { id: unknown }).id) : null;
      errors.push({ index, id, error: err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : String(err) });
    }
  });
  return { format: 'anbudradar-json', notices, errors };
}
