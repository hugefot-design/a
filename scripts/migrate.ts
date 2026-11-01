/**
 * Kjører SQL-migreringer i db/migrations i rekkefølge. Hver fil kjøres i én transaksjon.
 *
 *   npm run db:migrate            – kjør nye migreringer
 *   npm run db:migrate -- --reset – SLETT alt og kjør på nytt (kun *_dev / *_test databaser)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env, isProd } from '../src/lib/env';
import { closeDb, systemSql } from '../src/lib/db';

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
    .then(() => closeDb())
    .catch(async (err) => {
      console.error(`Migrering feilet: ${err instanceof Error ? err.message : String(err)}`);
      if (env.NODE_ENV !== 'production' && err instanceof Error && err.stack) console.error(err.stack);
      await closeDb();
      process.exit(1);
    });
}
