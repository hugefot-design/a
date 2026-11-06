/**
 * Kontraktsutløp-radar (Bedrift): tildelte kontrakter som trolig utløper, med grunnlag for anslaget,
 * filtrert på profilens bransjer og fylker – og anslaget på anbudssiden for alle planer.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb } from '../../src/lib/db';
import { addMonths } from '../../src/domain/competitors/expiry';
import type { NoticeAward } from '../../src/domain/tenders/normalize';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
const ids: Record<string, string> = {};
const day = (offsetMonths: number) => addMonths(new Date(), offsetMonths).toISOString().slice(0, 10);

before(async () => {
  server = await startServer();
  const award = (supplierName: string, awardDate: string | null, value: number | null = 1_500_000): NoticeAward[] => [
    { lotTitle: null, supplierName, supplierOrgNumber: null, value, currency: 'NOK', awardDate },
  ];
  const notices = {
    snart: makeNotice({ title: 'Vakthold rådhuset (utløp-test)', lifecycle: 'awarded', noticeType: 'award', details: { durationMonths: 24 }, awards: award('Vaktselskap Nord AS', day(-20)) }),
    oppgitt: makeNotice({
      title: 'Resepsjon helsehus (utløp-test)',
      lifecycle: 'awarded',
      noticeType: 'award',
      details: { contractEnd: day(8), durationMonths: 36 },
      awards: award('Trygg Vakt AS', day(-28)),
    }),
    langt: makeNotice({ title: 'Vakthold havn (utløp-test)', lifecycle: 'awarded', noticeType: 'award', details: { durationMonths: 48 }, awards: award('Havnevakt AS', day(-2)) }),
    ukjent: makeNotice({ title: 'Vakthold uten varighet (utløp-test)', lifecycle: 'awarded', noticeType: 'award', awards: award('Ukjent Varighet AS', day(-5)) }),
    utlopt: makeNotice({ title: 'Nattvakt skoler (utløp-test)', lifecycle: 'awarded', noticeType: 'award', details: { durationMonths: 12 }, awards: award('Skolevakt AS', day(-14)) }),
    bygg: makeNotice({
      title: 'Rehabilitering av bad (utløp-test)',
      cpvCodes: ['45233141'],
      mainCpv: '45233141',
      lifecycle: 'awarded',
      noticeType: 'award',
      details: { durationMonths: 12 },
      awards: award('Bygg og Bad AS', day(-6)),
    }),
  };
  await ingest(Object.values(notices));
  for (const [k, n] of Object.entries(notices)) ids[k] = await tenderIdFor('manual', n.sourceNoticeId);
});

after(async () => {
  await server.close();
  await closeDb();
});

const text = (html: string) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[  ]|&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

test('radaren viser kontrakter som utløper innen 12 måneder, i rekkefølge og med grunnlaget for anslaget', async () => {
  const c = await clientFor(server.base, await createAccount({ plan: 'business' }));
  const res = await c.get('/app/konkurrenter/utlop');
  assert.equal(res.status, 200);
  const page = text(res.body);
  const pos = (s: string) => page.indexOf(s);
  for (const t of ['Nattvakt skoler', 'Vakthold rådhuset', 'Resepsjon helsehus']) assert.ok(pos(t) > 0, `${t} er med`);
  assert.ok(pos('Nattvakt skoler') < pos('Vakthold rådhuset') && pos('Vakthold rådhuset') < pos('Resepsjon helsehus'), 'tidligst først');
  assert.equal(pos('Vakthold havn'), -1, 'utløper om 46 mnd – utenfor perioden');
  assert.equal(pos('Vakthold uten varighet'), -1, 'uten varighet gjettes ikke');
  assert.equal(pos('Rehabilitering av bad'), -1, 'annen bransje enn profilen');
  assert.match(page, /utløpt for 2 mnd siden/);
  assert.match(page, /Har kontrakten: Vaktselskap Nord AS/);
  assert.match(page, /Beregnet: tildelt [^·]+ \+ 24 mnd · tildelt 1,5 mill\. kr/);
  assert.match(page, /Sluttdato oppgitt i kunngjøringen/);
  assert.match(page, /Vi kan anslå utløp for \d+ av \d+ tildelte kontrakter/);

  const allRes = await c.get('/app/konkurrenter/utlop?mnd=24&bransje=alle&fylke=alle');
  assert.equal(allRes.status, 200);
  const all = text(allRes.body);
  assert.match(all, /Rehabilitering av bad/, 'alle bransjer');
  assert.doesNotMatch(all, /Vakthold havn/, 'fortsatt utenfor 24 mnd');
});

test('radaren krever Bedrift; anslaget på anbudssiden vises for alle planer', async () => {
  const pro = await clientFor(server.base, await createAccount({ plan: 'professional' }));
  const blocked = await pro.get('/app/konkurrenter/utlop');
  assert.notEqual(blocked.status, 200);
  const tenderPage = text((await pro.get(`/app/anbud/${ids.snart}`)).body);
  assert.match(tenderPage, /Kontrakten utløper trolig \d+\. \S+ \d{4} – beregnet fra tildelingsdato .+ \+ 24 mnd, uten eventuelle opsjoner\./);
  assert.doesNotMatch(tenderPage, /Flere kontrakter som utløper/, 'lenken til radaren bare for Bedrift');
  assert.match(text((await pro.get(`/app/anbud/${ids.oppgitt}`)).body), /sluttdato oppgitt i kunngjøringen/);
  assert.doesNotMatch(text((await pro.get(`/app/anbud/${ids.ukjent}`)).body), /utløper trolig/);
});
