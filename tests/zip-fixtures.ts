/**
 * ZIP-, Word- og Excel-filer til testene, laget i minnet: vanlige pakker, og filer som lyver om størrelsen eller er
 * merket som krypterte (slik «zip-bomber» og passordbeskyttede ZIP-filer ser ut).
 */
import JSZip from 'jszip';

export async function zipOf(files: Record<string, string | Buffer>): Promise<Buffer> {
  const z = new JSZip();
  for (const [name, data] of Object.entries(files)) z.file(name, data);
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
export async function docx(paragraphs: string[]): Promise<Buffer> {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  return zipOf({ '[Content_Types].xml': '<Types/>', 'word/document.xml': `<w:document><w:body>${body}</w:body></w:document>` });
}
export async function xlsx(sheets: { name: string; rows: (string | number)[][] }[]): Promise<Buffer> {
  const shared: string[] = [];
  const idx = (s: string) => (shared.includes(s) ? shared.indexOf(s) : shared.push(s) - 1);
  const files: Record<string, string> = {
    'xl/workbook.xml': `<workbook><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  };
  sheets.forEach((s, i) => {
    const rows = s.rows
      .map((r, ri) => `<row r="${ri + 1}">${r.map((v) => (typeof v === 'number' ? `<c><v>${v}</v></c>` : `<c t="s"><v>${idx(v)}</v></c>`)).join('')}</row>`)
      .join('');
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
  });
  files['xl/sharedStrings.xml'] = `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`;
  return zipOf(files);
}
/** Lyver om størrelsen utpakket (i sentralkatalogen og den lokale overskriften), slik en «zip-bombe» gjør. */
export function lieAboutSize(buf: Buffer, size: number): Buffer {
  const out = Buffer.from(buf);
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = out.readUInt32LE(i);
    if (sig === 0x02014b50) out.writeUInt32LE(size, i + 24);
    if (sig === 0x04034b50) out.writeUInt32LE(size, i + 22);
  }
  return out;
}
/** Setter «kryptert»-flagget, slik passordbeskyttede ZIP-filer har det. */
export function markEncrypted(buf: Buffer): Buffer {
  const out = Buffer.from(buf);
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = out.readUInt32LE(i);
    if (sig === 0x04034b50) out.writeUInt16LE(out.readUInt16LE(i + 6) | 1, i + 6);
    if (sig === 0x02014b50) out.writeUInt16LE(out.readUInt16LE(i + 8) | 1, i + 8);
  }
  return out;
}

/** En tom ZIP-fil (bare slutten av innholdsfortegnelsen). */
export const emptyZip = () => new JSZip().generateAsync({ type: 'nodebuffer' });
