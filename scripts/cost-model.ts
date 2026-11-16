/**
 * AI-kostnadsmodell (ANSLAG) brukt i docs/COST_REPORT.md. Gjør ingen AI-kall og skriver ingenting til databasen.
 *
 * Bygger de ekte promptene (systemtekst + JSON-skjema + kildeblokk) for et fast utvalg ekte kunngjøringer i databasen
 * og priser dem med listeprisene i src/domain/ai/provider.ts.
 *  - «Før» = koden før kostnadsarbeidet (6c9156a): «Spør om anbudet» og disposisjon for tilbud på kvalitetsmodellen.
 *  - «Etter» = nå: Claude Haiku 5.5 først, kvalitetsmodellen når kvalitetskontrollen feiler (eskalering), varm
 *    buffer og vakt som i src/domain/ai/routing.ts.
 * Alle antakelser står i A og skrives ut sammen med resultatet. Når AI er slått på i produksjon, viser
 * Admin → AI-bruk de faktiske tallene (tokens fra leverandørens svar) – de erstatter dette anslaget.
 *
 *   npx tsx scripts/cost-model.ts
 */
import { closeDb, systemSql } from '@/lib/db';
import { env } from '@/lib/env';
import { getTender } from '@/domain/tenders/queries';
import { noticeSource } from '@/domain/ai/analysis';
import { buildSourceBlock, compactForAi } from '@/domain/ai/sources';
import {
  BASIC_SUMMARY_SYSTEM,
  BID_CHECKLIST_SYSTEM,
  BID_DRAFT_SYSTEM,
  BID_REVIEW_SYSTEM,
  BID_STRUCTURE_SYSTEM,
  FIT_ASSESSMENT_SYSTEM,
  TENDER_ANALYSIS_SYSTEM,
  WEEKLY_OVERVIEW_SYSTEM,
} from '@/domain/ai/prompts';
import { TENDER_CHAT_SYSTEM, tenderChatJsonSchema } from '@/domain/ai/chat';
import {
  basicSummaryJsonSchema,
  bidChecklistJsonSchema,
  bidDraftJsonSchema,
  bidReviewJsonSchema,
  bidStructureJsonSchema,
  fitAssessmentJsonSchema,
  tenderAnalysisJsonSchema,
  weeklyOverviewJsonSchema,
} from '@/domain/ai/schemas';
import { PROFIT_ANALYSIS_SYSTEM, profitAnalysisJsonSchema } from '@/domain/profit/ai';
import { KNOWN_MODEL_PRICES, type ModelPrice } from '@/domain/ai/provider';
import { PLANS } from '@/domain/billing/plans';
import { ESCALATION_GUARD } from '@/domain/ai/routing';

/** Antakelser. Endre dem her og kjør på nytt. */
const A = {
  quality: 'claude-sonnet-5-5',
  fast: 'claude-haiku-5-5',
  /** Tegn per token for norsk tekst og JSON (120 000 tegn ≈ 35 000 tokens, som i docs/STATUS.md). */
  charsPerToken: 3.4,
  /** Haiku 5.5 har en nyere tokenizer som teller samme tekst som ca. 30 % flere tokens. Forsiktig: antar at
   *  kvalitetsmodellen ikke gjør det, så Haiku regnes dyrere enn den kanskje er. */
  haikuTokenFactor: 1.3,
  /** Med dokumenter fyller kildeblokken taket AI_MAX_INPUT_CHARS. */
  docsChars: env.AI_MAX_INPUT_CHARS,
  /** Andel av svarene fra den billige modellen som feiler kvalitetskontrollen og lages på nytt (ukjent til AI er på).
   *  Over 50 % bruker vakten kvalitetsmodellen direkte (routing.ts), og da er prisen som før. */
  escalation: [0.1, 0.3, 0.5],
  /** Spørsmål per økt i «Spør om anbudet»: det første skriver kildene til leverandørens buffer, de neste (innen
   *  5 minutter) leser dem til 5–10 % av prisen. Gjør spareanslaget for chat mindre, ikke større. */
  chatQuestionsPerSession: 3,
  usdNok: 9.25,
  mix: { starter: 0.3, professional: 0.5, business: 0.2 } as Record<'starter' | 'professional' | 'business', number>,
  customers: [100, 1_000, 10_000],
  sampleSize: 300,
};

type Tier = 'quality' | 'fast' | 'fast+escalate';
interface Feature {
  label: string;
  system: string;
  schema: unknown;
  /** Kildeblokk: kunngjøringen alene, med dokumenter, eller ingen. */
  source: 'notice' | 'docs' | 'none';
  /** Annen tekst i forespørselen (spørsmål, bedriftsprofil, utkast …) i tegn – antakelse. */
  extraChars: number;
  /** Typisk svar inkl. tenking ved lav/middels innsats, i tokens – antakelse. Taket står i koden (maxOutputTokens). */
  outTypical: number;
  outCap: number;
  before: Tier;
  after: Tier;
}

const F: Record<string, Feature> = {
  basic: { label: 'Short summary (shared)', system: BASIC_SUMMARY_SYSTEM, schema: basicSummaryJsonSchema, source: 'notice', extraChars: 60, outTypical: 700, outCap: 4000, before: 'fast', after: 'fast' },
  fullNotice: { label: 'Full analysis, notice only (shared)', system: TENDER_ANALYSIS_SYSTEM, schema: tenderAnalysisJsonSchema, source: 'notice', extraChars: 60, outTypical: 3000, outCap: 16000, before: 'quality', after: 'quality' },
  fullDocs: { label: 'Full analysis with documents', system: TENDER_ANALYSIS_SYSTEM, schema: tenderAnalysisJsonSchema, source: 'docs', extraChars: 60, outTypical: 4000, outCap: 16000, before: 'quality', after: 'quality' },
  fit: { label: 'Fit assessment', system: FIT_ASSESSMENT_SYSTEM, schema: fitAssessmentJsonSchema, source: 'docs', extraChars: 1500, outTypical: 2500, outCap: 12000, before: 'quality', after: 'quality' },
  chat: { label: 'Ask about the tender (chat)', system: TENDER_CHAT_SYSTEM, schema: tenderChatJsonSchema, source: 'docs', extraChars: 300, outTypical: 600, outCap: 3000, before: 'quality', after: 'fast+escalate' },
  profit: { label: 'Profit analysis', system: PROFIT_ANALYSIS_SYSTEM, schema: profitAnalysisJsonSchema, source: 'docs', extraChars: 2000, outTypical: 4000, outCap: 16000, before: 'quality', after: 'quality' },
  checklist: { label: 'Bid checklist', system: BID_CHECKLIST_SYSTEM, schema: bidChecklistJsonSchema, source: 'docs', extraChars: 500, outTypical: 2000, outCap: 8000, before: 'quality', after: 'quality' },
  structure: { label: 'Bid structure', system: BID_STRUCTURE_SYSTEM, schema: bidStructureJsonSchema, source: 'docs', extraChars: 500, outTypical: 1500, outCap: 8000, before: 'quality', after: 'fast+escalate' },
  draft: { label: 'Bid draft (section)', system: BID_DRAFT_SYSTEM, schema: bidDraftJsonSchema, source: 'docs', extraChars: 3000, outTypical: 2500, outCap: 12000, before: 'quality', after: 'quality' },
  review: { label: 'Bid review', system: BID_REVIEW_SYSTEM, schema: bidReviewJsonSchema, source: 'none', extraChars: 20000, outTypical: 2000, outCap: 10000, before: 'quality', after: 'quality' },
  weekly: { label: 'Weekly overview', system: WEEKLY_OVERVIEW_SYSTEM, schema: weeklyOverviewJsonSchema, source: 'none', extraChars: 2500, outTypical: 400, outCap: 800, before: 'fast', after: 'fast' },
};

/** Kall per kunde per måned ved «vanlig bruk» (30 % av kvoten), fordelt på funksjonene – antakelse. */
const SCENARIO: Record<'starter' | 'professional' | 'business', Partial<Record<keyof typeof F, number>>> = {
  starter: { basic: 3 }, // 30 % av 10
  professional: { fullNotice: 3, fullDocs: 3, fit: 4, chat: 6, weekly: 2 }, // 18 = 30 % av 60
  business: { fullNotice: 5, fullDocs: 7, fit: 6, chat: 15, profit: 4, checklist: 3, structure: 3, weekly: 2, draft: 12, review: 3 }, // 45 + 15
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
};

/** Pris for ett kall. Første kall i en økt skriver kildeblokken til leverandørens buffer (1,25×); et kall innen
 *  5 minutter med samme kilder leser den (0,05× hos Sonnet 5.5, 0,1× hos Haiku 5.5). */
function callUsd(model: string, prefixTokens: number, otherTokens: number, outTokens: number, cacheHit = false): number {
  const base = KNOWN_MODEL_PRICES[model];
  if (!base) throw new Error(`Ukjent modell: ${model}`);
  const total = prefixTokens + otherTokens;
  const p: Omit<ModelPrice, 'longContext'> = base.longContext && total > base.longContext.thresholdTokens ? base.longContext.price : base;
  return (prefixTokens * (cacheHit ? p.cacheRead : p.cacheWrite) + otherTokens * p.input + outTokens * p.output) / 1e6;
}

async function main() {
  const sql = systemSql();
  const ids = (await sql`select id from tenders where not is_sample order by md5(id::text) limit ${A.sampleSize}`) as unknown as { id: string }[];
  const blocks: number[] = [];
  const raw: number[] = [];
  for (const { id } of ids) {
    const t = await getTender(sql, id);
    if (!t) continue;
    const src = noticeSource(t);
    raw.push(buildSourceBlock([src]).block.length);
    blocks.push(buildSourceBlock(compactForAi([src])).block.length);
  }
  const noticeChars = median(blocks);
  console.log(`Sample: ${blocks.length} real notices. Source block (notice only, after compaction): median ${noticeChars} chars, p90 ${pct(blocks, 0.9)}, max ${Math.max(...blocks)} (before compaction: median ${median(raw)}).`);
  console.log(`Assumptions: ${JSON.stringify({ ...A, mix: undefined, customers: undefined })}`);

  const tok = (chars: number, model: string) => Math.ceil((chars / A.charsPerToken) * (model === A.fast ? A.haikuTokenFactor : 1));
  const perCall = (f: Feature, model: string, out: number, cacheHit = false) => {
    const sourceChars = f.source === 'notice' ? noticeChars : f.source === 'docs' ? A.docsChars : 0;
    const prefix = tok(f.system.length + sourceChars, model);
    const other = tok(JSON.stringify(f.schema).length + f.extraChars, model);
    return callUsd(model, prefix, other, Math.ceil(out * (model === A.fast ? A.haikuTokenFactor : 1)), cacheHit);
  };
  /**
   * Snittpris per kall. «Spør om anbudet» regnes i økter (første spørsmål skriver kildene til bufferen, de neste
   * leser dem). Etter: billig modell først; forkastes svaret (sannsynlighet e), lages det med kvalitetsmodellen, som
   * da starter kaldt – og resten av økten går rett dit (varm buffer, routing.ts). Over vaktens grense brukes
   * kvalitetsmodellen direkte, som før.
   */
  const cost = (f: Feature, tier: Tier, e: number, out = f.outTypical) => {
    const n = f === F.chat ? A.chatQuestionsPerSession : 1;
    const per = (model: string) => (perCall(f, model, out, false) + (n - 1) * perCall(f, model, out, true)) / n;
    if (tier === 'quality' || (tier === 'fast+escalate' && e > ESCALATION_GUARD.maxRejectedShare)) return per(A.quality);
    if (tier === 'fast') return per(A.fast);
    const hCold = perCall(f, A.fast, out, false);
    const hWarm = perCall(f, A.fast, out, true);
    const qCold = perCall(f, A.quality, out, false);
    const qWarm = perCall(f, A.quality, out, true);
    const go = (k: number, warm: 'none' | 'fast' | 'quality'): number => {
      if (k === 0) return 0;
      if (warm === 'quality') return k * qWarm;
      return (warm === 'fast' ? hWarm : hCold) + e * (qCold + go(k - 1, 'quality')) + (1 - e) * go(k - 1, 'fast');
    };
    return go(n, 'none') / n;
  };

  console.log('\nPer call (USD, typical answer; in brackets: answer at the output cap):');
  console.log('| Feature | Before | After (10 % / 30 % / 50 % escalation) | Change at 30 % |');
  for (const f of Object.values(F)) {
    const b = cost(f, f.before, 0);
    const [a10, a30, a50] = A.escalation.map((e) => cost(f, f.after, e));
    const capB = cost(f, f.before, 0, f.outCap);
    const capA = cost(f, f.after, 0.3, f.outCap);
    console.log(
      `| ${f.label} | ${b.toFixed(4)} (${capB.toFixed(4)}) | ${a10!.toFixed(4)} / ${a30!.toFixed(4)} / ${a50!.toFixed(4)} (${capA.toFixed(4)}) | ${(((a30! - b) / b) * 100).toFixed(0)} % |`,
    );
  }

  // «Før» med den billige modellen uten ANTHROPIC_MODEL_FAST: før gikk alt på kvalitetsmodellen.
  const basicSonnet = cost(F.basic!, 'quality', 0);
  const weeklySonnet = cost(F.weekly!, 'quality', 0);
  console.log(`\nIf ANTHROPIC_MODEL_FAST was not set before (then everything ran on the quality model): short summary ${basicSonnet.toFixed(4)} → ${cost(F.basic!, 'fast', 0).toFixed(4)} USD, weekly overview ${weeklySonnet.toFixed(4)} → ${cost(F.weekly!, 'fast', 0).toFixed(4)} USD.`);

  console.log('\nPer customer per month, typical use (USD; after at 10 / 30 / 50 % escalation):');
  const perPlan: Record<string, { before: number; after: number[] }> = {};
  for (const [plan, calls] of Object.entries(SCENARIO)) {
    let before = 0;
    const after = A.escalation.map(() => 0);
    for (const [k, n] of Object.entries(calls)) {
      const f = F[k]!;
      before += n! * cost(f, f.before, 0);
      A.escalation.forEach((e, i) => (after[i]! += n! * cost(f, f.after, e)));
    }
    perPlan[plan] = { before, after };
    const ent = PLANS[plan as keyof typeof PLANS].entitlements;
    console.log(`| ${plan} (quota ${ent.aiAnalysesPerMonth} + ${ent.aiBidDraftsPerMonth} drafts) | ${before.toFixed(3)} | ${after.map((x) => x.toFixed(3)).join(' / ')} | ${(((after[1]! - before) / before) * 100).toFixed(0)} % |`);
  }
  const avgBefore = Object.entries(A.mix).reduce((s, [p, w]) => s + w * perPlan[p]!.before, 0);
  const avgAfter = A.escalation.map((_, i) => Object.entries(A.mix).reduce((s, [p, w]) => s + w * perPlan[p]!.after[i]!, 0));
  console.log(`Average per customer (mix ${JSON.stringify(A.mix)}): before ${avgBefore.toFixed(3)} USD, after ${avgAfter.map((x) => x.toFixed(3)).join(' / ')} USD.`);

  console.log('\nPer month, all customers (USD; after at 10 / 30 / 50 % escalation):');
  for (const n of A.customers) {
    const after = avgAfter.map((x) => x * n);
    console.log(
      `| ${n} | ${(avgBefore * n).toFixed(0)} | ${after.map((x) => x.toFixed(0)).join(' / ')} | saves ${after.map((x) => (avgBefore * n - x).toFixed(0)).join(' / ')} USD (${after.map((x) => Math.round((avgBefore * n - x) * A.usdNok)).join(' / ')} NOK) |`,
    );
  }

  // Hele kvoten brukt (som «maks» i docs/STATUS.md): Start på korte sammendrag, de andre på full analyse med
  // dokumenter og utkast – typiske svar. Uendret av kostnadsarbeidet (full analyse bruker fortsatt kvalitetsmodellen).
  const full = (plan: 'starter' | 'professional' | 'business') => {
    const e = PLANS[plan].entitlements;
    if (plan === 'starter') return e.aiAnalysesPerMonth * cost(F.basic!, 'fast', 0);
    return e.aiAnalysesPerMonth * cost(F.fullDocs!, 'quality', 0) + e.aiBidDraftsPerMonth * cost(F.draft!, 'quality', 0);
  };
  const fullAvg = Object.entries(A.mix).reduce((sum, [p, w]) => sum + w * full(p as 'starter' | 'professional' | 'business'), 0);
  console.log(`\nWhole quota used (documents, typical answers): starter ${full('starter').toFixed(3)}, professional ${full('professional').toFixed(2)}, business ${full('business').toFixed(2)} USD; mix average ${fullAvg.toFixed(2)} USD per customer.`);

  // Verst tenkelig per kunde: hele kvoten på den dyreste analysen (uendret – full analyse bruker fortsatt kvalitetsmodellen).
  const worst = (plan: 'professional' | 'business') => {
    const e = PLANS[plan].entitlements;
    return e.aiAnalysesPerMonth * cost(F.fullDocs!, 'quality', 0, F.fullDocs!.outCap) + e.aiBidDraftsPerMonth * cost(F.draft!, 'quality', 0, F.draft!.outCap);
  };
  console.log(`\nWorst case (whole quota on full analyses with documents, answers at the cap): professional ${worst('professional').toFixed(2)} USD, business ${worst('business').toFixed(2)} USD – unchanged, and capped by AI_MONTHLY_COST_LIMIT_USD_PER_ORG.`);
  await closeDb();
}

await main();
