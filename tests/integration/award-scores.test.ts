/**
 * Poeng fra tildelingsbrevet (pakke 4): kriteriene og vektene fylles inn fra kunngjøringen, poengene lagres på det
 * lagrede anbudet, «Dere tapte på …» vises på anbudssiden og i Resultater, poengene beholdes når skjemaet uten
 * poengdel sendes – og en annen organisasjon ser dem aldri (heller ikke direkte i databasen).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql, withTenant } from '../../src/lib/db';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
const ids = { scored: '', other: '' };
before(async () => {
  server = await startServer();
  const criteria = [
    { name: 'Pris', type: 'price', weight: '40 %' },
    { name: 'Kvalitet', type: 'quality', weight: '60 %' },
  ];
  await ingest([
    makeNotice({ sourceNoticeId: 'SCORE-1', title: 'Renhold av rådhuset (poeng-test)', details: { awardCriteria: criteria } }),
    makeNotice({ sourceNoticeId: 'SCORE-2', title: 'Renhold av biblioteket (poeng-test)', details: { awardCriteria: criteria } }),
  ]);
  [ids.scored, ids.other] = await Promise.all([tenderIdFor('manual', 'SCORE-1'), tenderIdFor('manual', 'SCORE-2')]);
});
after(async () => {
  await server.close();
  await closeDb();
});

type C = Awaited<ReturnType<typeof clientFor>>;
const text = (html: string) =>
  html
    .replaceAll('<!-- -->', '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|[  ]/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

async function bookmark(c: C, tenderId: string, orgId: string): Promise<string> {
  await c.post(`/app/anbud/${tenderId}/bokmerke`, {}, { from: `/app/anbud/${tenderId}` });
  const [row] = (await systemSql()`select id from bookmarks where org_id = ${orgId} and tender_id = ${tenderId}`) as unknown as { id: string }[];
  return row!.id;
}
const scores = async (bookmarkId: string) =>
  ((await systemSql()`select score_details from bookmarks where id = ${bookmarkId}`) as unknown as { scoreDetails: unknown }[])[0]!.scoreDetails;

/** Skjemaet slik nettleseren sender det: to rader fra kunngjøringen og én tom. */
const lostWithScores = (tenderId: string) => ({
  status: 'lost',
  note: '',
  resultForm: '1',
  scoreForm: '1',
  ourPrice: '1 100 000',
  winningPrice: '1 000 000',
  winnerName: 'Vinner AS',
  reason: 'pris',
  scoreOurTotal: '',
  scoreWinnerTotal: '',
  scoreName: ['Pris', 'Kvalitet', ''],
  scoreWeight: ['40', '60', ''],
  scoreOurs: ['6', '8', ''],
  scoreWinner: ['10', '7', ''],
  scorePrice: ['1', '0', ''],
  back: `/app/anbud/${tenderId}`,
});

test('kriteriene og vektene fra kunngjøringen står i poengskjemaet', async () => {
  const acc = await createAccount({ plan: 'starter' });
  const c = await clientFor(server.base, acc);
  const b = await bookmark(c, ids.other, acc.orgId);
  await c.post(`/app/lagret/${b}`, { status: 'submitted', note: '', back: `/app/anbud/${ids.other}` }, { from: `/app/anbud/${ids.other}` });
  const body = (await c.get(`/app/anbud/${ids.other}`)).body.replaceAll('<!-- -->', '');
  assert.match(text(body), /Poeng fra tildelingsbrevet \(valgfritt\)/);
  assert.match(body, /id="s-name-0"[^>]*value="Pris"|value="Pris"[^>]*id="s-name-0"/);
  assert.match(body, /id="s-weight-1"[^>]*value="60"|value="60"[^>]*id="s-weight-1"/);
  assert.match(body, /<label for="s-ours-0"[^>]*>Dere<span class="sr-only">, kriterium 1<\/span><\/label>/);
  assert.match(text(body), /Kriteriene er fylt inn fra kunngjøringen/);
  assert.match(body, /<input type="hidden" name="scorePrice" value="1"\/?>/);
});

test('poengene lagres, «Dere tapte på pris» vises på anbudssiden og i Resultater – og beholdes når poengdelen ikke sendes', async () => {
  const acc = await createAccount({ plan: 'starter' });
  const c = await clientFor(server.base, acc);
  const b = await bookmark(c, ids.scored, acc.orgId);
  await c.post(`/app/lagret/${b}`, { status: 'submitted', note: '', back: `/app/anbud/${ids.scored}` }, { from: `/app/anbud/${ids.scored}` });
  const res = await c.post(`/app/lagret/${b}`, lostWithScores(ids.scored), { from: `/app/anbud/${ids.scored}` });
  assert.equal(res.status, 303);
  assert.deepEqual(await scores(b), {
    ourTotal: null,
    winnerTotal: null,
    weighted: false,
    criteria: [
      { name: 'Pris', weightPct: 40, ours: 6, winner: 10, price: true },
      { name: 'Kvalitet', weightPct: 60, ours: 8, winner: 7, price: false },
    ],
  });
  // Pris: −4 × 0,4 = −1,6. Kvalitet: +1 × 0,6 = +0,6.
  const page = text((await c.get(`/app/anbud/${ids.scored}`)).body);
  assert.match(page, /Fra poengene i tildelingsbrevet Dere tapte på pris: 1,60 poeng bak på pris, \+0,60 på de andre kriteriene\. Pris −1,60 Kvalitet \+0,60/);
  const results = text((await c.get('/app/resultater')).body);
  assert.match(results, /Poeng fra tildelingsbrevene/);
  assert.match(results, /Tapte på pris: 1/);
  assert.match(results, /Renhold av rådhuset \(poeng-test\) Dere tapte på pris: 1,60 poeng bak på pris/);

  // Statusskjemaet i listen (uten resultat- og poengdel) rører ikke poengene.
  await c.post(`/app/lagret/${b}`, { status: 'lost', note: 'Notat', back: '/app/lagret' }, { from: '/app/lagret' });
  assert.ok(await scores(b), 'poengene står');
  // Feil i et tall: ingenting lagres.
  const bad = await c.post(`/app/lagret/${b}`, { ...lostWithScores(ids.scored), scoreOurs: ['mye', '8', ''] }, { from: `/app/anbud/${ids.scored}` });
  assert.match(text((await c.get(bad.location!)).body), /Deres poeng for Pris: «mye» er ikke et tall\./);
  // Tomme poengfelt tømmer poengene.
  await c.post(
    `/app/lagret/${b}`,
    { ...lostWithScores(ids.scored), scoreName: ['Pris', 'Kvalitet', ''], scoreOurs: ['', '', ''], scoreWinner: ['', '', ''] },
    { from: `/app/anbud/${ids.scored}` },
  );
  assert.equal(await scores(b), null);
});

test('en annen organisasjon ser ikke poengene – verken i appen eller direkte i databasen', async () => {
  const a = await createAccount({ plan: 'starter' });
  const ca = await clientFor(server.base, a);
  const b = await bookmark(ca, ids.scored, a.orgId);
  await ca.post(`/app/lagret/${b}`, { status: 'submitted', note: '', back: `/app/anbud/${ids.scored}` }, { from: `/app/anbud/${ids.scored}` });
  await ca.post(`/app/lagret/${b}`, lostWithScores(ids.scored), { from: `/app/anbud/${ids.scored}` });
  assert.ok(await scores(b));

  const other = await createAccount({ plan: 'starter' });
  const co = await clientFor(server.base, other);
  assert.doesNotMatch(text((await co.get(`/app/anbud/${ids.scored}`)).body), /Fra poengene i tildelingsbrevet|Dere tapte på pris/);
  assert.doesNotMatch(text((await co.get('/app/resultater')).body), /Poeng fra tildelingsbrevene/);
  // Radnivåsikkerhet: som den andre organisasjonen finnes raden ikke …
  const seen = await withTenant({ userId: other.user.id, orgId: other.orgId }, (tx) => tx`select score_details from bookmarks where id = ${b}`);
  assert.equal(seen.length, 0);
  // … og den kan ikke endres.
  const changed = await withTenant({ userId: other.user.id, orgId: other.orgId }, (tx) => tx`update bookmarks set score_details = null where id = ${b} returning id`);
  assert.equal(changed.length, 0);
  assert.ok(await scores(b), 'poengene står urørt');
  // Og den andre organisasjonens lagringsrute når ikke raden.
  const res = await co.post(`/app/lagret/${b}`, lostWithScores(ids.scored), { from: `/app/anbud/${ids.scored}` });
  assert.equal(res.status, 303);
  assert.match(text((await co.get(res.location!)).body), /Kunne ikke oppdatere/);
});
