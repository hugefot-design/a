import { test } from 'node:test';
import assert from 'node:assert/strict';
import { credentialsOf, deriveAppDatabaseUrl, isPostgresUrl, withPassword } from '../../src/lib/db-url';

test('app-adressen lages fra Supabase-poolerens admin-adresse (prosjektdelen beholdes)', () => {
  const admin = 'postgresql://postgres.abcdefghij:AdminPass123@aws-0-eu-central-1.pooler.supabase.com:5432/postgres';
  const app = deriveAppDatabaseUrl(admin, 'AppPass456')!;
  assert.equal(app, 'postgresql://anbudradar_app.abcdefghij:AppPass456@aws-0-eu-central-1.pooler.supabase.com:5432/postgres');
  assert.deepEqual(credentialsOf(app), { role: 'anbudradar_app', password: 'AppPass456' });
});

test('vanlig adresse uten pooler, parametre beholdes og spesialtegn i passordet kodes riktig', () => {
  const app = deriveAppDatabaseUrl('postgres://postgres:x@localhost:5432/anbudradar?sslmode=require', 'p@ss:w/rd#?%')!;
  assert.match(app, /^postgres:\/\/anbudradar_app:[^@]+@localhost:5432\/anbudradar\?sslmode=require$/);
  assert.deepEqual(credentialsOf(app), { role: 'anbudradar_app', password: 'p@ss:w/rd#?%' });
});

test('plassholdere og andre ugyldige verdier avvises', () => {
  for (const v of ['lim-inn-admin-adressen-her', '', 'https://example.com', 'postgresql://']) assert.equal(isPostgresUrl(v), false, v);
  assert.equal(deriveAppDatabaseUrl('lim-inn-admin-adressen-her', 'x'), null);
  assert.equal(deriveAppDatabaseUrl('postgresql://postgres:x@host:5432/db', ''), null);
  assert.equal(credentialsOf('postgresql://anbudradar_app@host:5432/db'), null, 'uten passord');
});

test('passordet settes inn i adressen fra Supabase – også over plassholderen og med spesialtegn', () => {
  const fromSupabase = 'postgresql://postgres.pfdkexample:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';
  const admin = withPassword(fromSupabase, 'S#per@hemmelig/1')!;
  assert.doesNotMatch(admin, /YOUR-PASSWORD/);
  assert.deepEqual(credentialsOf(admin), { role: 'postgres', password: 'S#per@hemmelig/1' });
  const app = deriveAppDatabaseUrl(admin, 'AppPass456')!;
  assert.equal(app, 'postgresql://anbudradar_app.pfdkexample:AppPass456@aws-0-eu-west-1.pooler.supabase.com:5432/postgres');
  assert.equal(withPassword('postgresql://postgres.pfdkexample@aws-0-eu-west-1.pooler.supabase.com:5432/postgres', 'abc')?.includes(':abc@'), true, 'adresse uten passord');
  assert.equal(withPassword('lim-inn-her', 'abc'), null);
});
