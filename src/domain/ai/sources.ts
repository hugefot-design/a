/**
 * Forbereder kildetekst til AI og kontrollerer kildehenvisningene i svaret.
 *
 * Dokumenttekst behandles som UTRODD data: den pakkes inn i tydelige markører,
 * markørene fjernes fra selve teksten, og modellen instrueres om å ignorere
 * instruksjoner i kildene. Svaret kan uansett bare være strukturert JSON som valideres.
 */
import { env } from '@/lib/env';

export interface AnalysisSourcePage {
  page: number | null;
  text: string;
}

export interface AnalysisSource {
  id: string;
  kind: 'notice' | 'document';
  title: string;
  pages: AnalysisSourcePage[];
  totalPages: number | null;
  isPrivate: boolean;
  documentId?: string;
}

export interface SourceCoverage {
  sourceId: string;
  title: string;
  kind: 'notice' | 'document';
  includedPages: number[];
  totalPages: number | null;
  truncated: boolean;
  documentId?: string;
}

/** Fjerner tegn og markører som kan brukes til å «bryte ut» av kildeblokken. */
export function sanitizeSourceText(text: string): string {
  return text
    .replace(/<\s*\/?\s*(kilde|kilder|system|instruks\w*|instructions?)\b[^>]*>/gi, '[markør fjernet]')
    .replace(/\[\[\s*side\s*\d+\s*\]\]/gi, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/­/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

function escapeAttr(value: string): string {
  return value.replace(/["<>]/g, '');
}

/** Bygger kildeblokken innenfor et tegnbudsjett. Returnerer også hva som faktisk ble tatt med. */
export function buildSourceBlock(sources: AnalysisSource[], budget = env.AI_MAX_INPUT_CHARS): { block: string; coverage: SourceCoverage[] } {
  let remaining = budget;
  const parts: string[] = [];
  const coverage: SourceCoverage[] = [];
  for (const source of sources) {
    const included: number[] = [];
    const bodyParts: string[] = [];
    let truncated = false;
    for (const p of source.pages) {
      const clean = sanitizeSourceText(p.text).trim();
      if (!clean) continue;
      const header = p.page !== null ? `[[side ${p.page}]]\n` : '';
      const chunk = header + clean;
      if (chunk.length > remaining) {
        if (remaining > 500) {
          bodyParts.push(chunk.slice(0, remaining));
          if (p.page !== null) included.push(p.page);
        }
        truncated = true;
        remaining = 0;
        break;
      }
      bodyParts.push(chunk);
      remaining -= chunk.length;
      if (p.page !== null) included.push(p.page);
    }
    if (!bodyParts.length) {
      coverage.push({ sourceId: source.id, title: source.title, kind: source.kind, includedPages: [], totalPages: source.totalPages, truncated: true, documentId: source.documentId });
      continue;
    }
    parts.push(
      `<kilde id="${source.id}" type="${source.kind === 'notice' ? 'kunngjøring' : 'dokument'}" tittel="${escapeAttr(source.title)}">\n${bodyParts.join('\n\n')}\n</kilde>`,
    );
    coverage.push({ sourceId: source.id, title: source.title, kind: source.kind, includedPages: included, totalPages: source.totalPages, truncated, documentId: source.documentId });
    if (remaining <= 0) break;
  }
  return { block: `<kilder>\n${parts.join('\n\n')}\n</kilder>`, coverage };
}

function norm(s: string): string {
  return s.toLowerCase().replace(/­/g, '').replace(/\s+/g, ' ').trim();
}

export interface RefCheck {
  sourceId: string;
  sourceTitle: string | null;
  page: number | null;
  quote: string | null;
  sourceExists: boolean;
  pageValid: boolean;
  quoteVerified: boolean;
}

/** Sjekker at kilde-ID finnes, at sidetallet finnes i dokumentet og at sitatet står ordrett i kilden. */
export function checkRef(ref: { source_id: string; page: number | null; quote: string | null } | null, sources: AnalysisSource[]): RefCheck | null {
  if (!ref) return null;
  const source = sources.find((s) => s.id === ref.source_id);
  if (!source) {
    return { sourceId: ref.source_id, sourceTitle: null, page: ref.page, quote: ref.quote, sourceExists: false, pageValid: false, quoteVerified: false };
  }
  const pageValid = ref.page === null || source.pages.some((p) => p.page === ref.page);
  let quoteVerified = false;
  if (ref.quote && ref.quote.trim().length >= 8) {
    const q = norm(ref.quote).replace(/^[«"“']+|[»"”'.…]+$/g, '');
    const candidates = ref.page !== null && pageValid ? source.pages.filter((p) => p.page === ref.page) : source.pages;
    quoteVerified = candidates.some((p) => norm(p.text).includes(q) || (q.length > 60 && norm(p.text).includes(q.slice(0, 60))));
  }
  return {
    sourceId: ref.source_id,
    sourceTitle: source.title,
    page: pageValid ? ref.page : null,
    quote: ref.quote,
    sourceExists: true,
    pageValid,
    quoteVerified,
  };
}

/** Går gjennom et vilkårlig AI-resultat og kontrollerer alle felt som heter "source". */
export function verifyAllRefs(value: unknown, sources: AnalysisSource[], path = ''): Record<string, RefCheck> {
  const out: Record<string, RefCheck> = {};
  const visit = (v: unknown, p: string) => {
    if (Array.isArray(v)) v.forEach((item, i) => visit(item, `${p}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'source' && (child === null || (typeof child === 'object' && child !== null && 'source_id' in child))) {
          const check = checkRef(child as { source_id: string; page: number | null; quote: string | null } | null, sources);
          if (check) out[p] = check;
        } else visit(child, p ? `${p}.${k}` : k);
      }
    }
  };
  visit(value, path);
  return out;
}
