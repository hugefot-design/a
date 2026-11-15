import { z } from 'zod';
import { systemSql } from '@/lib/db';
import { env, isProd, paymentsOpen } from '@/lib/env';
import { rateLimit } from '@/lib/rate-limit';
import { queueEmail } from '@/lib/email';
import { countyOverview, industryListing, industryRegionCounts, marketSnapshot, noticeSpecimen, parseBoardFilter } from '@/domain/tenders/market';
import { siteShowcase } from '@/domain/tenders/showcase';
import { industryExpiring } from '@/domain/tenders/expiring';
import { MethodPage } from '@/ui/pages/method';
import { BuyerPage } from '@/ui/pages/buyer';
import { buyerIndex, buyerPath, indexableBuyers, orgNumberFromSlug, publicBuyer } from '@/domain/tenders/buyer-page';
import { BuyersIndexPage } from '@/ui/pages/buyers';
import { demoReport } from '@/domain/intelligence/demo';
import { intelligencePdf } from '@/domain/intelligence/pdf';
import { DemoPage } from '@/ui/pages/demo';
import { quickRanking } from '@/domain/matching/quick';
import { EMPTY_QUICK_CALC, parseQuickCalc, quickCalc, type QuickCalcForm } from '@/domain/profit/quick-calc';
import { shareAbove } from '@/domain/profit/market';
import { CalculatorPage, TryPage } from '@/ui/pages/tools';
import { EMPTY_AWARD_SIM, parseAwardSim, simulateAward, type AwardSimForm } from '@/domain/profit/award-sim';
import { fmtNumber } from '@/domain/profit/calculator';
import { AwardSimPage } from '@/ui/pages/award-sim';
import { PAID_PLANS, PLANS } from '@/domain/billing/plans';
import { indexableTenderIds, publicTender } from '@/domain/tenders/public-page';
import { PublicTenderPage } from '@/ui/pages/tender-public';
import { industryIdFromSlug, industryRegionPath, industrySlugNb, MIN_OPEN_FOR_INDEXING, regionCodeFromSlug, regionPath, REGION_SLUG } from '@/domain/slugs';
import { CountiesPage, CountyPage } from '@/ui/pages/counties';
import { fill, plural } from '@/i18n/format';
import { INDUSTRIES, REGION_BY_CODE, REGIONS } from '@/domain/reference';
import { LOCALES, localePath, MARKETING_PATHS, messages, sourcesText } from '@/i18n';
import { faqItems, faqJsonLd } from '@/ui/marketing';
import { aiModeFor } from '@/domain/ai/provider';
import { liveSources } from '@/domain/tenders/source-status';
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function breadcrumbs(items: [name: string, path: string][]) {
  const base = env.APP_URL.replace(/\/$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: base + path })),
  };
}

/**
 * Spørsmål og svar som strukturerte data (FAQPage) – nøyaktig de samme som vises på forsiden og prissiden for en
 * besøkende (AI og betaling slik de faktisk er slått på).
 */
function faqLd(ctx: RequestContext): unknown {
  const m = messages(ctx.locale);
  const ai = aiModeFor(null);
  return faqJsonLd(
    faqItems(m, {
      days: plural(ctx.locale, m.units.days, env.TRIAL_DAYS),
      sources: sourcesText(m, liveSources(), true),
      aiReal: ai.configured && !ai.isMock,
      paymentsOpen: paymentsOpen(),
    }),
  );
}

export function registerPublicRoutes(router: Router): void {
  router.get('/', 'public', async (ctx) => {
    const t = messages(ctx.locale);
    const [market, showcase] = await Promise.all([marketSnapshot(), siteShowcase()]);
    return render(ctx, <HomePage market={market} showcase={showcase} />, { title: t.meta.homeTitle, description: t.meta.homeDescription, jsonLd: [faqLd(ctx)] });
  });
  // Eksempel på en samlet vurdering av et ekte, åpent anbud (bare norsk – appen og rapporten er på norsk).
  router.get('/eksempel', 'public', async (ctx) => {
    const demo = await demoReport();
    return render(ctx, <DemoPage demo={demo} />, {
      title: 'Eksempel: et ekte anbud, vurdert',
      description: 'Se en ekte, åpen kunngjøring vurdert av AnbudRadar: om den passer, hva som kan gi avvisning, kostbare vilkår og hva lignende kontrakter ble tildelt for.',
      canonical: '/eksempel',
      noindex: !demo,
    });
  });
  router.get('/eksempel/rapport.pdf', 'public', async (ctx) => {
    if (!(await rateLimit(`demo-pdf:${ctx.ipHash}`, 20, 3600))) throw new HttpError(429, 'For mange nedlastinger. Prøv igjen om litt.');
    const demo = await demoReport();
    if (!demo) throw new HttpError(404, 'Eksempelet er ikke klart akkurat nå.');
    const pdf = await intelligencePdf(demo.report, { orgName: 'en eksempelbedrift (ikke en ekte kunde)' });
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="anbudradar-eksempel.pdf"',
        'Cache-Control': 'public, max-age=600',
      },
    });
  });
  // Offentlig side per anbud – til deling, ukesbrevet og søk. Bare åpne anbud med nok tekst indekseres (ingen tynne sider).
  router.get('/anbud/:id', 'public', async (ctx) => {
    const id = ctx.params.id ?? '';
    if (!env.PUBLIC_TENDER_PAGES || !UUID.test(id)) throw new HttpError(404, 'Fant ikke anbudet.');
    const t = await publicTender(id);
    if (!t) throw new HttpError(404, 'Fant ikke anbudet.');
    const industry = t.industries[0];
    const deadline = t.deadlineAt ? ` Frist ${new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' }).format(t.deadlineAt)}.` : '';
    return render(ctx, <PublicTenderPage t={t} origin={new URL(env.APP_URL).origin} />, {
      title: `${t.title}${t.buyerName ? ` – ${t.buyerName}` : ''}`.slice(0, 150),
      description: `${t.status === 'open' ? 'Åpent anbud' : 'Anbud'}${t.buyerName ? ` fra ${t.buyerName}` : ''}.${deadline} Se krav, avvisningsgrunner og kostbare vilkår fra kunngjøringen – og om det passer dere.`.slice(0, 300),
      canonical: `/anbud/${t.id}`,
      noindex: !t.indexable,
      jsonLd: industry ? [breadcrumbs([['Bransjer', '/bransjer'], [industry.name, `/bransjer/${industrySlugNb(industry.id)}`], [t.title, `/anbud/${t.id}`]])] : [],
    });
  });

  // Offentlig side per oppdragsgiver (bare norsk). Adressen slutter på organisasjonsnummeret; feil navn sendes videre.
  router.get('/oppdragsgiver/:slug', 'public', async (ctx) => {
    if (!env.PUBLIC_BUYER_PAGES || ctx.locale !== 'nb') throw new HttpError(404, messages(ctx.locale).errors.notFound);
    const org = orgNumberFromSlug(ctx.params.slug ?? '');
    const b = org ? await publicBuyer(org) : null;
    if (!b) throw new HttpError(404, messages(ctx.locale).errors.notFound);
    if (`/oppdragsgiver/${ctx.params.slug}` !== b.path) return redirect(withUtm(ctx, b.path), 301);
    return render(ctx, <BuyerPage b={b} />, {
      title: `Anbud fra ${b.name}`,
      description: `${b.open === 1 ? '1 åpent anbud' : `${b.open} åpne anbud`} fra ${b.name}, med frister. Se hva de kjøper mest og kontrakter som snart utløper. Oppdateres flere ganger i døgnet fra Doffin og TED.`,
      canonical: b.path,
      noindex: !b.indexable,
    });
  });

  // Oversikten over oppdragsgivere (bare norsk): de samme som står i nettstedskartet – ingen tynne sider.
  router.get('/oppdragsgivere', 'public', async (ctx) => {
    if (!env.PUBLIC_BUYER_PAGES || ctx.locale !== 'nb') throw new HttpError(404, messages(ctx.locale).errors.notFound);
    const buyers = await buyerIndex();
    return render(ctx, <BuyersIndexPage buyers={buyers} />, {
      title: 'Oppdragsgivere: hvem kjøper hva',
      description: `${buyers.length} offentlige oppdragsgivere med åpne anbud nå. Se hva hver av dem kjøper mest, åpne anbud og kontrakter som snart utløper. Oppdateres flere ganger i døgnet fra Doffin og TED.`,
      canonical: '/oppdragsgivere',
      noindex: buyers.length === 0,
    });
  });

  // Åpen metode: reglene bak treff, merking, markedspris, lønnsomhet og utløp (bare norsk).
  router.get('/metode', 'public', async (ctx) =>
    render(ctx, <MethodPage />, {
      title: 'Slik regner vi: treff, markedspris og lønnsomhet',
      description: 'Åpen metode: hvordan AnbudRadar regner treffpoeng, markedspris og lønnsomhet, hva hvert punkt bygger på – og hva vi ikke vet.',
      canonical: '/metode',
    }),
  );

  // Verktøy uten konto. Ingenting lagres – verken valgene, ordene eller tallene besøkende skriver inn.
  router.get('/prov', 'public', async (ctx) => {
    if (!env.PUBLIC_TOOLS) throw new HttpError(404, messages(ctx.locale).errors.notFound);
    const filter = parseBoardFilter(ctx.query.get('bransje'), ctx.query.get('fylke'));
    const values = { industry: filter.industry ?? '', region: filter.region ?? '', words: (ctx.query.get('ord') ?? '').slice(0, 200) };
    // Rangeringen regner på flere hundre anbud – begrenses per besøkende.
    const limited = Boolean(values.industry) && !(await rateLimit(`prov:${ctx.ipHash}`, 40, 600));
    const result = values.industry && !limited ? await quickRanking(values) : null;
    return render(ctx, <TryPage values={values} result={result} limited={limited} />, {
      title: 'Prøv uten konto: anbudene som passer dere',
      description: 'Velg bransje og fylke og se de åpne offentlige anbudene som passer best – rangert med begrunnelse, uten konto. Ingenting lagres.',
      canonical: '/prov',
      // Selve verktøyet indekseres; hvert enkelt resultat gjør det ikke.
      noindex: ctx.url.search.length > 0,
      status: limited ? 429 : 200,
    });
  });

  const calculator = async (ctx: RequestContext, post: boolean) => {
    if (!env.PUBLIC_TOOLS) throw new HttpError(404, messages(ctx.locale).errors.notFound);
    const id = ctx.query.get('anbud') ?? '';
    // Uten anbudet (ukjent, eller en feil ved henting) virker kalkulatoren som vanlig.
    const tender = env.PUBLIC_TENDER_PAGES && UUID.test(id) ? await publicTender(id).catch(() => null) : null;
    const meta = {
      title: 'Lønnsomhetssjekk: lønner anbudet seg?',
      description: 'Gratis kalkulator uten konto: legg inn timer og kostnader og se selvkost, prisen for ønsket margin og hva dere sitter igjen med ved kontraktsverdien.',
      canonical: '/kalkulator',
      noindex: ctx.url.search.length > 0,
    };
    if (!post) return render(ctx, <CalculatorPage form={EMPTY_QUICK_CALC} result={null} tender={tender} market={null} />, meta);
    if (!(await rateLimit(`kalkulator:${ctx.ipHash}`, 60, 600))) throw new HttpError(429, 'For mange utregninger på kort tid. Prøv igjen om litt.');
    const f = await ctx.form();
    const form = Object.fromEntries((Object.keys(EMPTY_QUICK_CALC) as (keyof QuickCalcForm)[]).map((k) => [k, formStr(f, k, 40)])) as unknown as QuickCalcForm;
    const parsed = parseQuickCalc(form);
    if (!parsed.ok) return render(ctx, <CalculatorPage form={form} errors={parsed.errors} result={null} tender={tender} market={null} />, { ...meta, status: 422 });
    // Kalkulatoren regner i kroner: anslått verdi og tildelinger i annen valuta brukes ikke.
    const nok = tender?.currency === 'NOK';
    const result = quickCalc(parsed.input, { value: nok ? (tender?.estimatedValue ?? null) : null, isFramework: tender?.isFramework ?? false });
    const target = result.calc.targetPrice;
    const mk = tender?.market && tender.market.currency === 'NOK' ? tender.market : null;
    const market =
      mk && target !== null
        ? { label: mk.label, n: mk.n, values: mk.values, band: { p25: mk.p25, median: mk.median, p75: mk.p75 }, cheaperThanPct: tender!.marketAll.length ? shareAbove(tender!.marketAll, target) : null }
        : null;
    return render(ctx, <CalculatorPage form={form} result={result} tender={tender} market={market} />, meta);
  };
  router.get('/kalkulator', 'public', (ctx) => calculator(ctx, false));
  router.post('/kalkulator', 'public', (ctx) => calculator(ctx, true));

  // Tildelingssimulatoren: samme mønster som kalkulatoren – bare norsk, ingenting lagres, grense per besøkende.
  const awardSim = async (ctx: RequestContext, post: boolean) => {
    if (!env.PUBLIC_TOOLS) throw new HttpError(404, messages(ctx.locale).errors.notFound);
    const id = ctx.query.get('anbud') ?? '';
    const tender = env.PUBLIC_TENDER_PAGES && UUID.test(id) ? await publicTender(id).catch(() => null) : null;
    const meta = {
      title: 'Tildelingssimulator: hvor mye dyrere kan dere være?',
      description: 'Gratis, uten konto: legg inn vekten på pris, prisene og kvalitetspoengene og se hvem som vinner – og prisen der dere står likt. DFØs prismodeller. Ingenting lagres.',
      canonical: '/tildeling',
      noindex: ctx.url.search.length > 0,
    };
    if (!post) {
      // Vekten på pris fylles inn fra kunngjøringen når den kan leses sikkert.
      const w = tender?.awardWeights;
      return render(ctx, <AwardSimPage form={w ? { ...EMPTY_AWARD_SIM, pricePct: fmtNumber(w.pricePct) } : EMPTY_AWARD_SIM} result={null} tender={tender} />, meta);
    }
    if (!(await rateLimit(`tildeling:${ctx.ipHash}`, 60, 600))) throw new HttpError(429, 'For mange utregninger på kort tid. Prøv igjen om litt.');
    const f = await ctx.form();
    const form = Object.fromEntries((Object.keys(EMPTY_AWARD_SIM) as (keyof AwardSimForm)[]).map((k) => [k, formStr(f, k, 40)])) as unknown as AwardSimForm;
    const parsed = parseAwardSim(form);
    if (!parsed.ok) return render(ctx, <AwardSimPage form={form} errors={parsed.errors} result={null} tender={tender} />, { ...meta, status: 422 });
    return render(ctx, <AwardSimPage form={form} result={simulateAward(parsed.input)} tender={tender} />, meta);
  };
  router.get('/tildeling', 'public', (ctx) => awardSim(ctx, false));
  router.post('/tildeling', 'public', (ctx) => awardSim(ctx, true));

  router.get('/funksjoner', 'public', async (ctx) =>
    render(ctx, <FeaturesPage specimen={await noticeSpecimen()} />, { title: messages(ctx.locale).meta.features, description: messages(ctx.locale).meta.featuresDescription }),
  );
  router.get('/priser', 'public', async (ctx) => {
    const t = messages(ctx.locale);
    const from = Math.min(...PAID_PLANS.map((p) => PLANS[p].priceNok ?? Number.POSITIVE_INFINITY));
    return render(ctx, <PricingPage />, { title: t.meta.pricing, description: fill(t.meta.pricingDescription, { price: from }), jsonLd: [faqLd(ctx)] });
  });
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
    const [listing, expiring] = await Promise.all([industryListing(industry, region), industryExpiring(industry, region)]);
    const name = t.industries.names[industry]?.name ?? industry;
    return render(ctx, <IndustryPage industryId={industry} region={region} listing={listing} expiring={expiring} />, {
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
    const [listing, expiring] = await Promise.all([industryListing(industry, region), industryExpiring(industry, region)]);
    const name = t.industries.names[industry]?.name ?? industry;
    const county = REGION_BY_CODE.get(region)!.name;
    return render(ctx, <IndustryPage industryId={industry} region={region} listing={listing} expiring={expiring} />, {
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

  // robots.txt med lenke til nettstedskartet (adressen følger APP_URL). Appen, API-et og admin holdes utenfor.
  router.get('/robots.txt', 'public', async () =>
    text(`User-agent: *\nDisallow: /app\nDisallow: /api\nAllow: /\n\nSitemap: ${env.APP_URL.replace(/\/$/, '')}/sitemap.xml\n`, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }),
  );
  router.get('/sitemap.xml', 'public', async () => {
    // Markedssidene på alle språk, de juridiske dokumentene, og (bare norsk) fylkessidene og bransje per fylke
    // når det er nok åpne anbud til at siden er nyttig.
    const pages = [...MARKETING_PATHS, ...INDUSTRIES.map((i) => `/bransjer/${industrySlugNb(i.id)}`)];
    // De tre oppslagene er uavhengige – kjøres samtidig.
    const [combos, tenderIds, buyerRows] = await Promise.all([
      industryRegionCounts(),
      env.PUBLIC_TENDER_PAGES ? indexableTenderIds() : Promise.resolve([] as string[]),
      env.PUBLIC_BUYER_PAGES ? indexableBuyers() : Promise.resolve([] as { name: string; orgNumber: string }[]),
    ]);
    const norwegianOnly = [
      '/eksempel',
      '/metode',
      ...(env.PUBLIC_TOOLS ? ['/prov', '/kalkulator', '/tildeling'] : []),
      ...(env.PUBLIC_BUYER_PAGES ? ['/oppdragsgivere'] : []),
      '/fylker',
      ...REGIONS.map((r) => regionPath(r.code)),
      ...INDUSTRIES.flatMap((i) => REGIONS.filter((r) => (combos.get(`${i.id}|${r.code}`) ?? 0) >= MIN_OPEN_FOR_INDEXING).map((r) => industryRegionPath(i.id, r.code))),
    ];
    const tenders = tenderIds.map((id) => `/anbud/${id}`);
    const buyers = buyerRows.map((b) => buyerPath(b.name, b.orgNumber));
    const urls = [...LOCALES.flatMap((l) => pages.map((path) => localePath(l, path))), ...norwegianOnly, ...LEGAL_DOCS.map((d) => d.href), ...tenders, ...buyers];
    const base = env.APP_URL.replace(/\/$/, '');
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${base}${u}</loc></url>`).join('')}</urlset>`;
    return text(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  });

}
