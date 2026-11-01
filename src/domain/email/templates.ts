/**
 * E-postmaler. Enkle tabeller og inline-stiler fungerer i alle vanlige e-postklienter (også Outlook).
 * Alle maler har ren tekst-versjon. Innhold fra brukere og kunngjøringer escapes alltid.
 */
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

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

const C = { navy: '#0f2340', text: '#172033', muted: '#5a677d', line: '#dce2ea', bg: '#f5f7fa', accent: '#1d4ed8', warn: '#9a3412', warnBg: '#fff7ed' };

function senderLine(): string {
  const parts = [env.COMPANY_LEGAL_NAME, env.COMPANY_ORG_NUMBER && !env.COMPANY_ORG_NUMBER.startsWith('[') ? `org.nr. ${env.COMPANY_ORG_NUMBER}` : null, env.COMPANY_ADDRESS]
    .filter((p): p is string => Boolean(p) && !p!.startsWith('['));
  return parts.length ? parts.join(' · ') : 'AnbudRadar';
}

interface LayoutOptions {
  /** Kort forhåndsvisning som vises i innboksen. */
  preheader?: string;
  footer?: string;
  unsubscribeUrl?: string;
}

function layout(heading: string, bodyHtml: string, opts: LayoutOptions = {}): string {
  const footer = opts.footer ?? 'Du får denne e-posten fordi du har en konto hos AnbudRadar.';
  const unsubscribe = opts.unsubscribeUrl
    ? ` <a href="${esc(opts.unsubscribeUrl)}" style="color:${C.muted}">Meld av varsel-e-post</a>.`
    : '';
  return `<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.text};-webkit-text-size-adjust:100%">
${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${C.line};border-radius:10px">
<tr><td style="padding:20px 28px;border-bottom:1px solid ${C.line}">
  <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${C.accent};margin-right:8px;vertical-align:middle"></span><span style="font-weight:700;font-size:16px;color:${C.navy};vertical-align:middle">AnbudRadar</span>
</td></tr>
<tr><td style="padding:28px">
<h1 style="font-size:21px;line-height:1.3;margin:0 0 16px;color:${C.navy}">${esc(heading)}</h1>
<div style="font-size:15px;line-height:1.6">${bodyHtml}</div>
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid ${C.line};font-size:12px;line-height:1.5;color:${C.muted}">${footer}${unsubscribe}<br>${esc(senderLine())}</td></tr>
</table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td style="border-radius:6px;background:${C.navy}">
<a href="${esc(href)}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">${esc(label)}</a></td></tr></table>`;
}

function note(text: string): string {
  return `<p style="font-size:13px;color:${C.muted};margin:16px 0 0">${esc(text)}</p>`;
}

function textFooter(unsubscribeUrl?: string): string {
  return `\n\n--\n${senderLine()}${unsubscribeUrl ? `\nMeld av varsel-e-post: ${unsubscribeUrl}` : ''}`;
}

// ---------------------------------------------------------------------------
// Konto og sikkerhet (kan ikke meldes av – nødvendige for kontoen)
// ---------------------------------------------------------------------------
export function verifyEmailTemplate(name: string, link: string): Rendered {
  const subject = 'Bekreft e-postadressen din';
  const html = layout(
    subject,
    `<p>Hei ${esc(name)},</p><p>Takk for at du opprettet konto hos AnbudRadar. Bekreft at dette er din e-postadresse, så kan vi sende deg varsler om nye anbud og frister.</p>
     ${button(link, 'Bekreft e-postadresse')}
     ${note('Lenken gjelder i 24 timer. Har du ikke opprettet konto, kan du se bort fra denne e-posten.')}`,
    { preheader: 'Bekreft adressen for å få varsler om nye anbud.' },
  );
  const text = `Hei ${name},\n\nBekreft e-postadressen din ved å åpne lenken under (gjelder i 24 timer):\n${link}\n\nHar du ikke opprettet konto, kan du se bort fra denne e-posten.${textFooter()}`;
  return { subject, html, text };
}

export function passwordResetTemplate(name: string, link: string): Rendered {
  const subject = 'Tilbakestill passordet ditt';
  const html = layout(
    subject,
    `<p>Hei ${esc(name)},</p><p>Vi fikk en forespørsel om å tilbakestille passordet for kontoen din.</p>
     ${button(link, 'Velg nytt passord')}
     ${note('Lenken gjelder i 1 time og kan bare brukes én gang. Ba du ikke om dette, kan du se bort fra e-posten – passordet ditt er uendret.')}`,
    { preheader: 'Lenken gjelder i én time.' },
  );
  const text = `Hei ${name},\n\nVelg nytt passord her (gjelder i 1 time):\n${link}\n\nBa du ikke om dette, kan du se bort fra e-posten.${textFooter()}`;
  return { subject, html, text };
}

export function passwordChangedTemplate(name: string, resetUrl: string): Rendered {
  const subject = 'Passordet ditt er endret';
  const html = layout(
    subject,
    `<p>Hei ${esc(name)},</p><p>Passordet for AnbudRadar-kontoen din ble nettopp endret, og andre enheter er logget ut.</p>
     <p>Var dette ikke deg? Tilbakestill passordet med en gang og kontakt oss.</p>${button(resetUrl, 'Tilbakestill passord')}`,
  );
  return { subject, html, text: `Hei ${name},\n\nPassordet ditt ble endret. Var det ikke deg? Tilbakestill her: ${resetUrl}${textFooter()}` };
}

export function invitationTemplate(orgName: string, inviterName: string, link: string): Rendered {
  const subject = `${inviterName} inviterte deg til ${orgName} på AnbudRadar`;
  const html = layout(
    `Invitasjon til ${orgName}`,
    `<p>${esc(inviterName)} har invitert deg til å bli med i <strong>${esc(orgName)}</strong> på AnbudRadar – en tjeneste for å finne og forberede tilbud på offentlige anbud.</p>
     ${button(link, 'Godta invitasjonen')}
     ${note('Invitasjonen gjelder i 7 dager.')}`,
    { footer: 'Du får denne e-posten fordi noen inviterte denne adressen til AnbudRadar.' },
  );
  const text = `${inviterName} har invitert deg til ${orgName} på AnbudRadar.\n\nGodta invitasjonen (gjelder i 7 dager):\n${link}${textFooter()}`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Varsler (kan meldes av)
// ---------------------------------------------------------------------------
export interface DigestItem {
  title: string;
  body?: string | null;
  url?: string | null;
  /** Kort etikett, f.eks. «Frist om 3 dager» eller «Relevans 82». */
  tag?: string | null;
}

export function digestTemplate(heading: string, intro: string, items: DigestItem[], settingsUrl: string, unsubscribe?: string): Rendered {
  const list = items
    .map(
      (i) =>
        `<tr><td style="padding:14px 0;border-bottom:1px solid #edf0f4">
          ${i.tag ? `<div style="font-size:12px;font-weight:600;color:${C.accent};text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px">${esc(i.tag)}</div>` : ''}
          ${i.url ? `<a href="${esc(i.url)}" style="color:${C.navy};font-weight:600;text-decoration:none;font-size:15px">${esc(i.title)}</a>` : `<strong>${esc(i.title)}</strong>`}
          ${i.body ? `<div style="font-size:13px;color:${C.muted};margin-top:4px">${esc(i.body)}</div>` : ''}
        </td></tr>`,
    )
    .join('');
  const html = layout(
    heading,
    `<p>${esc(intro)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${list}</table>
     ${button(absoluteUrl('/app/varsler'), 'Se alle varsler')}`,
    {
      preheader: items[0]?.title,
      footer: `Du kan endre hvilke varsler du får og hvor ofte under <a href="${esc(settingsUrl)}" style="color:${C.muted}">Varsler</a>.`,
      unsubscribeUrl: unsubscribe,
    },
  );
  const text = `${heading}\n\n${intro}\n\n${items
    .map((i) => `- ${i.tag ? `[${i.tag}] ` : ''}${i.title}${i.body ? `\n  ${i.body}` : ''}${i.url ? `\n  ${i.url}` : ''}`)
    .join('\n')}\n\nEndre varsler: ${settingsUrl}${textFooter(unsubscribe)}`;
  return { subject: heading, html, text };
}

// ---------------------------------------------------------------------------
// Abonnement og betaling (kan ikke meldes av – nødvendige for avtalen)
// ---------------------------------------------------------------------------
export function paymentFailedTemplate(orgName: string, billingUrl: string): Rendered {
  const subject = 'Betalingen for AnbudRadar feilet';
  const html = layout(
    subject,
    `<p>Vi fikk ikke trukket betalingen for <strong>${esc(orgName)}</strong>. Stripe prøver igjen automatisk de neste dagene.</p>
     <p>Oppdater betalingsmåten for å unngå at tilgangen stopper.</p>
     ${button(billingUrl, 'Oppdater betalingsmåte')}`,
    { preheader: 'Oppdater betalingsmåten for å beholde tilgangen.' },
  );
  const text = `Vi fikk ikke trukket betalingen for ${orgName}. Stripe prøver igjen automatisk. Oppdater betalingsmåten her:\n${billingUrl}${textFooter()}`;
  return { subject, html, text };
}

export function subscriptionActivatedTemplate(orgName: string, planName: string, priceNok: number | null, billingUrl: string): Rendered {
  const subject = `Abonnementet ${planName} er aktivt`;
  const price = priceNok !== null ? ` (${priceNok} kr per måned eks. mva.)` : '';
  const html = layout(
    subject,
    `<p>Takk! <strong>${esc(orgName)}</strong> har nå abonnementet <strong>${esc(planName)}</strong>${esc(price)}.</p>
     <p>Kvittering og faktura sendes fra Stripe, vår betalingsleverandør. Du finner fakturaene også under Abonnement.</p>
     ${button(billingUrl, 'Se abonnementet')}`,
    { preheader: `${planName} er aktivert.` },
  );
  return { subject, html, text: `${orgName} har nå abonnementet ${planName}${price}.\nSe abonnementet: ${billingUrl}${textFooter()}` };
}

export function subscriptionEndingTemplate(orgName: string, planName: string, endsAt: Date | null, billingUrl: string): Rendered {
  const when = endsAt ? new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' }).format(endsAt) : null;
  const subject = 'Abonnementet ditt er sagt opp';
  const html = layout(
    subject,
    `<p>Abonnementet <strong>${esc(planName)}</strong> for ${esc(orgName)} er sagt opp${when ? ` og avsluttes <strong>${esc(when)}</strong>` : ''}. Dere beholder tilgangen ut perioden dere har betalt for.</p>
     <p>Ombestemt dere? Dere kan gjenoppta abonnementet før det utløper.</p>${button(billingUrl, 'Gjenoppta abonnementet')}`,
  );
  return { subject, html, text: `Abonnementet ${planName} for ${orgName} er sagt opp${when ? ` og avsluttes ${when}` : ''}.\nGjenoppta: ${billingUrl}${textFooter()}` };
}

export function subscriptionEndedTemplate(orgName: string, pricingUrl: string): Rendered {
  const subject = 'Abonnementet er avsluttet';
  const html = layout(
    subject,
    `<p>Abonnementet for ${esc(orgName)} er avsluttet, og kontoen er nå på gratisnivået. Lagrede anbud og tilbudsarbeid er tatt vare på.</p>${button(pricingUrl, 'Velg en plan')}`,
  );
  return { subject, html, text: `Abonnementet for ${orgName} er avsluttet. Velg en plan: ${pricingUrl}${textFooter()}` };
}

export function trialEndingTemplate(orgName: string, daysLeft: number, billingUrl: string): Rendered {
  const subject = daysLeft <= 1 ? 'Prøveperioden din slutter i morgen' : `Prøveperioden din slutter om ${daysLeft} dager`;
  const html = layout(
    subject,
    `<p>Prøveperioden for <strong>${esc(orgName)}</strong> slutter snart. Etterpå går kontoen over til gratisnivået, og AI-analyser, varsler og rangering stopper.</p>
     <p>Velg en plan for å fortsette uten avbrudd. Ingen binding – abonnementet kan sies opp når som helst.</p>
     ${button(billingUrl, 'Velg plan')}`,
    { preheader: 'Velg en plan for å fortsette uten avbrudd.' },
  );
  return { subject, html, text: `Prøveperioden for ${orgName} slutter om ${daysLeft} dag(er). Velg plan: ${billingUrl}${textFooter()}` };
}

// ---------------------------------------------------------------------------
// Drift
// ---------------------------------------------------------------------------
export function contactNotificationTemplate(name: string, email: string, message: string): Rendered {
  const subject = `Ny henvendelse fra ${name}`;
  const html = layout(
    'Ny henvendelse via kontaktskjemaet',
    `<p><strong>${esc(name)}</strong> (${esc(email)}) skrev:</p><p style="white-space:pre-wrap">${esc(message)}</p>`,
    { footer: 'Sendt fra kontaktskjemaet på AnbudRadar.' },
  );
  return { subject, html, text: `${name} (${email}) skrev:\n\n${message}` };
}

export function adminAlertTemplate(title: string, details: string): Rendered {
  const subject = `[AnbudRadar] ${title}`;
  const html = layout(title, `<p style="white-space:pre-wrap">${esc(details)}</p>`, { footer: 'Automatisk driftsvarsel fra AnbudRadar.' });
  return { subject, html, text: `${title}\n\n${details}` };
}

export function systemMessageTemplate(title: string, message: string, link: string | null): Rendered {
  const html = layout(title, `<p style="white-space:pre-wrap">${esc(message)}</p>${link ? button(link, 'Les mer') : ''}`, {
    footer: 'Viktig melding om tjenesten til alle kunder.',
  });
  return { subject: title, html, text: `${title}\n\n${message}${link ? `\n\n${link}` : ''}${textFooter()}` };
}
