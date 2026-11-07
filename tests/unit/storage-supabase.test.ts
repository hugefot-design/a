/**
 * Supabase Storage-driveren mot en lokal etterligning av Supabase sitt lagrings-API (samme adresser, hoder og
 * svar som Supabase dokumenterer). Ikke testet mot ekte Supabase herfra – det gjøres med «Kontroller lagring» i admin.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SupabaseStorage } from '../../src/lib/storage';

const KEY = 'test-tjenestenokkel';
const files = new Map<string, { data: Buffer; type: string }>();
const buckets: Record<string, { public: boolean }> = { privat: { public: false }, apen: { public: true } };
const seen: { method: string; path: string; auth: string | undefined; apikey: string | undefined; upsert: string | undefined }[] = [];
let server: Server;
let base: string;

before(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const path = decodeURIComponent((req.url ?? '').split('?')[0]!);
    seen.push({ method: req.method!, path, auth: req.headers.authorization, apikey: req.headers.apikey as string | undefined, upsert: req.headers['x-upsert'] as string | undefined });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (req.headers.authorization !== `Bearer ${KEY}` || req.headers.apikey !== KEY) return send(401, { error: 'Unauthorized' });
    const bucketMatch = /^\/storage\/v1\/bucket\/([^/]+)$/.exec(path);
    if (bucketMatch) {
      const b = buckets[bucketMatch[1]!];
      return b ? send(200, { id: bucketMatch[1], name: bucketMatch[1], public: b.public }) : send(400, { statusCode: '404', error: 'Bucket not found' });
    }
    const obj = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(path);
    if (obj && req.method === 'POST') {
      files.set(`${obj[1]}/${obj[2]}`, { data: body, type: String(req.headers['content-type']) });
      return send(200, { Key: `${obj[1]}/${obj[2]}` });
    }
    if (obj && req.method === 'GET') {
      const f = files.get(`${obj[1]}/${obj[2]}`);
      if (!f) return send(400, { statusCode: '404', error: 'not_found' });
      res.writeHead(200, { 'content-type': f.type });
      return res.end(f.data);
    }
    const del = /^\/storage\/v1\/object\/([^/]+)$/.exec(path);
    if (del && req.method === 'DELETE') {
      const { prefixes } = JSON.parse(body.toString()) as { prefixes: string[] };
      for (const p of prefixes) files.delete(`${del[1]}/${p}`);
      return send(200, prefixes.map((name) => ({ name })));
    }
    send(404, { error: 'ukjent' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
after(() => server.close());

test('Supabase Storage: lagre, hente og slette med tjenestenøkkel og «upsert»', async () => {
  const s = new SupabaseStorage(base, KEY, 'privat');
  const data = Buffer.from('%PDF-1.4 testinnhold æøå');
  await s.put('org-1/tilbud/abc.pdf', data, 'application/pdf');
  assert.deepEqual(await s.get('org-1/tilbud/abc.pdf'), data);
  const upload = seen.find((r) => r.method === 'POST')!;
  assert.equal(upload.path, '/storage/v1/object/privat/org-1/tilbud/abc.pdf', 'riktig adresse (ingen dobbel skråstrek)');
  assert.equal(upload.upsert, 'true');
  await s.remove(['org-1/tilbud/abc.pdf']);
  await assert.rejects(s.get('org-1/tilbud/abc.pdf'), /Henting feilet/);
  await s.remove([]); // ingen kall
});

test('Supabase Storage: feil nøkkel og farlige filnavn stoppes', async () => {
  const wrong = new SupabaseStorage(base, 'feil-nokkel', 'privat');
  await assert.rejects(wrong.put('a/b.pdf', Buffer.from('x'), 'application/pdf'), /Lagring feilet \(401\)/);
  await assert.rejects(wrong.remove(['a/b.pdf']), /Sletting feilet \(401\)/);
  const s = new SupabaseStorage(base, KEY, 'privat');
  await assert.rejects(s.put('../hemmelig', Buffer.from('x'), 'text/plain'), /Ugyldig lagringsnøkkel/);
  await assert.rejects(s.get('/etc/passwd'), /Ugyldig lagringsnøkkel/);
});

test('Supabase Storage: kontrollen ser om bøtta finnes og om den er privat', async () => {
  assert.deepEqual(await new SupabaseStorage(base, KEY, 'privat').bucketInfo(), { exists: true, isPublic: false });
  assert.deepEqual(await new SupabaseStorage(base, KEY, 'apen').bucketInfo(), { exists: true, isPublic: true });
  assert.deepEqual(await new SupabaseStorage(base, KEY, 'mangler').bucketInfo(), { exists: false, isPublic: null });
});
