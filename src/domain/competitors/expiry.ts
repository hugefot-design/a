/**
 * Kontraktsutløp-radar: tildelte kontrakter som trolig utløper snart – fremtidige konkurranser før de utlyses,
 * med hvem som har kontrakten i dag.
 *
 * Utløpet er et anslag og vises alltid med grunnlaget:
 *  - «oppgitt»: kunngjøringen har sluttdato (eForms/TED),
 *  - «beregnet»: oppstart (eller tildelingsdato når oppstart mangler) + varighet.
 * Opsjoner (forlengelser) står sjelden i dataene, så kontrakter kan vare lenger enn anslått. Tildelinger uten
 * sluttdato, varighet eller dato tas ikke med – de gjettes ikke – og antallet som mangler vises.
 */
import type { Tx } from '@/lib/db';

export type ExpiryBasis = 'oppgitt' | 'beregnet';

export interface ExpiryEstimate {
  end: Date;
  basis: ExpiryBasis;
  start: Date | null;
  durationMonths: number | null;
}

/** Legger til hele måneder (UTC). 31. januar + 1 måned = 28./29. februar, ikke 3. mars. */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return d;
}

/** Hele måneder fra «from» til «to» (negativt når «to» er passert). */
export function monthsUntil(to: Date, from: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (30.44 * 86_400_000));
}

const MAX_DURATION_MONTHS = 240;

/** Ren funksjon – samme regel som spørringen i {@link expiringContracts}. */
export function expectedEnd(t: { contractEnd: Date | null; contractStart: Date | null; durationMonths: number | null; awardDate: Date | null }): ExpiryEstimate | null {
  if (t.contractEnd) return { end: t.contractEnd, basis: 'oppgitt', start: t.contractStart, durationMonths: t.durationMonths };
  const start = t.contractStart ?? t.awardDate;
  if (!start || !t.durationMonths || t.durationMonths < 1 || t.durationMonths > MAX_DURATION_MONTHS) return null;
  // Varigheten lagres som desimaltall; rundes til hele måneder her og i spørringen.
  return { end: addMonths(start, Math.round(t.durationMonths)), basis: 'beregnet', start, durationMonths: t.durationMonths };
}

export interface ExpiringContract {
  tenderId: string;
  title: string;
  buyerName: string | null;
  authorityId: string | null;
  suppliers: { name: string; id: string | null }[];
  /** Sum av tildelte verdier (samme vinner fra flere kilder telles én gang). Null når ingen verdi er oppgitt. */
  value: number | null;
  currency: string | null;
  expectedEnd: Date;
  basis: ExpiryBasis;
  startDate: Date | null;
  awardDate: Date | null;
  durationMonths: number | null;
  durationText: string | null;
  isFramework: boolean | null;
}

export interface ExpiryFilter {
  /** Bransjer (industry_ids). Tom liste eller null = alle. */
  industries: string[] | null;
  /** Fylker (regionkoder). Tom liste eller null = alle. */
  regions: string[] | null;
  /** Hvor langt frem (måneder). Kontrakter som utløp de siste tre månedene tas også med. */
  monthsAhead: number;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export async function expiringContracts(
  tx: Tx,
  f: ExpiryFilter,
  now: Date = new Date(),
): Promise<{ rows: ExpiringContract[]; coverage: { awarded: number; withEnd: number } }> {
  const industries = f.industries?.length ? f.industries : null;
  const regions = f.regions?.length ? f.regions : null;
  const months = Math.min(Math.max(Math.round(f.monthsAhead), 1), 36);
  const from = isoDate(addMonths(now, -3));
  const to = isoDate(addMonths(now, months));
  const rows = (await tx`
    with t as (
      select t.id, t.title, t.buyer_name, t.authority_id, t.is_framework, t.duration_months, t.duration_text,
             t.contract_start::date as contract_start, t.contract_end::date as contract_end
      from tenders t
      where not t.is_sample
        and exists (select 1 from contract_awards a where a.tender_id = t.id)
        and (${industries}::text[] is null or t.industry_ids && ${industries}::text[])
        and (${regions}::text[] is null or t.region_codes && ${regions}::text[])
    ),
    d as (
      select distinct on (a.tender_id, coalesce(s.org_number, lower(a.supplier_name)), coalesce(lower(a.lot_title), ''))
        a.tender_id, a.supplier_id, a.supplier_name, a.awarded_value, a.currency, a.award_date
      from contract_awards a
      left join suppliers s on s.id = a.supplier_id
      where a.tender_id in (select id from t)
      order by a.tender_id, coalesce(s.org_number, lower(a.supplier_name)), coalesce(lower(a.lot_title), ''), a.awarded_value desc nulls last
    ),
    aw as (
      select tender_id, min(award_date) as award_date, sum(awarded_value)::float8 as value, max(currency) as currency,
             jsonb_agg(distinct jsonb_build_object('name', supplier_name, 'id', supplier_id)) as suppliers
      from d group by tender_id
    ),
    e as (
      select t.*, aw.award_date, aw.value, aw.currency, aw.suppliers,
             case
               when t.contract_end is not null then t.contract_end
               when coalesce(t.contract_start, aw.award_date) is not null and t.duration_months between 1 and ${MAX_DURATION_MONTHS}
                 then (coalesce(t.contract_start, aw.award_date) + make_interval(months => round(t.duration_months)::int))::date
             end as expected_end
      from t join aw on aw.tender_id = t.id
    )
    select id as tender_id, title, buyer_name, authority_id, is_framework, duration_months::float8 as duration_months, duration_text, contract_start as start_date,
           award_date, value, currency, suppliers, expected_end, case when contract_end is not null then 'oppgitt' else 'beregnet' end as basis
    from e
    where expected_end between ${from}::date and ${to}::date
    order by expected_end asc
    limit 300
  `) as unknown as ExpiringContract[];
  // Dekning: hvor mange tildelte kontrakter (med samme filter) vi kan anslå utløp for.
  const [cov] = (await tx`
    select count(*)::int as awarded,
           count(*) filter (
             where t.contract_end is not null
                or (t.duration_months between 1 and ${MAX_DURATION_MONTHS}
                    and coalesce(t.contract_start::date, (select min(a.award_date) from contract_awards a where a.tender_id = t.id)) is not null)
           )::int as with_end
    from tenders t
    where not t.is_sample
      and exists (select 1 from contract_awards a where a.tender_id = t.id)
      and (${industries}::text[] is null or t.industry_ids && ${industries}::text[])
      and (${regions}::text[] is null or t.region_codes && ${regions}::text[])
  `) as unknown as { awarded: number; withEnd: number }[];
  return {
    rows: rows.map((r) => ({ ...r, suppliers: [...(r.suppliers ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'nb')) })),
    coverage: { awarded: cov?.awarded ?? 0, withEnd: cov?.withEnd ?? 0 },
  };
}
