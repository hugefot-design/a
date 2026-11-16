/**
 * AI-kostnader for admin: per funksjon og per organisasjon denne måneden, treff i hurtigbufferen (svar som ble
 * gjenbrukt uten nytt kall) og hva det sparte, billige forsøk som måtte lages på nytt med kvalitetsmodellen, og hvor
 * mye av inn-tokens leverandøren leste fra sin egen buffer (prompt caching). Bare tall – ingen innhold fra kundene.
 */
import { systemSql } from '@/lib/db';
import { getProvider } from './provider';
import { CHEAP_FIRST_KINDS, ESCALATION_GUARD, cheapFirstStats, type CheapFirstStats } from './routing';
import { currentPeriod } from './usage';

export interface AiCostRow {
  /** Funksjonen (usage_records.kind) eller organisasjonsnavnet. */
  label: string;
  /** AI-kall som telte mot kvoten (nye svar). */
  calls: number;
  /** Svar gjenbrukt fra hurtigbufferen – uten kostnad. */
  hits: number;
  /** Billige forsøk som ble forkastet og laget på nytt med kvalitetsmodellen. */
  escalations: number;
  costUsd: number;
  savedUsd: number;
}

export interface AiCostSummary {
  period: string;
  totals: AiCostRow & { hitRate: number | null };
  byFeature: AiCostRow[];
  byOrg: AiCostRow[];
  /** Fra AI-kallene denne måneden: hvor stor del av inn-tokens som ble lest fra leverandørens buffer. */
  promptCache: { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; readShare: number | null };
  /** Billig modell først (siste 7 dager): hvor ofte svaret måtte lages på nytt, og om vakten har satt den på pause.
   *  null når det ikke er satt opp en egen billig modell. */
  cheapFirst: { fastModel: string; qualityModel: string; guard: typeof ESCALATION_GUARD; rows: (CheapFirstStats & { label: string })[] } | null;
}

const CHEAP_FIRST_LABELS: Record<(typeof CHEAP_FIRST_KINDS)[number], string> = {
  tender_analysis: 'Kort sammendrag',
  tender_chat: 'Spør om anbudet',
  bid_structure: 'Disposisjon for tilbud',
  weekly_overview: 'Ukesoversikt',
};

const FEATURE_LABELS: Record<string, string> = {
  ai_tender_analysis: 'Anbudsanalyse',
  ai_fit_assessment: 'Egnethetsvurdering',
  ai_profit_analysis: 'Lønnsomhet (AI)',
  ai_bid_checklist: 'Sjekkliste for tilbud',
  ai_bid_structure: 'Disposisjon for tilbud',
  ai_bid_draft: 'Tilbudsutkast',
  ai_bid_review: 'Gjennomgang av utkast',
  ai_weekly_overview: 'Ukesoversikt',
  ai_tender_chat: 'Spør om anbudet',
};

type Agg = { label: string; calls: number; hits: number; escalations: number; costUsd: number; savedUsd: number };

export async function aiCostSummary(period = currentPeriod()): Promise<AiCostSummary> {
  const sql = systemSql();
  const aggregate = sql`
    coalesce(sum(u.quantity) filter (where not u.cached), 0)::int as calls,
    count(*) filter (where u.cached)::int as hits,
    count(*) filter (where u.escalated and u.quantity = 0)::int as escalations,
    coalesce(sum(u.cost_usd), 0)::float8 as cost_usd,
    coalesce(sum(u.saved_usd), 0)::float8 as saved_usd
  `;
  const byFeature = (await sql`
    select u.kind as label, ${aggregate} from usage_records u where u.period = ${period}
    group by u.kind order by cost_usd desc, u.kind
  `) as unknown as Agg[];
  const byOrg = (await sql`
    select coalesce(o.name, 'Slettet organisasjon') as label, ${aggregate}
    from usage_records u left join organizations o on o.id = u.org_id
    where u.period = ${period}
    group by o.name order by cost_usd desc, label limit 15
  `) as unknown as Agg[];
  const [cache] = (await sql`
    select coalesce(sum(input_tokens), 0)::float8 as input_tokens, coalesce(sum(cache_read_tokens), 0)::float8 as cache_read_tokens,
           coalesce(sum(cache_write_tokens), 0)::float8 as cache_write_tokens
    from ai_analyses where to_char(created_at, 'YYYY-MM') = ${period}
  `) as unknown as { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }[];
  const sum = (k: keyof Omit<Agg, 'label'>) => byFeature.reduce((s, r) => s + r[k], 0);
  const totals = { label: 'Totalt', calls: sum('calls'), hits: sum('hits'), escalations: sum('escalations'), costUsd: sum('costUsd'), savedUsd: sum('savedUsd') };
  const requests = totals.calls + totals.hits;
  return {
    period,
    totals: { ...totals, hitRate: requests ? totals.hits / requests : null },
    byFeature: byFeature.map((r) => ({ ...r, label: FEATURE_LABELS[r.label] ?? r.label })),
    byOrg,
    promptCache: {
      inputTokens: cache?.inputTokens ?? 0,
      cacheReadTokens: cache?.cacheReadTokens ?? 0,
      cacheWriteTokens: cache?.cacheWriteTokens ?? 0,
      readShare: cache && cache.inputTokens > 0 ? cache.cacheReadTokens / cache.inputTokens : null,
    },
    cheapFirst: await cheapFirstOverview(),
  };
}

async function cheapFirstOverview(): Promise<AiCostSummary['cheapFirst']> {
  const fastModel = getProvider('fast')?.model ?? null;
  const qualityModel = getProvider('quality')?.model ?? null;
  if (!fastModel || !qualityModel || fastModel === qualityModel) return null;
  const rows = await Promise.all(CHEAP_FIRST_KINDS.map(async (kind) => ({ ...(await cheapFirstStats(kind, fastModel)), label: CHEAP_FIRST_LABELS[kind] })));
  return { fastModel, qualityModel, guard: ESCALATION_GUARD, rows };
}
