import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessage, normalizePath, scrub, stackInfo, toErrorRecord } from '../../src/domain/ops/errors';

test('scrub: fjerner e-post, innlogging i adresser, nøkler og lange tall – resten står', () => {
  const raw =
    'Kunne ikke sende til ola.nordmann@firma.no via postgres://app:hemmelig@db.example.com:5432/x med Bearer abc.def-123 ' +
    'og nøkkel nokkel_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 for tlf 912 34 567, pnr 01020312345 og IP 127.0.0.1 (HTTP 503 etter 3 forsøk)';
  const out = scrub(raw);
  for (const secret of ['ola.nordmann', 'firma.no', 'hemmelig', 'app:', 'abc.def-123', 'nokkel_ABC', '912 34 567', '01020312345', '127.0.0.1']) {
    assert.ok(!out.includes(secret), `${secret} skal være fjernet: ${out}`);
  }
  assert.match(out, /\[e-post\]/);
  assert.match(out, /postgres:\/\/\[skjult\]@db\.example\.com:5432/);
  assert.match(out, /Bearer \[skjult\]/);
  assert.match(out, /HTTP 503 etter 3 forsøk/, 'korte tall og vanlig tekst beholdes');
});

test('normalizeMessage og normalizePath: ID-er og tall gir samme gruppe', () => {
  assert.equal(
    normalizeMessage('Fant ikke anbud 123e4567-e89b-12d3-a456-426614174000 (forsøk 3)'),
    normalizeMessage('Fant ikke anbud 9f8e7d6c-1111-4222-8333-444455556666 (forsøk 12)'),
  );
  assert.equal(normalizePath('/app/anbud/123e4567-e89b-12d3-a456-426614174000/kalkyle?x=1'), '/app/anbud/:id/kalkyle');
  assert.equal(normalizePath('/admin/epost/42'), '/admin/epost/:n');
});

test('stackInfo: første ramme i appen, korte stier og funksjonsnavn som signatur', () => {
  const stack = [
    'Error: boom',
    '    at Object.query (/opt/render/project/src/node_modules/postgres/src/query.js:12:3)',
    '    at saveCalculation (/opt/render/project/src/src/domain/profit/service.ts:120:11)',
    '    at async handler (/opt/render/project/src/src/routes/app/profit.tsx:88:5)',
    '    at async dispatch (/opt/render/project/src/src/server/app.ts:210:9)',
    '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
  ].join('\n');
  const info = stackInfo(stack);
  assert.equal(info.location, 'saveCalculation (src/domain/profit/service.ts:120:11)');
  assert.equal(info.signature, 'saveCalculation>handler>dispatch');
  assert.ok(info.stack && !info.stack.includes('/opt/render'), 'ingen mappenavn fra serveren');
  assert.ok(!info.stack!.includes('node_modules'), 'rammer fra biblioteker tas ikke med');

  // Samme feil i ny versjon (andre linjenumre i den bygde filen) beholder gruppen.
  const a = stackInfo('Error: x\n    at run (/srv/dist/server.js:100:1)\n    at tick (/srv/dist/server.js:200:1)');
  const b = stackInfo('Error: x\n    at run (/srv/dist/server.js:150:1)\n    at tick (/srv/dist/server.js:260:1)');
  assert.equal(a.signature, b.signature);
  assert.equal(stackInfo(undefined).location, null);
});

test('toErrorRecord: samme feil med ulike personopplysninger og ID-er blir én gruppe, uten ID-er lagret', () => {
  const mk = (email: string, id: string) => {
    const err = new Error(`Lagring feilet for ${email} (${id})`);
    err.stack = `Error: ${err.message}\n    at save (/app/src/domain/x.ts:1:1)\n    at handler (/app/src/routes/y.tsx:2:2)`;
    return toErrorRecord('request_failed', { method: 'post', path: `/app/anbud/${id}/kalkyle`, requestId: 'req-1234567890', err });
  };
  const a = mk('kari@eksempel.no', '123e4567-e89b-12d3-a456-426614174000');
  const b = mk('per@annet.no', '9f8e7d6c-1111-4222-8333-444455556666');
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(a.context, 'POST /app/anbud/:id/kalkyle');
  assert.equal(a.location, 'save (src/domain/x.ts:1:1)');
  const all = JSON.stringify(a);
  assert.ok(!all.includes('kari@'), 'ingen e-post');
  assert.ok(!all.includes('req-1234567890'), 'ingen forespørsels-ID');
  assert.ok(!all.includes('123e4567'), 'ingen anbuds-ID');

  // Annen feil på samme sted gir egen gruppe; tekstfeil uten stakk grupperes på jobben.
  const other = toErrorRecord('request_failed', { path: '/app', err: new Error('Noe helt annet') });
  assert.notEqual(other.fingerprint, a.fingerprint);
  const job = toErrorRecord('job_failed', { id: 'abc', kind: 'send_emails', attempts: 3, retry: false, error: 'Resend svarte 500' });
  assert.equal(job.message, 'Resend svarte 500');
  assert.equal(job.context, 'jobb: send_emails');
  assert.equal(job.name, 'Feil');
});
