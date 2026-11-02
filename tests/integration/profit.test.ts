/**
 * Profit Intelligence gjennom nettsidene og databasen:
 *  - kalkulator med opphav (dokument/deres tall/AI/beregnet), formler og testpris,
 *  - plansperrer (Start / Profesjonell / Bedrift),
 *  - AI-analyse i testmodus (AI_PROVIDER=mock – svarene er simulerte, men kildekontroll,
 *    tallkontroll, import og lagring er ekte),
 *  - kapasitet med roller, og at bare eier/administrator kan endre bedriftens tall,
 *  - anbudspartnere med samtykke, konkurranserettslig sperre og kontaktinfo bare ved godkjenning,
 *  - radnivåsikkerhet for alle nye tabeller.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql, withTenant } from '../../src/lib/db';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor, type TestAccount } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let tenderId: string;

function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[  ]/g, ' ')
    .replace(/\s+/g, ' ');
}

async function addMember(acc: TestAccount, orgId: string, role: 'admin' | 'member') {
  await systemSql()`insert into organization_members (org_id, user_id, role) values (${orgId}, ${acc.user.id}, ${role})`;
  await systemSql()`update users set current_org_id = ${orgId} where id = ${acc.user.id}`;
}

/** Ett kostnadsskjema: 1000 timer à 600 kr (600 000), 10 % påslag, 5 % risiko, margin 15/8. */
function calcForm(over: Record<string, string | string[]> = {}): Record<string, string | string[]> {
  return {
    contractValue: '1 200 000',
    durationMonths: '12',
    l_id: [''],
    l_category: ['arbeid'],
    l_description: ['Brøyting og strøing'],
    l_quantity: ['1000'],
    l_unit: ['timer'],
    l_unitCost: ['600'],
    l_period: ['total'],
    overheadPct: '10',
    riskBufferPct: '5',
    targetMarginPct: '15',
    minMarginPct: '8',
    hourlyCost: '',
    bidCostHours: '',
    userRiskLevel: '',
    notes: '',
    ...over,
  };
}

before(async () => {
  server = await startServer();
  const notice = makeNotice({
    title: 'Vintervedlikehold av kommunale veier (profit-test)',
    description: 'Brøyting, strøing og snørydding på kommunale veier. Leverandøren må ha egnet utstyr.',
    estimatedValue: 1_200_000,
    currency: 'NOK',
    cpvCodes: ['90620000'],
    mainCpv: '90620000',
    details: { durationMonths: 12, durationText: '12 måneder', language: 'nb' },
  });
  await ingest([notice]);
  tenderId = await tenderIdFor('manual', notice.sourceNoticeId);
});

after(async () => {
  await server.close();
  await closeDb();
});

test('kalkulator (Profesjonell): lagrer med opphav, viser formler og regner testpris – uten å finne på tall', async () => {
  const pro = await createAccount({ plan: 'professional', orgName: 'Profit Pro (test)' });
  const c = await clientFor(server.base, pro);
  const path = `/app/anbud/${tenderId}/lonnsomhet`;

  const empty = await c.get(path);
  assert.equal(empty.status, 200);
  const e = text(empty.body);
  assert.match(e, /Lønnsomhet og risiko/);
  assert.match(e, /Kunngjøringen: 1 200 000 kr/, 'verdien fra kunngjøringen vises med kilde');
  assert.match(e, /ikke en prognose for hvilken pris som vinner/);
  assert.match(e, /For lite grunnlag/, 'uten kostnader gis ingen anbefaling');

  const saved = await c.post(path, calcForm(), { from: path });
  assert.equal(saved.status, 303, saved.body.slice(0, 300));
  assert.equal(saved.location, path);

  const [row] = (await systemSql()`
    select inputs, result, recommendation from tender_calculations where org_id = ${pro.orgId} and tender_id = ${tenderId}
  `) as unknown as { inputs: Record<string, any>; result: Record<string, any>; recommendation: string }[];
  assert.ok(row, 'kalkylen er lagret');
  assert.equal(row.inputs.contractValueBasis, 'dokument', 'uendret verdi fra kunngjøringen beholder opphavet');
  assert.equal(row.inputs.durationBasis, 'dokument');
  assert.equal(row.inputs.lines[0].basis, 'bruker');
  assert.equal(row.result.calc.directCost, 600_000);
  assert.equal(row.result.calc.breakEven, 660_000);
  assert.equal(row.result.calc.atContractValue.profit, 540_000);
  assert.equal(row.result.calc.atContractValue.marginPct, 45);
  // Kontraktsvilkår ikke analysert og risiko ukjent → aldri «Vurder å by».
  assert.equal(row.recommendation, 'investigate');

  const page = text((await c.get(path)).body);
  assert.match(page, /Undersøk nærmere/);
  assert.match(page, /Selvkost \(pris uten tap\)/);
  assert.match(page, /600 000 kr \+ 60 000 kr/, 'formelen for selvkost vises');
  assert.match(page, /Kontraktsvilkårene er ikke analysert/);

  const test = text((await c.get(`${path}?pris=700000`)).body);
  assert.match(test, /Din testpris/);
  assert.match(test, /Viser testpris 700 000 kr \(lagres ikke\)/);

  // Endret verdi blir brukerens tall.
  await c.post(path, calcForm({ contractValue: '1000000' }), { from: path });
  const [changed] = (await systemSql()`select inputs from tender_calculations where org_id = ${pro.orgId} and tender_id = ${tenderId}`) as unknown as { inputs: Record<string, any> }[];
  assert.equal(changed!.inputs.contractValueBasis, 'bruker');

  // Porteføljen viser kalkylen.
  const portfolio = text((await c.get('/app/lonnsomhet')).body);
  assert.match(portfolio, /Vintervedlikehold av kommunale veier \(profit-test\)/);
  assert.match(portfolio, /Undersøk nærmere/);

  // Anbudssiden lenker til kalkylen.
  const tenderPage = text((await c.get(`/app/anbud/${tenderId}`)).body);
  assert.match(tenderPage, /Lønner det seg\?/);
  assert.match(tenderPage, /Åpne kalkylen/);
});

test('ugyldige tall lagres ikke – feilmeldingen sier hvilken linje', async () => {
  const pro = await createAccount({ plan: 'professional' });
  const c = await clientFor(server.base, pro);
  const path = `/app/anbud/${tenderId}/lonnsomhet`;
  const res = await c.post(path, calcForm({ l_quantity: ['mange'], targetMarginPct: '95' }), { from: path });
  assert.equal(res.status, 400);
  const t = text(res.body);
  assert.match(t, /Linje 1 \(«Brøyting og strøing»\), mengde: «mange» er ikke et tall/);
  assert.match(t, /Ønsket margin må være mellom 0 og 90/);
  assert.equal((await systemSql()`select 1 from tender_calculations where org_id = ${pro.orgId}`).length, 0);
});

test('plansperrer: Start har ikke kalkulator, Profesjonell har ikke AI eller partnersøk', async () => {
  const start = await createAccount({ plan: 'starter' });
  const sc = await clientFor(server.base, start);
  const locked = await sc.get(`/app/anbud/${tenderId}/lonnsomhet`);
  assert.equal(locked.status, 403);
  assert.match(text(locked.body), /Lønnsomhetskalkulator/);
  assert.match(text((await sc.get(`/app/anbud/${tenderId}`)).body), /Lønnsomhetskalkulatoren er med i Profesjonell og Bedrift/);
  // Start kan publisere partnerprofil, men ikke søke.
  const partners = await sc.get('/app/partnere');
  assert.equal(partners.status, 200);
  assert.match(text(partners.body), /Søk etter partnere er med i Bedrift/);

  const pro = await createAccount({ plan: 'professional' });
  const pc = await clientFor(server.base, pro);
  const ai = await pc.post(`/app/anbud/${tenderId}/lonnsomhet/ai`, {}, { from: `/app/anbud/${tenderId}/lonnsomhet` });
  assert.equal(ai.status, 403);
  assert.equal((await systemSql()`select 1 from ai_analyses where kind = 'profit_analysis' and org_id = ${pro.orgId}`).length, 0);
  const send = await pc.post('/app/partnere/foresporsel', { toOrgId: start.orgId, message: 'Hei, vi trenger hjelp.' }, { from: '/app/partnere' });
  assert.equal(send.status, 403);
});

test('AI (Bedrift, testmodus): risiko med side og sitat, kontrollerte tall, mengder inn i kalkylen uten priser', async () => {
  const biz = await createAccount({ plan: 'business', orgName: 'Profit Bedrift (test)' });
  const c = await clientFor(server.base, biz);
  const path = `/app/anbud/${tenderId}/lonnsomhet`;
  // Bedriftens egen timekost (brukes som forslag på timelinjer fra AI).
  assert.equal((await c.post('/app/kapasitet/okonomi', { hourlyCost: '650', overheadPct: '', targetMarginPct: '', minMarginPct: '', riskBufferPct: '', bidCostHours: '', notes: '' }, { from: '/app/kapasitet' })).status, 303);

  // Et privat, allerede tekstbehandlet dokument (som etter opplasting).
  const sql = systemSql();
  const [doc] = (await sql`
    insert into tender_documents (tender_id, org_id, title, text_status, page_count, uploaded_by)
    values (${tenderId}, ${biz.orgId}, 'Kontraktsvilkår vinterdrift.pdf', 'extracted', 3, ${biz.user.id}) returning id
  `) as unknown as { id: string }[];
  const pages = [
    'Oppdraget omfatter brøyting og strøing av kommunale veier. Det estimeres 800 timer per år med brøyting.',
    'Ved forsinkelse påløper dagbot på 1 promille av kontraktssummen per dag, begrenset til 10 % av kontraktssummen.',
    'Betalingsfrist er 45 dager etter mottatt faktura.',
  ];
  for (const [i, content] of pages.entries()) {
    await sql`insert into tender_document_pages (document_id, org_id, page_number, content) values (${doc!.id}, ${biz.orgId}, ${i + 1}, ${content})`;
  }

  const res = await c.post(`${path}/ai`, {}, { from: path });
  assert.equal(res.status, 303);
  assert.equal(res.location, path);

  const [analysis] = (await sql`
    select org_id, result from ai_analyses where kind = 'profit_analysis' and tender_id = ${tenderId} and org_id = ${biz.orgId}
  `) as unknown as { orgId: string; result: Record<string, any> }[];
  assert.ok(analysis, 'analysen er lagret privat for organisasjonen');
  assert.equal(analysis.result.isMock, true);
  const risks = analysis.result.data.contract_risks as { category: string; percent: number | null; days: number | null }[];
  const dagbot = risks.findIndex((r) => r.category === 'dagbot');
  assert.ok(dagbot >= 0, 'dagboten er funnet');
  assert.equal(analysis.result.checks.risks[dagbot].quote, true, 'sitatet står ordrett i dokumentet');
  assert.equal(analysis.result.checks.risks[dagbot].percent, true, 'taket (10 %) står i sitatet');
  const usage = (await sql`select kind from usage_records where org_id = ${biz.orgId}`) as unknown as { kind: string }[];
  assert.deepEqual(usage.map((u) => u.kind), ['ai_profit_analysis']);

  // Første analyse fyller en tom kalkyle med mengdene – enhetskost bare fra bedriftens timekost.
  const [calcRow] = (await sql`select inputs from tender_calculations where org_id = ${biz.orgId} and tender_id = ${tenderId}`) as unknown as { inputs: Record<string, any> }[];
  const line = (calcRow!.inputs.lines as Record<string, any>[]).find((l) => l.quantity === 800);
  assert.ok(line, 'mengden fra dokumentet er hentet inn');
  assert.equal(line.basis, 'dokument', 'tallet står i et kontrollert sitat');
  assert.equal(line.unitCost, 650, 'timekosten er bedriftens egen');
  assert.equal(line.period, 'per_aar');
  assert.equal(line.origin, 'ai_import');
  assert.equal(line.sourceRef.page, 1);
  for (const l of calcRow!.inputs.lines as Record<string, any>[]) {
    if (!/^(t|timer|time|h)$/i.test(l.unit)) assert.equal(l.unitCost, null, 'AI setter aldri priser');
  }

  const page = text((await c.get(path)).body);
  assert.match(page, /Dagbøter og sanksjoner/);
  assert.match(page, /Kontraktsvilkår vinterdrift\.pdf, side 2/);
  assert.match(page, /Sitat kontrollert/);
  assert.match(page, /Maks samlet dagbot ved 1 200 000 kr: 120 000 kr \(10 % tak\)/, 'konsekvensen er beregnet fra kontrollerte tall');
  assert.match(page, /Kapital bundet i utestående betaling: ca\. 65 000 kr/);
  const [rec] = (await sql`select recommendation, result from tender_calculations where org_id = ${biz.orgId} and tender_id = ${tenderId}`) as unknown as { recommendation: string; result: Record<string, any> }[];
  assert.equal(rec!.recommendation, 'high_risk', 'dagbot vurdert som høy risiko gir anbefalingen «Høy risiko»');
  assert.equal(rec!.result.riskLevel, 'høy');
  assert.deepEqual(rec!.result.highRisks.length > 0, true);
  assert.match(page, /Testmodus/);

  // Ny import erstatter ikke linjer brukeren har endret.
  const edited = calcForm({
    l_id: [line.id],
    l_category: ['arbeid'],
    l_description: [line.description],
    l_quantity: ['900'],
    l_unit: ['timer'],
    l_unitCost: ['650'],
    l_period: ['per_aar'],
  });
  assert.equal((await c.post(path, edited, { from: path })).status, 303);
  assert.equal((await c.post(`${path}/importer`, {}, { from: path })).status, 303);
  const [after] = (await sql`select inputs from tender_calculations where org_id = ${biz.orgId} and tender_id = ${tenderId}`) as unknown as { inputs: Record<string, any> }[];
  const lines = after!.inputs.lines as Record<string, any>[];
  assert.ok(lines.some((l) => l.quantity === 900 && l.basis === 'bruker'), 'brukerens endring beholdes og er merket som deres tall');
  assert.ok(!lines.some((l) => l.quantity === 800 && l.description === line.description), 'AI-linjen er ikke lagt inn på nytt ved siden av');
});

test('kapasitet: roller uten navn, mangel i timer gir «Høy risiko», og bare eier/admin kan endre', async () => {
  const owner = await createAccount({ plan: 'business', orgName: 'Kapasitet AS (test)' });
  const oc = await clientFor(server.base, owner);
  assert.equal((await oc.post('/app/kapasitet/bemanning', { role: 'Brøytemannskap', headcount: '1', hoursPerYearEach: '500', certifications: 'Førerkort klasse C', notes: '' }, { from: '/app/kapasitet' })).status, 303);
  assert.equal((await oc.post('/app/kapasitet/utstyr', { name: 'Hjullaster', category: 'Maskin', quantity: '1', notes: '' }, { from: '/app/kapasitet' })).status, 303);
  assert.equal(
    (await oc.post('/app/kapasitet/kontrakter', { name: 'Parkdrift', client: 'Testkommune', startDate: '2020-01-01', endDate: '2099-12-31', hoursPerMonth: '10', notes: '' }, { from: '/app/kapasitet' })).status,
    303,
  );
  const path = `/app/anbud/${tenderId}/lonnsomhet`;
  // 800 timer per år, 500 tilgjengelig, 120 bundet → mangler 420 (52,5 %).
  await oc.post(path, calcForm({ l_quantity: ['800'], l_period: ['per_aar'] }), { from: path });
  const [row] = (await systemSql()`select recommendation, result from tender_calculations where org_id = ${owner.orgId}`) as unknown as { recommendation: string; result: Record<string, any> }[];
  assert.equal(row!.result.capacityStatus, 'mangler');
  assert.equal(row!.result.capacityGapHours, 420);
  assert.equal(row!.recommendation, 'high_risk');
  const page = text((await oc.get(path)).body);
  assert.match(page, /Mangler ca\. 420 timer per år/);
  assert.match(page, /Parkdrift: 120 t\/år/);

  // Et vanlig medlem kan lese, men ikke endre bedriftens tall – heller ikke direkte i databasen.
  const member = await createAccount({ plan: 'business', orgName: 'Medlemmets org (test)' });
  await addMember(member, owner.orgId, 'member');
  const mc = await clientFor(server.base, member);
  const view = text((await mc.get('/app/kapasitet')).body);
  assert.match(view, /Brøytemannskap/);
  assert.match(view, /Bare eiere og administratorer kan endre/);
  const denied = await mc.post('/app/kapasitet/okonomi', { hourlyCost: '1' }, { from: '/app/kapasitet' });
  assert.equal(denied.status, 403);
  await assert.rejects(
    withTenant({ userId: member.user.id, orgId: owner.orgId }, (tx) => tx`insert into org_economics (org_id, hourly_cost) values (${owner.orgId}, 1)`),
    /row-level security/,
  );
  const del = await withTenant({ userId: member.user.id, orgId: owner.orgId }, (tx) => tx`delete from org_staff where org_id = ${owner.orgId} returning id`);
  assert.equal(del.length, 0, 'medlemmer kan ikke slette bemanning');
  // Medlemmer kan jobbe med kalkyler.
  assert.equal((await mc.post(path, calcForm(), { from: path })).status, 303);
});

test('partnere: samtykke, sperre når begge kan levere alene, kontaktinfo bare ved godkjenning', async () => {
  const seeker = await createAccount({ plan: 'business', orgName: 'Søker AS (test)' });
  const partner = await createAccount({ plan: 'starter', orgName: 'Partner AS (test)' });
  const sc = await clientFor(server.base, seeker);
  const pc = await clientFor(server.base, partner);
  const sql = systemSql();
  const profile = (over: Record<string, string | string[]> = {}) => ({
    displayName: 'Partner AS (test)',
    summary: 'Maskinentreprenør med hjullastere.',
    capabilities: 'Brøyting med hjullaster og traktor. Strøing.',
    employeeCount: '6',
    partnerRoles: ['underleverandor'],
    regions: ['50'],
    industries: ['construction'],
    certifications: ['iso14001'],
    published: '1',
    ...over,
  });

  // Uten samtykke publiseres ingenting.
  const noConsent = await pc.post('/app/partnere/profil', profile(), { from: '/app/partnere' });
  assert.equal(noConsent.status, 303);
  assert.equal((await sql`select 1 from partner_profiles where org_id = ${partner.orgId}`).length, 0);
  assert.equal((await pc.post('/app/partnere/profil', profile({ consent: 'on' }), { from: '/app/partnere' })).status, 303);
  const [pp] = (await sql`select published, consent_version, consent_at from partner_profiles where org_id = ${partner.orgId}`) as unknown as { published: boolean; consentVersion: string; consentAt: Date }[];
  assert.equal(pp!.published, true);
  assert.equal(pp!.consentVersion, 'partner-v1');
  assert.ok(pp!.consentAt);

  // Søkeren finner partneren, men må publisere egen profil før de kan sende.
  const found = text((await sc.get('/app/partnere?q=hjullaster')).body);
  assert.match(found, /Partner AS \(test\)/);
  const request = (over: Record<string, string> = {}) => ({
    toOrgId: partner.orgId,
    tenderId,
    roleSought: 'underleverandor',
    message: 'Vi trenger en underleverandør med hjullaster i Trøndelag.',
    selfAssessment: 'ingen_kan_alene',
    contactName: 'Siri Søker',
    contactEmail: 'siri.soker@example.com',
    confirmNoPrices: 'on',
    ...over,
  });
  const noProfile = await sc.post('/app/partnere/foresporsel', request(), { from: '/app/partnere' });
  assert.match(text((await sc.get(noProfile.location!)).body), /Publiser partnerprofilen deres først/);
  assert.equal((await sc.post('/app/partnere/profil', { ...profile({ consent: 'on' }), displayName: 'Søker AS (test)' }, { from: '/app/partnere' })).status, 303);

  // Begge kan levere alene → sperret med henvisning til konkurranseloven.
  const blocked = await sc.post('/app/partnere/foresporsel', request({ selfAssessment: 'begge_kan_alene' }), { from: '/app/partnere' });
  assert.match(text((await sc.get(blocked.location!)).body), /konkurranseloven § 10/);
  assert.equal((await sql`select 1 from partner_requests where from_org_id = ${seeker.orgId}`).length, 0);

  // Uten bekreftelse om å ikke dele priser → ikke sendt.
  const { confirmNoPrices: _omit, ...withoutConfirm } = request();
  const unconfirmed = await sc.post('/app/partnere/foresporsel', withoutConfirm, { from: '/app/partnere' });
  assert.match(text((await sc.get(unconfirmed.location!)).body), /Bekreft at dere ikke deler priser/);

  const sent = await sc.post('/app/partnere/foresporsel', request(), { from: '/app/partnere' });
  assert.equal(sent.location, '/app/partnere#sendte');
  const [req] = (await sql`select id, status from partner_requests where from_org_id = ${seeker.orgId}`) as unknown as { id: string; status: string }[];
  assert.equal(req!.status, 'pending');
  const notes = (await sql`select type from notifications where org_id = ${partner.orgId}`) as unknown as { type: string }[];
  assert.deepEqual(notes.map((n) => n.type), ['partner_request']);
  // Dobbel forespørsel stoppes.
  const dup = await sc.post('/app/partnere/foresporsel', request(), { from: '/app/partnere' });
  assert.match(text((await sc.get(dup.location!)).body), /allerede en ubesvart forespørsel/);

  // Mottakeren ser avsenderens kontaktinfo; avsenderen ser ikke mottakerens før godkjenning.
  assert.match(text((await pc.get('/app/partnere')).body), /siri\.soker@example\.com/);
  assert.ok(!(await sc.get('/app/partnere')).body.includes('per.partner@example.com'));

  // Databasen hindrer feil statusoverganger.
  await assert.rejects(
    withTenant({ userId: seeker.user.id, orgId: seeker.orgId }, (tx) => tx`update partner_requests set status = 'accepted' where id = ${req!.id}`),
    /Bare mottakeren kan svare/,
  );
  await assert.rejects(
    withTenant({ userId: partner.user.id, orgId: partner.orgId }, (tx) => tx`update partner_requests set message = 'endret' where id = ${req!.id}`),
    /permission denied/,
  );

  const accepted = await pc.post(`/app/partnere/foresporsel/${req!.id}/svar`, { decision: 'accept', contactName: 'Per Partner', contactEmail: 'per.partner@example.com' }, { from: '/app/partnere' });
  assert.equal(accepted.status, 303);
  assert.match(text((await sc.get('/app/partnere')).body), /per\.partner@example\.com/);
  const responses = (await sql`select type from notifications where org_id = ${seeker.orgId}`) as unknown as { type: string }[];
  assert.deepEqual(responses.map((n) => n.type), ['partner_response']);
  // Allerede besvart → kan ikke endres.
  await assert.rejects(
    withTenant({ userId: partner.user.id, orgId: partner.orgId }, (tx) => tx`update partner_requests set status = 'declined', responder_contact_name = null, responder_contact_email = null where id = ${req!.id}`),
    /allerede besvart/,
  );

  // Skjult profil er usynlig for andre.
  assert.equal((await pc.post('/app/partnere/profil', profile({ published: '0' }), { from: '/app/partnere' })).status, 303);
  const hidden = await sc.get('/app/partnere?q=hjullaster');
  assert.ok(!hidden.body.includes(`til=${partner.orgId}`), 'skjult profil vises ikke i søket');
  assert.match(text(hidden.body), /Profilen er skjult/, 'forespørselen står igjen, men uten navn');
  const direct = await sc.get(`/app/partnere?til=${partner.orgId}`);
  assert.ok(!text(direct.body).includes('Send forespørsel til Partner AS'), 'kan ikke sende til skjult profil');
  const visible = await withTenant({ userId: seeker.user.id, orgId: seeker.orgId }, (tx) => tx`select 1 from partner_profiles where org_id = ${partner.orgId}`);
  assert.equal(visible.length, 0, 'skjulte profiler kan ikke leses av andre (RLS)');
});

test('radnivåsikkerhet: andre organisasjoner ser ikke kalkyler, økonomi, bemanning, utstyr, kontrakter eller forespørsler', async () => {
  const a = await createAccount({ plan: 'business', orgName: 'RLS A (test)' });
  const b = await createAccount({ plan: 'business', orgName: 'RLS B (test)' });
  const ca = await clientFor(server.base, a);
  const path = `/app/anbud/${tenderId}/lonnsomhet`;
  await ca.post(path, calcForm({ notes: 'Hemmelig prisstrategi A' }), { from: path });
  await ca.post('/app/kapasitet/okonomi', { hourlyCost: '777', overheadPct: '', targetMarginPct: '', minMarginPct: '', riskBufferPct: '', bidCostHours: '', notes: '' }, { from: '/app/kapasitet' });
  await ca.post('/app/kapasitet/bemanning', { role: 'Hemmelig rolle', headcount: '3', hoursPerYearEach: '1600', certifications: '', notes: '' }, { from: '/app/kapasitet' });
  await ca.post('/app/kapasitet/utstyr', { name: 'Hemmelig maskin', category: '', quantity: '1', notes: '' }, { from: '/app/kapasitet' });
  await ca.post('/app/kapasitet/kontrakter', { name: 'Hemmelig kontrakt', client: '', startDate: '', endDate: '', hoursPerMonth: '5', notes: '' }, { from: '/app/kapasitet' });

  for (const table of ['tender_calculations', 'org_economics', 'org_staff', 'org_equipment', 'org_contracts']) {
    const count = async (ctx: { userId: string; orgId: string }) =>
      ((await withTenant(ctx, (tx) => tx.unsafe(`select count(*)::int as n from ${table} where org_id = $1`, [a.orgId]))) as unknown as { n: number }[])[0]!.n;
    assert.ok((await count({ userId: a.user.id, orgId: a.orgId })) > 0, `A skal ha rader i ${table}`);
    assert.equal(await count({ userId: b.user.id, orgId: b.orgId }), 0, `B ser A sine rader i ${table}`);
    assert.equal(await count({ userId: b.user.id, orgId: a.orgId }), 0, `forfalsket kontekst ga tilgang til ${table}`);
  }
  const cb = await clientFor(server.base, b);
  const bPage = await cb.get(path);
  assert.ok(!bPage.body.includes('Hemmelig prisstrategi A'));
  assert.ok(!(await cb.get('/app/kapasitet')).body.includes('Hemmelig'));
  assert.ok(!(await cb.get('/app/lonnsomhet')).body.includes('Vintervedlikehold'), 'B har ingen kalkyler');
  // B kan ikke skrive inn rader for A.
  await assert.rejects(
    withTenant({ userId: b.user.id, orgId: b.orgId }, (tx) => tx`insert into org_staff (org_id, role, headcount) values (${a.orgId}, 'x', 1)`),
    /row-level security/,
  );
  // B kan ikke slette A sine rader via nettsiden.
  const [staff] = (await systemSql()`select id from org_staff where org_id = ${a.orgId}`) as unknown as { id: string }[];
  await cb.post(`/app/kapasitet/bemanning/${staff!.id}/slett`, {}, { from: '/app/kapasitet' });
  assert.equal((await systemSql()`select 1 from org_staff where id = ${staff!.id}`).length, 1);
});

test('personvern: eksporten inneholder Profit-data, og partnerforespørsler slettes etter fast tid', async () => {
  const { applyRetention } = await import('../../src/domain/ops/tasks');
  const owner = await createAccount({ plan: 'business', orgName: 'Eksport AS (test)' });
  const other = await createAccount({ plan: 'business', orgName: 'Motpart AS (test)' });
  const c = await clientFor(server.base, owner);
  await c.post('/app/kapasitet/okonomi', { hourlyCost: '612', overheadPct: '', targetMarginPct: '', minMarginPct: '', riskBufferPct: '', bidCostHours: '', notes: '' }, { from: '/app/kapasitet' });
  await c.post('/app/kapasitet/bemanning', { role: 'Eksportrolle', headcount: '2', hoursPerYearEach: '1600', certifications: '', notes: '' }, { from: '/app/kapasitet' });
  const exported = JSON.parse((await c.get('/app/innstillinger/eksport')).body) as { organization: { profitIntelligence: Record<string, any> } };
  assert.equal(exported.organization.profitIntelligence.economics.hourlyCost, 612);
  assert.equal(exported.organization.profitIntelligence.staff[0].role, 'Eksportrolle');

  const sql = systemSql();
  for (const acc of [owner, other]) {
    await sql`insert into partner_profiles (org_id, published, display_name, consent_at, consent_version) values (${acc.orgId}, true, 'Profil (test)', now(), 'partner-v1') on conflict (org_id) do nothing`;
  }
  const insert = (status: string, createdDaysAgo: number, respondedDaysAgo: number | null) => sql`
    insert into partner_requests (from_org_id, to_org_id, role_sought, message, self_assessment, status, requester_contact_name, requester_contact_email, created_at, responded_at)
    values (${owner.orgId}, ${other.orgId}, 'underleverandor', 'Gammel forespørsel (test)', 'ingen_kan_alene', ${status}, 'Navn', 'navn@example.com',
            now() - make_interval(days => ${createdDaysAgo}), ${respondedDaysAgo === null ? null : sql`now() - make_interval(days => ${respondedDaysAgo})`})
    returning id
  `;
  const [oldDeclined] = (await insert('declined', 400, 390)) as unknown as { id: string }[];
  const [oldPending] = (await insert('pending', 200, null)) as unknown as { id: string }[];
  const [recentAccepted] = (await insert('accepted', 100, 90)) as unknown as { id: string }[];
  const [recentPending] = (await insert('pending', 10, null)) as unknown as { id: string }[];
  await applyRetention();
  const left = ((await sql`select id from partner_requests where from_org_id = ${owner.orgId}`) as unknown as { id: string }[]).map((r) => r.id);
  assert.ok(!left.includes(oldDeclined!.id), 'avslått for over 12 måneder siden er slettet');
  assert.ok(!left.includes(oldPending!.id), 'ubesvart i over 180 dager er slettet');
  assert.ok(left.includes(recentAccepted!.id));
  assert.ok(left.includes(recentPending!.id));
});
