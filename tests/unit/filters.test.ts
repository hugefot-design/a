import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_QUERY, queryFromParams, queryToParams, restrictQuery, sanitizeQuery } from '../../src/domain/search/filters';

test('filtre overlever URL rundt-tur', () => {
  const q = sanitizeQuery({
    ...EMPTY_QUERY,
    q: 'vakthold',
    industries: ['security'],
    regions: ['50', '15'],
    valueMin: 1_000_000,
    deadlineMinDays: 7,
    statuses: ['open'],
    cpv: ['79713000'],
    excludeKeywords: ['parkering'],
    sort: 'deadline',
  });
  const back = queryFromParams(queryToParams(q));
  assert.deepEqual(back, q);
});

test('ugyldige verdier forkastes', () => {
  const q = queryFromParams(new URLSearchParams('bransje=finnes-ikke&fylke=99&verdi_min=-5&status=tull&side=0'));
  assert.deepEqual(q.industries, []);
  assert.deepEqual(q.regions, []);
  assert.equal(q.valueMin, null);
  assert.deepEqual(q.statuses, []);
  assert.equal(q.page, 1);
});

test('avanserte filtre fjernes for planer uten avansert søk', () => {
  const q = sanitizeQuery({ ...EMPTY_QUERY, q: 'bygg', cpv: ['45000000'], authority: 'Oslo kommune', excludeKeywords: ['asfalt'] });
  const limited = restrictQuery(q, false);
  assert.equal(limited.removed, true);
  assert.deepEqual(limited.query.cpv, []);
  assert.equal(limited.query.authority, '');
  assert.deepEqual(limited.query.excludeKeywords, []);
  assert.equal(limited.query.q, 'bygg');
  assert.equal(restrictQuery(q, true).removed, false);
});
