/**
 * Ukesbrevet «Ukens anbud»: påmelding (/ukesbrev), bekreftelse og avmelding.
 * Samme skjema og samme lenker brukes for å følge en oppdragsgiver (feltet «oppdragsgiver» med organisasjonsnummeret).
 * Avmelding godtar POST uten CSRF-token (ettklikks-avmelding fra e-postprogrammer, RFC 8058);
 * den signerte lenken er autorisasjonen.
 */
import { rateLimit } from '@/lib/rate-limit';
import { confirmSubscription, findSubscription, subscribe, subscribeBuyer, subscriptionPath, subscriptionTopic, unsubscribe, verifyLink } from '@/domain/newsletter/newsletter';
import { HttpError, safeRedirectPath, type RequestContext } from '@/server/http';
import { render } from '@/server/render';
import type { Router } from '@/server/router';
import { MessagePage } from '@/ui/pages/auth';
import { NewsletterUnsubscribePage } from '@/ui/pages/newsletter';
import { formStr } from './helpers';

const page = (ctx: RequestContext, title: string, tone: 'ok' | 'danger' | 'info', message: string, status = 200, action?: { href: string; label: string }) =>
  render(ctx, <MessagePage title={title} tone={tone} message={message} action={action} />, { title, status, noindex: true });

const invalidLink = (ctx: RequestContext) =>
  page(ctx, 'Lenken virker ikke', 'danger', 'Lenken er ugyldig eller ufullstendig. Prøv å kopiere hele lenken fra e-posten.', 400, { href: '/fylker', label: 'Se åpne anbud' });

export function registerNewsletterRoutes(router: Router): void {
  router.post('/ukesbrev', 'public', async (ctx) => {
    const form = await ctx.form();
    const back = safeRedirectPath(formStr(form, 'kilde', 200), '/fylker');
    const done = (email: string, topic: string) =>
      page(ctx, 'Sjekk e-posten din', 'ok', `Vi har sendt en lenke til ${email}. Trykk på den for å bekrefte – først da får du Ukens anbud: ${topic}. Finner du den ikke, se i søppelpost.`, 200, {
        href: back,
        label: 'Tilbake',
      });
    // Roboter fyller ut det skjulte feltet: samme svar, men ingenting skjer.
    if (formStr(form, 'nettside', 200)) return done(formStr(form, 'email', 254), 'Ukens anbud');
    const orgNumber = formStr(form, 'oppdragsgiver', 20);
    const res = orgNumber
      ? await subscribeBuyer({ email: formStr(form, 'email', 254), orgNumber, sourcePath: back, ipHash: ctx.ipHash })
      : await subscribe({
          email: formStr(form, 'email', 254),
          industry: formStr(form, 'bransje', 40),
          region: formStr(form, 'fylke', 4) || null,
          sourcePath: back,
          ipHash: ctx.ipHash,
        });
    if (!res.ok && res.status === 404) throw new HttpError(404, 'Siden finnes ikke.');
    if (!res.ok) return page(ctx, 'Påmeldingen ble ikke registrert', 'danger', res.error, res.status, { href: back, label: 'Prøv igjen' });
    return done(res.email, res.topic);
  });

  router.get('/ukesbrev/bekreft', 'public', async (ctx) => {
    const id = verifyLink('confirm', ctx.query.get('id'), ctx.query.get('t'));
    if (!id) return invalidLink(ctx);
    const sub = await confirmSubscription(id);
    if (!sub) return page(ctx, 'Påmeldingen finnes ikke', 'info', 'Påmeldingen er utløpt eller meldt av. Du kan melde deg på igjen på en av bransje- eller fylkessidene.', 404, { href: '/fylker', label: 'Se åpne anbud' });
    const when = sub.buyer ? 'mandag morgen de ukene det er nye anbud derfra' : 'hver mandag morgen';
    return page(ctx, 'Du er påmeldt', 'ok', `Du får Ukens anbud – ${subscriptionTopic(sub)} – ${when}. Hver e-post har en lenke for å melde deg av.`, 200, {
      href: `${subscriptionPath(sub)}?utm_source=ukesbrev`,
      label: 'Se åpne anbud nå',
    });
  });

  const unsubscribeHandler = async (ctx: RequestContext, apply: boolean) => {
    const id = verifyLink('unsubscribe', ctx.query.get('id'), ctx.query.get('t'));
    if (!id) return invalidLink(ctx);
    if (!apply) {
      const sub = await findSubscription(id);
      if (!sub) return page(ctx, 'Du er allerede meldt av', 'info', 'Adressen står ikke lenger på listen for Ukens anbud.');
      return render(ctx, <NewsletterUnsubscribePage action={`/ukesbrev/avmeld?id=${encodeURIComponent(id)}&t=${encodeURIComponent(ctx.query.get('t') ?? '')}`} topic={subscriptionTopic(sub)} />, {
        title: 'Meld av Ukens anbud',
        noindex: true,
      });
    }
    if (!(await rateLimit(`newsletter-unsub:${ctx.ipHash}`, 30, 3600))) throw new HttpError(429, 'For mange forespørsler. Prøv igjen senere.');
    const topic = await unsubscribe(id);
    return page(ctx, 'Du er meldt av', 'ok', topic ? `Du får ikke lenger Ukens anbud – ${topic}. Vi har slettet adressen din fra listen.` : 'Adressen står ikke lenger på listen for Ukens anbud.');
  };
  router.get('/ukesbrev/avmeld', 'public', (ctx) => unsubscribeHandler(ctx, false));
  router.post('/ukesbrev/avmeld', 'public', (ctx) => unsubscribeHandler(ctx, true), { csrf: false });
}
