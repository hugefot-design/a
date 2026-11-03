/**
 * Future Opportunities: planlagte anskaffelser og politiske saker før de blir anbud (Enterprise).
 * Fakta fra kilden og AnbudRadars vurdering vises alltid hver for seg.
 */
import { LuArrowUpRight, LuEye, LuEyeOff } from 'react-icons/lu';
import type { OpportunityCoverage, OpportunityFilters, OpportunityItem } from '@/domain/opportunities/opportunities';
import { INDUSTRIES, REGIONS } from '@/domain/reference';
import { Badge, Button, cn, PageHeader, Panel, PostForm, Tabs } from '../../components';
import { AppShell } from '../../layouts';
import { formatInt, relativeTime } from '../../format';

const TONE = {
  planned: 'info',
  published: 'ok',
  awarded: 'neutral',
  cancelled: 'danger',
  case: 'marker',
} as const;

function viewHref(view: string, f: OpportunityFilters) {
  const p = new URLSearchParams();
  if (view !== 'match') p.set('visning', view);
  if (f.region) p.set('fylke', f.region);
  if (f.industry) p.set('bransje', f.industry);
  const q = p.toString();
  return `/app/fremtidige${q ? `?${q}` : ''}`;
}

function Coverage({ c }: { c: OpportunityCoverage }) {
  return (
    <Panel className="mb-6">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="text-[15px] font-semibold text-navy-900">Datadekning</span>
            <span className="ml-2 text-[13px] text-muted">
              {formatInt(c.plannedNotices)} planlagte anskaffelser og {formatInt(c.signals)} politiske saker siste 18 måneder
            </span>
          </span>
          <span className="text-[13px] font-semibold text-navy-700 group-open:hidden">Vis kilder</span>
        </summary>
        <div className="border-t border-line px-5 py-4 text-[14px]">
          <ul className="space-y-2">
            {c.sources.map((s) => (
              <li key={`${s.name}${s.what}`} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
                <span>
                  <span className="font-semibold text-ink">{s.name}</span> <span className="text-muted">– {s.what}</span>
                </span>
                <span className={cn('text-[13px]', s.lastError ? 'text-danger' : 'text-muted')}>
                  {s.lastSuccessAt ? `Sist hentet ${relativeTime(s.lastSuccessAt)}` : 'Ikke hentet ennå'}
                  {s.lastError ? ' · siste forsøk feilet' : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-muted">
            Vi finner ikke alle fremtidige prosjekter. Mange anskaffelser forhåndskunngjøres ikke, og ikke alle kommuner publiserer møtesaker i eInnsyn.
            Politiske saker tas med når tittelen tyder på et prosjekt eller en anskaffelse. Kommunebudsjetter og investeringsplaner som PDF er ikke med ennå.
            Det som står under «Fra kilden», er hentet fra kilden og lenket. «Vår vurdering» er beregnet av AnbudRadar – ingen verdier eller datoer er
            anslått.
          </p>
        </div>
      </details>
    </Panel>
  );
}

function Item({ i, back }: { i: OpportunityItem; back: string }) {
  return (
    <Panel as="article" className="p-5">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <Badge tone={TONE[i.status.tone]}>{i.status.label}</Badge>
        <span className="font-mono uppercase tracking-[0.08em] text-muted">{i.sourceName}</span>
        {i.publishedAt ? <span className="text-muted">· {relativeTime(i.publishedAt)}</span> : null}
        {i.following ? <Badge tone="outline">Følger</Badge> : null}
      </div>
      <h2 className="mt-2 text-[17px] font-semibold leading-snug text-navy-950">
        {i.detailUrl ? <a href={i.detailUrl}>{i.title}</a> : i.title}
      </h2>
      <p className="mt-1 text-[14px] text-muted">
        {[i.publisher, i.regionNames.join(', '), i.industryNames.join(', ')].filter(Boolean).join(' · ') || 'Organ ikke oppgitt'}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Fra kilden</p>
          <dl className="mt-1.5 space-y-1 text-[14px]">
            {i.facts.map((f) => (
              <div key={f.label} className="flex flex-wrap gap-x-2">
                <dt className="text-muted">{f.label}:</dt>
                <dd className="font-medium text-ink">{f.value}</dd>
              </div>
            ))}
            {i.kind === 'planned_notice' ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted">Utlysning:</dt>
                <dd className="text-ink">kilden oppgir ikke dato</dd>
              </div>
            ) : null}
          </dl>
        </div>
        <div className="min-w-0 rounded-md bg-paper p-3">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Vår vurdering</p>
          <ul className="mt-1.5 space-y-1 text-[14px] text-ink">
            {i.match.score !== null ? <li>Passer profilen: {i.match.score} av 100</li> : <li className="text-muted">Ikke vurdert mot profilen</li>}
            {i.match.reasons.map((r) => (
              <li key={r} className="text-muted">
                {r}
              </li>
            ))}
            {i.matchedTerms.length ? <li className="text-muted">Tatt med fordi tittelen nevner: {i.matchedTerms.map((t) => `«${t}»`).join(', ')}</li> : null}
          </ul>
        </div>
      </div>
      {i.related.length ? (
        <div className="mt-4 rounded-md border border-dashed border-line-strong p-3 text-[14px]">
          <p className="font-semibold text-ink">Kan gjelde dette prosjektet</p>
          <p className="text-[13px] text-muted">Nye konkurranser fra samme oppdragsgiver innen samme område. Vår vurdering – sjekk selv.</p>
          <ul className="mt-2 space-y-1">
            {i.related.map((r) => (
              <li key={r.tenderId}>
                <a href={`/app/anbud/${r.tenderId}`}>{r.title}</a>
                <span className="text-muted"> · {relativeTime(r.firstSeenAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <PostForm action={i.following ? '/app/fremtidige/slutt-a-folge' : '/app/fremtidige/folg'}>
          <input type="hidden" name="kind" value={i.kind} />
          <input type="hidden" name="id" value={i.id} />
          <input type="hidden" name="tilbake" value={back} />
          <Button size="sm" variant={i.following ? 'secondary' : 'primary'}>
            {i.following ? <LuEyeOff className="size-4" aria-hidden /> : <LuEye className="size-4" aria-hidden />}
            {i.following ? 'Slutt å følge' : 'Følg prosjektet'}
          </Button>
        </PostForm>
        {i.sourceUrl ? (
          <a href={i.sourceUrl} rel="noopener" className="inline-flex items-center gap-1 text-[14px] font-semibold">
            Åpne hos {i.sourceName} <LuArrowUpRight className="size-4" aria-hidden />
          </a>
        ) : null}
      </div>
    </Panel>
  );
}

export function OpportunitiesPage({
  items,
  coverage,
  filters,
  followingCount,
  hasProfile,
  back,
}: {
  items: OpportunityItem[];
  coverage: OpportunityCoverage;
  filters: OpportunityFilters;
  followingCount: number;
  hasProfile: boolean;
  back: string;
}) {
  const empty =
    filters.view === 'following'
      ? 'Du følger ingen prosjekter ennå. Trykk «Følg prosjektet» på et prosjekt for å få varsel når det utvikler seg.'
      : filters.view === 'match'
        ? hasProfile
          ? 'Ingen fremtidige prosjekter passer profilen akkurat nå. Se «Alle», eller utvid bransjer og fylker i bedriftsprofilen.'
          : 'Fyll ut bedriftsprofilen for å se prosjekter som passer dere.'
        : 'Ingen fremtidige prosjekter med disse filtrene.';
  return (
    <AppShell>
      <PageHeader
        title="Fremtidige prosjekter"
        description="Planlagte anskaffelser og politiske saker – før de blir vanlige anbud. Følg prosjektene og få varsel når de utlyses."
      />
      <Coverage c={coverage} />
      <Tabs
        items={[
          { href: viewHref('match', filters), label: 'Passer for dere', active: filters.view === 'match' },
          { href: viewHref('alle', filters), label: 'Alle', active: filters.view === 'all' },
          { href: viewHref('folger', filters), label: 'Følger', active: filters.view === 'following', count: followingCount },
        ]}
      />
      <form method="get" action="/app/fremtidige" className="my-5 flex flex-wrap items-end gap-3">
        {filters.view !== 'match' ? <input type="hidden" name="visning" value={filters.view === 'all' ? 'alle' : 'folger'} /> : null}
        <label className="text-[13px] font-semibold text-ink">
          Fylke
          <select name="fylke" defaultValue={filters.region ?? ''} className="field-input mt-1 min-w-[10rem]">
            <option value="">Alle fylker</option>
            {REGIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[13px] font-semibold text-ink">
          Bransje
          <select name="bransje" defaultValue={filters.industry ?? ''} className="field-input mt-1 min-w-[12rem]">
            <option value="">Alle bransjer</option>
            {INDUSTRIES.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary" type="submit">
          Filtrer
        </Button>
      </form>
      {items.length ? (
        <div className="space-y-4">
          {items.map((i) => (
            <Item key={`${i.kind}:${i.id}`} i={i} back={back} />
          ))}
        </div>
      ) : (
        <Panel className="p-6 text-[15px] text-muted">{empty}</Panel>
      )}
    </AppShell>
  );
}
