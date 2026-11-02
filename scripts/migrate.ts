/**
 * Kjører SQL-migreringer i db/migrations i rekkefølge. Hver fil kjøres i én transaksjon.
 *
 *   npm run db:migrate            – kjør nye migreringer
 *   npm run db:migrate -- --reset – SLETT alt og kjør på nytt (kun *_dev / *_test databaser)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { env, isProd } from '../src/lib/env';
import { closeDb, systemSql } from '../src/lib/db';
import { APP_ROLE, credentialsOf } from '../src/lib/db-url';
import { audit } from '../src/lib/audit';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

export async function migrate(options: { reset?: boolean; quiet?: boolean } = {}): Promise<string[]> {
  const sql = systemSql();
  const log = (msg: string) => {
    if (!options.quiet) console.log(msg);
  };

  if (options.reset) {
    const [{ db }] = (await sql`select current_database() as db`) as unknown as [{ db: string }];
    if (isProd || !/_(dev|test)$/.test(db)) {
      throw new Error(`Nekter å nullstille databasen "${db}". Kun tillatt for *_dev og *_test utenfor produksjon.`);
    }
    log(`Nullstiller databasen ${db} …`);
    await sql.unsafe('drop schema if exists public cascade; create schema public;');
  }

  await ensureAppRole(sql, { log });

  await sql.unsafe(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    );
    alter table schema_migrations enable row level security;
  `);

  const appliedRows = (await sql`select version from schema_migrations`) as unknown as { version: string }[];
  const applied = new Set(appliedRows.map((r) => r.version));
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    log(`→ ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`insert into schema_migrations (version) values (${version})`;
    });
    ran.push(version);
  }
  await enforceBaselineSecurity(sql);
  log(ran.length ? `Ferdig: ${ran.length} migrering(er) kjørt.` : 'Databasen er allerede oppdatert.');
  return ran;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isAuthError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === '28P01' || code === '28000' || /password authentication failed/i.test(err instanceof Error ? err.message : String(err));
}

/** Én innlogging med en egen, kortvarig tilkobling (ikke appens pool). */
async function tryLogin(url: string): Promise<true | unknown> {
  const client = postgres(url, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 1,
    ssl: env.DATABASE_SSL === 'require' ? 'require' : false,
    prepare: process.env.DATABASE_PREPARE !== 'false',
    onnotice: () => {},
  });
  try {
    await client`select 1`;
    return true;
  } catch (err) {
    return err;
  } finally {
    await client.end({ timeout: 2 }).catch(() => {});
  }
}

/**
 * Prøver innlogging flere ganger. Supabase-pooleren husker passord-data en stund, så rett etter en
 * endring kan første forsøk feile selv om passordet er riktig.
 */
async function loginWithRetry(url: string, delaysMs: number[]): Promise<true | unknown> {
  let last: unknown;
  for (let i = 0; i <= delaysMs.length; i++) {
    const result = await tryLogin(url);
    if (result === true) return true;
    last = result;
    if (!isAuthError(result) || i === delaysMs.length) break;
    await sleep(delaysMs[i]!);
  }
  return last;
}

/** Adresse for en rolle på samme vert som admin-adressen (Supabase-poolerens «.prosjekt» beholdes). */
function urlForRole(role: string, password: string): string {
  const u = new URL(env.DATABASE_ADMIN_URL);
  const suffix = /(\..+)$/.exec(decodeURIComponent(u.username))?.[1] ?? '';
  u.username = `${role}${suffix}`;
  u.password = encodeURIComponent(password);
  return u.toString();
}

const quoteLiteral = (v: string) => `'${v.replace(/'/g, "''")}'`;
const quoteIdent = (v: string) => `"${v.replace(/"/g, '""')}"`;

/**
 * Oppretter app-rollen (anbudradar_app) med passordet fra DATABASE_URL hvis den mangler, så man
 * slipper et eget SQL-steg i Supabase. Når passordet styres av DATABASE_APP_PASSWORD, holdes rollens
 * passord likt konfigurasjonen. Gjør ingenting hvis DATABASE_URL bruker en annen rolle.
 * Passordet skrives aldri ut.
 */
export async function ensureAppRole(
  sql: ReturnType<typeof systemSql>,
  opts: { log?: (msg: string) => void; role?: string; password?: string; managePassword?: boolean; retryDelaysMs?: number[] } = {},
): Promise<'created' | 'updated' | 'unchanged' | 'skipped'> {
  const creds = opts.role && opts.password ? { role: opts.role, password: opts.password } : credentialsOf(env.DATABASE_URL);
  const role = creds?.role;
  if (!creds || !role || (!opts.role && role !== APP_ROLE)) return 'skipped';
  const exists = ((await sql`select 1 from pg_roles where rolname = ${role}`) as unknown as unknown[]).length > 0;
  if (!exists) {
    await sql.unsafe(`create role ${quoteIdent(role)} login password ${quoteLiteral(creds.password)} nobypassrls`);
    const [{ db }] = (await sql`select current_database() as db`) as unknown as [{ db: string }];
    await sql.unsafe(`grant connect on database ${quoteIdent(db)} to ${quoteIdent(role)}`);
    opts.log?.(`Opprettet databaserollen ${role}.`);
    return 'created';
  }
  if (opts.managePassword ?? Boolean(env.DATABASE_APP_PASSWORD)) {
    // Bytt bare passord hvis innloggingen faktisk feiler. Å sette samme passord på nytt lager nye
    // passord-data i Postgres, og da avviser Supabase-pooleren innlogging til den har oppdatert seg.
    const login = await loginWithRetry(opts.role ? urlForRole(role, creds.password) : env.DATABASE_URL, opts.retryDelaysMs ?? [3_000, 6_000]);
    if (login === true || !isAuthError(login)) return 'unchanged';
    try {
      await sql.unsafe(`alter role ${quoteIdent(role)} with login password ${quoteLiteral(creds.password)}`);
      opts.log?.(`Oppdaterte passordet for ${role} slik at det stemmer med konfigurasjonen.`);
      return 'updated';
    } catch {
      // Rollen er laget av en annen bruker (f.eks. superbruker). Innloggingstesten etter migreringen
      // sier fra hvis passordet faktisk ikke stemmer.
      opts.log?.(`Kunne ikke oppdatere passordet for ${role} (mangler rettighet) – beholder det som er.`);
    }
  }
  return 'unchanged';
}

/**
 * PLATFORM_ADMIN_EMAILS: gjør disse registrerte brukerne til plattform-admin (bare tildeling –
 * fjerning gjøres med `npm run make-admin -- <e-post> --remove`). Hver endring revisjonslogges.
 * Adressene skrives maskert i byggeloggen.
 */
export async function applyAdminEmails(list: string | undefined = env.PLATFORM_ADMIN_EMAILS): Promise<number> {
  const emails = [...new Set((list ?? '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))];
  let granted = 0;
  for (const email of emails) {
    const rows = (await systemSql()`
      update users set is_platform_admin = true where lower(email) = ${email} and not is_platform_admin returning id
    `) as unknown as { id: string }[];
    if (!rows[0]) continue;
    granted++;
    await audit({ action: 'admin.role_changed', targetType: 'user', targetId: rows[0].id, metadata: { isPlatformAdmin: true, via: 'PLATFORM_ADMIN_EMAILS' } });
    console.log(`Plattform-admin gitt til ${email.replace(/^(.).*(@.*)$/, '$1***$2')}.`);
  }
  return granted;
}

/** Sjekker at appen faktisk kan logge inn med DATABASE_URL (gir tydelig feil i byggeloggen). */
async function verifyAppLogin(): Promise<void> {
  const result = await loginWithRetry(env.DATABASE_URL, [3_000, 6_000, 10_000, 15_000]);
  if (result === true) {
    console.log('App-brukeren kan logge inn i databasen.');
    return;
  }
  const msg = result instanceof Error ? result.message : String(result);
  const hint = isAuthError(result) ? ' Er passordet nettopp endret, kan Supabase-pooleren bruke noen minutter på å oppdatere seg – prøv å deploye igjen om litt.' : '';
  throw new Error(`Appen kan ikke logge inn med DATABASE_URL: ${msg}.${hint}`);
}

/**
 * Kjøres etter hver migrering (idempotent): radnivåsikkerhet på ALLE tabeller, også tabeller som
 * legges til senere, og ingen tilgang for Supabase sine API-roller (anon/authenticated). Da kan
 * databasen aldri leses via Supabase sitt automatiske REST-API, selv om en ny tabell glemmes.
 */
async function enforceBaselineSecurity(sql: ReturnType<typeof systemSql>): Promise<void> {
  await sql.unsafe(`
    do $$
    declare t text; r text;
    begin
      for t in select tablename from pg_tables where schemaname = 'public' loop
        execute format('alter table public.%I enable row level security', t);
      end loop;
      foreach r in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = r) then
          execute format('revoke all on all tables in schema public from %I', r);
          execute format('revoke all on all sequences in schema public from %I', r);
          execute format('revoke all on all functions in schema public from %I', r);
          execute format('alter default privileges in schema public revoke all on tables from %I', r);
          execute format('alter default privileges in schema public revoke all on sequences from %I', r);
          execute format('alter default privileges in schema public revoke all on functions from %I', r);
        end if;
      end loop;
    end $$;
  `);
}

const isMain = process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js');
if (isMain) {
  migrate({ reset: process.argv.includes('--reset') })
    .then(() => verifyAppLogin())
    .then(() => applyAdminEmails())
    .then(() => closeDb())
    .catch(async (err) => {
      console.error(`Migrering feilet: ${err instanceof Error ? err.message : String(err)}`);
      if (env.NODE_ENV !== 'production' && err instanceof Error && err.stack) console.error(err.stack);
      await closeDb();
      process.exit(1);
    });
}
