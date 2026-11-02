import { z } from 'zod';
import { first } from '@/lib/db';
import { env, integrationStatus } from '@/lib/env';
import { rateLimit } from '@/lib/rate-limit';
import { createOrganization, orgNumberSchema, switchOrganization } from '@/domain/org/org';
import { afterProfileSaved, getProfile, profileFormFromData, profileFormSchema, saveProfile } from '@/domain/profile/profile';
import { zodErrors } from '@/domain/auth/auth';
import { queryFromParams, queryToParams, restrictQuery, sanitizeQuery, type TenderQuery } from '@/domain/search/filters';
import { parseNaturalQuery } from '@/domain/search/nl-parser';
import { cpvLabels, getTender, getTenderExtras, searchTenders } from '@/domain/tenders/queries';
import { listBookmarks, toggleBookmark, updateBookmark, BOOKMARK_STATUSES } from '@/domain/tenders/bookmarks';
import { createSavedSearch, deleteSavedSearch, listSavedSearches, updateSavedSearch } from '@/domain/search/saved';
import { getLatestFitAssessment, getLatestTenderAnalysis, runFitAssessment, runTenderAnalysis } from '@/domain/ai/analysis';
import { usageSummary } from '@/domain/ai/usage';
import { runAi } from '@/domain/ai/runner';
import { WEEKLY_OVERVIEW_SYSTEM } from '@/domain/ai/prompts';
import { weeklyOverviewJsonSchema, weeklyOverviewZ } from '@/domain/ai/schemas';
import { mockWeeklyOverview } from '@/domain/ai/mock';
import { deleteTenderDocument, uploadTenderDocument } from '@/domain/documents/documents';
import { isoWeek, loadDashboard } from '@/domain/dashboard';
import type { MatchBreakdown } from '@/domain/matching/engine';
import { redirectWith } from '@/server/flash';
import { HttpError, json, redirect, safeRedirectPath } from '@/server/http';
import { render } from '@/server/render';
import type { Router } from '@/server/router';
import { DashboardPage } from '@/ui/pages/app/dashboard';
import { DiscoverPage } from '@/ui/pages/app/discover';
import { AnalysisPage, TenderPage } from '@/ui/pages/app/tender';
import { NotificationsPage, SavedSearchesPage, SavedTendersPage, type NotificationRow, type Prefs } from '@/ui/pages/app/lists';
import { formValues, OnboardingOrgPage, OnboardingProfilePage, ProfilePage, profileToValues } from '@/ui/pages/app/profile';
import { formBool, formStr, param, requireOrg, wantsJsonResponse } from '../helpers';

/** Sti fra Referer-headeren, bare hvis den peker til vår egen side. Ugyldige verdier gir null. */
export function refererPath(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    return u.origin === new URL(env.APP_URL).origin ? u.pathname + u.search : null;
  } catch {
    return null;
  }
}

export function registerCoreAppRoutes(router: Router): void {
  // ------------------------------------------------------------------ Oversikt
  router.get('/app', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const data = await ctx.tenant((tx) => loadDashboard(tx, org));
    const aiAvailable = integrationStatus().ai && org.entitlements.aiFullAnalysis;
    return render(ctx, <DashboardPage data={data} aiAvailable={aiAvailable} firstVisit={ctx.query.get('velkommen') === '1'} />, { title: 'Oversikt' });
  });

  router.post('/app/ukesoversikt', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const data = await ctx.tenant((tx) => loadDashboard(tx, org));
    const lines = [
      ...data.topMatches.map((t) => `Anbefalt (relevans ${t.score ?? '–'} %): ${t.title} – ${t.buyerName ?? 'ukjent oppdragsgiver'}, frist ${t.deadlineAt ? t.deadlineAt.toISOString().slice(0, 10) : 'ikke oppgitt'}`),
      ...data.deadlines.map((d) => `Lagret anbud med frist ${d.deadlineAt ? d.deadlineAt.toISOString().slice(0, 10) : 'ukjent'}: ${d.title}`),
      `Nye relevante anbud siste 7 dager: ${data.newMatches}. Åpne anbud i bransjene: ${data.openInIndustries}.`,
    ];
    const week = isoWeek();
    const result = await runAi({
      kind: 'weekly_overview',
      usageKind: 'ai_weekly_overview',
      org,
      userId: user.id,
      tenderId: null,
      isPrivate: true,
      system: WEEKLY_OVERVIEW_SYSTEM,
      user: `<kilder>\n<kilde id="S0" type="oversikt" tittel="Anbud i AnbudRadar denne uken">\n${lines.join('\n')}\n</kilde>\n</kilder>`,
      tier: 'fast',
      effort: 'low',
      schemaName: 'weekly_overview',
      schemaDescription: 'Kort ukesoversikt',
      schema: weeklyOverviewJsonSchema,
      validator: weeklyOverviewZ,
      maxOutputTokens: 800,
      mockHint: () => mockWeeklyOverview(lines),
      hashExtra: week,
      enrich: () => ({ week }),
    });
    if (!result.ok) return redirectWith(ctx, '/app', 'error', result.error);
    return redirect('/app');
  });

  // ---------------------------------------------------------------- Onboarding
  router.get(
    '/app/onboarding',
    'user',
    async (ctx) => {
      if (!ctx.org) return render(ctx, <OnboardingOrgPage />, { title: 'Kom i gang' });
      if (ctx.org.onboardingCompleted) return redirect('/app');
      const profile = await ctx.tenant((tx) => getProfile(tx, ctx.org!.id));
      return render(ctx, <OnboardingProfilePage values={profileToValues(profile, ctx.org.name)} />, { title: 'Bedriftsprofil' });
    },
  );

  router.post('/app/onboarding/organisasjon', 'user', async (ctx) => {
    const form = await ctx.form();
    const values = { name: formStr(form, 'name', 200), orgNumber: formStr(form, 'orgNumber', 30) };
    if (ctx.org) return redirect('/app/onboarding');
    const parsed = z.object({ name: z.string().trim().min(1, 'Skriv inn firmanavnet.').max(160), orgNumber: orgNumberSchema }).safeParse(values);
    if (!parsed.success) return render(ctx, <OnboardingOrgPage errors={zodErrors(parsed.error)} values={values} />, { title: 'Kom i gang', status: 422 });
    if (!(await rateLimit(`create-org:${ctx.user!.id}`, 5, 3600))) throw new HttpError(429, 'For mange forsøk. Prøv igjen senere.');
    await createOrganization(ctx.user!, { name: parsed.data.name, orgNumber: parsed.data.orgNumber }, ctx.ipHash);
    return redirect('/app/onboarding');
  });

  router.post(
    '/app/onboarding/profil',
    'org',
    async (ctx) => {
      const { org, user } = requireOrg(ctx);
      if (org.role === 'member') throw new HttpError(403, 'Bare eier eller administrator kan fylle ut bedriftsprofilen. Be dem fullføre den.');
      const form = await ctx.form();
      const raw = profileFormFromData(form);
      const parsed = profileFormSchema.safeParse(raw);
      if (!parsed.success) {
        return render(ctx, <OnboardingProfilePage values={formValues(raw)} errors={zodErrors(parsed.error)} />, { title: 'Bedriftsprofil', status: 422 });
      }
      await ctx.tenant((tx) => saveProfile(tx, { orgId: org.id, userId: user.id, ipHash: ctx.ipHash }, parsed.data));
      await afterProfileSaved(org.id);
      return redirect('/app?velkommen=1');
    },
    { requireOnboarding: false },
  );

  router.post('/app/org/bytt', 'user', async (ctx) => {
    const form = await ctx.form();
    const orgId = formStr(form, 'orgId', 100);
    if (!(await switchOrganization(ctx.user!.id, orgId))) throw new HttpError(403, 'Du er ikke medlem av den organisasjonen.');
    return redirect('/app');
  });

  // -------------------------------------------------------------------- Søk
  router.get('/app/anbud', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const nl = (ctx.query.get('nl') ?? '').trim().slice(0, 300);
    let query = queryFromParams(ctx.query);
    let interpretations: string[] = [];
    if (nl) {
      const parsed = parseNaturalQuery(nl);
      interpretations = parsed.interpretations;
      query = sanitizeQuery({ ...query, ...parsed.query, page: query.page, sort: query.sort });
    }
    const { query: effective, removed } = restrictQuery(query, org.entitlements.advancedSearch);
    const matching = org.entitlements.matching;
    const results = await ctx.tenant(async (tx) => {
      const r = await searchTenders(tx, effective, { orgId: org.id, matching });
      if (effective.page === 1) {
        await tx`
          insert into search_events (org_id, industries, regions, has_keyword, used_nl, result_count)
          values (${org.id}, ${effective.industries}::text[], ${effective.regions}::text[], ${effective.q !== ''}, ${nl !== ''}, ${r.total})
        `;
      }
      return r;
    });
    const savedCount = await ctx.tenant(async (tx) => {
      const [row] = (await tx`select count(*)::int as n from saved_searches where org_id = ${org.id}`) as unknown as { n: number }[];
      return row?.n ?? 0;
    });
    return render(
      ctx,
      <DiscoverPage
        query={effective}
        nl={nl}
        interpretations={interpretations}
        results={results}
        matching={matching}
        advanced={org.entitlements.advancedSearch}
        removedAdvanced={removed}
        canSaveSearch={savedCount < org.entitlements.maxSavedSearches}
        savedSearchLimitReached={org.entitlements.maxSavedSearches > 0 && savedCount >= org.entitlements.maxSavedSearches}
      />,
      { title: 'Finn anbud' },
    );
  });

  // --------------------------------------------------------------- Kunngjøring
  router.get('/app/anbud/:id', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const data = await ctx.tenant(async (tx) => {
      const tender = await getTender(tx, id);
      if (!tender) return null;
      const extras = await getTenderExtras(tx, id, org.id);
      const labels = await cpvLabels(tx, tender.cpvCodes);
      const analysis = await getLatestTenderAnalysis(tx, id, org.id);
      const fit = org.entitlements.matching ? await getLatestFitAssessment(tx, id, org.id) : null;
      const usage = await usageSummary(tx, org);
      return { tender, extras, labels, analysis, fit, usage };
    });
    if (!data) throw new HttpError(404, 'Fant ikke kunngjøringen.');
    return render(
      ctx,
      <TenderPage
        tender={data.tender}
        cpvLabels={data.labels}
        sources={data.extras.sources}
        updates={data.extras.updates}
        awards={data.extras.awards}
        bookmark={data.extras.bookmark}
        match={data.extras.match ? { ...data.extras.match, breakdown: data.extras.match.breakdown as MatchBreakdown } : null}
        documents={data.extras.documents}
        workspace={data.extras.workspace}
        analysis={data.analysis}
        fit={data.fit}
        canAssessFit={org.entitlements.matching}
        aiQuota={{ used: data.usage.analyses, limit: data.usage.analysesLimit }}
      />,
      { title: data.tender.title },
    );
  });

  router.post('/app/anbud/:id/bokmerke', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const result = await ctx.tenant((tx) => toggleBookmark(tx, org, user.id, id));
    if (wantsJsonResponse(ctx)) return result.ok ? json({ bookmarked: result.bookmarked }) : json({ error: result.error }, { status: 400 });
    const back = safeRedirectPath(refererPath(ctx.req.headers.referer), `/app/anbud/${id}`);
    if (!result.ok) return redirectWith(ctx, back, 'error', result.error);
    return redirectWith(ctx, back, 'success', result.bookmarked ? 'Anbudet er lagret.' : 'Anbudet er fjernet fra lagrede.');
  });

  router.post('/app/anbud/:id/analyse', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const form = await ctx.form();
    const result = await runTenderAnalysis(org, user.id, id, { force: formBool(form, 'force') });
    if (!result.ok) return redirectWith(ctx, `/app/anbud/${id}`, 'error', result.error);
    return redirectWith(ctx, `/app/anbud/${id}/analyse`, 'success', result.cached ? 'Viser lagret analyse (ingen ny kostnad).' : 'Analysen er klar.');
  });

  router.post('/app/anbud/:id/egnethet', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const form = await ctx.form();
    const result = await runFitAssessment(org, user.id, id, { force: formBool(form, 'force') });
    if (!result.ok) return redirectWith(ctx, `/app/anbud/${id}#egnethet`, 'error', result.error);
    return redirectWith(ctx, `/app/anbud/${id}#egnethet`, 'success', result.cached ? 'Viser lagret vurdering (ingen ny kostnad).' : 'Egnethetsvurderingen er klar.');
  });

  router.get('/app/anbud/:id/analyse', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const data = await ctx.tenant(async (tx) => {
      const tender = await getTender(tx, id);
      if (!tender) return null;
      return { tender, analysis: await getLatestTenderAnalysis(tx, id, org.id) };
    });
    if (!data) throw new HttpError(404, 'Fant ikke kunngjøringen.');
    if (!data.analysis) return redirectWith(ctx, `/app/anbud/${id}`, 'info', 'Det finnes ingen analyse ennå.');
    return render(ctx, <AnalysisPage tender={data.tender} analysis={data.analysis} />, { title: `AI-analyse: ${data.tender.title}` });
  });

  router.post(
    '/app/anbud/:id/dokumenter',
    'org',
    async (ctx) => {
      const { org, user } = requireOrg(ctx);
      const id = param(ctx, 'id');
      if (!(await rateLimit(`upload:${org.id}`, 30, 3600))) throw new HttpError(429, 'For mange opplastinger. Prøv igjen senere.');
      const form = await ctx.form();
      const file = form.get('file');
      if (!(file instanceof File)) return redirectWith(ctx, `/app/anbud/${id}`, 'error', 'Velg en fil å laste opp.');
      const result = await uploadTenderDocument(org, user.id, id, file);
      if (!result.ok) return redirectWith(ctx, `/app/anbud/${id}`, 'error', result.error);
      return redirectWith(ctx, `/app/anbud/${id}`, 'success', `Dokumentet er lest (${result.pages} sider). Kjør AI-analysen på nytt for å ta det med.`);
    },
    { maxBodyMb: 30 },
  );

  router.post('/app/anbud/:id/dokumenter/:docId/slett', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const ok = await deleteTenderDocument(org, user.id, param(ctx, 'docId'));
    return redirectWith(ctx, `/app/anbud/${id}`, ok ? 'success' : 'error', ok ? 'Dokumentet er slettet.' : 'Fant ikke dokumentet.');
  });

  router.post('/app/anbud/:id/rapporter', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const message = formStr(await ctx.form(), 'message', 2000).trim();
    if (!message) return redirectWith(ctx, `/app/anbud/${id}`, 'error', 'Beskriv feilen.');
    if (!(await rateLimit(`report:${user.id}`, 10, 3600))) throw new HttpError(429, 'For mange rapporter. Prøv igjen senere.');
    await ctx.tenant((tx) => tx`insert into reports (kind, tender_id, org_id, user_id, email, message) values ('data_error', ${id}, ${org.id}, ${user.id}, ${user.email}, ${message})`);
    return redirectWith(ctx, `/app/anbud/${id}`, 'success', 'Takk! Vi ser på det.');
  });

  // ----------------------------------------------------------- Lagrede anbud
  router.get('/app/lagret', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const status = ctx.query.get('status');
    const validStatus = status && status in BOOKMARK_STATUSES ? status : null;
    const { rows, counts } = await ctx.tenant(async (tx) => {
      const rows = await listBookmarks(tx, org.id, validStatus ?? undefined);
      const countRows = (await tx`select status, count(*)::int as n from bookmarks where org_id = ${org.id} group by status`) as unknown as { status: string; n: number }[];
      return { rows, counts: Object.fromEntries(countRows.map((c) => [c.status, c.n])) };
    });
    return render(ctx, <SavedTendersPage rows={rows} status={validStatus} counts={counts} limit={org.entitlements.maxBookmarks} />, { title: 'Lagrede anbud' });
  });

  router.post('/app/lagret/:id', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const form = await ctx.form();
    const ok = await ctx.tenant((tx) =>
      updateBookmark(tx, org.id, param(ctx, 'id'), { status: formStr(form, 'status', 20), note: formStr(form, 'note', 2000).trim() || null }),
    );
    return redirectWith(ctx, safeRedirectPath(formStr(form, 'back', 300), '/app/lagret'), ok ? 'success' : 'error', ok ? 'Lagret.' : 'Kunne ikke oppdatere.');
  });

  // ------------------------------------------------------------- Lagrede søk
  router.get('/app/sok', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const rows = await ctx.tenant((tx) => listSavedSearches(tx, org.id));
    return render(ctx, <SavedSearchesPage rows={rows} limit={org.entitlements.maxSavedSearches} alertsLevel={org.entitlements.alerts} />, { title: 'Lagrede søk' });
  });

  router.post('/app/sok', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const form = await ctx.form();
    const filters: TenderQuery = queryFromParams(new URLSearchParams(formStr(form, 'filters', 4000)));
    const { query } = restrictQuery(filters, org.entitlements.advancedSearch);
    const name = formStr(form, 'name', 120).trim();
    const alert = formStr(form, 'alert', 20);
    if (!name) return redirectWith(ctx, `/app/anbud?${queryToParams(query)}`, 'error', 'Gi søket et navn.');
    const result = await ctx.tenant((tx) =>
      createSavedSearch(tx, org, user.id, {
        name,
        filters: query,
        nlQuery: formStr(form, 'nl', 300).trim() || null,
        alertEnabled: alert !== 'off',
        alertFrequency: alert === 'instant' || alert === 'weekly' ? alert : 'daily',
      }),
    );
    if (!result.ok) return redirectWith(ctx, `/app/anbud?${queryToParams(query)}`, 'error', result.error);
    return redirectWith(ctx, '/app/sok', 'success', `Søket «${name}» er lagret.`);
  });

  router.post('/app/sok/:id', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const form = await ctx.form();
    const alert = formStr(form, 'alert', 20);
    const name = formStr(form, 'name', 120).trim();
    if (!name) return redirectWith(ctx, '/app/sok', 'error', 'Navnet kan ikke være tomt.');
    const ok = await ctx.tenant((tx) =>
      updateSavedSearch(tx, org, param(ctx, 'id'), {
        name,
        alertEnabled: alert !== 'off',
        alertFrequency: alert === 'instant' || alert === 'weekly' ? alert : 'daily',
      }),
    );
    return redirectWith(ctx, '/app/sok', ok ? 'success' : 'error', ok ? 'Søket er oppdatert.' : 'Fant ikke søket.');
  });

  router.post('/app/sok/:id/slett', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const ok = await ctx.tenant((tx) => deleteSavedSearch(tx, org.id, param(ctx, 'id')));
    return redirectWith(ctx, '/app/sok', ok ? 'success' : 'error', ok ? 'Søket er slettet.' : 'Fant ikke søket.');
  });

  // ------------------------------------------------------------------ Varsler
  router.get('/app/varsler', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const { rows, prefs } = await ctx.tenant(async (tx) => {
      const rows = (await tx`
        select id, type, title, body, url, read_at, created_at from notifications order by created_at desc limit 100
      `) as unknown as NotificationRow[];
      const prefs = first(
        (await tx`
          select email_frequency, new_matches, match_threshold, saved_search_alerts, deadline_reminders, tender_changes, weekly_summary
          from notification_preferences where user_id = ${user.id} and org_id = ${org.id}
        `) as unknown as Prefs[],
      );
      return { rows, prefs };
    });
    const defaults: Prefs = { emailFrequency: 'daily', newMatches: true, matchThreshold: 60, savedSearchAlerts: true, deadlineReminders: true, tenderChanges: true, weeklySummary: true };
    return render(ctx, <NotificationsPage rows={rows} prefs={prefs ?? defaults} alertsLevel={org.entitlements.alerts} />, { title: 'Varsler' });
  });

  router.get('/app/varsler/:id', 'org', async (ctx) => {
    const id = param(ctx, 'id');
    const row = await ctx.tenant(async (tx) =>
      first((await tx`update notifications set read_at = coalesce(read_at, now()) where id = ${id} returning url`) as unknown as { url: string | null }[]),
    );
    if (!row) throw new HttpError(404, 'Fant ikke varselet.');
    return redirect(safeRedirectPath(row.url, '/app/varsler'));
  });

  router.post('/app/varsler/lest', 'org', async (ctx) => {
    await ctx.tenant((tx) => tx`update notifications set read_at = now() where read_at is null`);
    return redirectWith(ctx, '/app/varsler', 'success', 'Alle varsler er merket som lest.');
  });

  router.post('/app/varsler/innstillinger', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const form = await ctx.form();
    const freq = formStr(form, 'emailFrequency', 20);
    const threshold = Math.max(0, Math.min(100, Math.round(Number(formStr(form, 'matchThreshold', 5)) || 60)));
    await ctx.tenant(
      (tx) => tx`
        insert into notification_preferences (user_id, org_id, email_frequency, new_matches, match_threshold, saved_search_alerts, deadline_reminders, tender_changes, weekly_summary)
        values (${user.id}, ${org.id}, ${['instant', 'daily', 'weekly', 'off'].includes(freq) ? freq : 'daily'}, ${formBool(form, 'newMatches')},
                ${threshold}, ${formBool(form, 'savedSearchAlerts')}, ${formBool(form, 'deadlineReminders')}, ${formBool(form, 'tenderChanges')},
                ${formBool(form, 'weeklySummary')})
        on conflict (user_id, org_id) do update set
          email_frequency = excluded.email_frequency, new_matches = excluded.new_matches, match_threshold = excluded.match_threshold,
          saved_search_alerts = excluded.saved_search_alerts, deadline_reminders = excluded.deadline_reminders,
          tender_changes = excluded.tender_changes, weekly_summary = excluded.weekly_summary
      `,
    );
    return redirectWith(ctx, '/app/varsler', 'success', 'Varselinnstillingene er lagret.');
  });

  // ---------------------------------------------------------------- Profil
  router.get('/app/profil', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const { profile, matchCount } = await ctx.tenant(async (tx) => {
      const profile = await getProfile(tx, org.id);
      const [m] = (await tx`select count(*)::int as n from match_results where org_id = ${org.id} and not excluded and score >= 50`) as unknown as { n: number }[];
      return { profile, matchCount: m?.n ?? 0 };
    });
    return render(
      ctx,
      <ProfilePage values={profileToValues(profile, org.name)} canEdit={org.role !== 'member'} matchCount={org.entitlements.matching ? matchCount : null} />,
      { title: 'Bedriftsprofil' },
    );
  });

  router.post('/app/profil', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    if (org.role === 'member') throw new HttpError(403, 'Bare eiere og administratorer kan endre profilen.');
    const raw = profileFormFromData(await ctx.form());
    const parsed = profileFormSchema.safeParse(raw);
    if (!parsed.success) {
      return render(ctx, <ProfilePage values={formValues(raw)} errors={zodErrors(parsed.error)} canEdit matchCount={null} />, { title: 'Bedriftsprofil', status: 422 });
    }
    await ctx.tenant((tx) => saveProfile(tx, { orgId: org.id, userId: user.id, ipHash: ctx.ipHash }, parsed.data));
    const count = await afterProfileSaved(org.id);
    return redirectWith(ctx, '/app/profil', 'success', `Profilen er lagret. ${count} anbud er rangert på nytt.`);
  });
}
