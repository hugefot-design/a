/**
 * «neste» og «tilbake» kan aldri sende brukeren til et annet nettsted – heller ikke med triks som
 * nettlesere tolker annerledes enn en enkel tekstsjekk (tabulator, linjeskift, omvendt skråstrek).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeRedirectPath } from '../../src/server/http';

test('stier på nettstedet godtas uendret', () => {
  for (const ok of ['/app', '/app/anbud?q=renhold&side=2', '/app/fremtidige?visning=alle#topp', '/app/onboarding?bransje=it&fylke=46', '/']) {
    assert.equal(safeRedirectPath(ok, 'X'), ok, ok);
  }
});

test('andre nettsteder og triks avvises', () => {
  const bad = [
    'https://ondsinnet.example',
    '//ondsinnet.example',
    '/\\ondsinnet.example',
    '/\t/ondsinnet.example',
    '/\n/ondsinnet.example',
    '/\r\n/ondsinnet.example',
    '\t//ondsinnet.example',
    'javascript:alert(1)',
    'app',
    '',
    '/%09/ondsinnet.example'.replace('%09', '\u0009'),
    '/\u0000//ondsinnet.example',
  ];
  for (const b of bad) assert.equal(safeRedirectPath(b, 'X'), 'X', JSON.stringify(b));
  assert.equal(safeRedirectPath(null, 'X'), 'X');
  assert.equal(safeRedirectPath(undefined), '/app');
});

test('kodede tegn blir ikke til et annet nettsted', () => {
  // %2F og %5C er bare tekst i stien; adressen peker fortsatt hit.
  assert.equal(new URL(safeRedirectPath('/%2F%2Fondsinnet.example'), 'https://anbudradar.com').host, 'anbudradar.com');
  assert.equal(new URL(safeRedirectPath('/%5Condsinnet.example'), 'https://anbudradar.com').host, 'anbudradar.com');
});
