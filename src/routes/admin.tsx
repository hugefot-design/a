import { systemSql } from '@/lib/db';
import { env, integrationStatus } from '@/lib/env';
import { audit } from '@/lib/audit';
import { enqueueJob } from '@/lib/jobs';
import { listOrganizations, listUsers, organizationDetail, systemHealth } from '@/domain/admin/admin';
import { adminOverview } from '@/domain/admin/overview';
import { visitStats } from '@/domain/admin/visits';
import { listAppErrors, resolveAllAppErrors, resolveAppError } from '@/domain/ops/errors';
import { adminProductContext } from '@/domain/admin/products';
import { customerJourney } from '@/domain/admin/journey';
import { linkedinPost, weeklyTopics } from '@/domain/admin/linkedin';
import { INDUSTRY_BY_ID, REGION_BY_CODE } from '@/domain/reference';
import { setManualPlan, verifyStripePrices, type PriceCheck } from '@/domain/billing/stripe';
import { PLANS, type PlanId } from '@/domain/billing/plans';
import { CONNECTORS } from '@/connectors';
import { enrichmentOverview } from '@/connectors/doffin-enrich';
import { parseImportFile } from '@/connectors/manual';
import { finishImportRun, ingestNotices, recordImportError, startImportRun } from '@/domain/tenders/ingest';
import { redirectWith } from '@/server/flash';
import { HttpError } from '@/server/http';
import { render } from '@/server/render';
import type { Router } from '@/server/router';
import { AdminOverviewPage } from '@/ui/pages/admin-overview';
import { AdminVisitsPage } from '@/ui/pages/admin-visits';
import { AdminLinkedinPage } from '@/ui/pages/admin-linkedin';
import { AdminErrorsPage } from '@/ui/pages/admin-errors';
import { AdminProductsPage } from '@/ui/pages/admin-products';
import { AdminJourneyPage } from '@/ui/pages/admin-journey';
import {
  AdminHealthPage,
  AdminImportsPage,
  AdminListPage,
  AdminOrgPage,
  AdminOrgsPage,
  AdminSourcesPage,
  AdminUsersPage,
} from '@/ui/pages/admin';
import { Badge, Button, PostForm } from '@/ui/components';
import { formatDateTime } from '@/ui/format';
import { formStr, param } from './helpers';

async function sourceRows() {
  const rows = (await systemSql()`select id, name, enabled, verified_live, last_success_at, last_error, notes from data_sources order by id`) as unknown as {
    id: string;
    name: string;
    enabled: boolean;
    verifiedLive: boolean;
    lastSuccessAt: Date | null;
    lastError: string | null;
    notes: string | null;
  }[];
  return rows.map((r) => {
    const connector = CONNECTORS[r.id as 'ted' | 'doffin'];
    const status = connector ? connector.status() : { configured: true, message: r.id === 'manual' ? 'Opplasting i admin' : 'Kun utvikling' };
    return { ...r, ...status };
  });
}

/**
 * Viktige endringer: krever at totrinn er bekreftet de siste 15 minuttene (ellers /konto/bekreft).
 * Resten av admin krever bekreftelse de siste 12 timene.
 */
const SENSITIVE = { sensitive: true } as const;

export function registerAdminRoutes(router: Router): void {
  router.get('/admin', 'admin', async (ctx) => render(ctx, <AdminOverviewPage o={await adminOverview()} />, { title: 'Admin – oversikt' }));

  router.get('/admin/besok', 'admin', async (ctx) => render(ctx, <AdminVisitsPage v={await visitStats()} />, { title: 'Besøk' }));

  router.get('/admin/linkedin', 'admin', async (ctx) => {
    const b = ctx.query.get('bransje');
    const f = ctx.query.get('fylke');
    const industry = b && INDUSTRY_BY_ID.has(b) ? b : null;
    const region = f && REGION_BY_CODE.has(f) ? f : null;
    const [post, topics] = await Promise.all([linkedinPost(industry, region), weeklyTopics()]);
    return render(ctx, <AdminLinkedinPage industry={industry} region={region} post={post} topics={topics} />, { title: 'LinkedIn' });
  });

  router.get('/admin/brukere', 'admin', async (ctx) => {
    const q = (ctx.query.get('q') ?? '').trim().slice(0, 100);
    return render(ctx, <AdminUsersPage rows={await listUsers(q, 1)} q={q} />, { title: 'Brukere' });
  });

  router.post('/admin/brukere/:id/admin', 'admin', async (ctx) => {
    const id = param(ctx, 'id');
    if (id === ctx.user!.id) return redirectWith(ctx, '/admin/brukere', 'error', 'Du kan ikke endre din egen admin-tilgang.');
    const [row] = (await systemSql()`update users set is_platform_admin = not is_platform_admin where id = ${id} returning is_platform_admin`) as unknown as {
      isPlatformAdmin: boolean;
    }[];
    if (!row) throw new HttpError(404, 'Fant ikke brukeren.');
    await audit({ action: 'admin.role_changed', actorUserId: ctx.user!.id, targetType: 'user', targetId: id, metadata: { isPlatformAdmin: row.isPlatformAdmin } });
    return redirectWith(ctx, '/admin/brukere', 'success', 'Tilgangen er endret.');
  }, SENSITIVE);

  router.get('/admin/organisasjoner', 'admin', async (ctx) => {
    const q = (ctx.query.get('q') ?? '').trim().slice(0, 100);
    return render(ctx, <AdminOrgsPage rows={await listOrganizations(q)} q={q} />, { title: 'Organisasjoner' });
  });

  router.get('/admin/organisasjoner/:id', 'admin', async (ctx) => {
    const d = await organizationDetail(param(ctx, 'id'));
    if (!d) throw new HttpError(404, 'Fant ikke organisasjonen.');
    return render(ctx, <AdminOrgPage d={d} />, { title: d.org.name });
  });

  router.post('/admin/organisasjoner/:id/plan', 'admin', async (ctx) => {
    const id = param(ctx, 'id');
    const form = await ctx.form();
    const plan = formStr(form, 'plan', 20) as PlanId;
    if (!(plan in PLANS)) throw new HttpError(400, 'Ukjent plan.');
    const note = formStr(form, 'note', 500).trim();
    if (!note) return redirectWith(ctx, `/admin/organisasjoner/${id}`, 'error', 'Skriv en begrunnelse.');
    const until = formStr(form, 'until', 20);
    await setManualPlan(ctx.user!.id, id, plan, until ? new Date(`${until}T23:59:59+01:00`) : null, note);
    return redirectWith(ctx, `/admin/organisasjoner/${id}`, 'success', 'Planen er satt.');
  }, SENSITIVE);

  router.get('/admin/importer', 'admin', async (ctx) => {
    const runs = (await systemSql()`select * from import_runs order by started_at desc limit 50`) as never;
    const errors = (await systemSql()`select id, source, source_notice_id, stage, error, created_at from import_errors order by created_at desc limit 50`) as never;
    return render(ctx, <AdminImportsPage runs={runs} errors={errors} sources={(await sourceRows()).filter((s) => s.id === 'ted' || s.id === 'doffin')} />, {
      title: 'Importer',
    });
  });

  router.post('/admin/importer/kjor', 'admin', async (ctx) => {
    const source = formStr(await ctx.form(), 'source', 20);
    if (source !== 'ted' && source !== 'doffin') throw new HttpError(400, 'Ukjent kilde.');
    const jobId = await enqueueJob('ingest', { source, triggeredBy: ctx.user!.id, trigger: 'manual' }, { dedupeKey: `ingest:${source}` });
    await audit({ action: 'admin.import_triggered', actorUserId: ctx.user!.id, targetType: 'data_source', targetId: source });
    return redirectWith(ctx, '/admin/importer', 'info', jobId ? 'Hentingen er lagt i køen. Arbeideren kjører den.' : 'En henting fra denne kilden står allerede i køen.');
  });

  router.post(
    '/admin/importer/fil',
    'admin',
    async (ctx) => {
      const file = (await ctx.form()).get('file');
      if (!(file instanceof File)) return redirectWith(ctx, '/admin/importer', 'error', 'Velg en fil.');
      const text = Buffer.from(await file.arrayBuffer()).toString('utf8');
      const parsed = parseImportFile(file.name, text);
      const source = parsed.format === 'ted-api' ? 'ted' : parsed.format === 'doffin-api' ? 'doffin' : 'manual';
      const run = await startImportRun(source, 'upload', { filename: file.name, format: parsed.format }, ctx.user!.id);
      for (const e of parsed.errors) await recordImportError(run, 'parse', e.error, e.id);
      const stats = await ingestNotices(parsed.notices, run);
      stats.errors += parsed.errors.length;
      stats.fetched += parsed.errors.length;
      await finishImportRun(run, stats);
      if (stats.tenderIds.length) {
        await enqueueJob('recompute_matches', { tenderIds: stats.tenderIds.slice(0, 5000) });
        await enqueueJob('generate_notifications', {}, { dedupeKey: 'generate_notifications' });
      }
      await audit({ action: 'admin.import_triggered', actorUserId: ctx.user!.id, targetType: 'import_file', metadata: { filename: file.name, ...stats, tenderIds: undefined } });
      return redirectWith(
        ctx,
        '/admin/importer',
        stats.errors ? 'info' : 'success',
        `Import (${parsed.format}): ${stats.created} nye, ${stats.updated} oppdatert, ${stats.unchanged} uendret, ${stats.duplicates} duplikater, ${stats.errors} feil.`,
      );
    },
    { maxBodyMb: 20, ...SENSITIVE },
  );

  router.get('/admin/kilder', 'admin', async (ctx) => {
    const [sources, enrichment] = await Promise.all([sourceRows(), enrichmentOverview()]);
    return render(ctx, <AdminSourcesPage sources={sources} enrichment={enrichment} />, { title: 'Datakilder' });
  });

  router.post('/admin/kilder/:id', 'admin', async (ctx) => {
    const id = ctx.params.id;
    if (!['ted', 'doffin', 'manual', 'sample'].includes(id ?? '')) throw new HttpError(404, 'Ukjent kilde.');
    const enabled = formStr(await ctx.form(), 'enabled', 2) === '1';
    await systemSql()`update data_sources set enabled = ${enabled} where id = ${id!}`;
    await audit({ action: 'admin.source_updated', actorUserId: ctx.user!.id, targetType: 'data_source', targetId: id, metadata: { enabled } });
    return redirectWith(ctx, '/admin/kilder', 'success', 'Datakilden er oppdatert.');
  }, SENSITIVE);

  router.get('/admin/ai', 'admin', async (ctx) => {
    const rows = (await systemSql()`
      select a.created_at, a.kind, a.status, a.provider, a.model, a.input_tokens, a.output_tokens, a.cost_usd, a.duration_ms, a.error,
             o.name as org_name, (a.org_id is null) as shared
      from ai_analyses a left join organizations o on o.id = a.org_id
      order by a.created_at desc limit 100
    `) as unknown as {
      createdAt: Date;
      kind: string;
      status: string;
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      durationMs: number | null;
      error: string | null;
      orgName: string | null;
      shared: boolean;
    }[];
    return render(
      ctx,
      <AdminListPage
        title="AI-bruk"
        description="Siste 100 AI-kall. Delte analyser (fra offentlig kunngjøringstekst) gjenbrukes av alle kunder uten ny kostnad."
        head={['Tid', 'Type', 'Status', 'Leverandør / modell', 'Tokens inn/ut', 'Kostnad (USD)', 'Tid', 'Organisasjon', 'Feil']}
        rows={rows.map((r) => [
          formatDateTime(r.createdAt),
          r.kind,
          <Badge tone={r.status === 'completed' ? 'ok' : 'danger'}>{r.status}</Badge>,
          `${r.provider} / ${r.model}`,
          `${r.inputTokens} / ${r.outputTokens}`,
          r.costUsd.toFixed(4),
          r.durationMs ? `${(r.durationMs / 1000).toFixed(1)} s` : '–',
          r.shared ? 'Delt' : (r.orgName ?? '–'),
          r.error ? <span className="text-danger">{r.error.slice(0, 120)}</span> : '',
        ])}
      />,
      { title: 'AI-bruk' },
    );
  });

  router.get('/admin/epost', 'admin', async (ctx) => {
    const rows = (await systemSql()`
      select id, created_at, to_email, subject, kind, status, provider, attempts, last_error, sent_at from email_outbox order by created_at desc limit 100
    `) as unknown as { id: string; createdAt: Date; toEmail: string; subject: string; kind: string; status: string; provider: string | null; attempts: number; lastError: string | null }[];
    return render(
      ctx,
      <AdminListPage
        title="E-post"
        description="Utboksen. Med EMAIL_PROVIDER=log sendes ingenting – e-postene vises bare her (status «logged»)."
        head={['Tid', 'Til', 'Emne', 'Type', 'Status', 'Forsøk', 'Feil', '']}
        rows={rows.map((r) => [
          formatDateTime(r.createdAt),
          r.toEmail,
          r.subject,
          r.kind,
          r.status,
          r.attempts,
          r.lastError?.slice(0, 80) ?? '',
          <a href={`/admin/epost/${r.id}`}>Vis</a>,
        ])}
      />,
      { title: 'E-post' },
    );
  });

  router.get('/admin/epost/:id', 'admin', async (ctx) => {
    const [row] = (await systemSql()`select html from email_outbox where id = ${param(ctx, 'id')}`) as unknown as { html: string }[];
    if (!row) throw new HttpError(404, 'Fant ikke e-posten.');
    return new Response(row.html, {
      // Logoen i e-posten ligger på vårt eget domene (APP_URL); andre bilder blokkeres fortsatt.
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src data: ${new URL(env.APP_URL).origin}`,
        'Cache-Control': 'no-store',
      },
    });
  });

  router.get('/admin/rapporter', 'admin', async (ctx) => {
    const rows = (await systemSql()`
      select r.id, r.kind, r.status, r.name, r.email, r.message, r.created_at, t.title as tender_title, r.tender_id, o.name as org_name
      from reports r left join tenders t on t.id = r.tender_id left join organizations o on o.id = r.org_id
      order by (r.status = 'open') desc, r.created_at desc limit 100
    `) as unknown as { id: string; kind: string; status: string; name: string | null; email: string | null; message: string; createdAt: Date; tenderTitle: string | null; tenderId: string | null; orgName: string | null }[];
    return render(
      ctx,
      <AdminListPage
        title="Henvendelser"
        description="Kontaktskjema, ønsker om plan (mens kortbetaling ikke er åpnet) og rapporterte feil i kunngjøringer."
        head={['Tid', 'Type', 'Fra', 'Gjelder', 'Melding', 'Status']}
        rows={rows.map((r) => [
          formatDateTime(r.createdAt),
          r.kind === 'contact' ? 'Kontakt' : r.kind === 'plan_interest' ? 'Planønske' : 'Datafeil',
          [r.name, r.email, r.orgName].filter(Boolean).join(' – '),
          r.tenderId ? <a href={`/app/anbud/${r.tenderId}`}>{r.tenderTitle}</a> : '–',
          <span className="whitespace-pre-line">{r.message}</span>,
          r.status === 'open' ? (
            <PostForm action={`/admin/rapporter/${r.id}`}>
              <Button size="sm" variant="secondary">
                Marker løst
              </Button>
            </PostForm>
          ) : (
            'Løst'
          ),
        ])}
      />,
      { title: 'Henvendelser' },
    );
  });

  router.post('/admin/rapporter/:id', 'admin', async (ctx) => {
    const id = param(ctx, 'id');
    await systemSql()`update reports set status = 'resolved', resolved_at = now(), resolved_by = ${ctx.user!.id} where id = ${id}`;
    await audit({ action: 'admin.report_resolved', actorUserId: ctx.user!.id, targetType: 'report', targetId: id });
    return redirectWith(ctx, '/admin/rapporter', 'success', 'Markert som løst.');
  });

  router.get('/admin/logg', 'admin', async (ctx) => {
    const rows = (await systemSql()`
      select a.created_at, a.action, a.target_type, a.target_id, a.metadata, u.email as actor, o.name as org_name
      from audit_logs a left join users u on u.id = a.actor_user_id left join organizations o on o.id = a.org_id
      order by a.created_at desc limit 200
    `) as unknown as { createdAt: Date; action: string; targetType: string | null; targetId: string | null; metadata: unknown; actor: string | null; orgName: string | null }[];
    return render(
      ctx,
      <AdminListPage
        title="Revisjonslogg"
        description="Sikkerhets- og administrasjonshendelser. Lagres i 365 dager. IP-adresser lagres kun pseudonymisert."
        head={['Tid', 'Hendelse', 'Utført av', 'Organisasjon', 'Mål', 'Detaljer']}
        rows={rows.map((r) => [
          formatDateTime(r.createdAt),
          r.action,
          r.actor ?? '–',
          r.orgName ?? '–',
          r.targetType ? `${r.targetType}${r.targetId ? `:${r.targetId.slice(0, 8)}` : ''}` : '–',
          <code className="text-[11px]">{JSON.stringify(r.metadata).slice(0, 160)}</code>,
        ])}
      />,
      { title: 'Revisjonslogg' },
    );
  });

  // Kundereisen: fra registrering til betalende kunde (bare antall).
  router.get('/admin/kundereise', 'admin', async (ctx) => {
    const p = ctx.query.get('periode');
    const days = p === 'alle' ? null : p === '30' ? 30 : 90;
    return render(ctx, <AdminJourneyPage j={await customerJourney(days)} />, { title: 'Kundereisen' });
  });

  // Alle produktene med lenke inn i appen; administratorens egen organisasjon har alle funksjoner.
  router.get('/admin/produkter', 'admin', async (ctx) => render(ctx, <AdminProductsPage c={await adminProductContext(ctx.user!.id)} />, { title: 'Produkter' }));

  // Feilovervåking: feil som er logget, gruppert per type (se src/domain/ops/errors.ts).
  router.get('/admin/feil', 'admin', async (ctx) => {
    const { open, resolved } = await listAppErrors();
    return render(ctx, <AdminErrorsPage open={open} resolved={resolved} emailOn={Boolean(env.ADMIN_NOTIFICATION_EMAIL)} />, { title: 'Feil i appen' });
  });

  router.post('/admin/feil/lost-alle', 'admin', async (ctx) => {
    const n = await resolveAllAppErrors();
    await audit({ action: 'admin.errors_resolved', actorUserId: ctx.user!.id, targetType: 'app_errors', metadata: { count: n } });
    return redirectWith(ctx, '/admin/feil', 'success', n === 1 ? 'Én feil er merket som løst.' : `${n} feil er merket som løst.`);
  });

  router.post('/admin/feil/:id/lost', 'admin', async (ctx) => {
    // Feil-ID-en er en kort sjekksum (32 heksadesimale tegn), ikke en UUID.
    const fingerprint = ctx.params.id ?? '';
    if (!/^[0-9a-f]{32}$/.test(fingerprint)) throw new HttpError(404, 'Fant ikke feilen.');
    const ok = await resolveAppError(fingerprint);
    if (ok) await audit({ action: 'admin.error_resolved', actorUserId: ctx.user!.id, targetType: 'app_errors', metadata: { fingerprint } });
    return redirectWith(ctx, '/admin/feil', ok ? 'success' : 'info', ok ? 'Merket som løst.' : 'Feilen var allerede løst.');
  });

  router.get('/admin/helse', 'admin', async (ctx) => {
    // Kontroll av pris-ID-ene mot Stripe (bare lesing) kjøres når administratoren ber om det.
    const prices: PriceCheck[] | null = ctx.query.get('stripe') === '1' && env.STRIPE_SECRET_KEY ? await verifyStripePrices() : null;
    return render(ctx, <AdminHealthPage h={await systemHealth()} integrations={integrationStatus()} prices={prices} stripeConfigured={Boolean(env.STRIPE_SECRET_KEY)} />, {
      title: 'Systemhelse',
    });
  });
}
