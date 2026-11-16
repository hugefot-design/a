/**
 * Testfiler: en «skannet» PDF – ett bilde (JPEG) per side og ingen tekst – slik en skanner lager dem.
 * Bygges for hånd (PDF-objekter og kryssreferansetabell), uten nye avhengigheter.
 */

/** Hvitt bilde, 1 × 1 piksel (JPEG). Nok når bare «ingen tekst» skal testes. */
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

/** Leser bredde og høyde fra JPEG-filens SOF-markør. */
export function jpegSize(jpeg: Buffer): { width: number; height: number } {
  let i = 2;
  while (i < jpeg.length) {
    if (jpeg[i] !== 0xff) throw new Error('Ikke en JPEG');
    const marker = jpeg[i + 1]!;
    const length = jpeg.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: jpeg.readUInt16BE(i + 5), width: jpeg.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  throw new Error('Fant ikke størrelsen i JPEG-filen');
}

/** PDF med én side per JPEG-bilde, uten tekstlag. Sidestørrelsen er A4 (bildet strekkes til siden). */
export function imagePdf(jpegs: Buffer[]): Buffer {
  const W = 595;
  const H = 842;
  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Buffer | string) => {
    const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b;
    chunks.push(buf);
    length += buf.length;
  };
  const obj = (n: number, body: (Buffer | string)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    for (const part of body) push(part);
    push('\nendobj\n');
  };
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const pageIds = jpegs.map((_, i) => 3 + i * 3);
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  obj(2, [`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${jpegs.length} >>`]);
  jpegs.forEach((jpeg, i) => {
    const [page, image, content] = [3 + i * 3, 4 + i * 3, 5 + i * 3];
    const { width, height } = jpegSize(jpeg);
    const draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(page, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`]);
    obj(image, [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream']);
    obj(content, [`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`]);
  });
  const count = 3 + jpegs.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks);
}
