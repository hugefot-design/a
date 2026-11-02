/**
 * PLATFORM_ADMIN_EMAILS: registrerte brukere på listen blir plattform-admin ved deploy (uten
 * direkte databasetilgang). Ukjente adresser gjør ingenting, og ingen mister tilgang.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { applyAdminEmails } from '../../scripts/migrate';
import { createAccount } from '../helpers';

after(() => closeDb());

const isAdmin = async (id: string) =>
  ((await systemSql()`select is_platform_admin from users where id = ${id}`) as unknown as { isPlatformAdmin: boolean }[])[0]!.isPlatformAdmin;

test('brukere på listen blir admin (store/små bokstaver spiller ingen rolle), med revisjonslogg', async () => {
  const a = await createAccount();
  const b = await createAccount();
  assert.equal(await applyAdminEmails(`  ${a.email.toUpperCase()}, finnes-ikke@example.com `), 1);
  assert.equal(await isAdmin(a.user.id), true);
  assert.equal(await isAdmin(b.user.id), false, 'andre brukere påvirkes ikke');
  const logs = (await systemSql()`select metadata from audit_logs where target_id = ${a.user.id} and action = 'admin.role_changed'`) as unknown as { metadata: { via: string } }[];
  assert.equal(logs.at(-1)?.metadata.via, 'PLATFORM_ADMIN_EMAILS');
  assert.equal(await applyAdminEmails(a.email), 0, 'allerede admin – ingen ny endring');
  assert.equal(await applyAdminEmails(undefined), 0);
});
