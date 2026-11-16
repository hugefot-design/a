/**
 * OCR i nettleseren for skannede PDF-er (Tesseract.js – ingen betalt OCR i skyen, og dokumentet sendes ikke til noen
 * andre). Lastes først når kunden velger en PDF i opplastingsskjemaet på anbudssiden.
 *
 * 1. pdf.js leser PDF-en her i nettleseren og finner sidene uten tekst (skannede sider).
 * 2. Hver slik side tegnes som et bilde og leses med Tesseract (norsk og engelsk), én side om gangen, med fremdrift.
 * 3. Teksten legges i et skjult felt og sendes med filen. Serveren bruker den bare for sider den selv ikke fant tekst
 *    på (src/domain/documents/ocr.ts).
 *
 * Motor, språkdata og pdf.js ligger hos oss under /assets/ocr/<versjon>/ – ingenting hentes fra andre nettsteder.
 */

/** Samme grenser som serveren (src/domain/documents/ocr.ts). */
const MAX_OCR_PAGES = 60;
const MIN_TEXT_CHARS_PER_PAGE = 25;
/** Sidebredde i piksler for OCR: nok for god lesing (ca. 200 DPI for A4) uten å bruke mye minne. */
const TARGET_WIDTH = 1800;

interface PdfPage {
  getTextContent(): Promise<{ items: { str?: string }[] }>;
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown; canvas: HTMLCanvasElement }): { promise: Promise<void> };
  cleanup(): void;
}
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}
interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(opts: { data: Uint8Array; isEvalSupported: boolean }): { promise: Promise<PdfDocument> };
}
interface TesseractWorker {
  recognize(image: HTMLCanvasElement): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<unknown>;
}
interface Tesseract {
  createWorker(langs: string[], oem: number, options: Record<string, unknown>): Promise<TesseractWorker>;
}

const running = new WeakMap<HTMLFormElement, { cancelled: boolean }>();

function setStatus(el: HTMLElement | null, html: string, busy = false) {
  if (!el) return;
  el.hidden = false;
  el.innerHTML = html;
  el.setAttribute('aria-busy', String(busy));
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Finner sidene uten tekst. Lese teksten er raskt; det er bare disse som må leses med OCR. */
async function pagesWithoutText(doc: PdfDocument): Promise<number[]> {
  const empty: number[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const chars = content.items.map((i) => i.str ?? '').join('').replace(/\s+/g, '').length;
    if (chars < MIN_TEXT_CHARS_PER_PAGE) empty.push(n);
    page.cleanup();
  }
  return empty;
}

/**
 * Kalles når kunden velger en fil. Gjør ingenting for andre filer enn PDF, eller når PDF-en har tekst på alle sider.
 */
export async function ocrIfScanned(form: HTMLFormElement, file: File, base: string): Promise<void> {
  const field = form.querySelector<HTMLInputElement>('input[name="ocr"]');
  const status = form.parentElement?.querySelector<HTMLElement>('[data-ocr-status]') ?? null;
  const submit = form.querySelector<HTMLButtonElement>('button');
  if (!field) return;
  field.value = '';
  const previous = running.get(form);
  if (previous) previous.cancelled = true;
  if (status) status.hidden = true;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return;

  const job = { cancelled: false };
  running.set(form, job);
  let doc: PdfDocument | null = null;
  let worker: TesseractWorker | null = null;
  try {
    const pdfjs = (await import(/* webpackIgnore: true */ `${base}pdf.min.mjs`)) as PdfJs;
    pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const empty = await pagesWithoutText(doc);
    if (!empty.length || job.cancelled) return;

    const todo = empty.slice(0, MAX_OCR_PAGES);
    if (submit) submit.disabled = true;
    const cancelButton = '<button type="button" data-ocr-cancel class="ml-2 font-semibold underline">Avbryt</button>';
    const progress = (done: number, part: number) => {
      const pct = Math.round(((done + part) / todo.length) * 100);
      setStatus(
        status,
        `<strong>Dokumentet ser skannet ut.</strong> Leser teksten her i nettleseren (OCR) – side ${Math.min(done + 1, todo.length)} av ${todo.length} …${cancelButton}` +
          `<progress class="mt-2 block w-full" max="100" value="${pct}" aria-label="Fremdrift for OCR">${pct} %</progress>`,
        true,
      );
      status?.querySelector('[data-ocr-cancel]')?.addEventListener('click', () => (job.cancelled = true), { once: true });
    };
    progress(0, 0);

    // ESM-pakken eksporterer biblioteket som standardeksport.
    const tesseract = (await import(/* webpackIgnore: true */ `${base}tesseract.esm.min.js`)) as { default?: Tesseract } & Partial<Tesseract>;
    const createWorker = (tesseract.default ?? (tesseract as Tesseract)).createWorker;
    let done = 0;
    worker = await createWorker(['nor', 'eng'], 1 /* OEM.LSTM_ONLY */, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}core/`,
      langPath: `${base}lang`,
      // Arbeideren lastes fra vår egen adresse (ikke en blob:-adresse, som sikkerhetsreglene for siden ikke tillater).
      workerBlobURL: false,
      gzip: true,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text' && !job.cancelled) progress(done, m.progress);
      },
    });

    const pages: { page: number; text: string; confidence: number }[] = [];
    for (const n of todo) {
      if (job.cancelled) break;
      const page = await doc.getPage(n);
      const first = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, TARGET_WIDTH / first.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const { data } = await worker.recognize(canvas);
      pages.push({ page: n, text: data.text.trim().slice(0, 20_000), confidence: Math.round(data.confidence) });
      // Frigjør minnet før neste side.
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      done++;
    }
    if (job.cancelled) {
      setStatus(status, 'OCR avbrutt. Du kan laste opp filen uten – da leses bare sidene som har tekst.');
      return;
    }
    field.value = JSON.stringify({ engine: 'tesseract.js 7.0.0', languages: 'nor+eng', pages });
    const words = pages.reduce((sum, p) => sum + (p.text.match(/\S+/g)?.length ?? 0), 0);
    const more = empty.length > todo.length ? ` De første ${todo.length} av ${empty.length} skannede sidene er lest.` : '';
    setStatus(
      status,
      `<strong>Ferdig:</strong> ${pages.length} ${pages.length === 1 ? 'side' : 'sider'} lest med OCR (${words} ord).${more} Trykk «Last opp» for å lagre. ` +
        'Teksten kan inneholde lesefeil – sjekk viktige tall mot dokumentet.',
    );
  } catch (err) {
    field.value = '';
    setStatus(status, `Kunne ikke lese den skannede PDF-en her i nettleseren (${escapeHtml(err instanceof Error ? err.message : String(err)).slice(0, 160)}). Du kan laste den opp likevel.`);
  } finally {
    if (submit) submit.disabled = false;
    await worker?.terminate().catch(() => undefined);
    await doc?.destroy().catch(() => undefined);
    if (running.get(form) === job) running.delete(form);
  }
}
