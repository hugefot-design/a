import { env } from './env';
import { systemSql } from './db';
import { log } from './logger';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  kind: string;
  userId?: string | null;
  orgId?: string | null;
}

/** Legger e-post i utboksen. Sendes av arbeideren (eller straks via deliverEmail). */
export async function queueEmail(msg: EmailMessage): Promise<string> {
  const rows = (await systemSql()`
    insert into email_outbox (to_email, subject, html, text_body, kind, user_id, org_id)
    values (${msg.to}, ${msg.subject}, ${msg.html}, ${msg.text}, ${msg.kind}, ${msg.userId ?? null}, ${msg.orgId ?? null})
    returning id
  `) as unknown as { id: string }[];
  return rows[0]!.id;
}

interface SendResult {
  ok: boolean;
  provider: string;
  messageId?: string;
  error?: string;
  logged?: boolean;
}

async function sendViaProvider(row: { toEmail: string; subject: string; html: string; textBody: string }): Promise<SendResult> {
  if (env.EMAIL_PROVIDER === 'resend') {
    if (!env.RESEND_API_KEY) return { ok: false, provider: 'resend', error: 'RESEND_API_KEY mangler' };
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [row.toEmail],
          subject: row.subject,
          html: row.html,
          text: row.textBody,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) return { ok: false, provider: 'resend', error: `HTTP ${res.status}: ${body.message ?? 'ukjent feil'}` };
      return { ok: true, provider: 'resend', messageId: body.id };
    } catch (err) {
      return { ok: false, provider: 'resend', error: err instanceof Error ? err.message : String(err) };
    }
  }
  // Utviklingsmodus: e-posten logges og blir liggende i utboksen (synlig i admin).
  log.info('email_logged', { to: row.toEmail, subject: row.subject });
  return { ok: true, provider: 'log', logged: true };
}

/** Sender én e-post fra utboksen. Trygt å kalle flere ganger (låser raden). */
export async function deliverEmail(id: string): Promise<void> {
  const sql = systemSql();
  const rows = (await sql`
    update email_outbox set attempts = attempts + 1, next_attempt_at = now() + interval '10 minutes'
    where id = ${id} and status = 'pending' and next_attempt_at <= now()
    returning id, to_email, subject, html, text_body, attempts
  `) as unknown as { id: string; toEmail: string; subject: string; html: string; textBody: string; attempts: number }[];
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
    const failed = row.attempts >= 5;
    await sql`
      update email_outbox set status = ${failed ? 'failed' : 'pending'}, provider = ${result.provider},
        last_error = ${result.error ?? null},
        next_attempt_at = now() + make_interval(mins => ${Math.min(60, 2 ** row.attempts)})
      where id = ${id}
    `;
    log.warn('email_send_failed', { id, error: result.error, attempts: row.attempts });
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
export async function sendEmailSoon(msg: EmailMessage): Promise<string> {
  const id = await queueEmail(msg);
  setImmediate(() => {
    deliverEmail(id).catch((err) => log.error('email_immediate_failed', { id, err }));
  });
  return id;
}
