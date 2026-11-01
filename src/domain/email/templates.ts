import { env } from '@/lib/env';

export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function absoluteUrl(path: string): string {
  return new URL(path, env.APP_URL).toString();
}

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

function layout(heading: string, bodyHtml: string, footer = ''): string {
  return `<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(heading)}</title></head>
<body style="margin:0;background:#f5f7fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#172033">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dce2ea;border-radius:8px">
<tr><td style="background:#0f2340;color:#ffffff;padding:16px 24px;border-radius:8px 8px 0 0;font-weight:700;font-size:16px">AnbudRadar</td></tr>
<tr><td style="padding:24px">
<h1 style="font-size:20px;line-height:1.3;margin:0 0 16px;color:#0f2340">${esc(heading)}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #dce2ea;font-size:12px;color:#5a677d">${footer || 'Du får denne e-posten fordi du har en konto hos AnbudRadar.'}</td></tr>
</table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#0f2340;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:600;display:inline-block">${esc(label)}</a></p>`;
}

export function verifyEmailTemplate(name: string, link: string): Rendered {
  const subject = 'Bekreft e-postadressen din';
  const html = layout(
    subject,
    `<p>Hei ${esc(name)},</p><p>Bekreft at dette er din e-postadresse, så kan vi sende deg varsler om nye anbud og frister.</p>
     ${button(link, 'Bekreft e-postadresse')}
     <p style="font-size:13px;color:#5a677d">Lenken gjelder i 24 timer. Har du ikke opprettet konto, kan du se bort fra denne e-posten.</p>`,
  );
  const text = `Hei ${name},\n\nBekreft e-postadressen din ved å åpne lenken under (gjelder i 24 timer):\n${link}\n\nHar du ikke opprettet konto, kan du se bort fra denne e-posten.`;
  return { subject, html, text };
}

export function passwordResetTemplate(name: string, link: string): Rendered {
  const subject = 'Tilbakestill passordet ditt';
  const html = layout(
    subject,
    `<p>Hei ${esc(name)},</p><p>Vi fikk en forespørsel om å tilbakestille passordet for kontoen din.</p>
     ${button(link, 'Velg nytt passord')}
     <p style="font-size:13px;color:#5a677d">Lenken gjelder i 1 time og kan bare brukes én gang. Ba du ikke om dette, kan du se bort fra e-posten – passordet ditt er uendret.</p>`,
  );
  const text = `Hei ${name},\n\nVelg nytt passord her (gjelder i 1 time):\n${link}\n\nBa du ikke om dette, kan du se bort fra e-posten.`;
  return { subject, html, text };
}

export function invitationTemplate(orgName: string, inviterName: string, link: string): Rendered {
  const subject = `${inviterName} inviterte deg til ${orgName} på AnbudRadar`;
  const html = layout(
    `Invitasjon til ${orgName}`,
    `<p>${esc(inviterName)} har invitert deg til å bli med i <strong>${esc(orgName)}</strong> på AnbudRadar.</p>
     ${button(link, 'Godta invitasjonen')}
     <p style="font-size:13px;color:#5a677d">Invitasjonen gjelder i 7 dager.</p>`,
    'Du får denne e-posten fordi noen inviterte denne adressen til AnbudRadar.',
  );
  const text = `${inviterName} har invitert deg til ${orgName} på AnbudRadar.\n\nGodta invitasjonen (gjelder i 7 dager):\n${link}`;
  return { subject, html, text };
}

export interface DigestItem {
  title: string;
  body?: string | null;
  url?: string | null;
}

export function digestTemplate(heading: string, intro: string, items: DigestItem[], settingsUrl: string): Rendered {
  const list = items
    .map(
      (i) =>
        `<tr><td style="padding:12px 0;border-bottom:1px solid #edf0f4">
          ${i.url ? `<a href="${esc(i.url)}" style="color:#0f2340;font-weight:600;text-decoration:none">${esc(i.title)}</a>` : `<strong>${esc(i.title)}</strong>`}
          ${i.body ? `<div style="font-size:13px;color:#5a677d;margin-top:4px">${esc(i.body)}</div>` : ''}
        </td></tr>`,
    )
    .join('');
  const html = layout(
    heading,
    `<p>${esc(intro)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${list}</table>`,
    `Du kan endre hvilke varsler du får og hvor ofte under <a href="${esc(settingsUrl)}" style="color:#5a677d">Varsler</a>.`,
  );
  const text = `${heading}\n\n${intro}\n\n${items
    .map((i) => `- ${i.title}${i.body ? `\n  ${i.body}` : ''}${i.url ? `\n  ${i.url}` : ''}`)
    .join('\n')}\n\nEndre varsler: ${settingsUrl}`;
  return { subject: heading, html, text };
}

export function paymentFailedTemplate(orgName: string, billingUrl: string): Rendered {
  const subject = 'Betalingen for AnbudRadar feilet';
  const html = layout(
    subject,
    `<p>Vi fikk ikke trukket betalingen for ${esc(orgName)}. Stripe prøver igjen automatisk, men oppdater gjerne betalingsmåten for å unngå avbrudd.</p>
     ${button(billingUrl, 'Oppdater betalingsmåte')}`,
  );
  const text = `Vi fikk ikke trukket betalingen for ${orgName}. Oppdater betalingsmåten her:\n${billingUrl}`;
  return { subject, html, text };
}

export function contactNotificationTemplate(name: string, email: string, message: string): Rendered {
  const subject = `Ny henvendelse fra ${name}`;
  const html = layout(
    'Ny henvendelse via kontaktskjemaet',
    `<p><strong>${esc(name)}</strong> (${esc(email)}) skrev:</p><p style="white-space:pre-wrap">${esc(message)}</p>`,
    'Sendt fra kontaktskjemaet på AnbudRadar.',
  );
  return { subject, html, text: `${name} (${email}) skrev:\n\n${message}` };
}
