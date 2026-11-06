/**
 * Hjelpere for integrasjons- og E2E-tester. Kjører mot testdatabasen (*_test, se .env.test).
 * Alle testdata er fiktive og får unike ID-er, så testfilene ikke påvirker hverandre.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { env } from '../src/lib/env';
import { systemSql, withTenant } from '../src/lib/db';
import { createApp } from '../src/server/app';
import { buildRouter } from '../src/routes';
import { createSession, registerUser, SESSION_COOKIE } from '../src/domain/auth/auth';
import { createOrganization } from '../src/domain/org/org';
import { afterProfileSaved, profileFormSchema, saveProfile } from '../src/domain/profile/profile';
import { ingestNotices, startImportRun, finishImportRun } from '../src/domain/tenders/ingest';
import { recomputeMatchesForTenders } from '../src/domain/matching/service';
import type { NormalizedNotice } from '../src/domain/tenders/normalize';
import type { PlanId } from '../src/domain/billing/plans';
import type { AuthUser } from '../src/server/http';
import { encryptSecret } from '../src/lib/crypto';
import { currentStep, totpAt } from '../src/lib/totp';

if (!env.DATABASE_URL.includes('_test')) throw new Error('Testene skal bare kjøre mot en *_test-database (NODE_ENV=test).');

export const ORIGIN = new URL(env.APP_URL).origin;

/**
 * Starter appen i testprosessen. Standard er en tilfeldig port; E2E-testene bruker porten i APP_URL,
 * fordi nettleseren sender Origin-header som må stemme med APP_URL (CSRF-beskyttelse).
 */
export async function startServer(port = 0): Promise<{ base: string; close: () => Promise<void> }> {
  const app = createApp(buildRouter());
  const server = createServer((req, res) => void app(req, res));
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = (server.address() as AddressInfo).port;
  return {
    base: port ? ORIGIN : `http://127.0.0.1:${actual}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface TestResponse {
  status: number;
  location: string | null;
  body: string;
  headers: Headers;
}

/** Enkel HTTP-klient med informasjonskapsler, slik en nettleser ville oppført seg. */
export class Client {
  readonly cookies = new Map<string, string>();
  constructor(readonly base: string) {}

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private store(res: Response): void {
    for (const c of res.headers.getSetCookie()) {
      const [pair = ''] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value || /max-age=0\b/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}): Promise<TestResponse> {
    const res = await fetch(this.base + path, {
      method,
      redirect: 'manual',
      body: init.body,
      headers: { cookie: this.cookieHeader(), ...(method === 'GET' ? {} : { origin: ORIGIN }), ...init.headers },
    });
    this.store(res);
    return { status: res.status, location: res.headers.get('location'), body: await res.text(), headers: res.headers };
  }

  get(path: string, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.request('GET', path, { headers });
  }

  /** Henter CSRF-tokenet fra skjemaet på `from`-siden og sender skjemaet. */
  async post(path: string, fields: Record<string, string | string[]> = {}, opts: { from?: string; csrf?: string | null; headers?: Record<string, string> } = {}): Promise<TestResponse> {
    let token = opts.csrf;
    if (token === undefined) {
      const page = await this.get(opts.from ?? '/app/innstillinger');
      token = csrfFrom(page.body);
      if (!token) throw new Error(`Fant ikke CSRF-token på ${opts.from ?? '/app/innstillinger'} (status ${page.status})`);
    }
    const body = new URLSearchParams();
    if (token !== null) body.append('_csrf', token);
    for (const [k, v] of Object.entries(fields)) for (const item of Array.isArray(v) ? v : [v]) body.append(k, item);
    return this.request('POST', path, { body, headers: { 'content-type': 'application/x-www-form-urlencoded', ...opts.headers } });
  }

  async postMultipart(path: string, form: FormData, from: string): Promise<TestResponse> {
    const page = await this.get(from);
    const token = csrfFrom(page.body);
    if (!token) throw new Error(`Fant ikke CSRF-token på ${from}`);
    form.append('_csrf', token);
    return this.request('POST', path, { body: form });
  }
}

export function csrfFrom(html: string): string | null {
  return /name="_csrf" value="([^"]+)"/.exec(html)?.[1] ?? null;
}

export function uniqueEmail(prefix = 'test'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.com`;
}

export interface TestAccount {
  user: AuthUser;
  email: string;
  password: string;
  orgId: string;
}

export const DEFAULT_PROFILE = {
  companyName: 'Testbedrift AS (test)',
  orgNumber: '',
  description: 'Fiktiv testbedrift.',
  industries: ['security'],
  services: 'Vakthold og resepsjon',
  keywords: 'vakthold, resepsjon',
  cpvCodes: '79713000',
  regions: ['50'],
  companySize: '10-49',
  certifications: ['vaktvirksomhet'],
  experience: '',
  minContractValue: '',
  maxContractValue: '',
  contractTypes: ['services'],
  excludedCpv: '',
  excludedKeywords: '',
  minDaysToDeadline: '5',
};

/** Oppretter bruker + organisasjon direkte i databasen (raskere enn via skjemaene). */
export async function createAccount(opts: { plan?: PlanId; verified?: boolean; profile?: Partial<typeof DEFAULT_PROFILE> | false; orgName?: string } = {}): Promise<TestAccount> {
  const email = uniqueEmail();
  const password = `Testpassord-${randomUUID().slice(0, 6)}`;
  const reg = await registerUser({ name: 'Test Testesen', email, password });
  if (!reg.ok) throw new Error('Kunne ikke opprette testbruker');
  const sql = systemSql();
  if (opts.verified !== false) await sql`update users set email_verified_at = now() where id = ${reg.user.id}`;
  const orgId = await createOrganization(reg.user, { name: opts.orgName ?? `Testorg ${email}`, orgNumber: null });
  if (opts.plan && opts.plan !== 'professional') {
    await sql`update subscriptions set plan = ${opts.plan}, status = 'active', source = 'manual', trial_ends_at = null, current_period_end = null where org_id = ${orgId}`;
  }
  if (opts.profile !== false) {
    const data = profileFormSchema.parse({ ...DEFAULT_PROFILE, ...(opts.profile ?? {}) });
    await withTenant({ userId: reg.user.id, orgId }, (tx) => saveProfile(tx, { orgId, userId: reg.user.id }, data));
    await afterProfileSaved(orgId);
  }
  const user: AuthUser = { ...reg.user, emailVerified: opts.verified !== false, currentOrgId: orgId };
  return { user, email, password, orgId };
}

/**
 * Logger inn ved å opprette en sesjon direkte (unngår innloggingsgrensen per IP i testene).
 * `mfaVerified`: økten er laget etter riktig kode, slik admin-panelet krever (bekreftet nå).
 */
export async function clientFor(base: string, account: TestAccount, opts: { mfaVerified?: boolean } = {}): Promise<Client> {
  const client = new Client(base);
  const { token } = await createSession(account.user.id, { userAgent: 'test', mfaVerified: opts.mfaVerified });
  client.cookies.set(SESSION_COOKIE, token);
  return client;
}

/** Admin-økt slik den er rett etter innlogging med kode. */
export function adminClientFor(base: string, account: TestAccount): Promise<Client> {
  return clientFor(base, account, { mfaVerified: true });
}

/** Flytter tidspunktet for siste bekreftelse bakover i alle brukerens økter (for å teste 12 t / 15 min). */
export async function ageMfaVerification(userId: string, minutes: number): Promise<void> {
  await systemSql()`update sessions set mfa_verified_at = now() - make_interval(mins => ${minutes}) where user_id = ${userId}`;
}

/** Fiktiv kunngjøring i felles format. */
export function makeNotice(overrides: Partial<NormalizedNotice> = {}): NormalizedNotice {
  const id = overrides.sourceNoticeId ?? `TEST-${randomUUID().slice(0, 8)}`;
  return {
    source: 'manual',
    sourceNoticeId: id,
    sourceUrl: null,
    noticeType: 'competition',
    lifecycle: 'competition',
    procedureId: null,
    buyerReference: `REF-${id}`,
    title: `Vakthold ved testbygget (test ${id})`,
    description: 'Fiktiv kunngjøring for automatiske tester. Leverandøren må ha tillatelse etter vaktvirksomhetsloven.',
    buyerName: 'Testkommune (test)',
    buyerOrgNumber: null,
    buyerCity: 'Trondheim',
    countryCode: 'NO',
    nutsCodes: ['NO060'],
    placeText: 'Trondheim',
    cpvCodes: ['79713000'],
    mainCpv: '79713000',
    contractNature: 'services',
    procedureType: 'open',
    estimatedValue: 2_000_000,
    currency: 'NOK',
    publishedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    deadlineAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    deadlineTimeKnown: true,
    documentsUrl: null,
    receivedTenders: null,
    awards: [],
    raw: { test: true },
    ...overrides,
  };
}

/** Importerer som en ekte kjøring: lagrer, og beregner treff for berørte anbud (som jobbkøen gjør). */
export async function ingest(notices: NormalizedNotice[]) {
  const run = await startImportRun(notices[0]?.source ?? 'manual', 'cli', { test: true });
  const stats = await ingestNotices(notices, run);
  await finishImportRun(run, stats);
  if (stats.tenderIds.length) await recomputeMatchesForTenders(stats.tenderIds);
  return stats;
}

export async function tenderIdFor(source: string, sourceNoticeId: string): Promise<string> {
  const rows = (await systemSql()`select tender_id from tender_sources where source = ${source} and source_notice_id = ${sourceNoticeId}`) as unknown as { tenderId: string }[];
  if (!rows[0]) throw new Error(`Fant ikke anbud for ${source}/${sourceNoticeId}`);
  return rows[0].tenderId;
}

// ---------------------------------------------------------------------------
// Totrinnsinnlogging i testene
// ---------------------------------------------------------------------------
/** Fast testhemmelighet (base32). Bare i testene. */
export const TEST_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/** Slår på totrinnsinnlogging for en bruker med testhemmeligheten. */
export async function enableTestMfa(userId: string): Promise<void> {
  await systemSql()`update users set totp_secret_enc = ${encryptSecret(TEST_TOTP_SECRET)}, totp_enabled_at = now(), totp_last_step = null where id = ${userId}`;
}

/** Gjør brukeren til plattform-administrator – med totrinnsinnlogging, slik det kreves i virkeligheten. */
export async function makeAdmin(userId: string, opts: { mfa?: boolean } = {}): Promise<void> {
  await systemSql()`update users set is_platform_admin = true where id = ${userId}`;
  if (opts.mfa !== false) await enableTestMfa(userId);
}

/**
 * En gyldig kode akkurat nå. Nullstiller «siste brukte steg» først, så flere innlogginger i samme
 * 30-sekunders vindu går i testene (gjentaksvernet testes for seg i mfa.test.ts).
 */
export async function testTotpCode(userId: string): Promise<string> {
  await systemSql()`update users set totp_last_step = null where id = ${userId}`;
  return totpAt(TEST_TOTP_SECRET, currentStep());
}

/** Henter utfordringen fra kodesiden etter riktig passord. */
export function challengeFrom(body: string): string {
  const m = /name="challenge" value="([^"]+)"/.exec(body);
  if (!m) throw new Error('Fant ikke kodesiden');
  return m[1]!;
}
