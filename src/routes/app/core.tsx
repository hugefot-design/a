import { parseBoardFilter } from '@/domain/tenders/market';
import { first, withTenant } from '@/lib/db';
import { env } from '@/lib/env';
import { aiModeFor } from '@/domain/ai/provider';
import { featuresUsed, markFeatureUsed, startSteps } from '@/domain/activation';
import { rateLimit } from '@/lib/rate-limit';
import { consumeSearch, searchKey, searchQuota } from '@/domain/billing/quota';
import { createOrganization, OrgLimitError, switchOrganization } from '@/domain/org/org';
import { afterProfileSaved, getProfile, profileFormFromData, profileFormSchema, quickStartProfile, quickStartSchema, saveProfile } from '@/domain/profile/profile';
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
import { tenderRequirementScan } from '@/domain/documents/requirements-service';
import { confirmAwardWin, learningSummary, loadResults, parseResultForm, saveResultFields, tenderResultInfo } from '@/domain/tenders/results';
import { noticeSignals, screenTender } from '@/domain/matching/screening';
import { askTender, chatHistory, MAX_QUESTION } from '@/domain/ai/chat';
import type { Tx } from '@/lib/db';

/** Profilens «minst antall dager til frist» (standard 10 når profilen mangler). */
async function profileMinDays(tx: Tx, orgId: string): Promise<number> {
  const [row] = (await tx`select min_days_to_deadline from company_profiles where org_id = ${orgId}`) as unknown as { minDaysToDeadline: number }[];
  return row?.minDaysToDeadline ?? 10;
}
import { ResultsPage } from '@/ui/pages/app/results';
import { isoWeek, loadDashboard } from '@/domain/dashboard';
import { LEGAL_REQUIREMENTS, type MatchBreakdown } from '@/domain/matching/engine';
import { redirectWith } from '@/server/flash';
import { HttpError, json, redirect, safeRedirectPath } from '@/server/http';
import { render } from '@/server/render';
import type { Router } from '@/server/router';
import { DashboardPage } from '@/ui/pages/app/dashboard';
import { DiscoverPage } from '@/ui/pages/app/discover';
import { LimitReachedPage } from '@/ui/pages/system';
import { AnalysisPage, TenderPage } from '@/ui/pages/app/tender';
import { calculationBadge } from '@/domain/profit/service';
import { NotificationsPage, SavedSearchesPage, SavedTendersPage, type NotificationRow, type Prefs } from '@/ui/pages/app/lists';
import { formValues, OnboardingPage, ProfilePage, profileToValues } from '@/ui/pages/app/profile';
import { formBool, formStr, param, requireOrg, wantsJsonResponse } from '../helpers';

/** Så mange dager etter oppstarten vises «Kom i gang» på Oversikt (til stegene er gjort). */
const START_GUIDE_DAYS = 21;

/** Målet etter oppstarten: bare sider inne i appen, aldri oppstarten selv. Alt annet gir null. */
export function onboardingTarget(value: string | null | undefined): string | null {
  const path = safeRedirectPath(value, '');
  return path.startsWith('/app/') && !path.startsWith('/app/onboarding') ? path : null;
}

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
    const aiAvailable = aiModeFor(org).configured && org.entitlements.aiFullAnalysis;
    let freeUsage = null;
    if (org.entitlements.plan === 'free') {
      const [sq, usage] = await Promise.all([searchQuota(org.id, ctx.user!.id, org.entitlements), ctx.tenant((tx) => usageSummary(tx, org))]);
      freeUsage = {
        searchesUsed: sq.used,
        searchesLimit: sq.limit,
        bookmarksUsed: data.savedCount,
        bookmarksLimit: org.entitlements.maxBookmarks,
        aiUsed: usage.analyses,
        aiLimit: usage.analysesLimit,
      };
    }
    // «Kom i gang»: stegene fra første treff til første vurdering, de tre første ukene eller til alt er gjort.
    const firstVisit = ctx.query.get('velkommen') === '1';
    const start = await ctx.tenant(async (tx) => {
      const [row] = (await tx`
        select p.onboarding_completed_at,
               -- «Skarpere» = noe utover oppstarten (de lovpålagte godkjenningene spørres det om der).
               (exists (select 1 from unnest(p.certifications) c where not (c = any(${[...LEGAL_REQUIREMENTS]}::text[])))
                 or cardinality(p.cpv_codes) > 0 or p.annual_revenue is not null or p.min_contract_value is not null
                 or p.max_contract_value is not null or p.experience is not null
                 or jsonb_array_length(coalesce(p.reference_projects, '[]'::jsonb)) > 0) as sharpened,
               exists (select 1 from tender_calculations c where c.org_id = p.org_id) as has_calculation
        from company_profiles p where p.org_id = ${org.id}
      `) as unknown as { onboardingCompletedAt: Date | null; sharpened: boolean; hasCalculation: boolean }[];
      return row ?? null;
    });
    const recentlyStarted = Boolean(start?.onboardingCompletedAt && Date.now() - start.onboardingCompletedAt.getTime() < START_GUIDE_DAYS * 86_400_000);
    const steps =
      start && (firstVisit || recentlyStarted)
        ? startSteps({
            topTenderId: (org.entitlements.matching ? data.topMatches[0]?.id : data.recent[0]?.id) ?? null,
            used: await featuresUsed(org.id),
            savedCount: data.savedCount,
            hasCalculation: start.hasCalculation,
            profitCalculator: org.entitlements.profitCalculator,
            profileSharpened: start.sharpened,
          })
        : null;
    // Når alt er gjort, forsvinner panelet (unntatt rett etter oppstarten).
    const startGuide = steps && (firstVisit || steps.some((s) => !s.done)) ? steps : null;
    return render(ctx, <DashboardPage data={data} aiAvailable={aiAvailable} firstVisit={firstVisit} freeUsage={freeUsage} startGuide={startGuide} />, {
      title: 'Oversikt',
    });
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

  // ---------------------------------------------------------------- Kom i gang
  // Ett kort skjema: firmanavn, bransje, område og stikkord. Organisasjonen opprettes og profilen lagres i samme
  // steg, og kunden sendes rett til anbudene (eller til siden de var på vei til, f.eks. et anbud fra en offentlig side).
  router.get('/app/onboarding', 'user', async (ctx) => {
    const start = parseBoardFilter(ctx.query.get('bransje'), ctx.query.get('fylke'));
    const next = onboardingTarget(ctx.query.get('neste'));
    if (ctx.org?.onboardingCompleted) return redirect(next ?? '/app');
    const values = {
      companyName: ctx.org?.name ?? '',
      orgNumber: '',
      industries: start.industry ? [start.industry] : [],
      regions: start.region ? [start.region] : [],
      certifications: [],
      services: '',
    };
    return render(ctx, <OnboardingPage values={values} next={next} memberOnly={ctx.org?.role === 'member'} />, { title: 'Kom i gang' });
  });

  router.post('/app/onboarding', 'user', async (ctx) => {
    const form = await ctx.form();
    const next = onboardingTarget(formStr(form, 'neste', 500));
    if (ctx.org?.onboardingCompleted) return redirect(next ?? '/app');
    if (ctx.org?.role === 'member') throw new HttpError(403, 'Bare eier eller administrator kan fylle ut bedriftsprofilen. Be dem fullføre den.');
    const all = (k: string) => form.getAll(k).filter((v): v is string => typeof v === 'string');
    const raw = {
      companyName: formStr(form, 'companyName', 200),
      orgNumber: formStr(form, 'orgNumber', 30),
      industries: all('industries'),
      regions: all('regions'),
      certifications: all('certifications'),
      services: formStr(form, 'services', 3000),
    };
    const parsed = quickStartSchema.safeParse(raw);
    if (!parsed.success) return render(ctx, <OnboardingPage values={raw} errors={zodErrors(parsed.error)} next={next} />, { title: 'Kom i gang', status: 422 });
    const user = ctx.user!;
    let orgId = ctx.org?.id ?? null;
    if (!orgId) {
      if (!(await rateLimit(`create-org:${user.id}`, 5, 3600))) throw new HttpError(429, 'For mange forsøk. Prøv igjen senere.');
      try {
        orgId = await createOrganization(user, { name: parsed.data.companyName, orgNumber: parsed.data.orgNumber }, ctx.ipHash);
      } catch (err) {
        if (err instanceof OrgLimitError) return render(ctx, <OnboardingPage values={raw} errors={{ companyName: err.message }} next={next} />, { title: 'Kom i gang', status: 422 });
        throw err;
      }
    }
    const org = orgId;
    await withTenant({ userId: user.id, orgId: org }, (tx) => saveProfile(tx, { orgId: org, userId: user.id, ipHash: ctx.ipHash }, quickStartProfile(parsed.data)));
    await afterProfileSaved(org);
    return redirect(next ?? '/app?velkommen=1');
  });

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
    // Gratisgrensen for søk håndheves her, før søket kjøres.
    const key = searchKey(effective, nl);
    const searchQuotaState = key
      ? await consumeSearch(org.id, ctx.user!.id, org.entitlements, key)
      : { ...(await searchQuota(org.id, ctx.user!.id, org.entitlements)), allowed: true };
    if (!searchQuotaState.allowed) {
      return render(ctx, <LimitReachedPage kind="search" used={searchQuotaState.used} limit={searchQuotaState.limit} />, {
        title: 'Dagens søk er brukt opp',
        status: 402,
      });
    }
    const matching = org.entitlements.matching;
    const results = await ctx.tenant(async (tx) => {
      const minDays = matching ? await profileMinDays(tx, org.id) : undefined;
      const r = await searchTenders(tx, effective, { orgId: org.id, matching, screenMinDays: minDays });
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
        searchQuota={searchQuotaState}
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
      const profit = org.entitlements.profitCalculator ? await calculationBadge(tx, org.id, id) : null;
      // Dokumentene leses bare når det finnes lest tekst (de fleste anbud har ingen opplastede dokumenter).
      const withDocuments = org.entitlements.documentUpload && extras.documents.some((d) => d.textStatus === 'extracted');
      const requirements = await tenderRequirementScan(tx, tender, withDocuments);
      const result = await tenderResultInfo(tx, org.id, tender);
      // Forhåndsvurdering (uten AI): frist, krav, befaring og vilkår i kunngjøringen + treffet mot profilen.
      const m = org.entitlements.matching ? extras.match : null;
      const screening = screenTender({
        match: m ? { score: m.score, excluded: m.excluded, breakdown: m.breakdown as MatchBreakdown } : null,
        deadlineAt: tender.deadlineAt,
        minDaysToDeadline: await profileMinDays(tx, org.id),
        signals: noticeSignals(tender.description),
      });
      const chat = aiModeFor(org).configured && org.entitlements.aiAnalysesPerMonth > 0 ? await chatHistory(tx, org.id, id) : null;
      return { tender, extras, labels, analysis, fit, usage, profit, requirements, result, screening, chat };
    });
    if (!data) throw new HttpError(404, 'Fant ikke kunngjøringen.');
    await markFeatureUsed(org.id, ctx.user?.id ?? null, 'tender_viewed');
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
        profit={data.profit}
        requirements={data.requirements}
        result={data.result}
        screening={data.screening}
        chat={data.chat}
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

  // Spør om anbudet (AI med kontrollerte kildehenvisninger). Teller som én AI-analyse; samme spørsmål igjen er gratis.
  router.post('/app/anbud/:id/sporsmal', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const question = formStr(await ctx.form(), 'question', MAX_QUESTION + 50);
    const result = await askTender(org, user.id, id, question);
    if (!result.ok) return redirectWith(ctx, `/app/anbud/${id}#sporsmal`, 'error', result.error);
    return redirectWith(ctx, `/app/anbud/${id}#sporsmal`, 'success', result.cached ? 'Viser lagret svar (ingen ny kostnad).' : 'Svaret er klart.');
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
    const id = param(ctx, 'id');
    const form = await ctx.form();
    const back = safeRedirectPath(formStr(form, 'back', 300), '/app/lagret');
    // Resultatfeltene sendes bare fra resultatskjemaet; statusskjemaet i listen skal ikke tømme dem.
    const result = form.get('resultForm') === '1' ? parseResultForm(form) : null;
    if (result && !result.ok) return redirectWith(ctx, back, 'error', result.error);
    const ok = await ctx.tenant(async (tx) => {
      const updated = await updateBookmark(tx, org.id, id, { status: formStr(form, 'status', 20), note: formStr(form, 'note', 2000).trim() || null });
      if (updated && result?.ok) await saveResultFields(tx, org.id, id, result.data);
      return updated;
    });
    return redirectWith(ctx, back, ok ? 'success' : 'error', ok ? 'Lagret.' : 'Kunne ikke oppdatere.');
  });

  router.post('/app/lagret/:id/vunnet', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const form = await ctx.form();
    const back = safeRedirectPath(formStr(form, 'back', 300), '/app/resultater');
    const result = await ctx.tenant((tx) => confirmAwardWin(tx, org.id, id));
    return redirectWith(ctx, back, result.ok ? 'success' : 'error', result.ok ? 'Registrert som vunnet. Gratulerer!' : result.error);
  });

  // ----------------------------------------------------- Resultater og læring
  router.get('/app/resultater', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const { rows } = await ctx.tenant((tx) => loadResults(tx, org.id));
    return render(ctx, <ResultsPage learning={learningSummary(rows)} rows={rows} />, { title: 'Resultater' });
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
