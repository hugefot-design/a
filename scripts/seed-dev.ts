/**
 * Fyller utviklingsdatabasen med TYDELIG MERKEDE EKSEMPELDATA.
 * Nekter å kjøre i produksjon.
 *
 *   npm run db:seed-dev
 */
import { env, isProd } from '../src/lib/env';
import { closeDb, systemSql } from '../src/lib/db';
import { hashPassword } from '../src/lib/crypto';
import { sampleNotices } from '../src/connectors/sample';
import { finishImportRun, ingestNotices, startImportRun } from '../src/domain/tenders/ingest';
import { recomputeMatchesForOrg } from '../src/domain/matching/service';

export const DEMO_USERS = {
  demo: { email: 'demo@example.com', password: 'demo-passord-2026', name: 'Demo Bruker' },
  admin: { email: 'admin@example.com', password: 'admin-passord-2026', name: 'Plattform Admin' },
  bygg: { email: 'bygg@example.com', password: 'bygg-passord-2026', name: 'Byggeleder Demo' },
};

async function upsertUser(u: { email: string; password: string; name: string }, admin = false): Promise<string> {
  const sql = systemSql();
  const hash = await hashPassword(u.password);
  const [row] = (await sql`
    insert into users (email, name, password_hash, email_verified_at, is_platform_admin)
    values (${u.email}, ${u.name}, ${hash}, now(), ${admin})
    on conflict (email) do update set name = excluded.name, password_hash = excluded.password_hash, is_platform_admin = excluded.is_platform_admin
    returning id
  `) as unknown as { id: string }[];
  return row!.id;
}

async function createOrg(name: string, ownerId: string, plan: 'business' | 'professional', manual: boolean): Promise<string> {
  const sql = systemSql();
  const existing = (await sql`select o.id from organizations o join organization_members m on m.org_id = o.id where m.user_id = ${ownerId} limit 1`) as unknown as { id: string }[];
  if (existing[0]) return existing[0].id;
  const [org] = (await sql`insert into organizations (name, created_by) values (${name}, ${ownerId}) returning id`) as unknown as { id: string }[];
  await sql`insert into organization_members (org_id, user_id, role) values (${org!.id}, ${ownerId}, 'owner')`;
  if (manual) {
    await sql`
      insert into subscriptions (org_id, plan, status, source, manual_note)
      values (${org!.id}, ${plan}, 'active', 'manual', 'Utviklingsdata – satt av seed-skriptet')
    `;
  } else {
    await sql`
      insert into subscriptions (org_id, plan, status, source, trial_ends_at)
      values (${org!.id}, ${plan}, 'trialing', 'trial', now() + make_interval(days => ${env.TRIAL_DAYS}))
    `;
  }
  await sql`insert into notification_preferences (user_id, org_id) values (${ownerId}, ${org!.id}) on conflict do nothing`;
  await sql`update users set current_org_id = ${org!.id} where id = ${ownerId}`;
  return org!.id;
}

export async function seedDev(options: { quiet?: boolean } = {}) {
  if (isProd) throw new Error('Seed-skriptet kan ikke kjøres i produksjon.');
  const log = (m: string) => !options.quiet && console.log(m);
  const sql = systemSql();

  await sql`update data_sources set enabled = true where id = 'sample'`;
  const run = await startImportRun('sample', 'cli', { note: 'Eksempeldata for utvikling' });
  const stats = await ingestNotices(sampleNotices(), run);
  await finishImportRun(run, stats);
  log(`Eksempelkunngjøringer: ${stats.created} nye, ${stats.updated} oppdatert, ${stats.unchanged} uendret, ${stats.errors} feil`);

  const demoId = await upsertUser(DEMO_USERS.demo);
  const adminId = await upsertUser(DEMO_USERS.admin, true);
  const byggId = await upsertUser(DEMO_USERS.bygg);

  const demoOrg = await createOrg('Demo Vakt og Renhold AS (eksempel)', demoId, 'business', true);
  await sql`
    insert into organization_members (org_id, user_id, role) values (${demoOrg}, ${adminId}, 'admin') on conflict do nothing
  `;
  await sql`insert into notification_preferences (user_id, org_id) values (${adminId}, ${demoOrg}) on conflict do nothing`;
  await sql`update users set current_org_id = ${demoOrg} where id = ${adminId} and current_org_id is null`;
  await sql`
    insert into company_profiles (org_id, company_name, description, industries, services, keywords, cpv_codes, regions, company_size,
      certifications, experience, min_contract_value, max_contract_value, contract_types, excluded_keywords, min_days_to_deadline, onboarding_completed_at)
    values (${demoOrg}, 'Demo Vakt og Renhold AS (eksempel)', 'Fiktiv demobedrift for utvikling.', ${['security', 'cleaning']}::text[],
      'Stasjonært vakthold, alarmmottak, resepsjonstjenester og renhold av næringsbygg og offentlige bygg.',
      ${['vakthold', 'resepsjon', 'alarmmottak', 'renhold', 'adgangskontroll']}::text[], ${['79713000', '90910000']}::text[],
      ${['50', '15', '46']}::text[], '50-249', ${['vaktvirksomhet', 'iso9001', 'renholdsregister']}::text[],
      'Fiktiv erfaring brukt i utvikling: vakthold for kontorbygg siden 2015.', 500000, 30000000, ${['services']}::text[], ${['kantine']}::text[], 10, now())
    on conflict (org_id) do nothing
  `;

  const byggOrg = await createOrg('Demo Bygg AS (eksempel)', byggId, 'professional', false);
  await sql`
    insert into company_profiles (org_id, company_name, industries, services, keywords, regions, contract_types, min_contract_value, max_contract_value, onboarding_completed_at)
    values (${byggOrg}, 'Demo Bygg AS (eksempel)', ${['construction', 'maintenance']}::text[], 'Rehabilitering, totalentreprise og vedlikehold av offentlige bygg.',
      ${['rehabilitering', 'totalentreprise', 'skole']}::text[], ${['ALL']}::text[], ${['works']}::text[], 5000000, 200000000, now())
    on conflict (org_id) do nothing
  `;

  const m1 = await recomputeMatchesForOrg(demoOrg);
  const m2 = await recomputeMatchesForOrg(byggOrg);
  log(`Treff beregnet: ${m1} for demo-org, ${m2} for bygg-org`);

  const firstTenders = (await sql`
    select id from tenders where is_sample and title in ('Vakthold og resepsjonstjenester ved rådhuset', 'Renhold av skoler og barnehager 2027–2029')
  `) as unknown as { id: string }[];
  for (const t of firstTenders) {
    await sql`insert into bookmarks (org_id, tender_id, created_by, status) values (${demoOrg}, ${t.id}, ${demoId}, 'preparing') on conflict do nothing`;
  }
  const hasSearch = await sql`select 1 from saved_searches where org_id = ${demoOrg}`;
  if (!hasSearch.length) {
    await sql`
      insert into saved_searches (org_id, user_id, name, filters, nl_query, alert_enabled, alert_frequency, last_alerted_at)
      values (${demoOrg}, ${demoId}, 'Vakthold i Midt-Norge',
        ${JSON.stringify({ q: '', industries: ['security'], countries: [], regions: ['50', '15'], place: '', valueMin: null, valueMax: null, deadlineMinDays: null, deadlineMaxDays: null, publishedWithinDays: null, authority: '', statuses: [], cpv: [], excludeIndustries: [], excludeCpv: [], excludeKeywords: [], sort: null, page: 1 })}::text::jsonb,
        'vakthold i Midt-Norge', true, 'daily', now())
    `;
  }
  log('\nInnlogging (kun utvikling):');
  log(`  Demo (Bedrift-plan):   ${DEMO_USERS.demo.email} / ${DEMO_USERS.demo.password}`);
  log(`  Plattform-admin:       ${DEMO_USERS.admin.email} / ${DEMO_USERS.admin.password}`);
  log(`  Bygg (prøveperiode):   ${DEMO_USERS.bygg.email} / ${DEMO_USERS.bygg.password}`);
  return { demoOrg, byggOrg, demoId, adminId, byggId };
}

const isMain = process.argv[1]?.endsWith('seed-dev.ts');
if (isMain) {
  seedDev()
    .then(() => closeDb())
    .catch(async (err) => {
      console.error(err);
      await closeDb();
      process.exit(1);
    });
}
