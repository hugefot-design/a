/**
 * Fillagring: lokal disk (utvikling) eller Supabase Storage (produksjon).
 * Nøkler genereres alltid av serveren – aldri fra brukerens filnavn.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { env } from './env';

export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(keys: string[]): Promise<void>;
}

/** Filen finnes ikke (lenger) i lagringen – f.eks. serverdisken på gratisplanen etter ny versjon eller dvale. */
export class StoredFileMissing extends Error {
  constructor(key: string) {
    super(`Filen finnes ikke i lagringen (${key.split('/').pop()}).`);
  }
}

/**
 * Lagres filene bare midlertidig? I produksjon er serverdisken ikke varig (Render tømmer den ved ny versjon og når
 * gratistjenesten sover) – da må kundene få vite det. Varig lagring: STORAGE_DRIVER=supabase (docs/DRIFT.md).
 */
export function storageIsTemporary(): boolean {
  return env.NODE_ENV === 'production' && env.STORAGE_DRIVER === 'local';
}

function assertSafeKey(key: string): void {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new Error('Ugyldig lagringsnøkkel');
  }
}

class LocalStorage implements Storage {
  private root = resolve(process.cwd(), env.STORAGE_LOCAL_DIR);
  private path(key: string) {
    assertSafeKey(key);
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('Ugyldig lagringsnøkkel');
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data, { mode: 0o600 });
  }
  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new StoredFileMissing(key);
      throw err;
    }
  }
  async remove(keys: string[]) {
    await Promise.all(keys.map((k) => rm(this.path(k), { force: true })));
  }
}

/**
 * Supabase Storage via REST (samme API som Supabase-klienten bruker). Bøtta MÅ være privat: filene hentes bare
 * gjennom appen med tjenestenøkkelen, aldri via en offentlig lenke. Se {@link checkSupabaseBucket}.
 */
export class SupabaseStorage implements Storage {
  private base: string;
  private headers: Record<string, string>;
  constructor(
    url: string,
    serviceKey: string,
    private bucket: string,
  ) {
    this.base = `${url.replace(/\/$/, '')}/storage/v1`;
    this.headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  }
  async put(key: string, data: Buffer, contentType: string) {
    assertSafeKey(key);
    const res = await fetch(`${this.base}/object/${this.bucket}/${key}`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': contentType, 'x-upsert': 'true' },
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`Lagring feilet (${res.status})`);
  }
  async get(key: string) {
    assertSafeKey(key);
    const res = await fetch(`${this.base}/object/${this.bucket}/${key}`, { headers: this.headers });
    // Supabase svarer 404, eller 400 med «not_found» i svaret, når objektet ikke finnes.
    if (res.status === 404 || (res.status === 400 && /not.?found/i.test(await res.text().catch(() => '')))) throw new StoredFileMissing(key);
    if (!res.ok) throw new Error(`Henting feilet (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  async remove(keys: string[]) {
    if (!keys.length) return;
    keys.forEach(assertSafeKey);
    const res = await fetch(`${this.base}/object/${this.bucket}`, {
      method: 'DELETE',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: keys }),
    });
    if (!res.ok) throw new Error(`Sletting feilet (${res.status})`);
  }
  /** Bøttas innstillinger: finnes den, og er den privat? */
  async bucketInfo(): Promise<{ exists: boolean; isPublic: boolean | null }> {
    const res = await fetch(`${this.base}/bucket/${this.bucket}`, { headers: this.headers });
    if (res.status === 404 || res.status === 400) return { exists: false, isPublic: null };
    if (!res.ok) throw new Error(`Bøtta kunne ikke leses (${res.status})`);
    const body = (await res.json()) as { public?: boolean };
    return { exists: true, isPublic: Boolean(body.public) };
  }

  /** Nyeste fil i bøtta (øverste nivå) med navn som starter med `prefix` – bare navn og tidspunkt, aldri innhold. */
  async latestObject(prefix: string): Promise<{ name: string; createdAt: Date } | null> {
    const res = await fetch(`${this.base}/object/list/${this.bucket}`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 100, offset: 0, sortBy: { column: 'created_at', order: 'desc' } }),
    });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`Bøtta kunne ikke leses (${res.status})`);
    const rows = (await res.json()) as { name?: string; created_at?: string }[];
    const latest = rows
      .filter((r) => r.name?.startsWith(prefix) && r.created_at)
      .map((r) => ({ name: r.name!, createdAt: new Date(r.created_at!) }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return latest ?? null;
  }
}

/** Den nattlige sikkerhetskopien (.github/workflows/sikkerhetskopi.yml) legger krypterte kopier her. */
export const BACKUP_BUCKET = 'sikkerhetskopier';

/**
 * Kontroll for admin: finnes det en fersk sikkerhetskopi av databasen? Ser bare på navn og tidspunkt i bøtta.
 * Uten Supabase-nøklene i appen kan det ikke kontrolleres herfra – da sier svaret det, i stedet for å gjette.
 */
export async function checkBackups(now = new Date()): Promise<{ state: 'ok' | 'feil' | 'ukjent'; detail: string }> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      state: 'ukjent',
      detail: 'Kan ikke kontrolleres herfra (SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY mangler i appen). Den nattlige kopien trenger fire hemmeligheter i GitHub – se docs/DRIFT.md.',
    };
  }
  try {
    const latest = await new SupabaseStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, BACKUP_BUCKET).latestObject('anbudradar-');
    if (!latest) return { state: 'feil', detail: 'Ingen sikkerhetskopi funnet – den nattlige kopien er ikke satt opp (docs/DRIFT.md).' };
    const hours = (now.getTime() - latest.createdAt.getTime()) / 3_600_000;
    if (hours > 48) return { state: 'feil', detail: `Siste kopi er ${Math.floor(hours / 24)} døgn gammel – den nattlige kopien har stoppet.` };
    return { state: 'ok', detail: `Siste kopi for ${Math.max(1, Math.round(hours))} ${Math.max(1, Math.round(hours)) === 1 ? 'time' : 'timer'} siden.` };
  } catch (err) {
    return { state: 'feil', detail: err instanceof Error ? err.message : 'Kunne ikke kontrollere sikkerhetskopien.' };
  }
}

/**
 * Kontroll for admin: lagring på serverdisken forsvinner ved ny versjon (Render), og en offentlig bøtte ville gjort
 * kundenes filer tilgjengelige for alle med lenken. Ingen nøkler eller filinnhold i svaret.
 */
export async function checkSupabaseBucket(): Promise<{ state: 'ok' | 'feil'; detail: string }> {
  if (env.STORAGE_DRIVER !== 'supabase') return { state: 'feil', detail: 'På serverdisken – forsvinner ved hver ny versjon og når gratistjenesten sover.' };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { state: 'feil', detail: 'Supabase valgt, men SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY mangler.' };
  try {
    const info = await new SupabaseStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_STORAGE_BUCKET).bucketInfo();
    if (!info.exists) return { state: 'feil', detail: `Bøtta «${env.SUPABASE_STORAGE_BUCKET}» finnes ikke – opprett den som privat.` };
    if (info.isPublic) return { state: 'feil', detail: `Bøtta «${env.SUPABASE_STORAGE_BUCKET}» er OFFENTLIG – gjør den privat straks.` };
    return { state: 'ok', detail: `Supabase Storage, privat bøtte «${env.SUPABASE_STORAGE_BUCKET}».` };
  } catch (err) {
    return { state: 'feil', detail: err instanceof Error ? err.message : 'Kunne ikke kontrollere lagringen.' };
  }
}

let instance: Storage | null = null;
export function storage(): Storage {
  if (!instance) {
    instance =
      env.STORAGE_DRIVER === 'supabase' ? new SupabaseStorage(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', env.SUPABASE_STORAGE_BUCKET) : new LocalStorage();
  }
  return instance;
}
