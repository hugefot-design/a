/**
 * Oppstarten for nye kunder: ett kort skjema (firmanavn, bransje, område, stikkord) som oppretter organisasjonen,
 * lagrer profilen og regner ut treff – og sender kunden dit de var på vei (f.eks. et anbud fra en offentlig side).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { registerUser } from '../../src/domain/auth/auth';
import { createOrganization } from '../../src/domain/org/org';
import { Client, clientFor, createAccount, ingest, makeNotice, startServer, uniqueEmail, type TestAccount } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let tenderId: string;
before(async () => {
  server = await startServer();
  await ingest([makeNotice({ title: 'Vakthold ved oppstartsskolen (test)', estimatedValue: 2_000_000 })]);
  const [row] = (await systemSql()`select id from tenders where title = 'Vakthold ved oppstartsskolen (test)'`) as unknown as { id: string }[];
  tenderId = row!.id;
});
after(async () => {
  await server.close();
  await closeDb();
});

/** Ny bruker uten organisasjon, registrert via skjemaet. */
async function newUser(): Promise<{ c: Client; email: string }> {
  const c = new Client(server.base);
  const email = uniqueEmail('start');
  await systemSql()`delete from rate_limits where key like 'register:%'`;
  const reg = await c.post('/registrer', { name: 'Nora Ny', email, password: 'Et-langt-passord-123', acceptTerms: 'on' }, { from: '/registrer' });
  assert.equal(reg.status, 303);
  return { c, email };
}

async function orgOf(email: string) {
  const [row] = (await systemSql()`
    select o.id, o.name, p.industries, p.regions, p.services, p.keywords, p.certifications, p.min_days_to_deadline, p.onboarding_completed_at,
           s.plan, s.source
    from users u join organization_members m on m.user_id = u.id join organizations o on o.id = m.org_id
    left join company_profiles p on p.org_id = o.id left join subscriptions s on s.org_id = o.id
    where u.email = ${email}
  `) as unknown as {
    id: string;
    name: string;
    industries: string[] | null;
    regions: string[] | null;
    services: string | null;
    keywords: string[] | null;
    certifications: string[] | null;
    minDaysToDeadline: number | null;
    onboardingCompletedAt: Date | null;
    plan: string;
    source: string;
  }[];
  return row ?? null;
}

test('oppstarten er ett kort skjema – uten de over 40 feltene i hele profilen', async () => {
  const { c } = await newUser();
  const page = await c.get('/app/onboarding');
  assert.equal(page.status, 200);
  assert.match(page.body, /Hva leverer dere – og hvor\?/);
  const fields = [...page.body.matchAll(/<(?:input|textarea|select)[^>]*\sname="([^"]+)"/g)].map((m) => m[1]).filter((n) => n !== '_csrf');
  assert.deepEqual([...new Set(fields)].sort(), ['certifications', 'companyName', 'industries', 'orgNumber', 'regions', 'services']);
  // Bare de lovpålagte godkjenningene spørres det om her (resten ligger i Bedriftsprofil).
  assert.equal((page.body.match(/name="certifications"/g) ?? []).length, 5);
  for (const gone of ['annualRevenue', 'ref_title_0', 'excludedCpv', 'experience', 'cpvCodes']) assert.ok(!page.body.includes(`name="${gone}"`), gone);
});

test('gyldig skjema: organisasjon, prøveperiode, profil og treff – rett til anbudene', async () => {
  const { c, email } = await newUser();
  const res = await c.post(
    '/app/onboarding',
    { companyName: 'Oppstart Vakt AS (test)', orgNumber: '', industries: ['security'], regions: ['50'], certifications: ['vaktvirksomhet', 'finnes-ikke'], services: 'vakthold, resepsjon, alarmmottak' },
    { from: '/app/onboarding' },
  );
  assert.equal(res.status, 303);
  assert.equal(res.location, '/app?velkommen=1');
  const org = await orgOf(email);
  assert.ok(org, 'organisasjonen er opprettet');
  assert.equal(org.name, 'Oppstart Vakt AS (test)');
  assert.equal(org.plan, 'professional');
  assert.equal(org.source, 'trial', 'prøveperioden starter');
  assert.deepEqual(org.industries, ['security']);
  assert.deepEqual(org.regions, ['50']);
  assert.equal(org.services, 'vakthold, resepsjon, alarmmottak');
  assert.deepEqual(org.keywords, ['vakthold', 'resepsjon', 'alarmmottak'], 'stikkordene blir nøkkelord');
  assert.deepEqual(org.certifications, ['vaktvirksomhet'], 'bare godkjenningen kunden krysset av (ukjente verdier fjernes)');
  assert.equal(org.minDaysToDeadline, 10);
  assert.ok(org.onboardingCompletedAt);
  // Treffene er regnet ut, så første side viser rangerte anbud.
  const [match] = (await systemSql()`select score from match_results where org_id = ${org.id} and tender_id = ${tenderId}`) as unknown as { score: number }[];
  assert.ok(match && match.score >= 60, `godt treff på vaktholdsanbudet (${match?.score})`);
  const dash = await c.get('/app?velkommen=1');
  assert.equal(dash.status, 200);
  assert.match(dash.body, /Vakthold ved oppstartsskolen \(test\)/);
  // Oppstarten vises ikke igjen.
  const again = await c.get('/app/onboarding');
  assert.equal(again.status, 303);
  assert.equal(again.location, '/app');
});

test('mangler bransje eller område: tydelig feil, og ingenting opprettes', async () => {
  const { c, email } = await newUser();
  const res = await c.post('/app/onboarding', { companyName: 'Halvferdig AS (test)', orgNumber: '12', industries: [], regions: [], services: '' }, { from: '/app/onboarding' });
  assert.equal(res.status, 422);
  assert.match(res.body, /Velg minst én bransje\./);
  assert.match(res.body, /Velg minst ett fylke eller «Hele landet»\./);
  assert.match(res.body, /Organisasjonsnummer må ha 9 siffer\./);
  assert.match(res.body, /value="Halvferdig AS \(test\)"/, 'det som er skrevet, står igjen');
  assert.equal(await orgOf(email), null);
});

/** Verdiene som er krysset av for et felt (rekkefølgen på attributtene i HTML-en spiller ingen rolle). */
function checkedValues(html: string, name: string): string[] {
  return [...html.matchAll(/<input\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes(`name="${name}"`) && /\schecked(=|\s|\/|>)/.test(tag))
    .map((tag) => /value="([^"]*)"/.exec(tag)?.[1] ?? '');
}

test('bransje og fylke fra siden kunden kom fra er krysset av', async () => {
  const { c } = await newUser();
  const page = await c.get('/app/onboarding?bransje=cleaning&fylke=50');
  assert.deepEqual(checkedValues(page.body, 'industries'), ['cleaning']);
  assert.deepEqual(checkedValues(page.body, 'regions'), ['50']);
  assert.deepEqual(checkedValues(page.body, 'certifications'), [], 'godkjenninger krysses aldri av for kunden');
  // Ugyldige verdier ignoreres.
  const bad = await c.get('/app/onboarding?bransje=finnes-ikke&fylke=99');
  assert.deepEqual([...checkedValues(bad.body, 'industries'), ...checkedValues(bad.body, 'regions')], []);
});

test('uten den lovpålagte godkjenningen merkes anbudet som mulig hindring – ikke som et godt treff', async () => {
  const { c, email } = await newUser();
  await c.post('/app/onboarding', { companyName: 'Uten Godkjenning AS (test)', orgNumber: '', industries: ['security'], regions: ['50'], services: 'vakthold' }, { from: '/app/onboarding' });
  const org = await orgOf(email);
  const [match] = (await systemSql()`select score, breakdown from match_results where org_id = ${org!.id} and tender_id = ${tenderId}`) as unknown as { score: number; breakdown: { unfulfilled: string[] } }[];
  assert.ok(match && match.score <= 40, `begrenset score (${match?.score})`);
  assert.match(match.breakdown.unfulfilled.join(' '), /vaktvirksomhetsloven er ikke registrert i profilen/);
});

test('anbudet kunden var på vei til følger med gjennom oppstarten', async () => {
  const { c } = await newUser();
  const target = `/app/anbud/${tenderId}/intelligence`;
  const wall = await c.get(target);
  assert.equal(wall.status, 303);
  assert.equal(wall.location, `/app/onboarding?neste=${encodeURIComponent(target)}`);
  const page = await c.get(wall.location!);
  assert.match(page.body, new RegExp(`name="neste" value="${target.replace(/\//g, '\\/')}"`));
  const res = await c.post(
    '/app/onboarding',
    { companyName: 'Videre AS (test)', orgNumber: '', industries: ['security'], regions: ['ALL', '50'], services: '', neste: target },
    { from: wall.location! },
  );
  assert.equal(res.status, 303);
  assert.equal(res.location, target);
  assert.equal((await c.get(target)).status, 200, 'vurderingen åpnes rett etter oppstarten');
});

test('målet etter oppstarten kan bare være en side i appen', async () => {
  for (const bad of ['//ondsinnet.example', 'https://ondsinnet.example/app/x', '/logg-ut', '/admin', '/app/onboarding?neste=/app/onboarding', '/\\ondsinnet.example']) {
    const { c } = await newUser();
    const page = await c.get(`/app/onboarding?neste=${encodeURIComponent(bad)}`);
    assert.doesNotMatch(page.body, /name="neste"/, bad);
    const res = await c.post(
      '/app/onboarding',
      { companyName: 'Trygg AS (test)', orgNumber: '', industries: ['it'], regions: ['ALL'], services: '', neste: bad },
      { from: '/app/onboarding' },
    );
    assert.equal(res.location, '/app?velkommen=1', bad);
  }
});

test('organisasjon uten profil: eier får skjemaet med firmanavnet, medlem får beskjed og kan ikke lagre', async () => {
  const email = uniqueEmail('eier');
  const reg = await registerUser({ name: 'Eva Eier', email, password: 'Et-langt-passord-123' });
  assert.ok(reg.ok);
  const orgId = await createOrganization(reg.user, { name: 'Uten Profil AS (test)', orgNumber: null });
  const owner = await clientFor(server.base, { user: reg.user, email, password: '', orgId } as TestAccount);
  const page = await owner.get('/app/onboarding');
  assert.equal(page.status, 200);
  assert.match(page.body, /name="companyName"[^>]*value="Uten Profil AS \(test\)"/);

  // Et medlem (lagt til av eieren) kan ikke fylle ut profilen.
  const member = await createAccount({ profile: false });
  const sql = systemSql();
  await sql`insert into organization_members (org_id, user_id, role) values (${orgId}, ${member.user.id}, 'member')`;
  await sql`update users set current_org_id = ${orgId} where id = ${member.user.id}`;
  const m = await clientFor(server.base, member);
  const info = await m.get('/app/onboarding');
  assert.equal(info.status, 200);
  assert.match(info.body, /Bare eier eller administrator kan fylle ut bedriftsprofilen/);
  assert.doesNotMatch(info.body, /name="industries"/);
  const denied = await m.post('/app/onboarding', { companyName: 'Kuppet AS', orgNumber: '', industries: ['it'], regions: ['ALL'], services: '' }, { from: '/app/innstillinger', csrf: /name="_csrf" value="([^"]+)"/.exec(info.body)?.[1] ?? null });
  assert.equal(denied.status, 403);

  // Eieren fullfører: samme organisasjon (ingen ny), profilen lagres.
  const done = await owner.post('/app/onboarding', { companyName: 'Uten Profil AS (test)', orgNumber: '', industries: ['cleaning'], regions: ['03'], services: '' }, { from: '/app/onboarding' });
  assert.equal(done.location, '/app?velkommen=1');
  const [count] = (await sql`select count(*)::int as n from organization_members where user_id = ${reg.user.id}`) as unknown as { n: number }[];
  assert.equal(count!.n, 1, 'ingen ekstra organisasjon');
  const [profile] = (await sql`select industries from company_profiles where org_id = ${orgId}`) as unknown as { industries: string[] }[];
  assert.deepEqual(profile!.industries, ['cleaning']);
});

test('Oversikt etter oppstarten: «Kom i gang» med neste steg – og det kunden gjør, krysses av', async () => {
  const { c, email } = await newUser();
  await c.post(
    '/app/onboarding',
    { companyName: 'Kom I Gang AS (test)', orgNumber: '', industries: ['security'], regions: ['50'], certifications: ['vaktvirksomhet'], services: 'vakthold' },
    { from: '/app/onboarding' },
  );
  const org = await orgOf(email);
  const first = await c.get('/app?velkommen=1');
  assert.equal(first.status, 200);
  assert.match(first.body, /Profilen er klar – slik kommer dere i gang/);
  assert.match(first.body, /1 av 5/, 'profilen er første steg (prøveperioden har kalkulatoren)');
  const assess = /href="(\/app\/anbud\/[0-9a-f-]{36}\/intelligence)"[^>]*>Åpne samlet vurdering/.exec(first.body)?.[1];
  assert.ok(assess, 'neste steg lenker rett til vurderingen av det beste treffet');
  // Listene sier hvorfor anbudet passer, og lenker til vurderingen.
  assert.match(first.body, /Passer fordi:/);
  assert.match(first.body, /href="\/app\/anbud\/[0-9a-f-]{36}\/intelligence"[^>]*>(<svg[^]*?<\/svg>)?Vurdering/);

  assert.equal((await c.get(assess)).status, 200);
  const used = (await systemSql()`select feature from feature_first_use where org_id = ${org!.id} order by feature`) as unknown as { feature: string }[];
  assert.deepEqual(used.map((u) => u.feature), ['intelligence_viewed']);
  const after = await c.get('/app');
  assert.match(after.body, /2 av 5/);
  assert.match(after.body, /Se vurderingen av det beste treffet<span class="sr-only"> \(gjort\)<\/span>/);

  // Dager med aktivitet: én rad per bruker per dag (bare datoen).
  const days = (await systemSql()`select d.day from user_active_days d join users u on u.id = d.user_id where u.email = ${email}`) as unknown as { day: Date }[];
  assert.equal(days.length, 1);

  // Etter tre uker forsvinner panelet.
  await systemSql()`update company_profiles set onboarding_completed_at = now() - interval '22 days' where org_id = ${org!.id}`;
  assert.doesNotMatch((await c.get('/app')).body, /Kom i gang/);
});
