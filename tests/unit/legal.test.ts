/**
 * De juridiske sidene skal beskrive det appen faktisk gjør. Testene feiler hvis koden endres
 * (ny informasjonskapsel, ny lagringstid, ny underleverandør) uten at fakta i
 * src/domain/legal/legal.ts følger med – da må tekstene, og eventuelt LEGAL_VERSION, oppdateres.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  companyConfigured,
  cookies,
  isPlaceholder,
  LEGAL_DOCS,
  LEGAL_UPDATED,
  LEGAL_VERSION,
  RETENTION,
  subprocessors,
} from '../../src/domain/legal/legal';
import { SESSION_COOKIE, SESSION_TTL_DAYS } from '../../src/domain/auth/auth';
import { FLASH_COOKIE } from '../../src/server/flash';
import { env } from '../../src/lib/env';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test('versjonen er datoen for siste endring', () => {
  assert.match(LEGAL_VERSION, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(LEGAL_UPDATED.toISOString().slice(0, 10), LEGAL_VERSION);
});

test('alle informasjonskapsler appen setter, er dokumentert med riktig varighet', () => {
  // Hvert kall til serializeCookie i koden bruker en av de kjente kapslene.
  const used = new Set<string>();
  for (const file of sourceFiles(join(process.cwd(), 'src'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(/serializeCookie\(\s*([A-Za-z_][\w]*|'[^']*')/g)) {
      if (!file.endsWith('http.ts')) used.add(m[1]!);
    }
  }
  assert.deepEqual([...used].sort(), ['FLASH_COOKIE', 'GUEST_CSRF_COOKIE', 'SESSION_COOKIE'], 'ny informasjonskapsel? Dokumenter den i cookies()');

  const csrfName = /GUEST_CSRF_COOKIE = '([^']+)'/.exec(source('src/server/app.ts'))?.[1];
  assert.ok(csrfName);
  const documented = cookies();
  assert.deepEqual(
    documented.map((c) => c.name),
    [SESSION_COOKIE, csrfName, FLASH_COOKIE],
  );

  // Varighetene i teksten stemmer med koden.
  assert.match(documented[0]!.duration, new RegExp(`^${SESSION_TTL_DAYS} dager`));
  assert.match(source('src/server/app.ts'), /serializeCookie\(GUEST_CSRF_COOKIE, guestToken, \{[^}]*maxAge: 60 \* 60 \* 24 \}/);
  assert.equal(documented[1]!.duration, '24 timer');
  assert.match(source('src/server/flash.ts'), /serializeCookie\(FLASH_COOKIE, [^)]*\), \{ maxAge: 60, /);
  assert.equal(documented[2]!.duration, '60 sekunder');
});

/** Leser slettereglene i applyRetention(): tabell → intervaller i dager. */
function retentionRules(): Map<string, number[]> {
  const src = source('src/domain/ops/tasks.ts');
  const body = src.slice(src.indexOf('export async function applyRetention'), src.indexOf("log.info('retention_applied'"));
  const rules = new Map<string, number[]>();
  const parts = body.split(/await run\('/).slice(1);
  for (const part of parts) {
    const name = part.slice(0, part.indexOf("'"));
    const days = [...part.matchAll(/interval '(\d+) days'/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
    rules.set(name, [...new Set(days)]);
  }
  return rules;
}

test('lagringstidene i personvernerklæringen stemmer med slettejobben', () => {
  const rules = retentionRules();
  // Ny sletteregel? Legg den inn her og i RETENTION.
  assert.deepEqual(
    [...rules.keys()].sort(),
    [
      'audit_logs',
      'doffin_enrichment',
      'email_outbox',
      'email_tokens',
      'import_errors',
      'import_runs',
      'invitations',
      'jobs',
      'login_challenges',
      'newsletter_unconfirmed',
      'notifications',
      'page_views_daily',
      'partner_requests',
      'rate_limits',
      'search_events',
      'search_usage',
      'sessions',
      'webauthn_challenges',
    ],
  );

  const row = (pattern: RegExp) => {
    const found = RETENTION.find((r) => pattern.test(r.what));
    assert.ok(found, `rad for ${pattern}`);
    return found.how;
  };
  const expectations: { table: string; days: number[]; row: RegExp; phrases: string[] }[] = [
    { table: 'email_tokens', days: [7], row: /^Lenker for e-postbekreftelse/, phrases: ['7 dager'] },
    { table: 'notifications', days: [180, 365], row: /^Varsler i appen/, phrases: ['180 dager', '365 dager'] },
    { table: 'email_outbox', days: [90], row: /^E-postlogg/, phrases: ['90 dager'] },
    { table: 'audit_logs', days: [365], row: /^Revisjonslogg/, phrases: ['365 dager'] },
    { table: 'search_events', days: [365], row: /søkestatistikk/, phrases: ['365 dager'] },
    { table: 'invitations', days: [90], row: /^Invitasjoner/, phrases: ['90 dager'] },
    { table: 'partner_requests', days: [180, 365, 730], row: /^Partnerforespørsler/, phrases: ['180 dager', '12 måneder', '24 måneder'] },
    { table: 'import_errors', days: [90], row: /^Tekniske logger/, phrases: ['90 til'] },
    { table: 'import_runs', days: [365], row: /^Tekniske logger/, phrases: ['365 dager'] },
    { table: 'newsletter_unconfirmed', days: [7], row: /^Påmelding til ukesbrevet/, phrases: ['7 dager', 'slettes'] },
  ];
  // Besøkstellingen har ingen persondata; 25 måneder står i erklæringen.
  assert.match(source('src/domain/ops/tasks.ts'), /page_views_daily where day < [^`]*interval '25 months'/);
  assert.ok(row(/^Besøkstelling/).includes('25 måneder'));
  for (const e of expectations) {
    assert.deepEqual(rules.get(e.table), e.days, `slettejobben for ${e.table}`);
    const how = row(e.row);
    for (const p of e.phrases) assert.ok(how.includes(p), `«${how}» skal nevne ${p} (${e.table})`);
  }
  // Økter slettes når de utløper, og utløper etter SESSION_TTL_DAYS uten bruk.
  assert.deepEqual(rules.get('sessions'), []);
  assert.ok(row(/^Innloggingsøkter/).includes(`${SESSION_TTL_DAYS} dager`));
});

test('underleverandører som ikke er satt opp, merkes som planlagt', () => {
  const saved = { ...env };
  const e = env as unknown as Record<string, unknown>;
  try {
    Object.assign(e, { STRIPE_SECRET_KEY: '', AI_PROVIDER: 'mock', EMAIL_PROVIDER: 'console', RESEND_API_KEY: '', STORAGE_DRIVER: 'local' });
    let list = subprocessors();
    const by = (prefix: string) => list.find((s) => s.name.startsWith(prefix));
    assert.equal(by('Stripe')?.planned, true);
    assert.equal(by('Anthropic')?.planned, true);
    assert.equal(by('Resend')?.planned, true);
    assert.ok(!by('Render')?.planned && !by('Supabase')?.planned, 'drift og database er alltid i bruk');
    assert.match(by('Render')!.purpose, /opplastede dokumenter/, 'lokale filer ligger hos Render');

    Object.assign(e, { STRIPE_SECRET_KEY: 'sk_test_x', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'x', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'x', STORAGE_DRIVER: 'supabase' });
    Object.assign(e, { EMAIL_FROM: 'AnbudRadar <onboarding@resend.dev>' });
    list = subprocessors();
    assert.equal(by('Resend')?.location, 'USA', 'Resends fellesadresse sender fra USA');
    Object.assign(e, { EMAIL_FROM: 'AnbudRadar <varsler@anbudradar.com>' });
    list = subprocessors();
    assert.match(by('Resend')!.location, /^EU \(Irland\)/, 'eget domene er lagt inn med EU-region');
    assert.match(by('Resend')!.transfer, /USA/, 'selskapet er amerikansk – det skal fortsatt stå');
    assert.equal(by('Stripe')?.planned, false);
    assert.equal(by('Anthropic')?.planned, false);
    assert.equal(by('Resend')?.planned, false);
    assert.doesNotMatch(by('Render')!.purpose, /dokumenter/);
    assert.match(by('Supabase')!.purpose, /opplastede dokumenter/);

    Object.assign(e, { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x' });
    list = subprocessors();
    assert.equal(by('OpenAI')?.planned, false);
    assert.equal(by('Anthropic'), undefined);
  } finally {
    Object.assign(e, saved);
  }
});

test('plassholdere for firmaopplysninger gjenkjennes', () => {
  for (const v of ['', '[Selskapsnavn AS]', '[org.nr.]', 'kontakt@example.com', 'post@EXAMPLE.org']) assert.ok(isPlaceholder(v), v);
  for (const v of ['Testfirma AS', '123 456 789', 'Storgata 1, 0155 Oslo', 'post@testfirma.no']) assert.ok(!isPlaceholder(v), v);
  const real = { name: 'Testfirma AS', orgNumber: '123 456 789', address: 'Storgata 1, 0155 Oslo', email: 'post@testfirma.no' };
  assert.equal(companyConfigured(real), true);
  assert.equal(companyConfigured({ ...real, orgNumber: '[org.nr.]' }), false);
  assert.equal(companyConfigured({ ...real, email: 'kontakt@example.com' }), false);
});

test('dokumentlisten har unike interne lenker', () => {
  const hrefs = LEGAL_DOCS.map((d) => d.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
  for (const h of hrefs) assert.match(h, /^\/[a-z]+$/);
});
