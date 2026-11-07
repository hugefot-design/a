/**
 * AnbudRadar Intelligence: samlet vurdering per anbud og PDF av den. Alle planer har siden; hver del viser bare
 * det planen gir tilgang til (se src/domain/intelligence/load.ts). Data hentes innenfor organisasjonens tilgang.
 */
import { loadIntelligence } from '@/domain/intelligence/load';
import { intelligencePdf } from '@/domain/intelligence/pdf';
import { HttpError } from '@/server/http';
import { render } from '@/server/render';
import type { Router } from '@/server/router';
import { IntelligencePage } from '@/ui/pages/app/intelligence';
import { param, requireOrg } from '../helpers';

/** Filnavn med bare trygge tegn (æøå → ae/o/a). */
function fileName(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `intelligence-${ascii || 'anbud'}.pdf`;
}

export function registerIntelligenceRoutes(router: Router): void {
  router.get('/app/anbud/:id/intelligence', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const report = await ctx.tenant((tx) => loadIntelligence(tx, org, param(ctx, 'id')));
    if (!report) throw new HttpError(404, 'Fant ikke kunngjøringen.');
    return render(ctx, <IntelligencePage report={report} />, { title: `Intelligence – ${report.tender.title}` });
  });

  router.get('/app/anbud/:id/intelligence/pdf', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const report = await ctx.tenant((tx) => loadIntelligence(tx, org, param(ctx, 'id')));
    if (!report) throw new HttpError(404, 'Fant ikke kunngjøringen.');
    const pdf = await intelligencePdf(report, { orgName: org.name });
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName(report.tender.title)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}
