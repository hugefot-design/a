/**
 * Krav- og avvisningssjekk – uten AI.
 *
 * Finner setninger i kunngjøringen og de opplastede dokumentene som beskriver avvisningsgrunner,
 * absolutte krav/minstekrav, kvalifikasjonskrav, befaring/frister, krav til selve tilbudet og
 * tildelingskriterier. Kvalifikasjons- og tildelingskriteriene i kunngjøringen (eForms) brukes direkte.
 *
 * Hvert treff viser hele setningen med dokument og side, så brukeren kan sjekke det selv. Ordsøk finner
 * ord, ikke betydning: noen treff kan være generelle, og krav uten disse ordene fanges ikke opp.
 * Alle uttrykk er lineære (ingen nøstede gjentakelser), så store dokumenter kan ikke låse tjenesten.
 */
import type { AnalysisSource } from '@/domain/ai/sources';

export type RequirementKind = 'avvisning' | 'minstekrav' | 'kvalifikasjon' | 'befaring' | 'innlevering' | 'tildeling';

/** Rekkefølgen er prioritet: en setning havner i den første kategorien som passer. */
export const REQUIREMENT_KINDS: RequirementKind[] = ['avvisning', 'minstekrav', 'befaring', 'kvalifikasjon', 'tildeling', 'innlevering'];

export const REQUIREMENT_LABELS: Record<RequirementKind, { label: string; hint: string }> = {
  avvisning: { label: 'Avvisningsgrunner', hint: 'Forhold som gjør at tilbudet kan bli avvist. Gå gjennom hvert punkt før innlevering.' },
  minstekrav: { label: 'Absolutte krav og minstekrav', hint: 'Må oppfylles – ellers kan tilbudet avvises.' },
  befaring: { label: 'Befaring og frister', hint: 'Obligatorisk befaring, spørsmålsfrist og vedståelsesfrist.' },
  kvalifikasjon: { label: 'Kvalifikasjonskrav og dokumentasjon', hint: 'Krav til bedriften (økonomi, erfaring, sertifiseringer) og bevisene som skal legges ved.' },
  tildeling: { label: 'Tildelingskriterier', hint: 'Hvordan tilbudene vurderes – med vekt når den er oppgitt.' },
  innlevering: { label: 'Andre «skal»-krav', hint: 'Hva tilbudet og leverandøren skal eller må – og hva som skal legges ved. Sjekk at dere oppfyller hvert punkt.' },
};

// NB: \b kjenner bare a–z, så ord som begynner eller slutter med æ/ø/å avgrenses med (?<![a-zæøå]) / (?![a-zæøå]).
const PATTERNS: Record<RequirementKind, RegExp> = {
  avvisning: /\bavvis(?:es|ning|ningsgrunn\w*|t|e)?\b|\bvil bli avvist\b|\bavvisningsgrunn|\b(?:will|shall) be rejected\b|\brejection\b|\bdisqualif/i,
  minstekrav: /\bminstekrav|\bminimumskrav|\babsolutte? krav|\bufravikelig|\bobligatoriske? krav|\bskal-krav|\bmandatory requirement|\bminimum requirement/i,
  befaring: /\bbefaring|\bvedståelsesfrist|\bfrist for (?:å stille )?spørsmål|\bspørsmålsfrist|\bsite visit|\bmandatory visit/i,
  kvalifikasjon:
    /\bkvalifikasjonskrav|\bkvalifikasjonskriter|\begenerklæring|\bESPD\b|\bskatteattest|\bfirmaattest|\bsentral godkjenning|\bISO ?(?:9001|14001|27001|45001)\b|\breferanseoppdrag|\bomsetning (?:på |over |av )?(?:minst |minimum |mer enn )?(?:kr\.? ?|NOK ?)?\d|(?<![a-zæøå])økonomisk (?:og finansiell )?kapasitet|\btekniske? og faglige? (?:kvalifikasjon|kapasitet|dyktighet)|\bkredittvurdering|\bselection criteri|\bqualification requirement|\bfinancial standing/i,
  tildeling: /\btildelingskriter|\bvekt(?:ing)?\s*:?\s*\d{1,3}\s*%|\b(?:pris|kvalitet|miljø|gjennomføring|kompetanse|leveringstid)\s*[–:-]?\s*\d{1,3}\s*%|\bvekte[srt]\s+(?:med\s+)?\d{1,3}\s*%|\bweight(?:ing)?\s*:?\s*\d{1,3}\s*%|\baward criteri/i,
  innlevering:
    /\b(?:tilbudet|tilbyderen|tilbyder|leverandøren)\b[^.!?\n]{0,80}?\b(?:skal|må)(?![a-zæøå])|\bskal (?:vedlegges|leveres|signeres|fylles ut|inneholde|merkes|lastes opp)\b|\bmå (?:vedlegges|leveres|signeres|fylles ut|inneholde)\b|\btender shall (?:include|contain)/i,
};

export interface RequirementHit {
  kind: RequirementKind;
  /** Hele setningen (forkortet rundt treffet hvis den er svært lang). */
  text: string;
  /** Ordet eller uttrykket som ga treffet (tom for strukturerte krav fra kunngjøringen). */
  match: string;
  sourceId: string;
  sourceTitle: string;
  documentId?: string;
  page: number | null;
  /** Hentet fra feltene i kunngjøringen (eForms), ikke fra ordsøk. */
  structured: boolean;
  weight?: string | null;
}

export interface RequirementScan {
  byKind: Record<RequirementKind, RequirementHit[]>;
  /** Antall treff per kategori før begrensningen per kategori. */
  counts: Record<RequirementKind, number>;
  total: number;
  /** Dokumenter (ikke kunngjøringen) som ble lest. */
  documents: number;
  /** Sider i dokumentene som ble lest (kunngjøringen er ikke med). */
  pages: number;
}

const MAX_PER_KIND = 30;
const MAX_SENTENCE = 420;

/** Forkortelser og listemerker som slutter med punktum uten at setningen slutter («1.», «jf.», «f.eks.»). */
const NO_BREAK = /(?:^|\s)(?:\d{1,2}|[a-z]|nr|kr|ca|jf|bl\.a|f\.eks|pkt|kap|ref|evt|inkl|ekskl|vedl|tlf|mv|osv|dvs|iht)\.$/i;

/**
 * Deler en side i setninger: avsnitt, punktlister og setningsslutt. En linje fortsetter forrige linje når
 * forrige ikke slutter med skilletegn og den nye begynner med liten bokstav eller tall (PDF bryter linjer
 * midt i setninger). Feltlinjer («Beskrivelse:») og punkter starter alltid på nytt.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r/g, '').split(/\n[ \t]*\n/)) {
    const segments: string[] = [];
    for (const raw of para.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const prev = segments[segments.length - 1];
      const continues = prev !== undefined && !/[.!?:;]$/.test(prev) && !/^(?:[•▪◦\-–*]|\d{1,2}[.)]|[a-z][.)])\s/.test(line) && /^[a-zæøå0-9(]/.test(line);
      if (continues) segments[segments.length - 1] = `${prev} ${line}`;
      else segments.push(line);
    }
    for (const seg of segments) {
      // Ny setning etter punktum bare når neste ord starter med stor bokstav («kl. 10.00» deles ikke).
      const pieces = seg.split(/(?<=[.!?])\s+(?=[A-ZÆØÅ«"(])/);
      let buffer = '';
      for (const piece of pieces) {
        buffer = buffer ? `${buffer} ${piece}` : piece;
        if (NO_BREAK.test(buffer)) continue;
        const clean = buffer.replace(/\s+/g, ' ').trim();
        if (clean) out.push(clean);
        buffer = '';
      }
      if (buffer.trim()) out.push(buffer.replace(/\s+/g, ' ').trim());
    }
  }
  return out;
}

/** Innholdsfortegnelser («Avvisning ........ 12») og korte overskrifter er ikke krav – korte vekter («Pris vektes 40 %.») er det. */
function looksLikeNoise(sentence: string): boolean {
  if (sentence.length < 25 && !/\d\s*%/.test(sentence)) return true;
  if (/\.{5,}|…{2,}|_{5,}/.test(sentence)) return true;
  if (!/[a-zæøå]{3}/i.test(sentence)) return true;
  return false;
}

function trimAround(sentence: string, index: number): string {
  if (sentence.length <= MAX_SENTENCE) return sentence;
  const start = Math.max(0, Math.min(index - 140, sentence.length - MAX_SENTENCE));
  const cut = sentence.slice(start, start + MAX_SENTENCE);
  return `${start > 0 ? '…' : ''}${cut.trim()}${start + MAX_SENTENCE < sentence.length ? '…' : ''}`;
}

function classify(sentence: string): { kind: RequirementKind; match: string; index: number } | null {
  for (const kind of REQUIREMENT_KINDS) {
    const m = PATTERNS[kind].exec(sentence);
    if (m) return { kind, match: m[0], index: m.index };
  }
  return null;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-zæøå0-9]+/g, ' ').trim();

export interface StructuredCriteria {
  selectionCriteria?: string[] | null;
  awardCriteria?: { name: string; weight?: string | null }[] | null;
}

export function scanRequirements(sources: AnalysisSource[], structured: StructuredCriteria = {}): RequirementScan {
  const byKind = Object.fromEntries(REQUIREMENT_KINDS.map((k) => [k, [] as RequirementHit[]])) as Record<RequirementKind, RequirementHit[]>;
  const counts = Object.fromEntries(REQUIREMENT_KINDS.map((k) => [k, 0])) as Record<RequirementKind, number>;
  const seen = new Set<string>();
  const notice = sources.find((s) => s.kind === 'notice');
  const add = (hit: RequirementHit) => {
    const key = normalize(hit.text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    counts[hit.kind]++;
    if (byKind[hit.kind].length < MAX_PER_KIND) byKind[hit.kind].push(hit);
  };

  // 1. Strukturerte kriterier fra kunngjøringen (sikrest – de er oppgitt av oppdragsgiver i egne felt).
  for (const c of structured.selectionCriteria ?? []) {
    if (c.trim()) add({ kind: 'kvalifikasjon', text: c.trim(), match: '', sourceId: notice?.id ?? 'S0', sourceTitle: notice?.title ?? 'Kunngjøringen', page: null, structured: true });
  }
  for (const c of structured.awardCriteria ?? []) {
    if (c.name.trim()) {
      add({
        kind: 'tildeling',
        text: c.weight ? `${c.name.trim()} – vekt ${c.weight}` : c.name.trim(),
        match: '',
        sourceId: notice?.id ?? 'S0',
        sourceTitle: notice?.title ?? 'Kunngjøringen',
        page: null,
        structured: true,
        weight: c.weight ?? null,
      });
    }
  }

  // 2. Ordsøk i kunngjøringens tekst og dokumentene.
  let pages = 0;
  for (const source of sources) {
    for (const page of source.pages) {
      if (source.kind === 'document') pages++;
      for (const sentence of splitSentences(page.text)) {
        if (looksLikeNoise(sentence)) continue;
        const c = classify(sentence);
        if (!c) continue;
        add({
          kind: c.kind,
          text: trimAround(sentence, c.index),
          match: c.match,
          sourceId: source.id,
          sourceTitle: source.title,
          documentId: source.documentId,
          page: page.page,
          structured: false,
        });
      }
    }
  }
  const total = REQUIREMENT_KINDS.reduce((a, k) => a + counts[k], 0);
  return { byKind, counts, total, documents: sources.filter((s) => s.kind === 'document').length, pages };
}

/** Kategoriene som hører hjemme i sjekklisten i tilbudsarbeidet (tildelingskriterier er ikke oppgaver). */
export const CHECKLIST_KINDS: RequirementKind[] = ['avvisning', 'minstekrav', 'befaring', 'kvalifikasjon', 'innlevering'];

export function sourceLabel(hit: Pick<RequirementHit, 'sourceTitle' | 'page' | 'structured'>): string {
  if (hit.structured) return 'Kunngjøringen (eget felt)';
  return hit.page !== null ? `${hit.sourceTitle}, s. ${hit.page}` : hit.sourceTitle;
}
