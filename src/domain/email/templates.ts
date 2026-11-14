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

/** Samme farger som nettsiden: natt-blått, radar-gult og varm bakgrunn. «accent» er en mørk gul som er lesbar på hvitt. */
const C = { navy: '#060e1b', text: '#172033', muted: '#5a677d', line: '#e8e3d8', bg: '#fbf8f1', accent: '#9a6400', signal: '#ffc845', warn: '#9a3412', warnBg: '#fff7ed' };

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
  /** Teksten på avmeldingslenken (standard: «Meld av varsel-e-post»). */
  unsubscribeLabel?: string;
}

function layout(heading: string, bodyHtml: string, opts: LayoutOptions = {}): string {
  const footer = opts.footer ?? 'Du får denne e-posten fordi du har en konto hos AnbudRadar.';
  const unsubscribe = opts.unsubscribeUrl
    ? ` <a href="${esc(opts.unsubscribeUrl)}" style="color:${C.muted}">${esc(opts.unsubscribeLabel ?? 'Meld av varsel-e-post')}</a>.`
    : '';
  return `<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.text};-webkit-text-size-adjust:100%">
${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${C.line};border-radius:16px;overflow:hidden">
<tr><td style="padding:18px 28px;background:${C.navy};border-radius:16px 16px 0 0">
  <img src="${esc(absoluteUrl('/icon-192.png'))}" width="28" height="28" alt="" style="display:inline-block;vertical-align:middle;border:0;margin-right:10px;border-radius:6px"><span style="font-weight:700;font-size:17px;color:#ffffff;vertical-align:middle;letter-spacing:-.01em">AnbudRadar</span>
</td></tr>
<tr><td style="padding:30px 28px 28px">
<h1 style="font-size:23px;line-height:1.25;margin:0 0 16px;color:${C.navy};letter-spacing:-.02em">${esc(heading)}</h1>
<div style="font-size:15px;line-height:1.6">${bodyHtml}</div>
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid ${C.line};font-size:12px;line-height:1.5;color:${C.muted}">${footer}${unsubscribe}<br>${esc(senderLine())}</td></tr>
</table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td style="border-radius:999px;background:${C.signal}">
<a href="${esc(href)}" style="display:inline-block;padding:13px 24px;color:${C.navy};text-decoration:none;font-weight:700;font-size:15px;border-radius:999px">${esc(label)}</a></td></tr></table>`;
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

/**
 * Sikkerhetsvarsel: innlogging i admin, mange feil koder, ny eller fjernet innloggingsmetode.
 * Viser hva som skjedde, når og fra hvilken enhet, og en lenke som logger ut alle enheter.
 */
export function securityNoticeTemplate(opts: {
  name: string;
  subject: string;
  heading: string;
  intro: string;
  details: [label: string, value: string][];
  revokeUrl: string;
  preheader?: string;
}): Rendered {
  const rows = opts.details
    .map(
      ([label, value]) =>
        `<tr><td style="padding:9px 14px;border-bottom:1px solid ${C.line};color:${C.muted};font-size:13px;width:34%">${esc(label)}</td><td style="padding:9px 14px;border-bottom:1px solid ${C.line};font-weight:600;font-size:14px;color:${C.navy}">${esc(value)}</td></tr>`,
    )
    .join('');
  const html = layout(
    opts.heading,
    `<p>Hei ${esc(opts.name)},</p><p>${esc(opts.intro)}</p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px;border:1px solid ${C.line};border-radius:12px;border-collapse:separate;overflow:hidden">${rows}</table>
     <p style="margin:22px 0 0">Var dette deg? Da trenger du ikke gjøre noe.</p>
     <div style="margin:14px 0 0;padding:16px 18px;border-radius:12px;background:${C.warnBg};border:1px solid #fed7aa">
       <p style="margin:0;font-weight:700;color:${C.warn}">Var det ikke deg?</p>
       <p style="margin:6px 0 0;font-size:14px">Logg ut alle enheter med knappen under, og bytt passord etterpå.</p>
       ${button(opts.revokeUrl, 'Logg ut alle enheter')}
       <p style="margin:0;font-size:12px;color:${C.muted}">Lenken gjelder i 7 dager.</p>
     </div>`,
    { preheader: opts.preheader ?? opts.intro, footer: 'Sikkerhetsvarsel for kontoen din hos AnbudRadar. Disse kan ikke meldes av.' },
  );
  const text = `Hei ${opts.name},\n\n${opts.intro}\n\n${opts.details.map(([l, v]) => `${l}: ${v}`).join('\n')}\n\nVar dette deg? Da trenger du ikke gjøre noe.\n\nVar det ikke deg? Logg ut alle enheter her (gjelder i 7 dager), og bytt passord etterpå:\n${opts.revokeUrl}${textFooter()}`;
  return { subject: opts.subject, html, text };
}

// ---------------------------------------------------------------------------
// Ukesbrevet «Ukens anbud» (uten konto, dobbel bekreftelse)
// ---------------------------------------------------------------------------
export function newsletterConfirmTemplate(topic: string, confirmUrl: string): Rendered {
  const subject = 'Bekreft påmeldingen til Ukens anbud';
  const html = layout(
    subject,
    `<p>Du (eller noen som skrev inn adressen din) ba om å få <strong>Ukens anbud – ${esc(topic)}</strong> på e-post hver mandag.</p>
     ${button(confirmUrl, 'Bekreft påmeldingen')}
     ${note('Ba du ikke om dette? Da kan du se bort fra e-posten – du blir ikke påmeldt, og adressen slettes etter 7 dager.')}`,
    { preheader: 'Ett klikk, så får du ukens nye anbud hver mandag.', footer: 'Du får denne e-posten fordi adressen ble skrevet inn på anbudradar.com.' },
  );
  const text = `Du (eller noen som skrev inn adressen din) ba om å få Ukens anbud – ${topic} hver mandag.\n\nBekreft her:\n${confirmUrl}\n\nBa du ikke om dette, kan du se bort fra e-posten. Du blir ikke påmeldt.${textFooter()}`;
  return { subject, html, text };
}

export interface NewsletterItem {
  title: string;
  url: string;
  meta: string;
}

export function weeklyNewsletterTemplate(opts: {
  topic: string;
  week: number;
  items: NewsletterItem[];
  moreCount: number;
  listUrl: string;
  signupUrl: string;
  unsubscribeUrl: string;
}): Rendered {
  const subject = `Ukens anbud: ${opts.topic} (uke ${opts.week})`;
  const n = opts.items.length + opts.moreCount;
  const intro = n === 1 ? '1 nytt offentlig anbud siste uke.' : `${n} nye offentlige anbud siste uke.`;
  const rows = opts.items
    .map(
      (i) => `<tr><td style="padding:12px 0;border-bottom:1px solid ${C.line}">
        <a href="${esc(i.url)}" style="font-weight:700;color:${C.navy};text-decoration:none;font-size:15px;line-height:1.35">${esc(i.title)}</a>
        <div style="margin-top:4px;font-size:13px;color:${C.muted}">${esc(i.meta)}</div></td></tr>`,
    )
    .join('');
  const html = layout(
    `Ukens anbud: ${opts.topic}`,
    `<p>${esc(intro)}${opts.moreCount ? ` Her er de ${opts.items.length} med nærmest frist.` : ''}</p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
     ${button(opts.listUrl, 'Se alle åpne anbud')}
     <p style="margin:8px 0 0"><strong>Få bare anbudene som passer bedriften</strong> – rangert, med krav, risiko og lønnsomhet for hvert anbud, og varsel med én gang de kommer.
       <a href="${esc(opts.signupUrl)}" style="color:${C.accent};font-weight:700">Prøv AnbudRadar gratis</a>.</p>`,
    {
      preheader: intro,
      footer: 'Du får Ukens anbud fordi du meldte deg på og bekreftet adressen på anbudradar.com. Kunngjøringene er offentlige og hentet fra Doffin og TED.',
      unsubscribeUrl: opts.unsubscribeUrl,
      unsubscribeLabel: 'Meld av Ukens anbud',
    },
  );
  const text = `Ukens anbud: ${opts.topic} (uke ${opts.week})\n\n${intro}\n\n${opts.items.map((i) => `- ${i.title}\n  ${i.meta}\n  ${i.url}`).join('\n\n')}\n\nSe alle åpne anbud: ${opts.listUrl}\nFå bare anbudene som passer bedriften – prøv AnbudRadar gratis: ${opts.signupUrl}\n\n--\n${senderLine()}\nMeld av Ukens anbud: ${opts.unsubscribeUrl}`;
  return { subject, html, text };
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
        `<tr><td style="padding:14px 0;border-bottom:1px solid ${C.line}">
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

export interface TrialEndingInfo {
  /** Er ekte AI slått på? Ellers nevnes ikke AI-analyser (de har aldri vært tilgjengelige). */
  aiReal: boolean;
  /** Kan kundene betale med kort? Ellers inviteres de til å melde interesse. */
  paymentsOpen: boolean;
  /** Åpne anbud som passer profilen nå (rangering 60+). */
  relevantOpen: number;
  /** Lagrede anbud. */
  saved: number;
}

/** Hva prøveperioden har gitt, med tall fra kontoen – bare det som faktisk er der. */
function trialValueLine(i: TrialEndingInfo): string {
  const parts = [
    i.relevantOpen > 0 ? `${i.relevantOpen} åpne anbud som passer profilen akkurat nå` : '',
    i.saved > 0 ? `${i.saved} ${i.saved === 1 ? 'lagret anbud' : 'lagrede anbud'}` : '',
  ].filter(Boolean);
  return parts.length ? `Dere har ${parts.join(' og ')}.` : '';
}

export function trialEndingTemplate(orgName: string, daysLeft: number, billingUrl: string, info: TrialEndingInfo): Rendered {
  const subject = daysLeft <= 1 ? 'Prøveperioden din slutter i morgen' : `Prøveperioden din slutter om ${daysLeft} dager`;
  const stops = info.aiReal ? 'AI-analyser, varsler og personlig rangering' : 'automatiske varsler, personlig rangering og lønnsomhetskalkulatoren';
  const value = trialValueLine(info);
  const next = info.paymentsOpen
    ? { text: 'Velg en plan for å fortsette uten avbrudd. Ingen binding – abonnementet kan sies opp når som helst.', cta: 'Velg plan' }
    : { text: 'Kortbetaling er ikke åpnet ennå. Vil dere fortsette med alt, kan dere melde interesse for en plan – så tar vi kontakt.', cta: 'Meld interesse' };
  const html = layout(
    subject,
    `<p>Prøveperioden for <strong>${esc(orgName)}</strong> slutter snart. Etterpå går kontoen over til gratisplanen, og ${stops} stopper. Lagrede anbud blir liggende.</p>
     ${value ? `<p>${esc(value)}</p>` : ''}
     <p>${esc(next.text)}</p>
     ${button(billingUrl, next.cta)}`,
    { preheader: next.text },
  );
  return {
    subject,
    html,
    text: `Prøveperioden for ${orgName} slutter ${daysLeft <= 1 ? 'i morgen' : `om ${daysLeft} dager`}. Etterpå stopper ${stops}.${value ? `\n${value}` : ''}\n${next.text}\n${next.cta}: ${billingUrl}${textFooter()}`,
  };
}

/** Til eieren av tjenesten: en kunde vil ha en plan mens kortbetaling ikke er åpnet. */
export function planInterestTemplate(orgName: string, planName: string, name: string, email: string): Rendered {
  const subject = `Ønske om plan: ${planName} – ${orgName}`;
  const html = layout(
    'En kunde vil ha en betalt plan',
    `<p><strong>${esc(name || email)}</strong> (${esc(email)}) i <strong>${esc(orgName)}</strong> ønsker planen <strong>${esc(planName)}</strong>.</p>
     <p>Kortbetaling er ikke åpnet. Svar kunden på e-post. Planen kan settes manuelt under Admin → Organisasjoner.</p>`,
    { footer: 'Sendt fra Abonnement i appen.' },
  );
  return { subject, html, text: `${name || email} (${email}) i ${orgName} ønsker planen ${planName}.\nKortbetaling er ikke åpnet. Svar kunden på e-post.` };
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
