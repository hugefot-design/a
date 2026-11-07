/**
 * Ruter for Profit Intelligence: lønnsomhet per anbud, portefølje, kapasitet/økonomi og anbudspartnere.
 * Plansperrer: kalkulator (Profesjonell+), AI-analyse og partnersøk (Bedrift+), partnerprofil (Start+).
 * Endringer i bedriftens økonomi, kapasitet og partnerprofil krever eier/administrator (også i databasen).
 */
import { getTender } from '@/domain/tenders/queries';
import { parseMonths } from '@/domain/profit/capacity';
import { marketPrice } from '@/domain/profit/market';
import { learningSummary, loadResults } from '@/domain/tenders/results';
import { getProfile } from '@/domain/profile/profile';
import { usageSummary } from '@/domain/ai/usage';
import { getLatestProfitAnalysis, runProfitAnalysis } from '@/domain/profit/ai';
import {
  addContract,
  addEquipment,
  addStaff,
  contractSchema,
  defaultInputs,
  deleteCalculation,
  deleteCapacityRow,
  documentedFacts,
  economicsFromData,
  economicsSchema,
  equipmentSchema,
  formFields,
  getCalculation,
  getEconomics,
  listPortfolio,
  loadCapacityData,
  loadProfitWorkspace,
  mergeAnalysisIntoInputs,
  parseCalcForm,
  parseNumber,
  refreshSnapshotIfChanged,
  saveCalculation,
  saveEconomics,
  snapshotOf,
  staffSchema,
  type StoredInputs,
} from '@/domain/profit/service';
import {
  answerPartnerRequest,
  getOwnPartnerProfile,
  getPartnerCard,
  listPartnerRequests,
  partnerAnswerSchema,
  partnerDefaultsFromCompany,
  partnerFormFromData,
  partnerProfileSchema,
  partnerRequestFromData,
  partnerRequestSchema,
  savePartnerProfile,
  searchPartners,
  sendPartnerRequest,
  withdrawPartnerRequest,
} from '@/domain/profit/partners';
import { redirectWith } from '@/server/flash';
import { HttpError, type RequestContext } from '@/server/http';
import { render } from '@/server/render';
import { isUuid, type Router } from '@/server/router';
import { CapacityPage, PartnersPage, PortfolioPage, ProfitWorkspacePage } from '@/ui/pages/app/profit';
import { formBool, param, requireManager, requireOrg } from '../helpers';

function zodErrors(error: { issues: { message: string }[] }): string[] {
  return [...new Set(error.issues.map((i) => i.message))].slice(0, 8);
}

async function renderWorkspace(ctx: RequestContext, tenderId: string, opts: { errors?: string[]; status?: number; inputsOverride?: StoredInputs; testPrice?: number | null } = {}) {
  const { org } = requireOrg(ctx);
  const data = await ctx.tenant(async (tx) => {
    const ws = await loadProfitWorkspace(tx, org, tenderId, { inputsOverride: opts.inputsOverride, testPrice: opts.testPrice ?? null });
    if (!ws) return null;
    if (!opts.inputsOverride) await refreshSnapshotIfChanged(tx, org.id, tenderId, ws);
    // Markedspris fra tidligere tildelinger, og hvor treffsikre kalkylene har vært (fra Resultater).
    const market = await marketPrice(tx, ws.tender);
    const learning = learningSummary((await loadResults(tx, org.id)).rows);
    const calcHistory = learning.medianCalcDiffPct !== null ? { medianPct: learning.medianCalcDiffPct, n: learning.calcVsResult.length } : null;
    return { ws, usage: await usageSummary(tx, org), market, calcHistory };
  });
  if (!data) throw new HttpError(404, 'Fant ikke kunngjøringen.');
  return render(
    ctx,
    <ProfitWorkspacePage
      ws={data.ws}
      errors={opts.errors}
      canRunAi={org.entitlements.profitAI}
      canSearchPartners={org.entitlements.partnerSearch}
      aiQuota={{ used: data.usage.analyses, limit: data.usage.analysesLimit }}
      market={data.market}
      calcHistory={data.calcHistory}
    />,
    { title: `Lønnsomhet – ${data.ws.tender.title}`, status: opts.status },
  );
}

export function registerProfitRoutes(router: Router): void {
  const calc = { feature: 'profitCalculator' as const };
  const ai = { feature: 'profitAI' as const };
  const listing = { feature: 'partnerListing' as const };
  const search = { feature: 'partnerSearch' as const };

  // ------------------------------------------------------------ Portefølje
  router.get('/app/lonnsomhet', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const data = await ctx.tenant((tx) => listPortfolio(tx, org.id));
    return render(ctx, <PortfolioPage data={data} />, { title: 'Lønnsomhet' });
  }, calc);

  // ------------------------------------------------------------ Lønnsomhet per anbud
  router.get('/app/anbud/:id/lonnsomhet', 'org', async (ctx) => {
    const id = param(ctx, 'id');
    const raw = ctx.query.get('pris');
    const parsed = raw ? parseNumber(raw) : null;
    const testPrice = typeof parsed === 'number' && parsed > 0 && parsed < 1e12 ? parsed : null;
    return renderWorkspace(ctx, id, { testPrice });
  }, calc);

  router.post('/app/anbud/:id/lonnsomhet', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const form = await ctx.form();
    const outcome = await ctx.tenant(async (tx) => {
      const tender = await getTender(tx, id);
      if (!tender) return null;
      const stored = await getCalculation(tx, org.id, id);
      const { inputs, errors } = parseCalcForm(form, stored?.inputs ?? null, documentedFacts(tender));
      if (errors.length) return { inputs, errors, label: null as string | null };
      const ws = await loadProfitWorkspace(tx, org, id, { inputsOverride: inputs });
      await saveCalculation(tx, { orgId: org.id, userId: user.id, ipHash: ctx.ipHash }, id, inputs, snapshotOf(ws!));
      return { inputs, errors, label: ws!.recommendation.label };
    });
    if (!outcome) throw new HttpError(404, 'Fant ikke kunngjøringen.');
    if (outcome.errors.length) return renderWorkspace(ctx, id, { errors: outcome.errors, status: 400, inputsOverride: outcome.inputs });
    return redirectWith(ctx, `/app/anbud/${id}/lonnsomhet`, 'success', `Kalkylen er lagret. Anbefaling: ${outcome.label}.`);
  }, calc);

  router.post('/app/anbud/:id/lonnsomhet/slett', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    await ctx.tenant((tx) => deleteCalculation(tx, { orgId: org.id, userId: user.id, ipHash: ctx.ipHash }, id));
    return redirectWith(ctx, '/app/lonnsomhet', 'success', 'Kalkylen er slettet.');
  }, calc);

  router.post('/app/anbud/:id/lonnsomhet/ai', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const form = await ctx.form();
    const result = await runProfitAnalysis(org, user.id, id, { force: formBool(form, 'force') });
    if (!result.ok) return redirectWith(ctx, `/app/anbud/${id}/lonnsomhet`, 'error', result.error);
    // Første gang: hent mengdene rett inn i en tom kalkyle (brukeren kan endre alt etterpå).
    const imported = await ctx.tenant(async (tx) => {
      const tender = await getTender(tx, id);
      const analysis = await getLatestProfitAnalysis(tx, id, org.id);
      if (!tender || !analysis) return 0;
      const stored = await getCalculation(tx, org.id, id);
      if (stored && stored.inputs.lines.length > 0) return 0;
      const economics = await getEconomics(tx, org.id);
      const base = stored?.inputs ?? defaultInputs(tender, economics);
      const merged = mergeAnalysisIntoInputs(base, analysis, economics);
      const ws = await loadProfitWorkspace(tx, org, id, { inputsOverride: merged.inputs });
      await saveCalculation(tx, { orgId: org.id, userId: user.id, ipHash: ctx.ipHash }, id, merged.inputs, snapshotOf(ws!), { audit: false });
      return merged.added;
    });
    const message = result.cached
      ? 'Viser lagret analyse (ingen ny kostnad).'
      : imported
        ? `Analysen er klar. ${imported} mengder er hentet inn i kalkylen – fyll inn deres egne enhetskostnader.`
        : 'Analysen er klar.';
    return redirectWith(ctx, `/app/anbud/${id}/lonnsomhet`, 'success', message);
  }, ai);

  router.post('/app/anbud/:id/lonnsomhet/importer', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const added = await ctx.tenant(async (tx) => {
      const tender = await getTender(tx, id);
      const analysis = await getLatestProfitAnalysis(tx, id, org.id);
      if (!tender || !analysis) return null;
      const economics = await getEconomics(tx, org.id);
      const stored = await getCalculation(tx, org.id, id);
      const merged = mergeAnalysisIntoInputs(stored?.inputs ?? defaultInputs(tender, economics), analysis, economics);
      const ws = await loadProfitWorkspace(tx, org, id, { inputsOverride: merged.inputs });
      await saveCalculation(tx, { orgId: org.id, userId: user.id, ipHash: ctx.ipHash }, id, merged.inputs, snapshotOf(ws!));
      return merged.added;
    });
    if (added === null) return redirectWith(ctx, `/app/anbud/${id}/lonnsomhet`, 'error', 'Kjør AI-analysen først.');
    return redirectWith(ctx, `/app/anbud/${id}/lonnsomhet`, 'success', added ? `${added} mengder er hentet inn. Kontroller dem og fyll inn enhetskostnader.` : 'Ingen nye mengder å hente inn.');
  }, ai);

  // ------------------------------------------------------------ Kapasitet og økonomi
  router.get('/app/kapasitet', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const data = await ctx.tenant((tx) => loadCapacityData(tx, org.id));
    return render(ctx, <CapacityPage data={data} canManage={org.role === 'owner' || org.role === 'admin'} />, { title: 'Kapasitet og økonomi' });
  }, calc);

  async function capacityError(ctx: RequestContext, errors: string[]) {
    const { org } = requireOrg(ctx);
    const data = await ctx.tenant((tx) => loadCapacityData(tx, org.id));
    return render(ctx, <CapacityPage data={data} canManage errors={errors} />, { title: 'Kapasitet og økonomi', status: 400 });
  }

  router.post('/app/kapasitet/okonomi', 'org', async (ctx) => {
    const { org, user } = requireManager(ctx);
    const parsed = economicsSchema.safeParse(economicsFromData(await ctx.form()));
    if (!parsed.success) return capacityError(ctx, zodErrors(parsed.error));
    await ctx.tenant((tx) => saveEconomics(tx, { orgId: org.id, userId: user.id, ipHash: ctx.ipHash }, parsed.data));
    return redirectWith(ctx, '/app/kapasitet', 'success', 'De økonomiske forutsetningene er lagret.');
  }, calc);

  router.post('/app/kapasitet/bemanning', 'org', async (ctx) => {
    const { org, user } = requireManager(ctx);
    const parsed = staffSchema.safeParse(formFields(await ctx.form(), ['role', 'headcount', 'hoursPerYearEach', 'certifications', 'notes']));
    if (!parsed.success) return capacityError(ctx, zodErrors(parsed.error));
    const error = await ctx.tenant((tx) => addStaff(tx, { orgId: org.id, userId: user.id }, parsed.data));
    if (error) return redirectWith(ctx, '/app/kapasitet', 'error', error);
    return redirectWith(ctx, '/app/kapasitet', 'success', 'Rollen er lagt til.');
  }, calc);

  router.post('/app/kapasitet/utstyr', 'org', async (ctx) => {
    const { org, user } = requireManager(ctx);
    const parsed = equipmentSchema.safeParse(formFields(await ctx.form(), ['name', 'category', 'quantity', 'notes']));
    if (!parsed.success) return capacityError(ctx, zodErrors(parsed.error));
    const error = await ctx.tenant((tx) => addEquipment(tx, { orgId: org.id, userId: user.id }, parsed.data));
    if (error) return redirectWith(ctx, '/app/kapasitet', 'error', error);
    return redirectWith(ctx, '/app/kapasitet', 'success', 'Utstyret er lagt til.');
  }, calc);

  router.post('/app/kapasitet/kontrakter', 'org', async (ctx) => {
    const { org, user } = requireManager(ctx);
    const form = await ctx.form();
    const parsed = contractSchema.safeParse(formFields(form, ['name', 'client', 'startDate', 'endDate', 'hoursPerMonth', 'notes']));
    if (!parsed.success) return capacityError(ctx, zodErrors(parsed.error));
    const error = await ctx.tenant((tx) => addContract(tx, { orgId: org.id, userId: user.id }, parsed.data, parseMonths(form.getAll('activeMonths'))));
    if (error) return redirectWith(ctx, '/app/kapasitet', 'error', error);
    return redirectWith(ctx, '/app/kapasitet', 'success', 'Kontrakten er lagt til.');
  }, calc);

  const tables = { bemanning: 'org_staff', utstyr: 'org_equipment', kontrakter: 'org_contracts' } as const;
  for (const [segment, table] of Object.entries(tables)) {
    router.post(`/app/kapasitet/${segment}/:id/slett`, 'org', async (ctx) => {
      const { org, user } = requireManager(ctx);
      const id = param(ctx, 'id');
      const deleted = await ctx.tenant((tx) => deleteCapacityRow(tx, { orgId: org.id, userId: user.id }, table, id));
      return redirectWith(ctx, '/app/kapasitet', deleted ? 'success' : 'error', deleted ? 'Slettet.' : 'Fant ikke raden.');
    }, calc);
  }

  // ------------------------------------------------------------ Anbudspartnere
  router.get('/app/partnere', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const canSearch = org.entitlements.partnerSearch;
    const q = {
      text: (ctx.query.get('q') ?? '').slice(0, 100),
      region: ctx.query.get('omrade') ?? '',
      certification: ctx.query.get('sertifisering') ?? '',
      industry: ctx.query.get('bransje') ?? '',
      role: ctx.query.get('rolle') ?? '',
    };
    const hasQuery = Object.values(q).some(Boolean);
    const targetId = ctx.query.get('til');
    const tenderId = ctx.query.get('anbud');
    const data = await ctx.tenant(async (tx) => {
      const [profile, company, requests] = await Promise.all([getOwnPartnerProfile(tx, org.id), getProfile(tx, org.id), listPartnerRequests(tx, org.id)]);
      const target = canSearch && isUuid(targetId) && targetId !== org.id ? await getPartnerCard(tx, targetId) : null;
      const tender = isUuid(tenderId) ? await getTender(tx, tenderId) : null;
      const results = canSearch ? await searchPartners(tx, org.id, q) : null;
      return { profile, company, requests, target, tender: tender ? { id: tender.id, title: tender.title } : null, results };
    });
    return render(
      ctx,
      <PartnersPage
        profile={data.profile}
        defaults={partnerDefaultsFromCompany(data.company, org.name)}
        requests={data.requests}
        canManage={org.role === 'owner' || org.role === 'admin'}
        canSearch={canSearch}
        search={hasQuery ? q : null}
        results={data.results}
        target={data.target}
        tender={data.tender}
      />,
      { title: 'Anbudspartnere' },
    );
  }, listing);

  router.post('/app/partnere/profil', 'org', async (ctx) => {
    const { org, user } = requireManager(ctx);
    const parsed = partnerProfileSchema.safeParse(partnerFormFromData(await ctx.form()));
    if (!parsed.success) return redirectWith(ctx, '/app/partnere', 'error', zodErrors(parsed.error).join(' '));
    await ctx.tenant((tx) => savePartnerProfile(tx, { orgId: org.id, userId: user.id, ipHash: ctx.ipHash }, parsed.data));
    return redirectWith(ctx, '/app/partnere', 'success', parsed.data.published ? 'Partnerprofilen er publisert.' : 'Partnerprofilen er lagret og vises ikke for andre.');
  }, listing);

  router.post('/app/partnere/foresporsel', 'org', async (ctx) => {
    const { org, user } = requireManager(ctx);
    const parsed = partnerRequestSchema.safeParse(partnerRequestFromData(await ctx.form()));
    if (!parsed.success) return redirectWith(ctx, '/app/partnere', 'error', zodErrors(parsed.error).join(' '));
    const result = await ctx.tenant((tx) => sendPartnerRequest(tx, { orgId: org.id, userId: user.id, ipHash: ctx.ipHash }, parsed.data));
    if (!result.ok) {
      const back = `/app/partnere?til=${parsed.data.toOrgId}${parsed.data.tenderId ? `&anbud=${parsed.data.tenderId}` : ''}#foresporsel`;
      return redirectWith(ctx, back, 'error', result.error);
    }
    return redirectWith(ctx, '/app/partnere#sendte', 'success', 'Forespørselen er sendt. Dere får varsel når den er besvart.');
  }, search);

  router.post('/app/partnere/foresporsel/:id/svar', 'org', async (ctx) => {
    const { org, user } = requireManager(ctx);
    const id = param(ctx, 'id');
    const form = await ctx.form();
    const parsed = partnerAnswerSchema.safeParse({
      decision: form.get('decision'),
      contactName: form.get('contactName') ?? undefined,
      contactEmail: form.get('contactEmail') ?? undefined,
    });
    if (!parsed.success) return redirectWith(ctx, '/app/partnere#innkommende', 'error', zodErrors(parsed.error).join(' '));
    const result = await ctx.tenant((tx) => answerPartnerRequest(tx, { orgId: org.id, userId: user.id, ipHash: ctx.ipHash }, id, parsed.data));
    if (!result.ok) return redirectWith(ctx, '/app/partnere#innkommende', 'error', result.error);
    return redirectWith(ctx, '/app/partnere#innkommende', 'success', parsed.data.decision === 'accept' ? 'Forespørselen er godtatt, og kontaktinfoen er delt.' : 'Forespørselen er avslått.');
  }, listing);

  router.post('/app/partnere/foresporsel/:id/trekk', 'org', async (ctx) => {
    const { org, user } = requireManager(ctx);
    const id = param(ctx, 'id');
    const result = await ctx.tenant((tx) => withdrawPartnerRequest(tx, { orgId: org.id, userId: user.id, ipHash: ctx.ipHash }, id));
    if (!result.ok) return redirectWith(ctx, '/app/partnere#sendte', 'error', result.error);
    return redirectWith(ctx, '/app/partnere#sendte', 'success', 'Forespørselen er trukket tilbake.');
  }, listing);
}
