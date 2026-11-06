/**
 * Tilbudsresultat og læring: registrering på anbudssiden, «vi vant» bare når tildelingen nevner org.nr.,
 * statistikk på resultatsiden, og at ingen kan se eller endre en annen organisasjons resultater.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

type C = Awaited<ReturnType<typeof clientFor>>;
const text = async (c: C, path: string) =>
  (await c.get(path)).body
    .replaceAll('<!-- -->', '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;| | /g, ' ')
    .replace(/\s+/g, ' ');

/** Gyldig norsk org.nr. (mod 11), tilfeldig per kjøring. */
function orgNumber(): string {
  const w = [3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const base = `9${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
    const rest = w.reduce((a, x, i) => a + x * Number(base[i]), 0) % 11;
    const check = rest === 0 ? 0 : 11 - rest;
    if (check !== 10) return `${base}${check}`;
  }
}

async function bookmark(c: C, tenderId: string, orgId: string): Promise<string> {
  await c.post(`/app/anbud/${tenderId}/bokmerke`, {}, { from: `/app/anbud/${tenderId}` });
  const [row] = (await systemSql()`select id from bookmarks where org_id = ${orgId} and tender_id = ${tenderId}`) as unknown as { id: string }[];
  return row!.id;
}

async function stored(bookmarkId: string) {
  const [row] = (await systemSql()`
    select status, our_price::float8 as our_price, winning_price::float8 as winning_price, winner_name, outcome_reason, outcome_source,
           submitted_at, decided_at
    from bookmarks where id = ${bookmarkId}
  `) as unknown as {
    status: string;
    ourPrice: number | null;
    winningPrice: number | null;
    winnerName: string | null;
    outcomeReason: string | null;
    outcomeSource: string | null;
    submittedAt: Date | null;
    decidedAt: Date | null;
  }[];
  return row!;
}

test('resultat registreres på anbudssiden og gir prisavvik, vinner og historikk', async () => {
  const buyer = `Resultatkommune ${Date.now()}`;
  const first = makeNotice({ buyerName: buyer, title: 'Renhold av skoler (test)' });
  const second = makeNotice({ buyerName: buyer, title: 'Renhold av barnehager (test)' });
  await ingest([first, second]);
  const t1 = await tenderIdFor('manual', first.sourceNoticeId);
  const t2 = await tenderIdFor('manual', second.sourceNoticeId);
  const acc = await createAccount({ plan: 'starter' });
  const c = await clientFor(server.base, acc);
  const b1 = await bookmark(c, t1, acc.orgId);

  // Levert: tidspunktet settes, og resultatfeltet for pris vises.
  await c.post(`/app/lagret/${b1}`, { status: 'submitted', note: '', back: `/app/anbud/${t1}` }, { from: `/app/anbud/${t1}` });
  assert.ok((await stored(b1)).submittedAt, 'levert-tidspunkt');
  assert.match(await text(c, `/app/anbud/${t1}`), /Deres pris \(eks\. mva\.\)/);

  // Feil tall lagres ikke.
  const bad = await c.post(`/app/lagret/${b1}`, { status: 'lost', note: '', resultForm: '1', ourPrice: 'mye', back: `/app/anbud/${t1}` }, { from: `/app/anbud/${t1}` });
  assert.match(await text(c, bad.location!), /«mye» er ikke et tall/);
  assert.equal((await stored(b1)).status, 'submitted');

  await c.post(
    `/app/lagret/${b1}`,
    { status: 'lost', note: 'Tapte på pris', resultForm: '1', ourPrice: '1 250 000', winnerName: 'Rask Renhold AS', winningPrice: '1 100 000', reason: 'pris', back: `/app/anbud/${t1}` },
    { from: `/app/anbud/${t1}` },
  );
  const saved = await stored(b1);
  assert.deepEqual(
    [saved.status, saved.ourPrice, saved.winningPrice, saved.winnerName, saved.outcomeReason, saved.outcomeSource],
    ['lost', 1_250_000, 1_100_000, 'Rask Renhold AS', 'pris', 'bruker'],
  );
  assert.ok(saved.decidedAt, 'resultat-tidspunkt');

  // Statusskjemaet i listen (uten resultatfelt) tømmer ikke resultatet.
  await c.post(`/app/lagret/${b1}`, { status: 'lost', note: 'Tapte på pris' }, { from: '/app/lagret' });
  assert.equal((await stored(b1)).ourPrice, 1_250_000);

  const page = await text(c, '/app/resultater');
  assert.match(page, /Resultater og læring/);
  assert.match(page, /Vinnerandel 0 % av 1 avgjorte/);
  assert.match(page, /Pris: dere mot vinneren/);
  assert.match(page, /\+13,6 % – over vinneren/);
  assert.match(page, /Tildelingsbrevet \(registrert av dere\)/);
  assert.match(page, /Hvem vant når dere ikke vant Fra tildelingskunngjøringene, ellers det dere har registrert\. Rask Renhold AS 1/);

  // Neste anbud fra samme oppdragsgiver viser erfaringen.
  const next = await text(c, `/app/anbud/${t2}`);
  assert.match(next, /Erfaring med oppdragsgiveren/);
  assert.match(next, /1 tilbud levert tidligere: 0 vunnet, 1 ikke vunnet/);
  assert.match(next, /Renhold av skoler \(test\) – Ikke vunnet \(Pris\)/);
});

test('«vi vant» fra tildelingen: bare når org.nr. stemmer, og bare når brukeren bekrefter', async () => {
  const ours = orgNumber();
  const notice = makeNotice({
    lifecycle: 'awarded',
    noticeType: 'award',
    awards: [{ lotTitle: null, supplierName: 'Oss Vakt AS', supplierOrgNumber: ours, value: 900_000, currency: 'NOK', awardDate: '2026-10-01' }],
  });
  await ingest([notice]);
  const tenderId = await tenderIdFor('manual', notice.sourceNoticeId);

  const acc = await createAccount();
  await systemSql()`update organizations set org_number = ${ours} where id = ${acc.orgId}`;
  const c = await clientFor(server.base, acc);
  const bm = await bookmark(c, tenderId, acc.orgId);
  await c.post(`/app/lagret/${bm}`, { status: 'submitted', note: '' }, { from: `/app/anbud/${tenderId}` });
  assert.equal((await stored(bm)).status, 'submitted', 'ingenting endres automatisk');
  const page = await text(c, `/app/anbud/${tenderId}`);
  assert.match(page, /Tildelingen nevner dere som vinner/);
  assert.match(page, /Oss Vakt AS Dere/, 'merket i tildelingslisten');
  assert.match(await text(c, '/app/resultater'), /Tildelt: dere/);

  const r = await c.post(`/app/lagret/${bm}/vunnet`, { back: `/app/anbud/${tenderId}#resultat` }, { from: `/app/anbud/${tenderId}` });
  assert.match(await text(c, r.location!), /Registrert som vunnet/);
  const won = await stored(bm);
  assert.deepEqual([won.status, won.outcomeSource], ['won', 'tildeling']);
  assert.match(await text(c, '/app/resultater'), /Vinnerandel 100 % av 1 avgjorte/);

  // En annen organisasjon (annet org.nr.) får verken forslag eller kan «bekrefte».
  const other = await createAccount();
  await systemSql()`update organizations set org_number = ${orgNumber()} where id = ${other.orgId}`;
  const oc = await clientFor(server.base, other);
  const obm = await bookmark(oc, tenderId, other.orgId);
  assert.doesNotMatch(await text(oc, `/app/anbud/${tenderId}`), /Tildelingen nevner dere/);
  const denied = await oc.post(`/app/lagret/${obm}/vunnet`, { back: `/app/anbud/${tenderId}` }, { from: `/app/anbud/${tenderId}` });
  assert.match(await text(oc, denied.location!), /Tildelingen nevner ikke organisasjonsnummeret deres/);
  assert.equal((await stored(obm)).status, 'watching');
});

test('resultater er private: en annen organisasjon kan verken se eller endre dem', async () => {
  const notice = makeNotice({ title: 'Hemmelig resultat (test)' });
  await ingest([notice]);
  const tenderId = await tenderIdFor('manual', notice.sourceNoticeId);
  const a = await createAccount();
  const ca = await clientFor(server.base, a);
  const bm = await bookmark(ca, tenderId, a.orgId);
  await ca.post(`/app/lagret/${bm}`, { status: 'lost', note: '', resultForm: '1', ourPrice: '500 000', winnerName: '', winningPrice: '', reason: 'kvalitet' }, { from: `/app/anbud/${tenderId}` });

  const b = await createAccount();
  const cb = await clientFor(server.base, b);
  const r = await cb.post(`/app/lagret/${bm}`, { status: 'won', note: '', resultForm: '1', ourPrice: '1', reason: 'pris' }, { from: '/app/lagret' });
  assert.match(await text(cb, r.location!), /Kunne ikke oppdatere/);
  const v = await cb.post(`/app/lagret/${bm}/vunnet`, {}, { from: '/app/lagret' });
  assert.match(await text(cb, v.location!), /Fant ikke det lagrede anbudet/);
  const after = await stored(bm);
  assert.deepEqual([after.status, after.ourPrice, after.outcomeReason], ['lost', 500_000, 'kvalitet']);
  assert.doesNotMatch(await text(cb, '/app/resultater'), /Hemmelig resultat/);
  assert.match(await text(ca, '/app/resultater'), /Hemmelig resultat \(test\)/);

  // Resultatene er med når eieren eksporterer alle data.
  const exported = JSON.parse((await ca.get('/app/innstillinger/eksport')).body) as { organization: { bookmarks: { title: string; ourPrice: string; outcomeReason: string }[] } };
  const row = exported.organization.bookmarks.find((x) => x.title === 'Hemmelig resultat (test)');
  assert.equal(Number(row?.ourPrice), 500_000);
  assert.equal(row?.outcomeReason, 'kvalitet');
});
