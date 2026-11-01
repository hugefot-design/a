import { first } from '@/lib/db';
import { integrationStatus } from '@/lib/env';
import { rateLimit } from '@/lib/rate-limit';
import {
  changeStatus,
  createWorkspace,
  deleteBidDocument,
  getBidDocument,
  invalidateApproval,
  listWorkspaces,
  loadWorkspace,
  uploadBidDocument,
  type BidAction,
} from '@/domain/bids/bids';
import { draftSection, generateChecklist, reviewDraft } from '@/domain/bids/ai';
import { toDocx, toMarkdown, toPrintHtml } from '@/domain/bids/export';
import { usageSummary } from '@/domain/ai/usage';
import { redirectWith } from '@/server/flash';
import { HttpError, json, redirect } from '@/server/http';
import { render } from '@/server/render';
import type { Router } from '@/server/router';
import { BidsListPage, BidWorkspacePage } from '@/ui/pages/app/bids';
import { formStr, param, requireOrg, wantsJsonResponse } from '../helpers';

const LOCKED = new Set(['submitted', 'archived']);

function asciiFilename(name: string): string {
  return name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '').slice(0, 120) || 'tilbud';
}

export function registerBidRoutes(router: Router): void {
  const feature = { feature: 'bidAssistant' as const };

  router.get('/app/tilbud', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const rows = await ctx.tenant((tx) => listWorkspaces(tx, org.id));
    return render(ctx, <BidsListPage rows={rows} />, { title: 'Tilbudsarbeid' });
  }, feature);

  router.post('/app/tilbud', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const tenderId = formStr(await ctx.form(), 'tenderId', 100);
    if (!/^[0-9a-f-]{36}$/i.test(tenderId)) throw new HttpError(400, 'Ugyldig kunngjøring.');
    const result = await createWorkspace(org, user.id, tenderId);
    if (!result.ok) return redirectWith(ctx, `/app/anbud/${tenderId}`, 'error', result.error);
    return redirect(`/app/tilbud/${result.id}`);
  }, feature);

  router.get('/app/tilbud/:id', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const data = await ctx.tenant(async (tx) => {
      const ws = await loadWorkspace(tx, org.id, id);
      return ws ? { ...ws, usage: await usageSummary(tx, org) } : null;
    });
    if (!data) throw new HttpError(404, 'Fant ikke tilbudsarbeidet.');
    return render(
      ctx,
      <BidWorkspacePage
        ws={data.ws}
        checklist={data.checklist}
        sections={data.sections}
        documents={data.documents}
        review={data.review}
        aiConfigured={integrationStatus().ai}
        draftQuota={{ used: data.usage.drafts, limit: data.usage.draftsLimit }}
      />,
      { title: `Tilbud: ${data.ws.tenderTitle}` },
    );
  }, feature);

  router.post('/app/tilbud/:id/status', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const form = await ctx.form();
    const action = formStr(form, 'action', 30) as BidAction;
    const result = await changeStatus(org, user.id, id, action, form.get('confirmed') === 'on');
    return redirectWith(ctx, `/app/tilbud/${id}`, result.ok ? 'success' : 'error', result.ok ? 'Status er oppdatert.' : result.error);
  }, feature);

  // Sjekkliste
  router.post('/app/tilbud/:id/sjekkliste', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const label = formStr(await ctx.form(), 'label', 500).trim();
    if (!label) return redirectWith(ctx, `/app/tilbud/${id}`, 'error', 'Skriv inn et punkt.');
    await ctx.tenant(async (tx) => {
      const ws = first((await tx`select status from bid_workspaces where id = ${id}`) as unknown as { status: string }[]);
      if (!ws || LOCKED.has(ws.status)) throw new HttpError(400, 'Tilbudet er låst.');
      await tx`
        insert into bid_checklist_items (workspace_id, org_id, label, source, sort_order)
        values (${id}, ${org.id}, ${label}, 'manual', (select coalesce(max(sort_order), 0) + 1 from bid_checklist_items where workspace_id = ${id}))
      `;
    });
    return redirect(`/app/tilbud/${id}`);
  }, feature);

  router.post('/app/tilbud/:id/sjekkliste/ai', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const result = await generateChecklist(org, user.id, id);
    return redirectWith(ctx, `/app/tilbud/${id}`, result.ok ? 'success' : 'error', result.ok ? `${result.count} punkter er lagt til fra kravene.` : result.error);
  }, feature);

  router.post('/app/tilbud/:id/sjekkliste/:itemId', 'org', async (ctx) => {
    const { user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const itemId = param(ctx, 'itemId');
    const done = formStr(await ctx.form(), 'done', 2) === '1';
    await ctx.tenant(
      (tx) => tx`
        update bid_checklist_items set is_done = ${done}, done_by = ${done ? user.id : null}, done_at = ${done ? new Date() : null}
        where id = ${itemId} and workspace_id = ${id}
      `,
    );
    return redirect(`/app/tilbud/${id}`);
  }, feature);

  router.post('/app/tilbud/:id/sjekkliste/:itemId/slett', 'org', async (ctx) => {
    const id = param(ctx, 'id');
    await ctx.tenant((tx) => tx`delete from bid_checklist_items where id = ${param(ctx, 'itemId')} and workspace_id = ${id}`);
    return redirect(`/app/tilbud/${id}`);
  }, feature);

  // Seksjoner
  router.post('/app/tilbud/:id/seksjoner', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const title = formStr(await ctx.form(), 'title', 200).trim();
    if (!title) return redirectWith(ctx, `/app/tilbud/${id}`, 'error', 'Gi seksjonen et navn.');
    await ctx.tenant(async (tx) => {
      const ws = first((await tx`select status from bid_workspaces where id = ${id}`) as unknown as { status: string }[]);
      if (!ws || LOCKED.has(ws.status)) throw new HttpError(400, 'Tilbudet er låst.');
      await tx`
        insert into bid_sections (workspace_id, org_id, title, sort_order, updated_by)
        values (${id}, ${org.id}, ${title}, (select coalesce(max(sort_order), 0) + 1 from bid_sections where workspace_id = ${id}), ${user.id})
      `;
      await invalidateApproval(tx, id);
    });
    return redirect(`/app/tilbud/${id}`);
  }, feature);

  // Lagring (brukes både av autolagring (JSON) og vanlig skjema)
  router.post('/app/tilbud/:id/seksjoner/:sectionId', 'org', async (ctx) => {
    const { user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const sectionId = param(ctx, 'sectionId');
    const content = formStr(await ctx.form(), 'content', 50_000);
    const ok = await ctx.tenant(async (tx) => {
      const ws = first((await tx`select status from bid_workspaces where id = ${id}`) as unknown as { status: string }[]);
      if (!ws || LOCKED.has(ws.status)) return false;
      const rows = await tx`
        update bid_sections set content = ${content}, updated_by = ${user.id} where id = ${sectionId} and workspace_id = ${id}
          and content is distinct from ${content}
        returning id
      `;
      if (rows.length) await invalidateApproval(tx, id);
      return true;
    });
    if (wantsJsonResponse(ctx)) return ok ? json({ saved: true }) : json({ error: 'Tilbudet er låst.' }, { status: 409 });
    return redirectWith(ctx, `/app/tilbud/${id}`, ok ? 'success' : 'error', ok ? 'Teksten er lagret.' : 'Tilbudet er låst.');
  }, feature);

  router.post('/app/tilbud/:id/seksjoner/:sectionId/ai', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const result = await draftSection(org, user.id, id, param(ctx, 'sectionId'));
    if (!result.ok) return redirectWith(ctx, `/app/tilbud/${id}`, 'error', result.error);
    return redirectWith(
      ctx,
      `/app/tilbud/${id}`,
      'success',
      `Utkastet er lagt inn. ${result.placeholders ? `${result.placeholders} opplysninger må fylles inn ([FYLL INN: …]).` : ''} Les gjennom før dere bruker teksten.`,
    );
  }, feature);

  router.post('/app/tilbud/:id/gjennomgang/ai', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const result = await reviewDraft(org, user.id, id);
    return redirectWith(ctx, `/app/tilbud/${id}`, result.ok ? 'success' : 'error', result.ok ? 'Sammenligningen er klar.' : result.error);
  }, feature);

  // Dokumenter
  router.post(
    '/app/tilbud/:id/dokumenter',
    'org',
    async (ctx) => {
      const { org, user } = requireOrg(ctx);
      const id = param(ctx, 'id');
      if (!(await rateLimit(`bid-upload:${org.id}`, 60, 3600))) throw new HttpError(429, 'For mange opplastinger.');
      const form = await ctx.form();
      const file = form.get('file');
      if (!(file instanceof File)) return redirectWith(ctx, `/app/tilbud/${id}`, 'error', 'Velg en fil.');
      const result = await uploadBidDocument(org, user.id, id, file, formStr(form, 'category', 40));
      return redirectWith(ctx, `/app/tilbud/${id}`, result.ok ? 'success' : 'error', result.ok ? 'Dokumentet er lastet opp.' : result.error);
    },
    { ...feature, maxBodyMb: 30 },
  );

  router.get('/app/tilbud/:id/dokumenter/:docId', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const doc = await getBidDocument(org, user.id, param(ctx, 'docId'));
    if (!doc) throw new HttpError(404, 'Fant ikke dokumentet.');
    return new Response(new Uint8Array(doc.data), {
      headers: {
        'Content-Type': doc.mimeType,
        'Content-Disposition': `attachment; filename="${asciiFilename(doc.name)}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  }, feature);

  router.post('/app/tilbud/:id/dokumenter/:docId/slett', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const ok = await deleteBidDocument(org, user.id, param(ctx, 'docId'));
    return redirectWith(ctx, `/app/tilbud/${id}`, ok ? 'success' : 'error', ok ? 'Dokumentet er slettet.' : 'Fant ikke dokumentet.');
  }, feature);

  // Eksport
  router.get('/app/tilbud/:id/eksport', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const data = await ctx.tenant((tx) => loadWorkspace(tx, org.id, param(ctx, 'id')));
    if (!data) throw new HttpError(404, 'Fant ikke tilbudsarbeidet.');
    const format = ctx.query.get('format');
    const base = asciiFilename(`tilbud-${data.ws.tenderTitle}`).replace(/\s+/g, '-').toLowerCase();
    if (format === 'md') {
      return new Response(toMarkdown(data.ws, data.sections, data.checklist), {
        headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${base}.md"`, 'Cache-Control': 'no-store' },
      });
    }
    if (format === 'html') {
      return new Response(toPrintHtml(data.ws, data.sections), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    const buf = await toDocx(data.ws, data.sections);
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${base}.docx"`,
        'Cache-Control': 'no-store',
      },
    });
  }, feature);
}
