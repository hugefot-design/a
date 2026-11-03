/**
 * Future Opportunities (Enterprise). Tilgangen håndheves i ruteren (feature: futureOpportunities),
 * så andre planer får oppgraderingssiden – også ved direkte lenker og skjemainnsendinger.
 */
import { REGION_BY_CODE, INDUSTRY_BY_ID } from '@/domain/reference';
import {
  followOpportunity,
  listOpportunities,
  opportunityCoverage,
  unfollowOpportunity,
  type OpportunityFilters,
  type OpportunityKind,
} from '@/domain/opportunities/opportunities';
import { audit } from '@/lib/audit';
import { redirectWith } from '@/server/flash';
import { HttpError, safeRedirectPath } from '@/server/http';
import { render } from '@/server/render';
import type { Router } from '@/server/router';
import { OpportunitiesPage } from '@/ui/pages/app/opportunities';
import { formStr, requireOrg } from '../helpers';

const fo = { feature: 'futureOpportunities' as const };

function parseKind(v: string): OpportunityKind {
  if (v === 'planned_notice' || v === 'political_case') return v;
  throw new HttpError(400, 'Ukjent type.');
}

export function registerOpportunityRoutes(router: Router): void {
  router.get(
    '/app/fremtidige',
    'org',
    async (ctx) => {
      const { org } = requireOrg(ctx);
      const v = ctx.query.get('visning');
      const region = ctx.query.get('fylke');
      const industry = ctx.query.get('bransje');
      const filters: OpportunityFilters = {
        view: v === 'alle' ? 'all' : v === 'folger' ? 'following' : 'match',
        region: region && REGION_BY_CODE.has(region) ? region : null,
        industry: industry && INDUSTRY_BY_ID.has(industry) ? industry : null,
      };
      const [items, coverage, counts] = await Promise.all([
        ctx.tenant((tx) => listOpportunities(tx, org.id, filters)),
        opportunityCoverage(),
        ctx.tenant(async (tx) => {
          const [f] = (await tx`select count(*)::int as n from opportunity_follows where org_id = ${org.id}`) as unknown as { n: number }[];
          const [p] = (await tx`select cardinality(industries) as n from company_profiles where org_id = ${org.id}`) as unknown as { n: number }[];
          return { following: f?.n ?? 0, hasProfile: (p?.n ?? 0) > 0 };
        }),
      ]);
      return render(
        ctx,
        <OpportunitiesPage
          items={items}
          coverage={coverage}
          filters={filters}
          followingCount={counts.following}
          hasProfile={counts.hasProfile}
          back={ctx.path + ctx.url.search}
        />,
        { title: 'Fremtidige prosjekter' },
      );
    },
    fo,
  );

  for (const [path, follow] of [
    ['/app/fremtidige/folg', true],
    ['/app/fremtidige/slutt-a-folge', false],
  ] as const) {
    router.post(
      path,
      'org',
      async (ctx) => {
        const { org, user } = requireOrg(ctx);
        const form = await ctx.form();
        const kind = parseKind(formStr(form, 'kind', 30));
        const id = formStr(form, 'id', 60);
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Ugyldig prosjekt.');
        const back = safeRedirectPath(formStr(form, 'tilbake', 500), '/app/fremtidige');
        if (follow) {
          const added = await ctx.tenant((tx) => followOpportunity(tx, org.id, user.id, kind, id));
          if (added) await audit({ action: 'opportunity.followed', orgId: org.id, actorUserId: user.id, targetType: kind, targetId: id });
          return redirectWith(ctx, back, 'success', added ? 'Du følger prosjektet. Vi varsler når det skjer noe.' : 'Du følger allerede prosjektet.');
        }
        await ctx.tenant((tx) => unfollowOpportunity(tx, org.id, kind, id));
        return redirectWith(ctx, back, 'success', 'Du følger ikke lenger prosjektet.');
      },
      fo,
    );
  }
}
