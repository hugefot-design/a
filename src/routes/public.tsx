import { z } from 'zod';
import { systemSql } from '@/lib/db';
import { env, isProd } from '@/lib/env';
import { rateLimit } from '@/lib/rate-limit';
import { queueEmail } from '@/lib/email';
import { CERTIFICATIONS } from '@/domain/reference';
import { coverageStats } from '@/domain/tenders/queries';
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
  PricingPage,
  PrivacyPage,
  SecurityPage,
  SubprocessorsPage,
  TermsPage,
  type Specimen,
} from '@/ui/pages/public';
import { formStr } from './helpers';


let specimenCache: { at: number; value: Specimen | null } | null = null;

/** En åpen kunngjøring fra databasen til forsiden (ekte data; eksempeldata kun utenfor produksjon). */
async function loadSpecimen(): Promise<Specimen | null> {
  if (specimenCache && Date.now() - specimenCache.at < 10 * 60_000) return specimenCache.value;
  const sql = systemSql();
  const rows = (await sql`
    select id, title, buyer_name, deadline_at, deadline_time_known, estimated_value, currency, description, is_sample
    from tenders t
    where t.lifecycle = 'competition' and t.deadline_at > now() + interval '5 days' and t.estimated_value is not null
      ${isProd ? sql`and not t.is_sample` : sql``}
    order by t.is_sample asc, t.first_seen_at desc
    limit 20
  `) as unknown as (Omit<Specimen, 'requirement'> & { description: string | null })[];
  let pick: Specimen | null = null;
  for (const r of rows) {
    const text = `${r.title} ${r.description ?? ''}`;
    const cert = CERTIFICATIONS.find((c) => c.patterns.some((p) => p.test(text)));
    const candidate: Specimen = { ...r, requirement: cert ? cert.label : null };
    if (!pick || (cert && !pick.requirement)) pick = candidate;
    if (pick.requirement) break;
  }
  specimenCache = { at: Date.now(), value: pick };
  return pick;
}

export function registerPublicRoutes(router: Router): void {
  router.get('/', 'public', async (ctx) => {
    const [specimen, coverage] = await Promise.all([loadSpecimen(), coverageStats(systemSql())]);
    return render(ctx, <HomePage specimen={specimen} coverage={coverage} />, {
      title: 'Offentlige anbud for norske bedrifter',
      description: 'Finn, forstå og svar på offentlige anbud. AnbudRadar rangerer kunngjøringer etter hva bedriften leverer og forklarer kravene med kildehenvisning.',
    });
  });
  router.get('/funksjoner', 'public', async (ctx) => render(ctx, <FeaturesPage />, { title: 'Funksjoner' }));
  router.get('/priser', 'public', async (ctx) => render(ctx, <PricingPage />, { title: 'Priser' }));
  router.get('/bransjer', 'public', async (ctx) => render(ctx, <IndustriesPage />, { title: 'Bransjer' }));
  router.get('/om', 'public', async (ctx) => render(ctx, <AboutPage company={companyInfo()} />, { title: 'Om oss' }));
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
  router.get('/kontakt', 'public', async (ctx) => render(ctx, <ContactPage />, { title: 'Kontakt' }));

  router.post('/kontakt', 'public', async (ctx) => {
    const form = await ctx.form();
    const values = { name: formStr(form, 'name', 200), email: formStr(form, 'email', 300), message: formStr(form, 'message', 6000) };
    // Honningkrukke: roboter fyller ut skjulte felt. Svar som om alt gikk bra.
    if (formStr(form, 'website', 200)) return render(ctx, <ContactPage sent />, { title: 'Kontakt' });
    if (!(await rateLimit(`contact:${ctx.ipHash}`, 5, 3600))) throw new HttpError(429, 'For mange meldinger. Prøv igjen senere.');
    const parsed = z
      .object({
        name: z.string().trim().min(1, 'Skriv inn navnet ditt.').max(120),
        email: z.string().trim().email('Skriv inn en gyldig e-postadresse.'),
        message: z.string().trim().min(5, 'Skriv en melding.').max(5000),
      })
      .safeParse(values);
    if (!parsed.success) return render(ctx, <ContactPage errors={zodErrors(parsed.error)} values={values} />, { title: 'Kontakt', status: 422 });
    await systemSql()`
      insert into reports (kind, name, email, message, user_id) values ('contact', ${parsed.data.name}, ${parsed.data.email}, ${parsed.data.message}, ${ctx.user?.id ?? null})
    `;
    if (env.ADMIN_NOTIFICATION_EMAIL) {
      const tpl = contactNotificationTemplate(parsed.data.name, parsed.data.email, parsed.data.message);
      await queueEmail({ to: env.ADMIN_NOTIFICATION_EMAIL, ...tpl, kind: 'contact' });
    }
    return render(ctx, <ContactPage sent />, { title: 'Kontakt' });
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
    const urls = ['/', '/funksjoner', '/priser', '/bransjer', '/om', '/kontakt', ...LEGAL_DOCS.map((d) => d.href)];
    const base = env.APP_URL.replace(/\/$/, '');
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${base}${u}</loc></url>`).join('')}</urlset>`;
    return text(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  });

}
