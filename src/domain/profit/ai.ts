/**
 * Profit Intelligence – AI-delen.
 *
 * AI-en LESER kunngjøringen og dokumentene og henter ut:
 *  - beløp som står i kildene (estimert verdi, rammetak, budsjett),
 *  - kostnadsdrivere med mengder (timer, årsverk, antall, m², km …) – aldri kroner,
 *  - kontraktsvilkår med økonomisk risiko (dagbøter, betalingsfrist, prisregulering, garantier, ansvar …),
 *  - økonomiske usikkerheter og hva som mangler for å regne.
 *
 * AI-en setter ALDRI kostnader eller priser. Bedriftens egne kostnader legges inn av bedriften, og
 * selve regnestykket gjøres av den deterministiske kalkulatoren (calculator.ts).
 *
 * Kontroll etter svaret: hvert sitat sjekkes mot kildeteksten (checkRef), og hvert tall som AI-en
 * sier står i kildene, må finnes i det kontrollerte sitatet (numberInText). Tall som ikke kan
 * kontrolleres, brukes ikke som «dokument»-tall i kalkylen.
 */
import { z } from 'zod';
import { first, withTenant, type Tx } from '@/lib/db';
import type { OrgContext } from '@/server/http';
import { getTender } from '@/domain/tenders/queries';
import { loadDocumentSources, noticeSource } from '@/domain/ai/analysis';
import { GUARDRAILS } from '@/domain/ai/prompts';
import { runAi, type RunAiResult } from '@/domain/ai/runner';
import { sourceRefZ } from '@/domain/ai/schemas';
import type { JsonSchema } from '@/domain/ai/provider';
import { buildSourceBlock, checkRef, verifyAllRefs, type AnalysisSource, type RefCheck, type SourceCoverage } from '@/domain/ai/sources';
import { COST_CATEGORIES, type CostCategory } from './calculator';
import { scanContractTerms, type TermCategory } from './terms-scan';

export const PROFIT_RISK_CATEGORIES = [
  'dagbot',
  'leveringsfrist',
  'betalingsvilkar',
  'prisregulering',
  'kostnadsansvar',
  'garanti',
  'erstatningsansvar',
  'forsikring',
  'volum',
  'tapsrisiko',
  'uvanlig_vilkar',
  'annet',
] as const;
export type ProfitRiskCategory = (typeof PROFIT_RISK_CATEGORIES)[number];

export const PROFIT_RISK_LABELS: Record<ProfitRiskCategory, string> = {
  dagbot: 'Dagbøter og sanksjoner',
  leveringsfrist: 'Stramme frister',
  betalingsvilkar: 'Betalingsvilkår',
  prisregulering: 'Prisregulering',
  kostnadsansvar: 'Kostnadsansvar',
  garanti: 'Garantier og sikkerhetsstillelse',
  erstatningsansvar: 'Ansvar og erstatning',
  forsikring: 'Forsikringskrav',
  volum: 'Usikkert volum',
  tapsrisiko: 'Krav som kan gi tap',
  uvanlig_vilkar: 'Uvanlige vilkår',
  annet: 'Annet',
};

const COST_CATEGORY_IDS = COST_CATEGORIES.map((c) => c.id) as [CostCategory, ...CostCategory[]];
const PERIOD_IDS = ['total', 'per_aar', 'per_maaned', 'ukjent'] as const;

// ---------------------------------------------------------------------------
// Skjema (JSON Schema til modellen, zod til validering av svaret)
// ---------------------------------------------------------------------------
const sourceRef: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source_id', 'page', 'quote'],
  properties: {
    source_id: { type: 'string', description: 'Kilde-ID, f.eks. "S0" (kunngjøringen) eller "D1" (dokument 1).' },
    page: { type: ['integer', 'null'], description: 'Sidetall fra markøren [[side N]], eller null.' },
    quote: { type: ['string', 'null'], description: 'Kort, ORDRETT sitat (maks 200 tegn) på originalspråket. Skal inneholde tallet når et tall oppgis.' },
  },
};
const nullableSourceRef: JsonSchema = { anyOf: [sourceRef, { type: 'null' }] };

export const profitAnalysisJsonSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'stated_values',
    'duration',
    'price_format',
    'price_evaluation',
    'cost_drivers',
    'contract_risks',
    'economic_uncertainties',
    'missing_for_calculation',
    'documents_not_read',
  ],
  properties: {
    summary: { type: 'string', description: 'Nøktern oppsummering av økonomien og risikoen i oppdraget, 2–4 setninger. Ingen priser eller vinnersjanser.' },
    stated_values: {
      type: 'array',
      description: 'Beløp som STÅR i kildene (estimert verdi, rammetak, budsjett, maksimal verdi). Tom liste hvis ingen beløp står der.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'amount', 'currency', 'period', 'includes_options', 'source'],
        properties: {
          label: { type: 'string', description: 'Hva beløpet er, f.eks. «Estimert totalverdi inkl. opsjoner».' },
          amount: { type: 'number', description: 'Beløpet som tall (f.eks. 2000000 for «2 MNOK»).' },
          currency: { type: ['string', 'null'] },
          period: { type: 'string', enum: [...PERIOD_IDS] },
          includes_options: { type: ['boolean', 'null'], description: 'Om beløpet inkluderer opsjoner, hvis det står.' },
          source: sourceRef,
        },
      },
    },
    duration: {
      type: 'object',
      additionalProperties: false,
      required: ['months', 'text', 'options_text', 'source'],
      properties: {
        months: { type: ['number', 'null'], description: 'Fast varighet i måneder uten opsjoner, bare hvis den står i kildene.' },
        text: { type: ['string', 'null'] },
        options_text: { type: ['string', 'null'], description: 'Opsjoner på forlengelse slik de er beskrevet.' },
        source: nullableSourceRef,
      },
    },
    price_format: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'source'],
      properties: {
        text: { type: ['string', 'null'], description: 'Hvordan prisen skal oppgis (fastpris, timepriser, enhetspriser, prisskjema …).' },
        source: nullableSourceRef,
      },
    },
    price_evaluation: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'weight_pct', 'source'],
      properties: {
        text: { type: ['string', 'null'], description: 'Hvordan pris evalueres (tildelingskriterium og modell), slik det står.' },
        weight_pct: { type: ['number', 'null'], description: 'Prisens vekt i prosent hvis den står.' },
        source: nullableSourceRef,
      },
    },
    cost_drivers: {
      type: 'array',
      description: 'Det som driver kostnadene i oppdraget, med mengde når den står eller kan regnes ut. ALDRI kroner.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'description', 'quantity', 'unit', 'period', 'quantity_basis', 'calculation', 'source'],
        properties: {
          category: { type: 'string', enum: COST_CATEGORY_IDS },
          description: { type: 'string', description: 'F.eks. «Vakthold, 2 vektere døgnet rundt» eller «Strøsand».' },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'], description: 'timer, årsverk, stk, m2, km, tonn, besøk …' },
          period: { type: 'string', enum: [...PERIOD_IDS] },
          quantity_basis: { type: 'string', enum: ['kilde', 'utledet', 'ukjent'] },
          calculation: { type: ['string', 'null'], description: 'Utregningen med tall fra kildene når quantity_basis er «utledet».' },
          source: nullableSourceRef,
        },
      },
    },
    contract_risks: {
      type: 'array',
      description: 'Kontraktsvilkår og krav med økonomisk risiko.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'title', 'finding', 'economic_impact', 'severity', 'basis', 'percent', 'days', 'amount', 'source'],
        properties: {
          category: { type: 'string', enum: [...PROFIT_RISK_CATEGORIES] },
          title: { type: 'string', description: 'Kort tittel, f.eks. «Dagbot 1 ‰ per dag, tak 10 %».' },
          finding: { type: 'string', description: 'Hva kildene sier, kort og presist.' },
          economic_impact: { type: 'string', description: 'Hvordan det kan påvirke lønnsomheten (din vurdering).' },
          severity: { type: 'string', enum: ['lav', 'middels', 'høy'] },
          basis: { type: 'string', enum: ['kilde', 'tolkning'] },
          percent: { type: ['number', 'null'], description: 'Prosentsats (tak for dagbot, garanti i % …) bare hvis den står i sitatet.' },
          days: { type: ['number', 'null'], description: 'Antall dager (betalingsfrist, leveringsfrist …) bare hvis det står i sitatet.' },
          amount: { type: ['number', 'null'], description: 'Beløp i kroner bare hvis det står i sitatet.' },
          source: nullableSourceRef,
        },
      },
    },
    economic_uncertainties: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'basis', 'source'],
        properties: { text: { type: 'string' }, basis: { type: 'string', enum: ['kilde', 'tolkning'] }, source: nullableSourceRef },
      },
    },
    missing_for_calculation: {
      type: 'array',
      description: 'Opplysninger som mangler for å kunne regne på oppdraget (f.eks. volum, antall lokasjoner, prisskjema).',
      items: { type: 'string' },
    },
    documents_not_read: {
      type: 'array',
      description: 'Dokumenter som nevnes i kildene (kontraktsvilkår, prisskjema, kravspesifikasjon …), men som ikke er med i kildene.',
      items: { type: 'string' },
    },
  },
};

const claimZ = z.object({ text: z.string().min(1).max(1500), basis: z.enum(['kilde', 'tolkning']), source: sourceRefZ.nullable() });

export const profitAnalysisZ = z.object({
  summary: z.string().min(1).max(2500),
  stated_values: z
    .array(
      z.object({
        label: z.string().min(1).max(200),
        amount: z.number().nonnegative().max(1e12),
        currency: z.string().max(10).nullable(),
        period: z.enum(PERIOD_IDS),
        includes_options: z.boolean().nullable(),
        source: sourceRefZ,
      }),
    )
    .max(10),
  duration: z.object({
    months: z.number().positive().max(600).nullable(),
    text: z.string().max(400).nullable(),
    options_text: z.string().max(400).nullable(),
    source: sourceRefZ.nullable(),
  }),
  price_format: z.object({ text: z.string().max(800).nullable(), source: sourceRefZ.nullable() }),
  price_evaluation: z.object({ text: z.string().max(800).nullable(), weight_pct: z.number().min(0).max(100).nullable(), source: sourceRefZ.nullable() }),
  cost_drivers: z
    .array(
      z
        .object({
          category: z.enum(COST_CATEGORY_IDS),
          description: z.string().min(1).max(300),
          quantity: z.number().nonnegative().max(1e9).nullable(),
          unit: z.string().max(40).nullable(),
          period: z.enum(PERIOD_IDS),
          quantity_basis: z.enum(['kilde', 'utledet', 'ukjent']),
          calculation: z.string().max(600).nullable(),
          source: sourceRefZ.nullable(),
        })
        // «Ukjent» mengde skal aldri ha et tall – fjern det i stedet for å stole på det.
        .transform((d) => (d.quantity_basis === 'ukjent' ? { ...d, quantity: null } : d)),
    )
    .max(30),
  contract_risks: z
    .array(
      z.object({
        category: z.enum(PROFIT_RISK_CATEGORIES),
        title: z.string().min(1).max(200),
        finding: z.string().max(1200),
        economic_impact: z.string().max(1200),
        severity: z.enum(['lav', 'middels', 'høy']),
        basis: z.enum(['kilde', 'tolkning']),
        percent: z.number().min(0).max(1000).nullable(),
        days: z.number().min(0).max(3650).nullable(),
        amount: z.number().nonnegative().max(1e12).nullable(),
        source: sourceRefZ.nullable(),
      }),
    )
    .max(30),
  economic_uncertainties: z.array(claimZ).max(15),
  missing_for_calculation: z.array(z.string().max(400)).max(20),
  documents_not_read: z.array(z.string().max(300)).max(20),
});
export type ProfitAnalysis = z.infer<typeof profitAnalysisZ>;

export const PROFIT_ANALYSIS_SYSTEM = `Du er en erfaren kalkulatør og kontraktsrådgiver for offentlige anskaffelser i Norge. Du hjelper en liten eller mellomstor leverandør å forstå økonomien og den kontraktuelle risikoen i en konkurranse FØR de bestemmer pris.

${GUARDRAILS}
7. Du skal ALDRI oppgi priser, timepriser, lønnskostnader, materialpriser eller andre kostnader i kroner. Bedriften legger inn sine egne kostnader selv. Beløp du oppgir i stated_values eller amount, skal stå i kildene, og sitatet skal inneholde beløpet.
8. Mengder (timer, årsverk, antall, kvadratmeter, kilometer, besøk osv.):
   - quantity_basis «kilde»: mengden står i kildene. Sitatet skal inneholde tallet.
   - quantity_basis «utledet»: mengden kan regnes ut fra tall i kildene (f.eks. bemanningskrav × åpningstid). Skriv utregningen i calculation med tallene fra kildene.
   - quantity_basis «ukjent»: mengden står ikke og kan ikke regnes ut. Sett quantity til null. Ikke gjett.
9. Kontraktsrisiko: let særlig etter dagbøter/dagmulkt (sats og tak), leveringsfrister og oppstartsfrister, betalingsfrist, prisregulering (indeks, fastpris, hvor ofte), hvem som bærer kostnader (reise, materiell, endringer, lisenser), garantier og sikkerhetsstillelse, erstatningsansvar og ansvarsbegrensning, forsikringskrav, volum uten garanti, og krav eller vilkår som er uvanlige eller kan gi tap. Oppgi percent, days og amount bare når tallet står i sitatet.
10. severity: «høy» når vilkåret kan gi tap eller store kostnader som leverandøren ikke kan styre (f.eks. dagbot uten tak, ubegrenset ansvar, ingen prisregulering i en lang kontrakt, investeringer uten volumgaranti); «middels» når det må prises inn eller følges opp; «lav» når det er vanlig og håndterbart. Begrunn i economic_impact.
11. Ikke anslå hvilken pris som vinner, hva konkurrentene byr eller sannsynligheten for å vinne. Det er ikke en del av oppgaven.
12. Kontraktsvilkår, prisskjema og kravspesifikasjon står ofte i vedlegg. Er de ikke med i kildene, skal de stå i documents_not_read, og du skal ikke anta hva de inneholder.

Oppgave: Gå gjennom kildene og fyll ut skjemaet. En tom liste er bedre enn et gjettet punkt.`;

// ---------------------------------------------------------------------------
// Tallkontroll: står tallet faktisk i sitatet?
// ---------------------------------------------------------------------------
const WORD_NUMBERS: Record<string, number> = {
  ett: 1,
  én: 1,
  tre: 3,
  fire: 4,
  fem: 5,
  seks: 6,
  sju: 7,
  syv: 7,
  åtte: 8,
  ni: 9,
  ti: 10,
  elleve: 11,
  tolv: 12,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
};

/** Alle tall i en tekst, med norske og engelske skrivemåter («1 500 000», «2,5 mill.», «2 MNOK», «45 dager», «fem»). */
export function numbersInText(text: string): number[] {
  const t = text.replace(/[   ]/g, ' ');
  const out: number[] = [];
  const re = /(\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.](\d+))?\s*(mrd\.?|milliard(?:er)?|billion|mill\.?|mnok|millioner|million(?:s)?|tusen|thousand|promille|‰)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const int = m[1]!.replace(/[ .]/g, '');
    const value = Number(m[2] ? `${int}.${m[2]}` : int);
    if (!Number.isFinite(value)) continue;
    const unit = (m[3] ?? '').toLowerCase();
    if (/^(mrd|milliard|billion)/.test(unit)) out.push(value * 1e9);
    else if (/^(mill|mnok|million)/.test(unit)) out.push(value * 1e6);
    else if (/^(tusen|thousand)/.test(unit)) out.push(value * 1e3);
    else if (unit === 'promille' || unit === '‰') out.push(value, value / 10);
    else out.push(value);
  }
  for (const word of t.toLowerCase().split(/[^a-zæøåé]+/)) {
    const n = WORD_NUMBERS[word];
    if (n !== undefined) out.push(n);
  }
  return out;
}

export function numberInText(n: number, text: string | null | undefined): boolean {
  if (!text) return false;
  const tolerance = Math.max(0.005, Math.abs(n) * 0.001);
  return numbersInText(text).some((x) => Math.abs(x - n) <= tolerance);
}

export interface ProfitChecks {
  /** Beløpet står i et kontrollert sitat. */
  statedValues: boolean[];
  /** Mengden står i et kontrollert sitat (null når mengden ikke er oppgitt som «kilde»). */
  costDrivers: (boolean | null)[];
  risks: { quote: boolean; percent: boolean | null; days: boolean | null; amount: boolean | null }[];
  duration: boolean | null;
}

function verifiedQuote(ref: { source_id: string; page: number | null; quote: string | null } | null, sources: AnalysisSource[]): string | null {
  const check = checkRef(ref, sources);
  return check?.quoteVerified ? (ref?.quote ?? null) : null;
}

export function checkProfitNumbers(data: ProfitAnalysis, sources: AnalysisSource[]): ProfitChecks {
  const numberCheck = (n: number | null, quote: string | null) => (n === null ? null : quote !== null && numberInText(n, quote));
  return {
    statedValues: data.stated_values.map((v) => numberInText(v.amount, verifiedQuote(v.source, sources))),
    costDrivers: data.cost_drivers.map((d) =>
      d.quantity === null || d.quantity_basis !== 'kilde' ? null : numberInText(d.quantity, verifiedQuote(d.source, sources)),
    ),
    risks: data.contract_risks.map((r) => {
      const quote = verifiedQuote(r.source, sources);
      return { quote: quote !== null, percent: numberCheck(r.percent, quote), days: numberCheck(r.days, quote), amount: numberCheck(r.amount, quote) };
    }),
    duration: data.duration.months === null ? null : verifiedQuote(data.duration.source, sources) !== null,
  };
}

// ---------------------------------------------------------------------------
// Testmodus (AI_PROVIDER=mock): forutsigbare svar bygd med enkle regler – merket tydelig.
// ---------------------------------------------------------------------------
const MOCK_NOTE = '(Simulert svar fra testmodus – ikke en ekte AI-analyse.)';

const TERM_TO_RISK: Partial<Record<TermCategory, ProfitRiskCategory>> = {
  dagbot: 'dagbot',
  betalingsvilkar: 'betalingsvilkar',
  prisregulering: 'prisregulering',
  garanti: 'garanti',
  erstatningsansvar: 'erstatningsansvar',
  leveringsfrist: 'leveringsfrist',
  forsikring: 'forsikring',
  volum: 'volum',
};

function sentenceAround(text: string, needle: RegExp): string | null {
  const flat = text.replace(/\s+/g, ' ');
  const m = needle.exec(flat);
  if (!m) return null;
  const start = Math.max(0, flat.lastIndexOf('.', m.index) + 1);
  const endDot = flat.indexOf('.', m.index + m[0].length);
  const end = endDot === -1 ? flat.length : endDot + 1;
  return flat.slice(start, end).trim().slice(0, 200);
}

export function mockProfitAnalysis(sources: AnalysisSource[]): ProfitAnalysis {
  const stated: ProfitAnalysis['stated_values'] = [];
  const drivers: ProfitAnalysis['cost_drivers'] = [];
  const risks: ProfitAnalysis['contract_risks'] = [];
  for (const s of sources) {
    for (const p of s.pages) {
      for (const raw of p.text.split('\n')) {
        const line = raw.trim();
        const value = /^Estimert verdi:\s*([\d\s ]+)\s*kr/i.exec(line);
        if (value && stated.length < 2) {
          stated.push({
            label: 'Estimert verdi i kunngjøringen',
            amount: Number(value[1]!.replace(/[\s ]/g, '')),
            currency: 'NOK',
            period: 'ukjent',
            includes_options: null,
            source: { source_id: s.id, page: p.page, quote: line.slice(0, 180) },
          });
        }
      }
      const qty = /(\d[\d  ]*)\s*(timer|årsverk|vektere|stk|m2|kvadratmeter|km|tonn)\b/i;
      const quote = sentenceAround(p.text, qty);
      if (quote && drivers.length < 4) {
        const m = qty.exec(quote)!;
        const unit = m[2]!.toLowerCase();
        drivers.push({
          category: /timer|årsverk|vektere/.test(unit) ? 'arbeid' : 'materialer',
          description: quote.slice(0, 120),
          quantity: Number(m[1]!.replace(/[\s  ]/g, '')),
          unit,
          period: /per år|årlig|pr\.? år/i.test(quote) ? 'per_aar' : /per måned|månedlig/i.test(quote) ? 'per_maaned' : 'total',
          quantity_basis: 'kilde',
          calculation: null,
          source: { source_id: s.id, page: p.page, quote },
        });
      }
    }
  }
  const scan = scanContractTerms(sources, 1);
  for (const hit of scan.hits) {
    const category = TERM_TO_RISK[hit.category];
    if (!category || risks.some((r) => r.category === category)) continue;
    const source = sources.find((s) => s.id === hit.sourceId);
    const page = source?.pages.find((p) => p.page === hit.page);
    const quote = page ? sentenceAround(page.text, new RegExp(hit.match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')) : null;
    const q = quote ?? hit.snippet.replace(/^…|…$/g, '').slice(0, 180);
    const pct = /(\d+(?:[,.]\d+)?)\s*%/.exec(q);
    const days = /(\d+)\s*dager/.exec(q);
    risks.push({
      category,
      title: PROFIT_RISK_LABELS[category],
      finding: q,
      economic_impact: `Testmodus: vurder hvordan vilkåret påvirker kostnad og risiko. ${MOCK_NOTE}`,
      severity: category === 'dagbot' ? 'høy' : 'middels',
      basis: 'kilde',
      percent: pct ? Number(pct[1]!.replace(',', '.')) : null,
      days: days ? Number(days[1]) : null,
      amount: null,
      source: { source_id: hit.sourceId, page: hit.page, quote: q },
    });
  }
  const hasDocs = sources.some((s) => s.kind === 'document');
  return {
    summary: `Testmodus: enkel regelbasert gjennomgang av kildene. ${MOCK_NOTE}`,
    stated_values: stated,
    duration: { months: null, text: null, options_text: null, source: null },
    price_format: { text: null, source: null },
    price_evaluation: { text: null, weight_pct: null, source: null },
    cost_drivers: drivers,
    contract_risks: risks,
    economic_uncertainties: [{ text: `Mengdene må kontrolleres mot dokumentene. ${MOCK_NOTE}`, basis: 'tolkning', source: null }],
    missing_for_calculation: ['Bedriftens egne timekostnader og innkjøpspriser (legges inn i kalkylen).'],
    documents_not_read: hasDocs ? [] : ['Konkurransegrunnlaget og kontraktsvilkårene (ikke lastet opp)'],
  };
}

// ---------------------------------------------------------------------------
// Kjøring og lagring
// ---------------------------------------------------------------------------
export interface StoredProfitAnalysis {
  id: string;
  createdAt: Date;
  data: ProfitAnalysis;
  verification: Record<string, RefCheck>;
  checks: ProfitChecks;
  coverage: SourceCoverage[];
  documentsAnalyzed: number;
  isMock: boolean;
  model: string;
}

export async function getLatestProfitAnalysis(tx: Tx, tenderId: string, orgId: string): Promise<StoredProfitAnalysis | null> {
  const row = first(
    (await tx`
      select id, created_at, result, model from ai_analyses
      where tender_id = ${tenderId} and kind = 'profit_analysis' and status = 'completed' and org_id = ${orgId}
      order by created_at desc limit 1
    `) as unknown as { id: string; createdAt: Date; result: Record<string, unknown>; model: string }[],
  );
  if (!row) return null;
  const parsed = profitAnalysisZ.safeParse(row.result.data);
  if (!parsed.success) return null;
  const coverage = (row.result.coverage ?? []) as SourceCoverage[];
  return {
    id: row.id,
    createdAt: row.createdAt,
    data: parsed.data,
    verification: (row.result.verification ?? {}) as Record<string, RefCheck>,
    checks: row.result.checks as ProfitChecks,
    coverage,
    documentsAnalyzed: coverage.filter((c) => c.kind === 'document' && c.includedPages.length > 0).length,
    isMock: Boolean(row.result.isMock),
    model: row.model,
  };
}

export async function runProfitAnalysis(org: OrgContext, userId: string, tenderId: string, opts: { force?: boolean } = {}): Promise<RunAiResult> {
  if (!org.entitlements.profitAI) {
    return { ok: false, code: 'quota', error: 'AI-analyse av lønnsomhet og kontraktsrisiko er med i Bedrift.' };
  }
  const prepared = await withTenant({ userId, orgId: org.id }, async (tx) => {
    const tender = await getTender(tx, tenderId);
    if (!tender) return null;
    const docs = org.entitlements.documentUpload ? await loadDocumentSources(tx, tenderId) : [];
    return { sources: [noticeSource(tender), ...docs] };
  });
  if (!prepared) return { ok: false, code: 'invalid_output', error: 'Fant ikke kunngjøringen.' };
  const { block, coverage } = buildSourceBlock(prepared.sources);
  return runAi({
    kind: 'profit_analysis',
    usageKind: 'ai_profit_analysis',
    org,
    userId,
    tenderId,
    // Lagres alltid bare for organisasjonen: analysen er en del av deres prisarbeid.
    isPrivate: true,
    system: PROFIT_ANALYSIS_SYSTEM,
    cacheablePrefix: block,
    user: 'Finn beløp, kostnadsdrivere med mengder og kontraktsvilkår med økonomisk risiko i kildene over, i henhold til skjemaet.',
    tier: 'quality',
    effort: 'medium',
    schemaName: 'profit_analysis',
    schemaDescription: 'Kostnadsdrivere, beløp og kontraktsrisiko fra en offentlig konkurranse, med kildehenvisninger',
    schema: profitAnalysisJsonSchema,
    validator: profitAnalysisZ,
    maxOutputTokens: 16000,
    mockHint: () => mockProfitAnalysis(prepared.sources),
    hashExtra: 'profit:v1',
    force: opts.force,
    enrich: (data) => ({ verification: verifyAllRefs(data, prepared.sources), checks: checkProfitNumbers(data, prepared.sources), coverage }),
  });
}
