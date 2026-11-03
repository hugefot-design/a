/**
 * Kanonisk adresse: den gamle onrender.com-adressen sender sider videre til eget domene, mens
 * API-ruter (helsesjekk, webhooks) og skjemainnsendinger aldri sendes videre.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRedirect } from '../../src/server/canonical';

const APP = 'https://anbudradar.com';

test('sider på en annen vertsadresse sendes til samme sti på APP_URL', () => {
  assert.equal(canonicalRedirect({ method: 'GET', url: '/priser', host: 'a-yg57.onrender.com' }, APP), 'https://anbudradar.com/priser');
  assert.equal(canonicalRedirect({ method: 'HEAD', url: '/', host: 'a-yg57.onrender.com' }, APP), 'https://anbudradar.com/');
  // Spørring og lenker i e-post (bekreftelse, nytt passord, avmelding) beholdes.
  assert.equal(
    canonicalRedirect({ method: 'GET', url: '/bekreft-epost?token=abc_123', host: 'a-yg57.onrender.com' }, APP),
    'https://anbudradar.com/bekreft-epost?token=abc_123',
  );
});

test('riktig adresse, API-ruter og innsendinger sendes ikke videre', () => {
  assert.equal(canonicalRedirect({ method: 'GET', url: '/priser', host: 'anbudradar.com' }, APP), null);
  assert.equal(canonicalRedirect({ method: 'GET', url: '/priser', host: 'AnbudRadar.com' }, APP), null);
  for (const url of ['/api/health', '/api/cron/retention', '/api/stripe/webhook', '/api', '/api?x=1']) {
    assert.equal(canonicalRedirect({ method: 'GET', url, host: 'a-yg57.onrender.com' }, APP), null, url);
  }
  assert.equal(canonicalRedirect({ method: 'POST', url: '/logg-inn', host: 'a-yg57.onrender.com' }, APP), null);
  assert.equal(canonicalRedirect({ method: 'GET', url: '/', host: '' }, APP), null);
  assert.equal(canonicalRedirect({ method: 'GET', url: '/', host: undefined }, APP), null);
});

test('målet er alltid på APP_URL, også for rare stier', () => {
  for (const url of ['//evil.example/x', '/\\evil.example', 'http://evil.example/']) {
    const target = canonicalRedirect({ method: 'GET', url, host: 'a-yg57.onrender.com' }, APP);
    assert.ok(target && new URL(target).origin === 'https://anbudradar.com', `${url} → ${target}`);
  }
  // Tegn som ikke er lov i en header, kodes (ellers ville svaret feile).
  const encoded = canonicalRedirect({ method: 'GET', url: '/anbud?q=bygg og anlegg æøå', host: 'a-yg57.onrender.com' }, APP);
  assert.ok(encoded && /^[\x21-\x7e]+$/.test(encoded), `bare trygge tegn: ${encoded}`);
  assert.equal(new URL(encoded!).searchParams.get('q'), 'bygg og anlegg æøå');
  // Port i APP_URL (lokalt) sammenlignes riktig.
  assert.equal(canonicalRedirect({ method: 'GET', url: '/', host: 'localhost:3000' }, 'http://localhost:3000'), null);
  assert.equal(canonicalRedirect({ method: 'GET', url: '/', host: '127.0.0.1:3000' }, 'http://localhost:3000'), 'http://localhost:3000/');
});
