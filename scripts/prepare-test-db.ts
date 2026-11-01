export {};
/**
 * Nullstiller og migrerer testdatabasen (*_test). Kjøres automatisk før integrasjons- og E2E-tester.
 */
process.env.NODE_ENV = 'test';
const { migrate } = await import('./migrate');
const { closeDb } = await import('../src/lib/db');
const { env } = await import('../src/lib/env');

if (!env.DATABASE_ADMIN_URL.includes('_test')) {
  console.error('DATABASE_ADMIN_URL i .env.test må peke på en database som slutter på _test.');
  process.exit(1);
}
await migrate({ reset: true, quiet: true });
await closeDb();
console.log('Testdatabasen er klar.');
