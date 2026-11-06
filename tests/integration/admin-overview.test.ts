/**
 * Admin-oversikten: varslene kommer fra ekte tilstand (feilet henting, e-post som ikke gikk,
 * e-post stoppet av testlisten), lanseringssjekken følger oppsettet, trendene teller riktig dag,
 * og siden viser ingen personopplysninger.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { BLOCKED_BY_ALLOWLIST } from '../../src/lib/email';
import { adminOverview } from '../../src/domain/admin/overview';
import { adminClientFor, createAccount, ingest, makeNotice, startServer, uniqueEmail, makeAdmin } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
const mutableEnv = env as unknown as Record<string, unknown>;
const savedEnv = { ...env };

before(async () => {
  server = await startServer();
});
after(async () => {
  Object.assign(mutableEnv, savedEnv);
  await server.close();
  await closeDb();
});

async function adminClient() {
  const acc = await createAccount();
  await makeAdmin(acc.user.id);
  return { acc, c: await adminClientFor(server.base, acc) };
}
const text = (html: string) => html.replaceAll('<!-- -->', '');

test('oversikten viser seksjonene, 30 dager i tabellene og ingen personopplysninger', async () => {
  const { acc, c } = await adminClient();
  const res = await c.get('/admin');
  assert.equal(res.status, 200);
  const body = text(res.body);
  for (const heading of ['Trenger oppmerksomhet', 'Klar for lansering', 'Datakilder', 'Nye anbud per dag', 'Nye brukere per dag', 'Siste hendelser']) {
    assert.ok(body.includes(heading), heading);
  }
  // Tabellvisningen bak hvert diagram har én rad per dag.
  const tables = [...body.matchAll(/<caption class="sr-only">([^<]+)<\/caption>[\s\S]*?<\/table>/g)];
  assert.equal(tables.length, 2);
  for (const t of tables) {
    const rows = /<tbody>([\s\S]*?)<\/tbody>/.exec(t[0])?.[1] ?? '';
    assert.equal((rows.match(/<tr[\s>]/g) ?? []).length, 30, t[1]);
  }
  // Ingen e-postadresser eller navn på brukere i oversikten.
  assert.ok(!body.includes(acc.email), 'e-post til en bruker vises ikke');
  assert.doesNotMatch(body, /Test Testesen/);
});

test('varsler kommer fra ekte tilstand, med feil først', async () => {
  const { c } = await adminClient();
  const sql = systemSql();
  const [before] = (await sql`select last_success_at, last_error_at, last_error from data_sources where id = 'ted'`) as unknown as {
    lastSuccessAt: Date | null;
    lastErrorAt: Date | null;
    lastError: string | null;
  }[];
  const marker = `Testfeil ${Date.now()}`;
  const ids: string[] = [];
  try {
    await sql`update data_sources set last_success_at = now() - interval '1 hour', last_error_at = now(), last_error = ${marker} where id = 'ted'`;
    const rows = (await sql`
      insert into email_outbox (to_email, subject, html, text_body, kind, status, last_error)
      values (${uniqueEmail('stoppet')}, 'Test', '<p>x</p>', 'x', 'test', 'failed', ${BLOCKED_BY_ALLOWLIST}),
             (${uniqueEmail('feilet')}, 'Test', '<p>x</p>', 'x', 'test', 'failed', 'SMTP 550: avvist')
      returning id
    `) as unknown as { id: string }[];
    ids.push(...rows.map((r) => r.id));

    const body = text((await c.get('/admin')).body);
    const failed = body.indexOf('Siste henting fra TED');
    const email = body.search(/\d+ e-post(er)? kunne ikke sendes/);
    const blocked = body.search(/\d+ e-post(er)? stoppet av testlisten/);
    assert.ok(failed > 0, 'feilet henting vises');
    assert.ok(body.includes(marker), 'feilmeldingen fra kilden vises');
    assert.ok(email > 0, 'e-post som ikke kunne sendes, vises');
    assert.ok(blocked > 0, 'e-post stoppet av testlisten vises for seg (ikke som feil)');
    assert.ok(failed < blocked && email < blocked, 'feil står før info');
  } finally {
    await sql`update data_sources set last_success_at = ${before!.lastSuccessAt}, last_error_at = ${before!.lastErrorAt}, last_error = ${before!.lastError} where id = 'ted'`;
    if (ids.length) await sql`delete from email_outbox where id in ${sql(ids)}`;
  }
});

test('lanseringssjekken følger oppsettet', async () => {
  const state = async () => Object.fromEntries((await adminOverview()).launch.map((i) => [i.id, i.state]));
  try {
    Object.assign(mutableEnv, {
      APP_URL: 'http://localhost:3101',
      EMAIL_PROVIDER: 'log',
      RESEND_API_KEY: undefined,
      EMAIL_ALLOWED_RECIPIENTS: undefined,
      COMPANY_LEGAL_NAME: '[Selskapsnavn AS]',
      COMPANY_CONTACT_EMAIL: 'kontakt@example.com',
      LEGAL_PAGES_REVIEWED: false,
    });
    let s = await state();
    assert.equal(s.domene, 'mangler');
    assert.equal(s.epost, 'mangler');
    assert.equal(s['kunde-epost'], 'mangler', 'uten e-post er ikke kunde-e-post «klar»');
    assert.equal(s.firma, 'mangler');
    assert.equal(s.kontakt, 'mangler');
    assert.equal(s.juridisk, 'mangler');

    Object.assign(mutableEnv, {
      APP_URL: 'https://anbudradar.com',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'test',
      EMAIL_FROM: 'AnbudRadar <varsler@anbudradar.com>',
      EMAIL_ALLOWED_RECIPIENTS: 'eier@anbudradar.com',
      COMPANY_LEGAL_NAME: 'Testfirma AS',
      COMPANY_ORG_NUMBER: '123 456 789',
      COMPANY_ADDRESS: 'Storgata 1, 0155 Oslo',
      COMPANY_CONTACT_EMAIL: 'testfirma@gmail.com',
      LEGAL_PAGES_REVIEWED: true,
    });
    s = await state();
    assert.equal(s.domene, 'klar');
    assert.equal(s.epost, 'klar');
    assert.equal(s['kunde-epost'], 'venter', 'testlisten er på');
    assert.equal(s.firma, 'klar');
    assert.equal(s.kontakt, 'delvis', 'gratis Gmail har ingen databehandleravtale');
    assert.equal(s.juridisk, 'klar');

    Object.assign(mutableEnv, { EMAIL_FROM: 'AnbudRadar <onboarding@resend.dev>', EMAIL_ALLOWED_RECIPIENTS: '', COMPANY_CONTACT_EMAIL: 'kontakt@testfirma.no' });
    s = await state();
    assert.equal(s.epost, 'delvis', 'Resends fellesadresse er ikke eget domene');
    assert.equal(s['kunde-epost'], 'klar');
    assert.equal(s.kontakt, 'klar');
  } finally {
    Object.assign(mutableEnv, savedEnv);
  }
});

test('trendene teller dagens nye anbud og brukere på siste dag', async () => {
  const before = await adminOverview();
  assert.equal(before.days.length, 30);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo' }).format(new Date());
  assert.equal(before.days.at(-1)!.day, today, 'siste dag er i dag (norsk tid)');
  await ingest([makeNotice(), makeNotice()]);
  await createAccount({ profile: false });
  const after = await adminOverview();
  assert.equal(after.days.at(-1)!.tenders, before.days.at(-1)!.tenders + 2);
  assert.equal(after.days.at(-1)!.users, before.days.at(-1)!.users + 1);
  assert.equal(after.kpi.newTenders24h, before.kpi.newTenders24h + 2);
});
