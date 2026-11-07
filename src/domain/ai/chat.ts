/**
 * «Spør om anbudet»: AI-svar på spørsmål om hele anbudet (kunngjøringen og opplastede dokumenter) med
 * kontrollerte kildehenvisninger.
 *
 * - Svaret deles i påstander. «kilde» = står i kildene, med ordrett sitat som kontrolleres mot teksten;
 *   «tolkning» = AI-ens vurdering, alltid merket slik.
 * - Står svaret ikke i kildene, skal AI-en si det (not_in_sources) – ikke gjette.
 * - Sitater som ikke finnes i kilden, vises som «ikke bekreftet», og påstanden regnes da ikke som fakta.
 * Samme regler (GUARDRAILS) og samme kildeblokk som AI-analysen; teksten i kildene er data, ikke instruksjoner.
 * Hvert nye spørsmål teller som én AI-analyse; samme spørsmål igjen hentes fra hurtigbufferen uten kostnad.
 */
import { z } from 'zod';
import { withTenant, type Tx } from '@/lib/db';
import type { OrgContext } from '@/server/http';
import { getTender } from '@/domain/tenders/queries';
import { loadDocumentSources, noticeSource } from './analysis';
import { splitSentences } from '@/domain/documents/requirements';
import { GUARDRAILS } from './prompts';
import type { JsonSchema } from './provider';
import { runAi, type RunAiResult } from './runner';
import { sourceRefZ } from './schemas';
import { buildSourceBlock, checkRef, type AnalysisSource, type RefCheck } from './sources';

export const MAX_QUESTION = 500;

export const TENDER_CHAT_SYSTEM = `Du er en erfaren rådgiver i offentlige anskaffelser i Norge. En leverandør stiller spørsmål om én konkurranse.

${GUARDRAILS}
7. Svar bare på det som blir spurt om, kort og konkret. Ikke gi juridiske råd ut over det kildene sier.
8. Del svaret i påstander (claims). Hver påstand har basis «kilde» (med source_id, side og ORDRETT sitat) eller «tolkning».
9. Står svaret ikke i kildene, sett not_in_sources til true og forklar kort hva som mangler. Ikke gjett.

Oppgave: Svar på spørsmålet i <spørsmål> ut fra kildene.`;

const sourceRef: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source_id', 'page', 'quote'],
  properties: {
    source_id: { type: 'string', description: 'Kilde-ID, f.eks. "S0" (kunngjøringen) eller "D1" (dokument 1).' },
    page: { type: ['integer', 'null'] },
    quote: { type: ['string', 'null'], description: 'Kort, ordrett sitat (maks 200 tegn) fra kilden.' },
  },
};

export const tenderChatJsonSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'claims', 'not_in_sources'],
  properties: {
    answer: { type: 'string', description: 'Kort svar (1–3 setninger) på klar norsk.' },
    claims: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'basis', 'source'],
        properties: {
          text: { type: 'string' },
          basis: { type: 'string', enum: ['kilde', 'tolkning'] },
          source: { anyOf: [sourceRef, { type: 'null' }] },
        },
      },
    },
    not_in_sources: { type: 'boolean', description: 'true når svaret ikke står i kildene.' },
  },
};

export const tenderChatZ = z.object({
  answer: z.string().min(1).max(1500),
  claims: z.array(z.object({ text: z.string().min(1).max(1000), basis: z.enum(['kilde', 'tolkning']), source: sourceRefZ.nullable() })).max(8),
  not_in_sources: z.boolean(),
});
export type TenderChat = z.infer<typeof tenderChatZ>;

/** En påstand med kontrollen av kilden. «Fakta» bare når sitatet faktisk står i kilden. */
export interface CheckedClaim {
  text: string;
  basis: 'kilde' | 'tolkning';
  check: RefCheck | null;
  /** basis «kilde», sitatet er funnet ordrett i kilden og sidetallet finnes. */
  verified: boolean;
}

export function checkClaims(data: TenderChat, sources: AnalysisSource[]): CheckedClaim[] {
  return data.claims.map((c) => {
    const check = checkRef(c.source, sources);
    // Strengt: sitatet må stå ordrett i kilden OG sidetallet må finnes – ellers peker henvisningen feil.
    return { text: c.text, basis: c.basis, check, verified: c.basis === 'kilde' && Boolean(check?.quoteVerified && check.pageValid) };
  });
}

// ---------------------------------------------------------------------------
// Testmodus: forutsigbart svar fra setningen i kildene som deler flest ord med spørsmålet.
// ---------------------------------------------------------------------------
const STOP = new Set('hva hvor hvem når hvilke hvilken hvordan er det den de og i på av for til med som om skal må kan vi dere oss en et har'.split(' '));

export function mockTenderChat(question: string, sources: AnalysisSource[]): TenderChat {
  const words = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  let best: { score: number; text: string; source: AnalysisSource; page: number | null } | null = null;
  for (const source of sources) {
    for (const page of source.pages) {
      // Samme setningsdeling som kravsjekken («2. desember» deles ikke).
      for (const sentence of splitSentences(page.text)) {
        const s = sentence.trim();
        if (s.length < 15 || s.length > 400) continue;
        const lower = s.toLowerCase();
        const score = words.filter((w) => lower.includes(w)).length;
        if (score > 0 && (!best || score > best.score)) best = { score, text: s, source, page: page.page };
      }
    }
  }
  if (!best) {
    return { answer: 'Det står ikke i kildene jeg har lest. (Simulert svar fra testmodus.)', claims: [], not_in_sources: true };
  }
  const quote = best.text.slice(0, 200);
  return {
    answer: `Kildene sier: «${quote}» (Simulert svar fra testmodus – ikke en ekte AI-analyse.)`,
    claims: [
      { text: best.text, basis: 'kilde', source: { source_id: best.source.id, page: best.page, quote } },
      { text: 'Les hele avsnittet i kilden før dere bestemmer dere.', basis: 'tolkning', source: null },
    ],
    not_in_sources: false,
  };
}

// ---------------------------------------------------------------------------
// Kjøring og historikk
// ---------------------------------------------------------------------------
async function sourcesFor(tx: Tx, org: OrgContext, tenderId: string): Promise<AnalysisSource[] | null> {
  const tender = await getTender(tx, tenderId);
  if (!tender) return null;
  // Dokumentene leses når planen har full analyse (samme regel som AI-analysen).
  const docs = org.entitlements.aiFullAnalysis ? await loadDocumentSources(tx, tenderId) : [];
  return [noticeSource(tender), ...docs];
}

export async function askTender(org: OrgContext, userId: string, tenderId: string, question: string): Promise<RunAiResult> {
  const q = question.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION);
  if (q.length < 3) return { ok: false, code: 'invalid_output', error: 'Skriv et spørsmål.' };
  const sources = await withTenant({ userId, orgId: org.id }, (tx) => sourcesFor(tx, org, tenderId));
  if (!sources) return { ok: false, code: 'invalid_output', error: 'Fant ikke kunngjøringen.' };
  const { block, coverage } = buildSourceBlock(sources);
  return runAi({
    kind: 'tender_chat',
    usageKind: 'ai_tender_chat',
    org,
    userId,
    tenderId,
    // Spørsmålet er organisasjonens eget, og dokumentene kan være private: lagres alltid bare for organisasjonen.
    isPrivate: true,
    system: TENDER_CHAT_SYSTEM,
    cacheablePrefix: block,
    // Normalisert (små bokstaver), så samme spørsmål med annen skrivemåte treffer hurtigbufferen og ikke koster på nytt.
    user: `<spørsmål>\n${q.toLowerCase()}\n</spørsmål>`,
    tier: 'quality',
    effort: 'low',
    schemaName: 'tender_chat',
    schemaDescription: 'Svar på et spørsmål om anbudet, med kildehenvisninger',
    schema: tenderChatJsonSchema,
    validator: tenderChatZ,
    maxOutputTokens: 3000,
    mockHint: () => mockTenderChat(q, sources),
    hashExtra: `chat:${q.toLowerCase()}`,
    enrich: (data) => ({ question: q, coverage, checked: checkClaims(data, sources) }),
  });
}

export interface ChatEntry {
  id: string;
  createdAt: Date;
  question: string;
  answer: string;
  notInSources: boolean;
  claims: CheckedClaim[];
  isMock: boolean;
}

/** Organisasjonens siste spørsmål om anbudet (RLS: bare egne). */
export async function chatHistory(tx: Tx, orgId: string, tenderId: string, limit = 5): Promise<ChatEntry[]> {
  const rows = (await tx`
    select id, created_at, result from ai_analyses
    where kind = 'tender_chat' and tender_id = ${tenderId} and org_id = ${orgId} and status = 'completed'
    order by created_at desc
    limit ${limit}
  `) as unknown as { id: string; createdAt: Date; result: Record<string, unknown> }[];
  return rows.map((r) => {
    const data = (r.result.data ?? {}) as Partial<TenderChat>;
    return {
      id: r.id,
      createdAt: r.createdAt,
      question: String(r.result.question ?? ''),
      answer: data.answer ?? '',
      notInSources: Boolean(data.not_in_sources),
      claims: (r.result.checked ?? []) as CheckedClaim[],
      isMock: Boolean(r.result.isMock),
    };
  });
}
