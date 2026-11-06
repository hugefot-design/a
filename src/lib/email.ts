import { env } from './env';
import { systemSql, toJson, type Db } from './db';
import { log } from './logger';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  kind: string;
  userId?: string | null;
  orgId?: string | null;
  /**
   * Samme nøkkel gir bare én e-post, uansett hvor mange ganger hendelsen behandles
   * (f.eks. `payment_failed:<faktura>:<forsøk>:<bruker>`). Utelates for e-post brukeren selv ber om.
   */
  dedupeKey?: string;
  /** Ekstra e-postheadere, f.eks. List-Unsubscribe. */
  headers?: Record<string, string>;
}

/**
 * Legger e-post i utboksen. Sendes av arbeideren (eller straks via sendEmailSoon).
 * Returnerer null hvis en e-post med samme dedupeKey allerede finnes.
 * `db` kan være en transaksjon, slik at e-posten bare legges i kø hvis resten lykkes.
 */
export async function queueEmail(msg: EmailMessage, db: Db = systemSql()): Promise<string | null> {
  const rows = (await db`
    insert into email_outbox (to_email, subject, html, text_body, kind, user_id, org_id, dedupe_key, headers)
    values (${msg.to}, ${msg.subject.slice(0, 300)}, ${msg.html}, ${msg.text}, ${msg.kind}, ${msg.userId ?? null}, ${msg.orgId ?? null},
            ${msg.dedupeKey ?? null}, ${toJson(msg.headers ?? {})}::text::jsonb)
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning id
  `) as unknown as { id: string }[];
  return rows[0]?.id ?? null;
}

/** Testlisten (EMAIL_ALLOWED_RECIPIENTS): adresser eller «@domene». Uten liste er alle tillatt. */
/** Feilteksten i utboksen for e-post som testlisten stoppet (brukes også til å telle dem i admin). */
export const BLOCKED_BY_ALLOWLIST = 'Ikke sendt: mottakeren står ikke på testlisten (EMAIL_ALLOWED_RECIPIENTS).';

export function recipientAllowed(email: string, list: string | undefined = env.EMAIL_ALLOWED_RECIPIENTS): boolean {
  if (!list?.trim()) return true;
  const to = email.trim().toLowerCase();
  return list
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .some((e) => (e.startsWith('@') ? to.endsWith(e) : to === e));
}

interface SendResult {
  ok: boolean;
  provider: string;
  messageId?: string;
  error?: string;
  logged?: boolean;
  /** Varig feil (f.eks. ugyldig adresse): ingen nye forsøk. */
  permanent?: boolean;
  /** Stoppet av testlisten – ikke sendt til leverandøren. */
  blocked?: boolean;
}

interface OutboxRow {
  id: string;
  toEmail: string;
  subject: string;
  html: string;
  textBody: string;
  headers: Record<string, string> | null;
}

/** Feilteksten for adresser på reserverte testdomener (sendes aldri). */
export const BLOCKED_TEST_DOMAIN = 'Ikke sendt: testadresse på et reservert domene (f.eks. example.com).';

/**
 * Reserverte domener for testing og dokumentasjon (RFC 2606 og 6761): example.com/.org/.net og
 * toppdomenene .test, .example, .invalid og .localhost. Kan aldri være ekte mottakere – e-post dit ville
 * bare sprette tilbake og skade avsenderens omdømme.
 */
export function isReservedTestAddress(email: string): boolean {
  const domain = (email.trim().toLowerCase().split('@')[1] ?? '').replace(/\.$/, '');
  if (!domain) return true;
  if (['example.com', 'example.org', 'example.net', 'localhost'].includes(domain)) return true;
  return /\.(test|example|invalid|localhost)$/.test(domain) || /\.example\.(com|org|net)$/.test(domain);
}

async function sendViaProvider(row: OutboxRow): Promise<SendResult> {
  if (env.EMAIL_PROVIDER === 'resend' && isReservedTestAddress(row.toEmail)) {
    return { ok: false, provider: env.EMAIL_PROVIDER, error: BLOCKED_TEST_DOMAIN, permanent: true, blocked: true };
  }
  if (!recipientAllowed(row.toEmail)) {
    return { ok: false, provider: env.EMAIL_PROVIDER, error: BLOCKED_BY_ALLOWLIST, permanent: true, blocked: true };
  }
  if (env.EMAIL_PROVIDER === 'resend') {
    if (!env.RESEND_API_KEY) return { ok: false, provider: 'resend', error: 'RESEND_API_KEY mangler' };
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          // Resend sender ikke samme e-post to ganger innen 24 timer med samme nøkkel – vern mot
          // dobbel sending hvis vi krasjer etter at Resend har tatt imot, men før vi har lagret svaret.
          'Idempotency-Key': `outbox-${row.id}`,
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [row.toEmail],
          subject: row.subject,
          html: row.html,
          text: row.textBody,
          ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}),
          ...(row.headers && Object.keys(row.headers).length ? { headers: row.headers } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (!res.ok) {
        // 4xx (unntatt 408/429) prøves ikke på nytt i det uendelige – f.eks. ugyldig mottaker.
        const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
        return { ok: false, provider: 'resend', error: `HTTP ${res.status}: ${body.message ?? body.name ?? 'ukjent feil'}`, permanent };
      }
      return { ok: true, provider: 'resend', messageId: body.id };
    } catch (err) {
      return { ok: false, provider: 'resend', error: err instanceof Error ? err.message : String(err) };
    }
  }
  // Utviklingsmodus: e-posten logges og blir liggende i utboksen (synlig i admin).
  log.info('email_logged', { to: row.toEmail, subject: row.subject });
  return { ok: true, provider: 'log', logged: true };
}

/** Sender én e-post fra utboksen. Trygt å kalle flere ganger og fra flere prosesser (låser raden). */
export async function deliverEmail(id: string): Promise<void> {
  const sql = systemSql();
  const rows = (await sql`
    update email_outbox set attempts = attempts + 1, next_attempt_at = now() + interval '10 minutes'
    where id = ${id} and status = 'pending' and next_attempt_at <= now()
    returning id, to_email, subject, html, text_body, attempts, headers
  `) as unknown as (OutboxRow & { attempts: number })[];
  const row = rows[0];
  if (!row) return;
  const result = await sendViaProvider(row);
  if (result.ok) {
    await sql`
      update email_outbox set status = ${result.logged ? 'logged' : 'sent'}, provider = ${result.provider},
        provider_message_id = ${result.messageId ?? null}, sent_at = now(), last_error = null
      where id = ${id}
    `;
  } else {
    const failed = result.permanent || row.attempts >= 5;
    await sql`
      update email_outbox set status = ${failed ? 'failed' : 'pending'}, provider = ${result.provider},
        last_error = ${result.error ?? null},
        next_attempt_at = now() + make_interval(mins => ${Math.min(60, 2 ** row.attempts)})
      where id = ${id}
    `;
    if (result.blocked) log.info('email_blocked_test_recipients', { id });
    else (failed ? log.error : log.warn)('email_send_failed', { id, error: result.error, attempts: row.attempts, permanent: Boolean(result.permanent) });
  }
}

export async function deliverPendingEmails(limit = 50): Promise<number> {
  const sql = systemSql();
  const rows = (await sql`
    select id from email_outbox where status = 'pending' and next_attempt_at <= now()
    order by created_at limit ${limit}
  `) as unknown as { id: string }[];
  for (const r of rows) await deliverEmail(r.id);
  return rows.length;
}

/** Legg i kø og prøv å sende med en gang uten å blokkere forespørselen. */
export async function sendEmailSoon(msg: EmailMessage): Promise<string | null> {
  const id = await queueEmail(msg);
  if (id) {
    setImmediate(() => {
      deliverEmail(id).catch((err) => log.error('email_immediate_failed', { id, err }));
    });
  }
  return id;
}
