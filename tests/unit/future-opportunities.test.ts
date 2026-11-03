/**
 * Future Opportunities og gratisplanen – rene funksjoner: tittelklassifisering (eInnsyn), vurdering
 * mot profilen, søkenøkkel for gratisgrensen og planrettigheter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTitle } from '../../src/connectors/einnsyn';
import { signalMatch } from '../../src/domain/opportunities/opportunities';
import { searchKey } from '../../src/domain/billing/quota';
import { sanitizeQuery } from '../../src/domain/search/filters';
import { PLANS, UNLIMITED } from '../../src/domain/billing/plans';

test('politiske saker: prosjekter og anskaffelser tas med, omtale og avslutning holdes ute', () => {
  const yes = [
    'Ferje Hordaland 2030 - mandat for konkurranseutsetting',
    'Nytt sykehjem på Treningsfeltet - videreføring med forprosjekt og totalentreprise',
    'Rehabilitering Risør Ungdomsskole - valg av alternativ for forprosjektfasen',
    'Utvidelse av gang- og sykkelveg langs fv. 47',
    'Investeringsprosjekt tilrettelegging havneareal 2027',
  ];
  const no = [
    'Orientering om avgrenset prøveprosjekt med konkurranseutsetting av tjenester i habilitering',
    'Svar på oversendelsesforslag til Partssammensatt utvalg - Konkurranseutsetting',
    'Navnsetting av ny barnehage og flerbrukshall på Økern',
    'Sluttrapport for investeringsprosjektet Ny barneskole i Tvedestrand',
    'Prosjektavslutning - ny barnehage - Kringletoppen',
    'Lokal forskrift om finansiering av private barnehager 2027',
    'Presentasjon av Stokka sykehjem',
    'Avvik til Datatilsynet - Hundvåg skole',
    'Inngåelse av ny festeavtale - Bygdøy skole',
  ];
  for (const t of yes) assert.equal(classifyTitle(t).include, true, t);
  for (const t of no) assert.equal(classifyTitle(t).include, false, t);
  assert.deepEqual(classifyTitle('Ferje Hordaland 2030 - mandat for konkurranseutsetting').industries, ['transport']);
  assert.deepEqual(classifyTitle('Fv. 5723 Lodalen - forprosjekt for punktutbetring').industries, ['construction']);
  assert.ok(!classifyTitle('Konkurranseutsetting og fritt brukervalg av helse- og velferdstjenester').industries.includes('construction'), '«brukervalg» er ikke bru');
});

test('vurdering mot profilen: bransje må stemme, fylke når profilen har fylker', () => {
  const p = { industries: ['construction'], regions: ['46'] };
  assert.equal(signalMatch(p, { industryIds: ['transport'], regionCodes: ['46'] }).score, null);
  assert.equal(signalMatch(p, { industryIds: ['construction'], regionCodes: ['03'] }).score, null);
  const hit = signalMatch(p, { industryIds: ['construction'], regionCodes: ['46'] });
  assert.equal(hit.score, 100);
  assert.equal(hit.reasons.length, 2);
  assert.equal(signalMatch({ industries: ['construction'], regions: [] }, { industryIds: ['construction'], regionCodes: ['03'] }).score, 80);
});

test('søkenøkkel: side og sortering teller ikke, standardlisten er ikke et søk', () => {
  assert.equal(searchKey(sanitizeQuery({})), null);
  const a = searchKey(sanitizeQuery({ q: 'renhold', regions: ['46', '03'] }));
  const b = searchKey(sanitizeQuery({ q: ' Renhold ', regions: ['03', '46'], page: 3, sort: 'deadline' }));
  assert.ok(a);
  assert.equal(a, b);
  assert.notEqual(a, searchKey(sanitizeQuery({ q: 'renhold' })));
  assert.ok(searchKey(sanitizeQuery({}), 'byggeoppdrag i Trøndelag'), 'fritekst teller som søk');
});

test('planer: gratisgrensene og Future Opportunities bare i Enterprise; prisene er uendret', () => {
  const free = PLANS.free.entitlements;
  assert.equal(free.searchesPerDay, 5);
  assert.equal(free.maxBookmarks, 3);
  assert.equal(free.aiAnalysesPerMonth, 1);
  assert.equal(free.alerts, 'none');
  assert.equal(free.profitCalculator || free.profitAI, false);
  for (const id of ['starter', 'professional', 'business', 'enterprise'] as const) assert.equal(PLANS[id].entitlements.searchesPerDay, UNLIMITED);
  for (const id of ['free', 'starter', 'professional', 'business'] as const) assert.equal(PLANS[id].entitlements.futureOpportunities, false, id);
  assert.equal(PLANS.enterprise.entitlements.futureOpportunities, true);
  assert.deepEqual([PLANS.starter.priceNok, PLANS.professional.priceNok, PLANS.business.priceNok, PLANS.enterprise.priceNok], [199, 499, 999, null]);
});
