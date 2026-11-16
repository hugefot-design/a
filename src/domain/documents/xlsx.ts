/**
 * Excel (.xlsx) som tekst: hvert ark med navnet sitt, hver rad som cellene etter hverandre – så krav og vilkår i
 * regneark (kravspesifikasjoner, prisskjemaer) blir med i ordsøket og analysen.
 *
 * Leses med den trygge ZIP-leseren (zip-reader.ts, bare Node), med et hardt tak på hvor mye som pakkes ut samlet –
 * uansett hva filen påstår. Formler regnes ikke ut – bare verdiene som er lagret i filen brukes. Tall vises slik de er
 * lagret (datoer er tall i Excel og vises derfor som tall).
 */
import { zipFileReader } from './zip-reader';

/** Høyst så mange ark leses. */
export const MAX_SHEETS = 50;
/** Høyst så mye tekst tas med fra én Excel-fil (resten kuttes, og det står i teksten). */
export const MAX_XLSX_TEXT = 2_000_000;

const attr = (tag: string, name: string): string | null => new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`).exec(tag)?.[1] ?? null;

export function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Teksten i et <si>- eller <is>-element: alle <t>-ene (også formatert tekst i flere deler), uten uttale-hint. */
function runText(xml: string): string {
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!)).join('');
}

export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => runText(m[1]!));
}

/** Radene i et ark: cellene med innhold, skilt med « | ». Tomme rader tas ikke med. */
export function sheetRows(xml: string, shared: readonly string[]): string[] {
  const rows: string[] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] ?? '';
      const body = cell[2] ?? '';
      const type = attr(` ${attrs}`, 't');
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (type === 's') text = v !== undefined ? (shared[Number(v)] ?? '') : '';
      else if (type === 'inlineStr') text = runText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (type === 'e') text = '';
      else if (v !== undefined) text = decodeXml(v);
      text = text.replace(/\s+/g, ' ').trim();
      if (text) cells.push(text);
    }
    if (cells.length) rows.push(cells.join(' | '));
  }
  return rows;
}

/** Stien til et ark ut fra relasjonen i arbeidsboken («worksheets/sheet1.xml» eller «/xl/worksheets/sheet1.xml»). */
function sheetPath(target: string): string | null {
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  return /(^|\/)\.\.(\/|$)/.test(path) || !/^xl\/[\w./-]+\.xml$/.test(path) ? null : path;
}

/** Leser en .xlsx-fil som tekst. Kaster en feil (ZipError eller Error) når filen ikke kan leses trygt. */
export function xlsxToText(data: Buffer, maxXmlBytes: number): string {
  const read = zipFileReader(data, { maxEntries: 5000, maxTotalBytes: maxXmlBytes });
  const workbook = read('xl/workbook.xml');
  if (!workbook) throw new Error('Fant ikke innholdet i Excel-filen.');
  const rels = read('xl/_rels/workbook.xml.rels') ?? '';
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')] as const));
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: decodeXml(attr(m[0], 'name') ?? ''), rid: attr(m[0], 'r:id') }));
  const shared = parseSharedStrings(read('xl/sharedStrings.xml') ?? '');

  const parts: string[] = [];
  let length = 0;
  for (const [i, s] of sheets.slice(0, MAX_SHEETS).entries()) {
    const target = s.rid ? targets.get(s.rid) : null;
    const path = target ? sheetPath(target) : `xl/worksheets/sheet${i + 1}.xml`;
    if (!path) continue;
    const xml = read(path);
    if (!xml) continue;
    const rows = sheetRows(xml, shared);
    if (!rows.length) continue;
    const part = `Ark «${s.name || `Ark ${i + 1}`}»\n${rows.join('\n')}`;
    if (length + part.length > MAX_XLSX_TEXT) {
      parts.push(`${part.slice(0, Math.max(0, MAX_XLSX_TEXT - length))}\n(Excel-filen er kortet ned her – resten er ikke lest.)`);
      break;
    }
    parts.push(part);
    length += part.length;
  }
  return parts.join('\n\n');
}
