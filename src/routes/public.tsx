import { z } from 'zod';
import { systemSql } from '@/lib/db';
import { env, isProd } from '@/lib/env';
import { rateLimit } from '@/lib/rate-limit';
import { queueEmail } from '@/lib/email';
import { countyOverview, industryListing, industryRegionCounts, marketSnapshot, noticeSpecimen } from '@/domain/tenders/market';
import { industryIdFromSlug, industryRegionPath, industrySlugNb, MIN_OPEN_FOR_INDEXING, regionCodeFromSlug, regionPath, REGION_SLUG } from '@/domain/slugs';
import { CountiesPage, CountyPage } from '@/ui/pages/counties';
import { fill } from '@/i18n/format';
import { INDUSTRIES, REGION_BY_CODE, REGIONS } from '@/domain/reference';
import { LOCALES, localePath, MARKETING_PATHS, messages } from '@/i18n';
import { contactNotificationTemplate } from '@/domain/email/templates';
import { zodErrors } from '@/domain/auth/auth';
import { companyInfo, isPlaceholder, LEGAL_DOCS } from '@/domain/legal/legal';
import { HttpError, redirect, text, type RequestContext } from '@/server/http';
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


/** «12 åpne offentlige anbud» / «1 åpent offentlig anbud». */
function openText(n: number): string {
  return n === 1 ? '1 åpent offentlig anbud' : `${n.toLocaleString('nb-NO')} åpne offentlige anbud`;
}

/** «Bygg og anlegg» → «bygg og anlegg», men «IT og programvare» beholdes. */
function lowerFirst(name: string): string {
  const first = name.split(' ')[0] ?? '';
  return first.length > 1 && first === first.toUpperCase() ? name : name.charAt(0).toLowerCase() + name.slice(1);
}

/** Behold kilden (utm_source) når en gammel adresse sendes videre, så besøkstellingen blir riktig. */
function withUtm(ctx: RequestContext, path: string): string {
  const utm = ctx.query.get('utm_source');
  return utm ? `${path}?utm_source=${encodeURIComponent(utm.slice(0, 40))}` : path;
}

/** Brødsmuler for Google (schema.org/BreadcrumbList). */
function breadcrumbs(items: [name: string, path: string][]) {
  const base = env.APP_URL.replace(/\/$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: base + path })),
  };
}

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
    return render(ctx, <IndustriesPage counts={counts} regions={market.regions} />, { title: messages(ctx.locale).meta.industries });
  });
  // Én side per bransje med åpne anbud (ekte data) – god å bli funnet på i søkemotorer.
  // Norsk adresse er /bransjer/renhold; gamle engelske adresser og ?fylke= sendes videre (301).
  router.get('/bransjer/:id', 'public', async (ctx) => {
    const t = messages(ctx.locale);
    const industry = industryIdFromSlug(ctx.params.id);
    if (!industry) throw new HttpError(404, t.errors.notFound);
    const fylke = ctx.query.get('fylke');
    const region = fylke && Object.hasOwn(REGION_SLUG, fylke) ? fylke : null;
    if (ctx.locale === 'nb' && (ctx.params.id !== industrySlugNb(industry) || region)) {
      return redirect(withUtm(ctx, region ? industryRegionPath(industry, region) : `/bransjer/${industrySlugNb(industry)}`), 301);
    }
    const listing = await industryListing(industry, region);
    const name = t.industries.names[industry]?.name ?? industry;
    return render(ctx, <IndustryPage industryId={industry} region={region} listing={listing} />, {
      title: fill(t.industries.pageTitle, { industry: name }),
      description: fill(t.industries.pageDescription, { industry: name }),
    });
  });
  // Bransje i ett fylke (bare norsk): /bransjer/renhold/trondelag. Tynne sider (få anbud) holdes utenfor Google.
  router.get('/bransjer/:id/:fylke', 'public', async (ctx) => {
    const t = messages(ctx.locale);
    const industry = industryIdFromSlug(ctx.params.id);
    const region = regionCodeFromSlug(ctx.params.fylke);
    if (!industry || !region || ctx.locale !== 'nb') throw new HttpError(404, t.errors.notFound);
    const path = industryRegionPath(industry, region);
    if (ctx.params.id !== industrySlugNb(industry)) return redirect(withUtm(ctx, path), 301);
    const listing = await industryListing(industry, region);
    const name = t.industries.names[industry]?.name ?? industry;
    const county = REGION_BY_CODE.get(region)!.name;
    return render(ctx, <IndustryPage industryId={industry} region={region} listing={listing} />, {
      title: `Anbud: ${name} i ${county}`,
      description: `${openText(listing.open)} innen ${lowerFirst(name)} i ${county}, med frister og oppdragsgivere. Oppdateres flere ganger i døgnet fra Doffin og TED. Få varsel om nye anbud.`,
      canonical: path,
      noindex: listing.open < MIN_OPEN_FOR_INDEXING,
      jsonLd: [breadcrumbs([['Bransjer', '/bransjer'], [name, `/bransjer/${industrySlugNb(industry)}`], [county, path]])],
    });
  });
  router.get('/fylker', 'public', async (ctx) => {
    if (ctx.locale !== 'nb') throw new HttpError(404, messages(ctx.locale).errors.notFound);
    const market = await marketSnapshot();
    return render(ctx, <CountiesPage regions={market.regions} open={market.open} />, {
      title: 'Offentlige anbud per fylke',
      description: 'Åpne offentlige anbud i alle fylker – Oslo, Akershus, Vestland, Trøndelag og resten av landet – med frister og oppdragsgivere. Oppdateres flere ganger i døgnet fra Doffin og TED.',
      canonical: '/fylker',
      jsonLd: [breadcrumbs([['Fylker', '/fylker']])],
    });
  });
  router.get('/fylker/:fylke', 'public', async (ctx) => {
    const region = regionCodeFromSlug(ctx.params.fylke);
    if (!region || ctx.locale !== 'nb') throw new HttpError(404, messages(ctx.locale).errors.notFound);
    const overview = await countyOverview(region);
    const county = REGION_BY_CODE.get(region)!.name;
    return render(ctx, <CountyPage region={region} overview={overview} />, {
      title: `Offentlige anbud i ${county}`,
      description: `${openText(overview.open)} i ${county} akkurat nå, fordelt på bransjer, med frister og oppdragsgivere. Oppdateres flere ganger i døgnet fra Doffin og TED.`,
      canonical: regionPath(region),
      noindex: overview.open === 0,
      jsonLd: [breadcrumbs([['Fylker', '/fylker'], [county, regionPath(region)]])],
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
    // Markedssidene på alle språk, de juridiske dokumentene, og (bare norsk) fylkessidene og bransje per fylke
    // når det er nok åpne anbud til at siden er nyttig.
    const pages = [...MARKETING_PATHS, ...INDUSTRIES.map((i) => `/bransjer/${industrySlugNb(i.id)}`)];
    const combos = await industryRegionCounts();
    const norwegianOnly = [
      '/fylker',
      ...REGIONS.map((r) => regionPath(r.code)),
      ...INDUSTRIES.flatMap((i) => REGIONS.filter((r) => (combos.get(`${i.id}|${r.code}`) ?? 0) >= MIN_OPEN_FOR_INDEXING).map((r) => industryRegionPath(i.id, r.code))),
    ];
    const urls = [...LOCALES.flatMap((l) => pages.map((path) => localePath(l, path))), ...norwegianOnly, ...LEGAL_DOCS.map((d) => d.href)];
    const base = env.APP_URL.replace(/\/$/, '');
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${base}${u}</loc></url>`).join('')}</urlset>`;
    return text(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  });

}
