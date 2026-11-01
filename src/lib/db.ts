import postgres from 'postgres';
import { env } from './env';

/**
 * To tilkoblingspooler:
 *  - appSql:    rollen anbudradar_app. Underlagt radnivåsikkerhet (RLS). Brukes for alt
 *               som skjer på vegne av en innlogget bruker.
 *  - systemSql: eier-rollen. Omgår RLS. Brukes KUN av bakgrunnsjobber, import, webhooks,
 *               admin og operasjoner som krysser organisasjoner (f.eks. invitasjoner).
 */

export type Sql = postgres.Sql<Record<string, unknown>>;
export type Tx = postgres.TransactionSql<Record<string, unknown>>;
export type Db = Sql | Tx;

function createPool(url: string, name: string): Sql {
  return postgres(url, {
    max: env.DATABASE_POOL_SIZE,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
    ssl: env.DATABASE_SSL === 'require' ? 'require' : false,
    prepare: process.env.DATABASE_PREPARE !== 'false',
    // Kolonnenavn snake_case <-> camelCase. JSON-innhold (jsonb) leveres uendret –
    // postgres.camel ville også endret nøklene inne i JSON-dokumenter.
    transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
    onnotice: () => {},
    connection: { application_name: `anbudradar-${name}` },
    types: {
      numeric: {
        to: 1700,
        from: [1700],
        serialize: (x: unknown) => String(x),
        parse: (x: string) => Number(x),
      },
      bigint: {
        to: 20,
        from: [20],
        serialize: (x: unknown) => String(x),
        parse: (x: string) => Number(x),
      },
    },
  }) as unknown as Sql;
}

let _app: Sql | null = null;
let _system: Sql | null = null;

export function appSql(): Sql {
  if (!_app) _app = createPool(env.DATABASE_URL, 'app');
  return _app;
}

export function systemSql(): Sql {
  if (!_system) _system = createPool(env.DATABASE_ADMIN_URL, 'system');
  return _system;
}

export interface TenantContext {
  userId: string;
  orgId: string | null;
}

/**
 * Kjører fn i en transaksjon der RLS-konteksten (app.user_id / app.org_id) er satt.
 * Alle spørringer mot tenant-tabeller må gå via denne.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const sql = appSql();
  return (await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${ctx.userId}, true), set_config('app.org_id', ${ctx.orgId ?? ''}, true)`;
    return fn(tx as unknown as Tx);
  })) as T;
}

export async function closeDb(): Promise<void> {
  const pools = [_app, _system].filter(Boolean) as Sql[];
  _app = null;
  _system = null;
  await Promise.all(pools.map((p) => p.end({ timeout: 5 })));
}

/** Trekker ut én rad eller null. */
export function first<T>(rows: readonly T[]): T | null {
  return rows.length > 0 ? (rows[0] as T) : null;
}

/**
 * Serialiserer en verdi til JSON-tekst for en jsonb-kolonne.
 * Bruk ALLTID sammen med `::text::jsonb` i SQL: postgres.js ville ellers JSON-kode strengen
 * en gang til (parameteren får typen jsonb), og kolonnen ville inneholde en JSON-streng.
 */
export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}
