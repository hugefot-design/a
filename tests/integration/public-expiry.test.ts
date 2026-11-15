/**
 * «Kontrakter som snart utløper» på bransjesidene: de nærmeste tildelte kontraktene som trolig utløper de neste
 * 12 månedene, med samme anslag og grunnlag som radaren i appen – uten leverandørnavn og verdi (det er for appen),
 * filtrert på fylket på fylkessidene, og uten de som alt er utløpt eller mangler sluttdato og varighet.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { addMonths } from '../../src/domain/competitors/expiry';
import { resetExpiringCache } from '../../src/domain/tenders/expiring';
import type { NoticeAward } from '../../src/domain/tenders/normalize';
import { ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
const mutableEnv = env as unknown as Record<string, unknown>;
const ids: Record<string, string> = {};
const CPV = '65300000'; // Energi – brukes ikke i andre tester.
const day = (offsetMonths: number, offsetDays = 0) => {
  const d = addMonths(new Date(), offsetMonths);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};
const award = (supplierName: string, awardDate: string): NoticeAward[] => [{ lotTitle: null, supplierName, supplierOrgNumber: null, value: 3_000_000, currency: 'NOK', awardDate }];
const awarded = (title: string, details: Record<string, unknown>, supplier: string, awardDate: string, over: Parameters<typeof makeNotice>[0] = {}) =>
  makeNotice({ title, cpvCodes: [CPV], mainCpv: CPV, lifecycle: 'awarded', noticeType: 'award', details, awards: award(supplier, awardDate), ...over });

before(async () => {
  server = await startServer();
  const notices = {
    // Trøndelag (standard i testene): sluttdato oppgitt om fire måneder.
    varme: awarded('Fjernvarme til sentrum (utløp-offentlig)', { contractEnd: day(4), durationMonths: 48 }, 'Hemmelig Varme AS', day(-44)),
    // Trøndelag: oppstart for ti måneder siden + 12 måneder = om to måneder (beregnet).
    strom: awarded('Strøm til skolene (utløp-offentlig)', { durationMonths: 12 }, 'Hemmelig Kraft AS', day(-10)),
    // Oslo: sluttdato oppgitt om fem måneder.
    lading: awarded('Ladestasjoner ved rådhuset (utløp-offentlig)', { contractEnd: day(5) }, 'Hemmelig Lading AS', day(-19), {
      nutsCodes: ['NO081'],
      placeText: 'Oslo',
      buyerCity: 'Oslo',
    }),
    // Utløpt for to måneder siden – vises ikke.
    gatelys: awarded('Gatelys, utløpt (utløp-offentlig)', { contractEnd: day(-2) }, 'Hemmelig Lys AS', day(-26)),
    // Uten sluttdato og varighet – gjettes ikke.
    sol: awarded('Solceller uten varighet (utløp-offentlig)', {}, 'Hemmelig Sol AS', day(-3)),
  };
  await ingest(Object.values(notices));
  for (const [k, n] of Object.entries(notices)) ids[k] = await tenderIdFor('manual', n.sourceNoticeId);
  resetExpiringCache();
});

after(async () => {
  mutableEnv.PUBLIC_TENDER_PAGES = true;
  await server.close();
  await closeDb();
});

const page = async (path: string) => {
  const res = await fetch(`${server.base}${path}`, { headers: { 'user-agent': 'Mozilla/5.0 (test)' } });
  return { status: res.status, body: (await res.text()).replaceAll('<!-- -->', '').replaceAll('&amp;', '&') };
};
const section = (html: string) => /<section aria-labelledby="utlop"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
const monthYear = (iso: string) => new Intl.DateTimeFormat('nb-NO', { month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' }).format(new Date(`${iso}T12:00:00Z`));

test('bransjesiden viser kontraktene som snart utløper – nærmeste først, med grunnlaget for anslaget', async () => {
  const { status, body } = await page('/bransjer/energi');
  assert.equal(status, 200);
  const s = section(body);
  assert.ok(s, 'seksjonen finnes');
  assert.match(s, /<h2 id="utlop"[^>]*>Kontrakter som snart utløper<\/h2>/);
  assert.match(s, /\d+ tildelte kontrakter utløper trolig de neste 12 månedene\./);
  const order = ['Strøm til skolene', 'Fjernvarme til sentrum', 'Ladestasjoner ved rådhuset'].map((t) => s.indexOf(t));
  assert.ok(order.every((i) => i > 0), `alle tre vises: ${order.join(', ')}`);
  assert.ok(order[0]! < order[1]! && order[1]! < order[2]!, 'nærmeste utløp først');
  // Grunnlaget for anslaget: oppgitt sluttdato eller beregnet fra varigheten.
  assert.ok(s.includes(`Utløper ca. ${monthYear(day(4))}`), 'måned og år for den oppgitte sluttdatoen');
  assert.match(s, /oppgitt i kunngjøringen/);
  assert.match(s, /beregnet fra varigheten/);
  assert.match(s, /Opsjoner \(forlengelser\) står sjelden der/);
  // Ikke med: utløpte kontrakter og kontrakter uten sluttdato eller varighet.
  assert.ok(!s.includes('Gatelys, utløpt') && !s.includes('Solceller uten varighet'));
  // Hvem som har kontrakten i dag, vises bare i appen.
  assert.ok(!body.includes('Hemmelig'), 'ingen leverandørnavn på den offentlige siden');
  assert.ok(s.includes(`href="/anbud/${ids.varme}"`), 'lenke til den offentlige anbudssiden');
  assert.ok(s.includes(`href="/registrer?neste=${encodeURIComponent('/app/konkurrenter/utlop')}"`), 'videre til radaren i appen');
});

test('fylkessiden viser bare kontraktene i fylket', async () => {
  const s = section((await page('/bransjer/energi/trondelag')).body);
  assert.ok(s.includes('Fjernvarme til sentrum') && s.includes('Strøm til skolene'));
  assert.ok(!s.includes('Ladestasjoner ved rådhuset'), 'Oslo vises ikke under Trøndelag');
  const oslo = section((await page('/bransjer/energi/oslo')).body);
  assert.ok(oslo.includes('Ladestasjoner ved rådhuset') && !oslo.includes('Fjernvarme til sentrum'));
});

test('på engelsk og uten offentlige anbudssider', async () => {
  const en = section((await page('/en/industries/energy')).body);
  assert.match(en, /Contracts about to expire/);
  assert.match(en, /awarded contracts will probably end in the next 12 months\./);
  mutableEnv.PUBLIC_TENDER_PAGES = false;
  try {
    const s = section((await page('/bransjer/energi')).body);
    assert.ok(s.includes('Fjernvarme til sentrum'), 'listen vises fortsatt');
    assert.ok(!s.includes(`/anbud/${ids.varme}`), 'men uten lenke til anbudssiden');
  } finally {
    mutableEnv.PUBLIC_TENDER_PAGES = true;
  }
});
