import { z } from 'zod';
import { systemSql } from '@/lib/db';
import { env, isProd } from '@/lib/env';
import { rateLimit } from '@/lib/rate-limit';
import { queueEmail } from '@/lib/email';
import { industryListing, marketSnapshot, noticeSpecimen, parseBoardFilter } from '@/domain/tenders/market';
import { fill } from '@/i18n/format';
import { INDUSTRIES } from '@/domain/reference';
import { LOCALES, localePath, MARKETING_PATHS, messages } from '@/i18n';
import { contactNotificationTemplate } from '@/domain/email/templates';
import { zodErrors } from '@/domain/auth/auth';
import { companyInfo, isPlaceholder, LEGAL_DOCS } from '@/domain/legal/legal';
import { HttpError, text, type RequestContext } from '@/server/http';
import { audit } from '@/lib/audit';
import { verifyUnsubscribeToken } from '@/domain/email/unsubscribe';
import { MessagePage, UnsubscribePage } from '@/ui/pages/auth';
import { render } from '@/server/render';
import type { Router } from '@/server/router';
import {
  AboutPage,
  ContactPage,
  CookiesPage,
  DpaPage,
  FeaturesPage,
  HomePage,
  IndustriesPage,
  IndustryPage,
  PricingPage,
  PrivacyPage,
  SecurityPage,
  SubprocessorsPage,
  TermsPage,
} from '@/ui/pages/public';
import { formStr } from './helpers';


export function registerPublicRoutes(router: Router): void {
  router.get('/', 'public', async (ctx) => {
    const t = messages(ctx.locale);
    return render(ctx, <HomePage market={await marketSnapshot()} />, { title: t.meta.homeTitle, description: t.meta.homeDescription });
  });
  router.get('/funksjoner', 'public', async (ctx) =>
    render(ctx, <FeaturesPage specimen={await noticeSpecimen()} />, { title: messages(ctx.locale).meta.features }),
  );
  router.get('/priser', 'public', async (ctx) => render(ctx, <PricingPage />, { title: messages(ctx.locale).meta.pricing }));
  router.get('/bransjer', 'public', async (ctx) => {
    const market = await marketSnapshot();
    const counts = Object.fromEntries(market.industries.map((i) => [i.id, i.n]));
    return render(ctx, <IndustriesPage counts={counts} />, { title: messages(ctx.locale).meta.industries });
  });
  // Én side per bransje med åpne anbud (ekte data) – god å bli funnet på i søkemotorer.
  router.get('/bransjer/:id', 'public', async (ctx) => {
    const t = messages(ctx.locale);
    const filter = parseBoardFilter(ctx.params.id ?? null, ctx.query.get('fylke'));
    if (!filter.industry) throw new HttpError(404, t.errors.notFound);
    const listing = await industryListing(filter.industry, filter.region);
    const name = t.industries.names[filter.industry]?.name ?? filter.industry;
    return render(ctx, <IndustryPage industryId={filter.industry} region={filter.region} listing={listing} />, {
      title: fill(t.industries.pageTitle, { industry: name }),
      description: fill(t.industries.pageDescription, { industry: name }),
    });
  });
  router.get('/om', 'public', async (ctx) => render(ctx, <AboutPage company={companyInfo()} />, { title: messages(ctx.locale).meta.about }));
  router.get('/personvern', 'public', async (ctx) => render(ctx, <PrivacyPage />, { title: 'Personvernerklæring' }));
  router.get('/vilkar', 'public', async (ctx) => render(ctx, <TermsPage />, { title: 'Vilkår for bruk' }));
  router.get('/databehandleravtale', 'public', async (ctx) => render(ctx, <DpaPage />, { title: 'Databehandleravtale' }));
  router.get('/underleverandorer', 'public', async (ctx) => render(ctx, <SubprocessorsPage />, { title: 'Underleverandører' }));
  router.get('/informasjonskapsler', 'public', async (ctx) => render(ctx, <CookiesPage />, { title: 'Informasjonskapsler' }));
  router.get('/sikkerhet', 'public', async (ctx) => render(ctx, <SecurityPage />, { title: 'Sikkerhet' }));
  // RFC 9116: hvor sårbarheter kan meldes. Finnes først når en ekte kontaktadresse er satt.
  router.get('/.well-known/security.txt', 'public', async () => {
    const { email } = companyInfo();
    if (isPlaceholder(email)) throw new HttpError(404, 'Ikke satt opp ennå.');
    const expires = new Date(Date.now() + 365 * 86_400_000).toISOString();
    return text(
      [
        `Contact: mailto:${email}`,
        `Expires: ${expires}`,
        'Preferred-Languages: no, en',
        `Canonical: ${env.APP_URL.replace(/\/$/, '')}/.well-known/security.txt`,
        `Policy: ${env.APP_URL.replace(/\/$/, '')}/sikkerhet`,
        '',
      ].join('\n'),
    );
  });
  router.get('/kontakt', 'public', async (ctx) => render(ctx, <ContactPage />, { title: messages(ctx.locale).meta.contact }));

  router.post('/kontakt', 'public', async (ctx) => {
    const t = messages(ctx.locale);
    const form = await ctx.form();
    const values = { name: formStr(form, 'name', 200), email: formStr(form, 'email', 300), message: formStr(form, 'message', 6000) };
    // Honningkrukke: roboter fyller ut skjulte felt. Svar som om alt gikk bra.
    if (formStr(form, 'website', 200)) return render(ctx, <ContactPage sent />, { title: t.meta.contact });
    if (!(await rateLimit(`contact:${ctx.ipHash}`, 5, 3600))) throw new HttpError(429, t.contact.errors.tooMany);
    const parsed = z
      .object({
        name: z.string().trim().min(1, t.contact.errors.name).max(120),
        email: z.string().trim().email(t.contact.errors.email),
        message: z.string().trim().min(5, t.contact.errors.message).max(5000),
      })
      .safeParse(values);
    if (!parsed.success) return render(ctx, <ContactPage errors={zodErrors(parsed.error)} values={values} />, { title: t.meta.contact, status: 422 });
    await systemSql()`
      insert into reports (kind, name, email, message, user_id) values ('contact', ${parsed.data.name}, ${parsed.data.email}, ${parsed.data.message}, ${ctx.user?.id ?? null})
    `;
    if (env.ADMIN_NOTIFICATION_EMAIL) {
      const tpl = contactNotificationTemplate(parsed.data.name, parsed.data.email, parsed.data.message);
      await queueEmail({ to: env.ADMIN_NOTIFICATION_EMAIL, ...tpl, kind: 'contact' });
    }
    return render(ctx, <ContactPage sent />, { title: t.meta.contact });
  });

  // Avmelding fra varsel-e-post. POST uten CSRF-token er nødvendig for ettklikks-avmelding fra
  // e-postklienter (RFC 8058); den signerte lenken er autorisasjonen.
  const unsubscribe = async (ctx: RequestContext, apply: boolean) => {
    const token = ctx.query.get('t') ?? '';
    const target = verifyUnsubscribeToken(token);
    if (!target) {
      return render(ctx, <MessagePage title="Lenken virker ikke" tone="danger" message="Avmeldingslenken er ugyldig. Logg inn og endre varsler under Varsler." action={{ href: '/app/varsler', label: 'Gå til varsler' }} />, {
        title: 'Avmelding',
        status: 400,
        noindex: true,
      });
    }
    const [org] = (await systemSql()`select name from organizations where id = ${target.orgId}`) as unknown as { name: string }[];
    if (!org) return render(ctx, <MessagePage title="Allerede avsluttet" tone="info" message="Organisasjonen finnes ikke lenger, så du får ingen varsler." />, { title: 'Avmelding', noindex: true });
    if (apply) {
      if (!(await rateLimit(`unsubscribe:${ctx.ipHash}`, 30, 3600))) throw new HttpError(429, 'For mange forespørsler. Prøv igjen senere.');
      await systemSql()`
        insert into notification_preferences (user_id, org_id, email_frequency, weekly_summary)
        select ${target.userId}, ${target.orgId}, 'off', false
        where exists (select 1 from organization_members where user_id = ${target.userId} and org_id = ${target.orgId})
        on conflict (user_id, org_id) do update set email_frequency = 'off', weekly_summary = false
      `;
      await audit({ action: 'notifications.unsubscribed', orgId: target.orgId, actorUserId: target.userId, ipHash: ctx.ipHash });
    }
    return render(ctx, <UnsubscribePage token={token} orgName={org.name} done={apply} />, { title: 'Avmelding', noindex: true });
  };
  router.get('/avmeld', 'public', (ctx) => unsubscribe(ctx, false));
  router.post('/avmeld', 'public', (ctx) => unsubscribe(ctx, true), { csrf: false });

  router.get('/sitemap.xml', 'public', async () => {
    // Markedssidene på alle språk, og de juridiske dokumentene (bare norsk).
    const pages = [...MARKETING_PATHS, ...INDUSTRIES.map((i) => `/bransjer/${i.id}`)];
    const urls = [...LOCALES.flatMap((l) => pages.map((path) => localePath(l, path))), ...LEGAL_DOCS.map((d) => d.href)];
    const base = env.APP_URL.replace(/\/$/, '');
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${base}${u}</loc></url>`).join('')}</urlset>`;
    return text(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  });

}
