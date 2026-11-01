/**
 * Forutsigbare "AI-svar" for utvikling og automatiske tester (AI_PROVIDER=mock).
 * Svarene bygges med enkle regler fra kildeteksten og merkes tydelig i grensesnittet.
 * Brukes aldri i produksjon (provider.ts nekter).
 */
import { CERTIFICATIONS } from '@/domain/reference';
import type { AnalysisSource } from './sources';
import type { BasicSummary, BidDraft, BidReview, TenderAnalysis, WeeklyOverview } from './schemas';

const MOCK_NOTE = '(Simulert svar fra testmodus – ikke en ekte AI-analyse.)';

// Faktalinjene øverst i kunngjøringskilden ("Tittel: …", "Tilbudsfrist: …") er ikke setninger.
const META_LINE = /^(Tittel|Oppdragsgiver|Sted|CPV-koder|Kontraktstype|Prosedyre|Estimert verdi|Tilbudsfrist|Publisert|Beskrivelse):/;

function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .filter((line) => !META_LINE.test(line.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

function findQuote(sources: AnalysisSource[], re: RegExp) {
  for (const s of sources) {
    for (const p of s.pages) {
      for (const sentence of sentences(p.text)) {
        if (re.test(sentence)) return { source_id: s.id, page: p.page, quote: sentence.slice(0, 180), sentence };
      }
    }
  }
  return null;
}

function findLine(sources: AnalysisSource[], re: RegExp) {
  for (const s of sources) {
    for (const p of s.pages) {
      for (const raw of p.text.split('\n')) {
        const line = raw.trim();
        if (line && re.test(line)) return { source_id: s.id, page: p.page, quote: line.slice(0, 180), sentence: line };
      }
    }
  }
  return null;
}

export function mockTenderAnalysis(sources: AnalysisSource[]): TenderAnalysis {
  const notice = sources.find((s) => s.kind === 'notice');
  const allText = sources.flatMap((s) => s.pages.map((p) => p.text)).join('\n');
  const descSentences = sentences(notice?.pages.map((p) => p.text).join(' ') ?? '').filter((s) => !s.startsWith('Fiktiv kunngjøring'));
  const requirementHits = sources
    .flatMap((s) => s.pages.flatMap((p) => sentences(p.text).map((sentence) => ({ s, p, sentence }))))
    .filter(({ sentence }) => /\b(må|skal|krav|påkrevd|kvalifikasjonskrav)\b/i.test(sentence))
    .slice(0, 6);
  const certs = CERTIFICATIONS.filter((c) => c.patterns.some((re) => re.test(allText)))
    .map((c) => {
      const q = findQuote(sources, c.patterns[0]!);
      return q ? { text: c.label, source: { source_id: q.source_id, page: q.page, quote: q.quote } } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const deadlineQuote = findLine(sources, /^tilbudsfrist:\s*\d/i) ?? findQuote(sources, /tilbudsfrist/i);
  const pct = findQuote(sources, /\d+\s*%/);
  const financial = findQuote(sources, /omsetning|kredittvurdering|egenkapital/i);
  const duration = findQuote(sources, /\b(år|måneder)\b.*\b(opsjon|varighet|avtale)\b|\bopsjon\b/i);
  return {
    summary: `${descSentences.slice(0, 2).join(' ') || 'Kunngjøringen har lite beskrivende tekst.'} ${MOCK_NOTE}`,
    purchase_description: descSentences[0] ?? 'Ikke beskrevet i kildene.',
    key_requirements: requirementHits.map(({ s, p, sentence }) => ({ text: sentence, source: { source_id: s.id, page: p.page, quote: sentence.slice(0, 180) } })),
    qualification_criteria: requirementHits
      .filter(({ sentence }) => /kvalifikasjon|tillatelse|godkjen|registrert/i.test(sentence))
      .map(({ s, p, sentence }) => ({ text: sentence, source: { source_id: s.id, page: p.page, quote: sentence.slice(0, 180) } })),
    certifications: certs,
    financial_requirements: financial ? [{ text: financial.sentence, source: { source_id: financial.source_id, page: financial.page, quote: financial.quote } }] : [],
    deadline: deadlineQuote
      ? { value: deadlineQuote.sentence.replace(/^tilbudsfrist:\s*/i, '').slice(0, 200), source: { source_id: deadlineQuote.source_id, page: deadlineQuote.page, quote: deadlineQuote.quote } }
      : { value: null, source: null },
    contract_duration: duration
      ? { value: duration.sentence.slice(0, 200), source: { source_id: duration.source_id, page: duration.page, quote: duration.quote } }
      : { value: null, source: null },
    geographic_requirements: [],
    evaluation_criteria: pct ? [{ criterion: pct.sentence.slice(0, 200), weight: null, source: { source_id: pct.source_id, page: pct.page, quote: pct.quote } }] : [],
    required_documentation: [],
    risks: [{ text: `Testmodus: risikovurdering lages ikke. ${MOCK_NOTE}`, source: null }],
    questions_to_investigate: ['Hvilke dokumenter må legges ved tilbudet?', 'Er det spørsmålsfrist før tilbudsfristen?'],
    missing_information: [
      ...(duration ? [] : ['Kontraktens varighet er ikke oppgitt i kildene.']),
      ...(pct ? [] : ['Tildelingskriterier og vekting er ikke oppgitt i kildene.']),
    ],
  };
}

export function mockBasicSummary(sources: AnalysisSource[]): BasicSummary {
  const full = mockTenderAnalysis(sources);
  return { summary: full.summary, purchase_description: full.purchase_description, missing_information: full.missing_information };
}

export function mockBidDraft(sectionTitle: string, profileFacts: string[]): BidDraft {
  return {
    content: `${sectionTitle}\n\n${profileFacts.length ? profileFacts.map((f) => `- ${f}`).join('\n') : ''}\n\n[FYLL INN: Beskriv hvordan dere løser oppdraget]\n[FYLL INN: Relevante referanser med kontaktperson]\n\n${MOCK_NOTE}`,
    placeholders: ['Beskriv hvordan dere løser oppdraget', 'Relevante referanser med kontaktperson'],
    profile_facts_used: profileFacts.slice(0, 5),
  };
}

export function mockBidReview(requirements: string[], sectionTexts: string): BidReview {
  return {
    overall: `Testmodus: enkel ordsammenligning. ${MOCK_NOTE}`,
    items: requirements.slice(0, 15).map((r) => {
      const words = r.toLowerCase().split(/\W+/).filter((w) => w.length > 5);
      const hits = words.filter((w) => sectionTexts.toLowerCase().includes(w)).length;
      const coverage = hits >= Math.max(1, Math.ceil(words.length / 2)) ? 'dekket' : hits > 0 ? 'delvis' : 'mangler';
      return { requirement: r, coverage, comment: `${hits} av ${words.length} sentrale ord funnet i utkastet.`, section_title: null };
    }),
  };
}

export function mockWeeklyOverview(lines: string[]): WeeklyOverview {
  return { headline: `Ukens oversikt ${MOCK_NOTE}`, points: lines.slice(0, 5) };
}
