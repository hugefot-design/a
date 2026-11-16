import type { Tx } from '@/lib/db';
import type { OrgContext } from '@/server/http';

export type AiUsageKind =
  | 'ai_tender_analysis'
  | 'ai_fit_assessment'
  | 'ai_profit_analysis'
  | 'ai_bid_checklist'
  | 'ai_bid_structure'
  | 'ai_bid_draft'
  | 'ai_bid_review'
  | 'ai_weekly_overview'
  | 'ai_tender_chat';

/** AI-bruk som teller mot «AI-analyser per måned». */
export const ANALYSIS_KINDS = ['ai_tender_analysis', 'ai_fit_assessment', 'ai_profit_analysis', 'ai_weekly_overview', 'ai_bid_checklist', 'ai_bid_structure', 'ai_tender_chat'];

export function currentPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export interface UsageSummary {
  analyses: number;
  drafts: number;
  analysesLimit: number;
  draftsLimit: number;
  costUsd: number;
}

/** Bruk denne måneden. Svar fra hurtigbuffer teller ikke mot kvoten. */
export async function usageSummary(tx: Tx, org: OrgContext): Promise<UsageSummary> {
  const [row] = (await tx`
    select
      coalesce(sum(quantity) filter (where kind in ${tx(ANALYSIS_KINDS)} and not cached), 0)::int as analyses,
      coalesce(sum(quantity) filter (where kind in ('ai_bid_draft', 'ai_bid_review') and not cached), 0)::int as drafts,
      coalesce(sum(cost_usd), 0)::float8 as cost_usd
    from usage_records where org_id = ${org.id} and period = ${currentPeriod()}
  `) as unknown as { analyses: number; drafts: number; costUsd: number }[];
  return {
    analyses: row?.analyses ?? 0,
    drafts: row?.drafts ?? 0,
    analysesLimit: org.entitlements.aiAnalysesPerMonth,
    draftsLimit: org.entitlements.aiBidDraftsPerMonth,
    costUsd: row?.costUsd ?? 0,
  };
}

export async function recordUsage(
  tx: Tx,
  input: {
    orgId: string;
    userId: string;
    kind: AiUsageKind;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    cached: boolean;
    /** Teller mot kvoten (1), eller ikke (0: et billig modellforsøk som ble forkastet og kjørt på nytt). */
    quantity?: 0 | 1;
    /** Ved treff i hurtigbufferen: hva analysen som ble gjenbrukt, kostet å lage. */
    savedUsd?: number;
    analysisId?: string | null;
    escalated?: boolean;
  },
): Promise<void> {
  await tx`
    insert into usage_records (org_id, user_id, kind, quantity, input_tokens, output_tokens, cost_usd, cached, period, saved_usd, analysis_id, escalated)
    values (${input.orgId}, ${input.userId}, ${input.kind}, ${input.quantity ?? 1}, ${input.inputTokens}, ${input.outputTokens}, ${input.costUsd},
            ${input.cached}, ${currentPeriod()}, ${input.savedUsd ?? 0}, ${input.analysisId ?? null}, ${input.escalated ?? false})
  `;
}

export function quotaFor(kind: AiUsageKind, summary: UsageSummary): { used: number; limit: number } {
  if (kind === 'ai_bid_draft' || kind === 'ai_bid_review') return { used: summary.drafts, limit: summary.draftsLimit };
  return { used: summary.analyses, limit: summary.analysesLimit };
}
