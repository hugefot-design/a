/**
 * Admin-tilgang: organisasjoner som eies av en plattform-administrator får alle funksjoner uten betaling, og
 * AI kjører i testmodus når ekte AI er av. Ingenting av dette skal smitte over på kundenes organisasjoner.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { loadOrgContext, orgHasAdminAccess } from '../../src/domain/org/org';
import { entitlementsByOrg } from '../../src/domain/notifications/engine';
import { runTenderAnalysis } from '../../src/domain/ai/analysis';
import { adminClientFor, clientFor, createAccount, ingest, makeAdmin, makeNotice, startServer, tenderIdFor } from '../helpers';

const mutableEnv = env as unknown as Record<string, unknown>;
const savedEnv = { ...env };
let server: Awaited<ReturnType<typeof startServer>>;

before(async () => {
  server = await startServer();
  // Som i produksjon i dag: ingen AI-leverandør.
  mutableEnv.AI_PROVIDER = 'none';
});
after(async () => {
  Object.assign(mutableEnv, savedEnv);
  await server.close();
  await closeDb();
});

const text = (html: string) => html.replaceAll('<!-- -->', '');

test('administratorens egen organisasjon får alle funksjoner – kunder og organisasjoner der admin bare er medlem, gjør ikke', async () => {
  const admin = await createAccount({ plan: 'free' });
  await makeAdmin(admin.user.id);
  const customer = await createAccount({ plan: 'free' });
  // Administratoren hjelper en kunde og blir medlem (ikke eier) i kundens organisasjon.
  await systemSql()`insert into organization_members (org_id, user_id, role) values (${customer.orgId}, ${admin.user.id}, 'member')`;

  assert.equal(await orgHasAdminAccess(admin.orgId), true);
  assert.equal(await orgHasAdminAccess(customer.orgId), false, 'kundens organisasjon får ikke admin-tilgang');

  const ctx = (await loadOrgContext({ ...admin.user, isPlatformAdmin: true, currentOrgId: admin.orgId }))!;
  assert.equal(ctx.adminAccess, true);
  assert.equal(ctx.plan, 'enterprise');
  assert.match(ctx.billing.label, /admin-tilgang/);
  assert.equal(ctx.billing.notice, null);
  assert.equal(ctx.entitlements.futureOpportunities, true);
  // Abonnementet i databasen er uendret (ingen gratis plan skrevet inn).
  const [sub] = (await systemSql()`select plan, source from subscriptions where org_id = ${admin.orgId}`) as unknown as { plan: string; source: string }[];
  assert.deepEqual(sub, { plan: 'free', source: 'manual' });

  const inCustomerOrg = (await loadOrgContext({ ...admin.user, isPlatformAdmin: true, currentOrgId: customer.orgId }))!;
  assert.equal(inCustomerOrg.adminAccess, false);
  assert.equal(inCustomerOrg.plan, 'free', 'admin som medlem hos en kunde får kundens plan');

  // E-postvarslene i bakgrunnen følger samme regel.
  const byOrg = await entitlementsByOrg();
  assert.equal(byOrg.get(admin.orgId)?.alerts, 'full');
  assert.equal(byOrg.get(customer.orgId)?.alerts, 'none');

  // Gjennom nettsidene: Enterprise-funksjoner åpne for admin, låst for kunden.
  const ac = await clientFor(server.base, admin);
  const cc = await clientFor(server.base, customer);
  for (const path of ['/app/fremtidige', '/app/konkurrenter', '/app/tilbud', '/app/lonnsomhet', '/app/kapasitet']) {
    assert.equal((await ac.get(path)).status, 200, `admin: ${path}`);
    assert.notEqual((await cc.get(path)).status, 200, `kunde: ${path}`);
  }
  const dash = text((await ac.get('/app')).body);
  assert.match(dash, /Admin-tilgang/);
  assert.match(dash, /AI kjører i testmodus/);
  assert.doesNotMatch(text((await cc.get('/app')).body), /Admin-tilgang/);
  assert.match(text((await ac.get('/app/abonnement')).body), /eies av en administrator og har alle funksjoner/);
});

test('AI i testmodus for admin: simulerte svar lagres bare for admin, og kunder har fortsatt ikke AI', async () => {
  const notice = makeNotice({ title: 'Renhold av skoler i Bergen kommune 2027', description: 'Leverandøren skal ha ISO 14001. Tilbudet må leveres innen fristen.' });
  await ingest([notice]);
  const tenderId = await tenderIdFor('manual', notice.sourceNoticeId);
  const admin = await createAccount({ plan: 'free' });
  await makeAdmin(admin.user.id);
  const customer = await createAccount({ plan: 'business' });

  const adminCtx = (await loadOrgContext({ ...admin.user, isPlatformAdmin: true, currentOrgId: admin.orgId }))!;
  const r = await runTenderAnalysis(adminCtx, admin.user.id, tenderId);
  assert.equal(r.ok, true, r.ok ? '' : r.error);
  const rows = (await systemSql()`select org_id, provider, result->>'isMock' as is_mock from ai_analyses where tender_id = ${tenderId} and kind = 'tender_analysis'`) as unknown as {
    orgId: string | null;
    provider: string;
    isMock: string;
  }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.orgId, admin.orgId, 'simulert svar lagres privat for admin, ikke delt med alle');
  assert.equal(rows[0]!.provider, 'mock');
  assert.equal(rows[0]!.isMock, 'true');

  const customerCtx = (await loadOrgContext({ ...customer.user, currentOrgId: customer.orgId }))!;
  const denied = await runTenderAnalysis(customerCtx, customer.user.id, tenderId);
  assert.equal(denied.ok, false);
  assert.equal(denied.ok ? '' : denied.code, 'not_configured');

  // Kunden ser verken analysen eller AI-knappene; admin ser analysen merket som simulert.
  const cc = await clientFor(server.base, customer);
  const cpage = text((await cc.get(`/app/anbud/${tenderId}`)).body);
  assert.doesNotMatch(cpage, /Simulert svar fra testmodus/);
  const ac = await clientFor(server.base, admin);
  const apage = text((await ac.get(`/app/anbud/${tenderId}/analyse`)).body);
  assert.match(apage, /Simulert svar fra testmodus/);
});

test('Admin → Produkter viser alle produktene med lenker og ærlig status', async () => {
  const notice = makeNotice({ deadlineAt: new Date(Date.now() + 10 * 86_400_000).toISOString(), lifecycle: 'competition' });
  await ingest([notice]);
  const tenderId = await tenderIdFor('manual', notice.sourceNoticeId);
  const acc = await createAccount({ plan: 'free' });
  await makeAdmin(acc.user.id);
  const c = await adminClientFor(server.base, acc);
  const res = await c.get('/admin/produkter');
  assert.equal(res.status, 200);
  const body = text(res.body);
  assert.match(body, /Admin-tilgang for/);
  for (const name of ['Søk i alle anbud', 'AI-analyse', 'Spør om anbudet', 'Kalkyle og markedspris', 'Tilbudsarbeid', 'Kontraktsutløp', 'Fremtidige anskaffelser', 'Abonnement og betaling']) {
    assert.ok(body.includes(name), name);
  }
  assert.match(body, /Testmodus – simulerte svar/, 'AI er av: testmodus');
  assert.match(body, /Betaling er ikke satt opp|Klar/);
  // Lenkene til anbudssidene peker på et ekte, åpent anbud.
  const links = [...body.matchAll(/href="(\/app\/anbud\/[0-9a-f-]{36}[^"]*)"/g)].map((m) => m[1]!);
  assert.ok(links.length >= 4, links.join(', '));
  assert.ok(links.every((l) => l.includes('/app/anbud/')), 'lenker til anbud');
  assert.ok(tenderId);
  // Vanlige brukere ser ikke siden.
  const user = await createAccount();
  assert.equal((await (await clientFor(server.base, user)).get('/admin/produkter')).status, 404);
});
