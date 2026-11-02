/**
 * Migreringen oppretter app-rollen selv når den mangler (enklere oppsett i Supabase), og holder
 * passordet i takt med konfigurasjonen. Testes med en egen, midlertidig rolle mot ekte database.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { ensureAppRole } from '../../scripts/migrate';

const ROLE = `ar_rolletest_${randomUUID().slice(0, 8)}`;

after(async () => {
  const sql = systemSql();
  const [{ db }] = (await sql`select current_database() as db`) as unknown as [{ db: string }];
  await sql.unsafe(`revoke connect on database "${db}" from "${ROLE}"`).catch(() => {});
  await sql.unsafe(`drop role if exists "${ROLE}"`);
  await closeDb();
});

async function canLogin(password: string): Promise<boolean> {
  const u = new URL(env.DATABASE_ADMIN_URL);
  u.username = ROLE;
  u.password = encodeURIComponent(password);
  const client = postgres(u.toString(), { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    await client`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.end({ timeout: 1 });
  }
}

test('rollen opprettes når den mangler, og passordet følger konfigurasjonen', async () => {
  const sql = systemSql();
  assert.equal(await ensureAppRole(sql, { role: ROLE, password: "første'passord" }), 'created');
  const [r] = (await sql`select rolbypassrls, rolcanlogin from pg_roles where rolname = ${ROLE}`) as unknown as { rolbypassrls: boolean; rolcanlogin: boolean }[];
  assert.deepEqual([r!.rolcanlogin, r!.rolbypassrls], [true, false], 'kan logge inn, men kan ikke omgå radnivåsikkerhet');
  assert.equal(await canLogin("første'passord"), true);

  assert.equal(await ensureAppRole(sql, { role: ROLE, password: 'nytt-passord', managePassword: false }), 'unchanged');
  assert.equal(await canLogin('nytt-passord'), false, 'passordet endres ikke uten at det styres av konfigurasjonen');
  assert.equal(await ensureAppRole(sql, { role: ROLE, password: 'nytt-passord', managePassword: true }), 'updated');
  assert.equal(await canLogin('nytt-passord'), true);
});
