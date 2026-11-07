/**
 * scripts/backup/upload.sh mot en etterligning av Supabase Storage: bøtta opprettes som privat, en offentlig bøtte
 * stoppes, kopien legges under db/, og kopier eldre enn KEEP_DAYS slettes – men den nyeste beholdes alltid.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const KEY = 'test-tjenestenokkel';
let buckets: Record<string, { public: boolean }> = {};
let objects: Map<string, number> = new Map();
let server: Server;
let base: string;
const dir = mkdtempSync(join(tmpdir(), 'backup-upload-'));

before(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = (req.url ?? '').split('?')[0]!;
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (req.headers.authorization !== `Bearer ${KEY}` || req.headers.apikey !== KEY) return send(401, { error: 'Unauthorized' });
    let m: RegExpExecArray | null;
    if ((m = /^\/storage\/v1\/bucket\/([^/]+)$/.exec(url)) && req.method === 'GET') {
      return buckets[m[1]!] ? send(200, { id: m[1], public: buckets[m[1]!]!.public }) : send(400, { statusCode: '404', error: 'Bucket not found' });
    }
    if (url === '/storage/v1/bucket' && req.method === 'POST') {
      const b = JSON.parse(body.toString()) as { id: string; public: boolean };
      buckets[b.id] = { public: b.public };
      return send(200, { name: b.id });
    }
    if ((m = /^\/storage\/v1\/object\/list\/([^/]+)$/.exec(url)) && req.method === 'POST') {
      const names = [...objects.keys()].filter((k) => k.startsWith(`${m![1]}/db/`)).map((k) => ({ name: k.split('/').pop(), id: k }));
      return send(200, names);
    }
    if ((m = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(url)) && req.method === 'POST') {
      const key = `${m[1]}/${m[2]}`;
      if (req.headers['x-upsert'] !== 'false') return send(400, { error: 'forventet x-upsert: false' });
      if (objects.has(key)) return send(400, { error: 'Duplicate' });
      objects.set(key, body.length);
      return send(200, { Key: key });
    }
    if ((m = /^\/storage\/v1\/object\/([^/]+)$/.exec(url)) && req.method === 'DELETE') {
      for (const p of (JSON.parse(body.toString()) as { prefixes: string[] }).prefixes) objects.delete(`${m[1]}/${p}`);
      return send(200, []);
    }
    send(404, { error: 'ukjent' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  buckets = {};
  objects = new Map();
});

const stamp = (daysAgo: number) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return `anbudradar-${d.toISOString().slice(0, 10)}T${d.toISOString().slice(11, 13)}${d.toISOString().slice(14, 16)}Z.dump.gpg`;
};
const upload = (file: string, env: Record<string, string> = {}) =>
  run('bash', ['scripts/backup/upload.sh', file], { env: { ...process.env, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: KEY, BUCKET: 'sikkerhetskopier', KEEP_DAYS: '30', ...env } });

test('første kopi: bøtta opprettes som privat, og kopien legges under db/', async () => {
  const name = stamp(0);
  writeFileSync(join(dir, name), Buffer.alloc(4096, 1));
  const { stdout } = await upload(join(dir, name));
  assert.match(stdout, /Opprettet privat bøtte «sikkerhetskopier»/);
  assert.deepEqual(buckets, { sikkerhetskopier: { public: false } });
  assert.equal(objects.get(`sikkerhetskopier/db/${name}`), 4096);
});

test('offentlig bøtte: ingenting lastes opp', async () => {
  buckets = { sikkerhetskopier: { public: true } };
  const name = stamp(0);
  writeFileSync(join(dir, name), Buffer.alloc(2048, 1));
  await assert.rejects(upload(join(dir, name)), (err: { stderr: string }) => /OFFENTLIG/.test(err.stderr));
  assert.equal(objects.size, 0);
});

test('opprydding: kopier eldre enn 30 dager slettes, nyere beholdes', async () => {
  buckets = { sikkerhetskopier: { public: false } };
  for (const d of [45, 31, 29, 2]) objects.set(`sikkerhetskopier/db/${stamp(d)}`, 100);
  objects.set('sikkerhetskopier/db/annen-fil.txt', 1);
  const name = stamp(0);
  writeFileSync(join(dir, name), Buffer.alloc(2048, 1));
  const { stdout } = await upload(join(dir, name));
  assert.match(stdout, /Slettet 2 kopi\(er\) eldre enn 30 dager/);
  const left = [...objects.keys()].map((k) => k.replace('sikkerhetskopier/db/', '')).sort();
  assert.deepEqual(left, [name, stamp(2), stamp(29), 'annen-fil.txt'].sort(), 'filer med andre navn røres ikke');
});

test('den nyeste kopien slettes aldri, selv om alle er gamle (f.eks. etter lang stans)', async () => {
  buckets = { sikkerhetskopier: { public: false } };
  const old = stamp(60);
  objects.set(`sikkerhetskopier/db/${stamp(90)}`, 100);
  writeFileSync(join(dir, old), Buffer.alloc(2048, 1));
  await upload(join(dir, old));
  assert.deepEqual([...objects.keys()], [`sikkerhetskopier/db/${old}`]);
});

test('feil nøkkel og ukjente filnavn stoppes', async () => {
  const name = stamp(0);
  writeFileSync(join(dir, name), Buffer.alloc(2048, 1));
  await assert.rejects(upload(join(dir, name), { SUPABASE_SERVICE_ROLE_KEY: 'feil' }), (err: { stderr: string }) => /HTTP 401/.test(err.stderr));
  writeFileSync(join(dir, 'hemmelig.sql'), 'x');
  await assert.rejects(upload(join(dir, 'hemmelig.sql')), (err: { stderr: string }) => /Uventet filnavn/.test(err.stderr));
});
