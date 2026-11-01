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
    return readFile(this.path(key));
  }
  async remove(keys: string[]) {
    await Promise.all(keys.map((k) => rm(this.path(k), { force: true })));
  }
}

/** Supabase Storage via REST. Bøtta må være PRIVAT. (Ikke testet mot live Supabase i utviklingsmiljøet.) */
class SupabaseStorage implements Storage {
  private base = `${env.SUPABASE_URL!.replace(/\/$/, '')}/storage/v1/object`;
  private headers = { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? '' };
  async put(key: string, data: Buffer, contentType: string) {
    assertSafeKey(key);
    const res = await fetch(`${this.base}/${env.SUPABASE_STORAGE_BUCKET}/${key}`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': contentType, 'x-upsert': 'true' },
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`Lagring feilet (${res.status})`);
  }
  async get(key: string) {
    assertSafeKey(key);
    const res = await fetch(`${this.base}/${env.SUPABASE_STORAGE_BUCKET}/${key}`, { headers: this.headers });
    if (!res.ok) throw new Error(`Henting feilet (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  async remove(keys: string[]) {
    if (!keys.length) return;
    keys.forEach(assertSafeKey);
    await fetch(`${this.base}/${env.SUPABASE_STORAGE_BUCKET}`, {
      method: 'DELETE',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: keys }),
    });
  }
}

let instance: Storage | null = null;
export function storage(): Storage {
  if (!instance) instance = env.STORAGE_DRIVER === 'supabase' ? new SupabaseStorage() : new LocalStorage();
  return instance;
}
