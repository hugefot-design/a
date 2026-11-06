/**
 * Forutsigbare "AI-svar" for utvikling og automatiske tester (AI_PROVIDER=mock).
 * Svarene bygges med enkle regler fra kildeteksten og merkes tydelig i grensesnittet.
 * Brukes aldri i produksjon (provider.ts nekter).
 */
import { CERTIFICATIONS } from '@/domain/reference';
import type { AnalysisSource } from './sources';
import type { BasicSummary, BidDraft, BidReview, BidStructure, FitAssessment, TenderAnalysis, WeeklyOverview } from './schemas';

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
    .filter(({ sentence }) => /(?<![a-zæøå])(må|skal|krav|påkrevd|kvalifikasjonskrav)(?![a-zæøå])/i.test(sentence))
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
  const duration = findQuote(sources, /(?<![a-zæøå])(år|måneder)(?![a-zæøå]).*\b(opsjon|varighet|avtale)\b|\bopsjon\b/i);
  const ref = (q: { source_id: string; page: number | null; quote: string }) => ({ source_id: q.source_id, page: q.page, quote: q.quote });
  const category = (sentence: string) =>
    /kvalifikasjon|tillatelse|godkjen|registrert|qualif|experience|erfaring/i.test(sentence)
      ? ('kvalifikasjon' as const)
      : /dokumentasjon|attest|documentation/i.test(sentence)
        ? ('dokumentasjon' as const)
        : ('leveranse' as const);
  return {
    summary: `${descSentences.slice(0, 2).join(' ') || 'Kunngjøringen har lite beskrivende tekst.'} ${MOCK_NOTE}`,
    purchase_description: descSentences[0] ?? 'Ikke beskrevet i kildene.',
    scope_items: descSentences.slice(0, 2).map((text) => ({ text, basis: 'tolkning' as const, source: null })),
    requirements: [
      ...requirementHits.map(({ s, p, sentence }) => ({
        text: sentence,
        category: category(sentence),
        basis: 'kilde' as const,
        source: { source_id: s.id, page: p.page, quote: sentence.slice(0, 180) },
      })),
      ...certs.map((c) => ({ text: c.text, category: 'sertifisering' as const, basis: 'kilde' as const, source: c.source })),
      ...(financial ? [{ text: financial.sentence, category: 'økonomi' as const, basis: 'kilde' as const, source: ref(financial) }] : []),
    ],
    important_dates: deadlineQuote ? [{ label: 'Tilbudsfrist', value: deadlineQuote.sentence.replace(/^tilbudsfrist:\s*/i, '').slice(0, 200), source: ref(deadlineQuote) }] : [],
    deadline: deadlineQuote
      ? { value: deadlineQuote.sentence.replace(/^tilbudsfrist:\s*/i, '').slice(0, 200), source: ref(deadlineQuote) }
      : { value: null, source: null },
    contract_duration: duration ? { value: duration.sentence.slice(0, 200), source: ref(duration) } : { value: null, source: null },
    evaluation_criteria: pct ? [{ criterion: pct.sentence.slice(0, 200), weight: null, source: ref(pct) }] : [],
    rejection_risks: requirementHits
      .filter(({ sentence }) => /(?<![a-zæøå])(må|skal)(?![a-zæøå])/i.test(sentence))
      .slice(0, 3)
      .map(({ s, p, sentence }) => ({ text: `Kravet må dokumenteres: ${sentence}`, basis: 'tolkning' as const, source: { source_id: s.id, page: p.page, quote: sentence.slice(0, 180) } })),
    how_to_participate: ['Last ned konkurransegrunnlaget hos kilden.', 'Dokumenter kvalifikasjonskravene.', 'Lever tilbudet i oppdragsgivers system før fristen.'],
    risks: [{ text: `Testmodus: risikovurdering lages ikke. ${MOCK_NOTE}`, source: null }],
    questions_to_investigate: ['Hvilke dokumenter må legges ved tilbudet?', 'Er det spørsmålsfrist før tilbudsfristen?'],
    missing_information: [
      ...(duration ? [] : ['Kontraktens varighet er ikke oppgitt i kildene.']),
      ...(pct ? [] : ['Tildelingskriterier og vekting er ikke oppgitt i kildene.']),
    ],
    documents_not_read: sources.some((s2) => s2.kind === 'document') ? [] : ['Konkurransegrunnlaget (ikke lastet opp)'],
  };
}

export function mockFitAssessment(sources: AnalysisSource[], profileFacts: string[]): FitAssessment {
  const reqs = mockTenderAnalysis(sources).requirements.slice(0, 6);
  const profileText = profileFacts.join(' ').toLowerCase();
  return {
    overall: `Testmodus: enkel sammenligning av ord i krav og bedriftsprofil. ${MOCK_NOTE}`,
    fit: reqs.length ? 'middels' : 'uklar',
    requirements: reqs.map((r) => {
      const words = r.text.toLowerCase().split(/\W+/).filter((w) => w.length > 6);
      const hit = words.some((w) => profileText.includes(w));
      return {
        requirement: r.text,
        status: hit ? ('oppfylt' as const) : ('uklart' as const),
        explanation: hit ? 'Profilen nevner dette.' : 'Profilen sier ikke noe om dette.',
        basis: r.basis,
        source: r.source,
      };
    }),
    missing_company_info: profileFacts.some((f) => f.startsWith('Omsetning')) ? [] : ['Årlig omsetning'],
    uncertainty: 'høy',
    uncertainty_reasons: ['Simulert vurdering i testmodus.'],
    next_steps: ['Les konkurransegrunnlaget.'],
  };
}

export function mockBidStructure(sources: AnalysisSource[]): BidStructure {
  const reqs = mockTenderAnalysis(sources).requirements;
  return {
    sections: [
      { title: 'Om leverandøren', purpose: 'Kort presentasjon og kvalifikasjoner.', requirements_covered: reqs.filter((r) => r.category === 'kvalifikasjon').map((r) => r.text).slice(0, 3), source: null },
      { title: 'Løsning og gjennomføring', purpose: `Hvordan oppdraget løses. ${MOCK_NOTE}`, requirements_covered: reqs.filter((r) => r.category === 'leveranse').map((r) => r.text).slice(0, 3), source: null },
      { title: 'Pris', purpose: 'Utfylt prisskjema.', requirements_covered: [], source: null },
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
