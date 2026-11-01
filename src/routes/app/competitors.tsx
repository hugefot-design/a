import { first } from '@/lib/db';
import {
  authorityDetail,
  awardCoverage,
  searchSuppliers,
  supplierDetail,
  topAuthorities,
  topSuppliers,
  watchedSuppliers,
} from '@/domain/competitors/competitors';
import { redirectWith } from '@/server/flash';
import { HttpError } from '@/server/http';
import { render } from '@/server/render';
import type { Router } from '@/server/router';
import { AuthorityPage, CompetitorsPage, SupplierPage } from '@/ui/pages/app/competitors';
import { param, requireOrg } from '../helpers';

export function registerCompetitorRoutes(router: Router): void {
  const feature = { feature: 'competitorIntel' as const };

  router.get('/app/konkurrenter', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const q = (ctx.query.get('q') ?? '').trim().slice(0, 100);
    const data = await ctx.tenant(async (tx) => {
      const profile = first((await tx`select industries from company_profiles where org_id = ${org.id}`) as unknown as { industries: string[] }[]);
      const industries = profile?.industries ?? [];
      return {
        coverage: await awardCoverage(tx),
        top: await topSuppliers(tx, industries),
        watched: await watchedSuppliers(tx, org.id),
        authorities: await topAuthorities(tx, industries),
        results: q.length >= 2 ? await searchSuppliers(tx, q) : null,
      };
    });
    return render(ctx, <CompetitorsPage {...data} q={q} />, { title: 'Konkurrenter' });
  }, feature);

  router.get('/app/konkurrenter/leverandor/:id', 'org', async (ctx) => {
    const { org } = requireOrg(ctx);
    const data = await ctx.tenant((tx) => supplierDetail(tx, param(ctx, 'id'), org.id));
    if (!data) throw new HttpError(404, 'Fant ikke leverandøren.');
    return render(ctx, <SupplierPage data={data} />, { title: data.supplier.name });
  }, feature);

  router.post('/app/konkurrenter/leverandor/:id/folg', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const id = param(ctx, 'id');
    const watching = await ctx.tenant(async (tx) => {
      const deleted = await tx`delete from competitor_watch where org_id = ${org.id} and supplier_id = ${id} returning supplier_id`;
      if (deleted.length) return false;
      const exists = await tx`select 1 from suppliers where id = ${id}`;
      if (!exists.length) throw new HttpError(404, 'Fant ikke leverandøren.');
      await tx`insert into competitor_watch (org_id, supplier_id, created_by) values (${org.id}, ${id}, ${user.id})`;
      return true;
    });
    return redirectWith(ctx, `/app/konkurrenter/leverandor/${id}`, 'success', watching ? 'Dere følger nå med på leverandøren.' : 'Dere følger ikke lenger med.');
  }, feature);

  router.get('/app/konkurrenter/oppdragsgiver/:id', 'org', async (ctx) => {
    const data = await ctx.tenant((tx) => authorityDetail(tx, param(ctx, 'id')));
    if (!data) throw new HttpError(404, 'Fant ikke oppdragsgiveren.');
    return render(ctx, <AuthorityPage data={data} />, { title: data.authority.name });
  }, feature);
}
