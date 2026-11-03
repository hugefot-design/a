import { LuLock, LuSearch, LuSlidersHorizontal } from 'react-icons/lu';
import { COUNTRIES, INDUSTRIES, REGIONS } from '@/domain/reference';
import { queryToParams, type TenderQuery } from '@/domain/search/filters';
import type { TenderListItem } from '@/domain/tenders/queries';
import { useUi } from '../../context';
import {
  Alert,
  Badge,
  Button,
  buttonVariants,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Pagination,
  Panel,
  PostForm,
  Select,
} from '../../components';
import { AppShell } from '../../layouts';
import { TenderRow } from '../../tender';
import { formatInt } from '../../format';

const STATUS_OPTIONS: [string, string][] = [
  ['open', 'Åpne'],
  ['planned', 'Planlagte'],
  ['closed', 'Frist utløpt'],
  ['awarded', 'Tildelte'],
  ['cancelled', 'Avlyste'],
];

function FilterPanel({ q, advanced, nl }: { q: TenderQuery; advanced: boolean; nl: string }) {
  const statuses = q.statuses.length ? q.statuses : ['open', 'planned'];
  return (
    <form method="get" action="/app/anbud" className="space-y-6" id="filter-form">
      {nl ? <input type="hidden" name="nl_bak" value={nl} /> : null}
      <Field label="Søkeord" htmlFor="f-q">
        <Input id="f-q" name="q" type="search" defaultValue={q.q} placeholder="f.eks. vinduspuss" />
      </Field>
      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold">Status</legend>
        <div className="space-y-1.5">
          {STATUS_OPTIONS.map(([v, label]) => (
            <Checkbox key={v} name="status" value={v} defaultChecked={statuses.includes(v as never)} label={label} />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold">Bransje</legend>
        <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {INDUSTRIES.map((i) => (
            <Checkbox key={i.id} name="bransje" value={i.id} defaultChecked={q.industries.includes(i.id)} label={i.name} />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold">Fylke</legend>
        <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {REGIONS.map((r) => (
            <Checkbox key={r.code} name="fylke" value={r.code} defaultChecked={q.regions.includes(r.code)} label={r.name} />
          ))}
        </div>
      </fieldset>
      <Field label="Kommune eller sted" htmlFor="f-sted" hint="Søker i oppdragsgiver og sted.">
        <Input id="f-sted" name="sted" defaultValue={q.place} placeholder="f.eks. Levanger" />
      </Field>
      <Field label="Land" htmlFor="f-land">
        <Select id="f-land" name="land" defaultValue={q.countries[0] ?? ''}>
          <option value="">Alle</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code} disabled={!c.active}>
              {c.name}
              {c.active ? '' : ' (kommer)'}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Verdi fra (kr)" htmlFor="f-vmin">
          <Input id="f-vmin" name="verdi_min" inputMode="numeric" defaultValue={q.valueMin ?? ''} />
        </Field>
        <Field label="Verdi til (kr)" htmlFor="f-vmax">
          <Input id="f-vmax" name="verdi_maks" inputMode="numeric" defaultValue={q.valueMax ?? ''} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Frist om minst (dager)" htmlFor="f-fmin">
          <Input id="f-fmin" name="frist_min" type="number" min={0} defaultValue={q.deadlineMinDays ?? ''} />
        </Field>
        <Field label="Frist innen (dager)" htmlFor="f-fmax">
          <Input id="f-fmax" name="frist_maks" type="number" min={0} defaultValue={q.deadlineMaxDays ?? ''} />
        </Field>
      </div>
      <Field label="Publisert" htmlFor="f-pub">
        <Select id="f-pub" name="publisert" defaultValue={q.publishedWithinDays !== null ? String(q.publishedWithinDays) : ''}>
          <option value="">Når som helst</option>
          <option value="1">Siste døgn</option>
          <option value="7">Siste 7 dager</option>
          <option value="14">Siste 14 dager</option>
          <option value="30">Siste 30 dager</option>
        </Select>
      </Field>

      <fieldset className="space-y-4 rounded-lg border border-line p-4">
        <legend className="flex items-center gap-1.5 px-1 text-[13px] font-semibold">
          Avansert {!advanced ? <LuLock className="size-3.5 text-muted" aria-label="Krever Profesjonell" /> : null}
        </legend>
        {!advanced ? (
          <p className="text-[13px] text-muted">
            CPV-koder, oppdragsgiver og ekskluderinger er med i Profesjonell. <a href="/app/abonnement">Se planer</a>
          </p>
        ) : null}
        <fieldset disabled={!advanced} className="space-y-4 disabled:opacity-60">
          <Field label="CPV-koder" htmlFor="f-cpv" hint="Skill med komma. Overordnede koder (f.eks. 45) gir treff på alt under.">
            <Input id="f-cpv" name="cpv" defaultValue={q.cpv.join(', ')} />
          </Field>
          <Field label="Oppdragsgiver" htmlFor="f-auth">
            <Input id="f-auth" name="oppdragsgiver" defaultValue={q.authority} />
          </Field>
          <Field label="Ekskluder ord" htmlFor="f-exw" hint="Skill med komma.">
            <Input id="f-exw" name="ekskl_ord" defaultValue={q.excludeKeywords.join(', ')} />
          </Field>
          <Field label="Ekskluder CPV-koder" htmlFor="f-excpv">
            <Input id="f-excpv" name="ekskl_cpv" defaultValue={q.excludeCpv.join(', ')} />
          </Field>
          <fieldset>
            <legend className="mb-2 text-[13px] font-semibold">Ekskluder bransjer</legend>
            <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
              {INDUSTRIES.map((i) => (
                <Checkbox key={i.id} name="ekskl_bransje" value={i.id} defaultChecked={q.excludeIndustries.includes(i.id)} label={i.name} />
              ))}
            </div>
          </fieldset>
        </fieldset>
      </fieldset>
      {q.sort ? <input type="hidden" name="sorter" value={q.sort} /> : null}
      <div className="flex gap-2">
        <Button type="submit" className="flex-1">
          Bruk filtre
        </Button>
        <a href="/app/anbud" className={buttonVariants({ variant: 'secondary' })}>
          Nullstill
        </a>
      </div>
    </form>
  );
}

export interface DiscoverProps {
  query: TenderQuery;
  nl: string;
  interpretations: string[];
  results: { items: TenderListItem[]; total: number; page: number; totalPages: number };
  matching: boolean;
  advanced: boolean;
  removedAdvanced: boolean;
  canSaveSearch: boolean;
  savedSearchLimitReached: boolean;
  /** Dagens søk for planer med grense (gratis). */
  searchQuota?: { used: number; limit: number; unlimited: boolean };
}

export function DiscoverPage(props: DiscoverProps) {
  const { query, results, matching } = props;
  const { org } = useUi();
  const params = queryToParams(query);
  const sortValue = query.sort ?? (query.q ? 'relevance' : matching ? 'match' : 'published');
  return (
    <AppShell wide>
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-serif text-[28px] font-semibold text-navy-900">Finn anbud</h1>
          {props.searchQuota && !props.searchQuota.unlimited ? (
            <p className="text-[13px] text-muted">
              <span className="font-mono font-medium text-navy-950">
                {props.searchQuota.used} av {props.searchQuota.limit}
              </span>{' '}
              søk brukt i dag · <a href="/app/abonnement">Ubegrenset med en betalt plan</a>
            </p>
          ) : null}
        </div>
        <form method="get" action="/app/anbud" role="search" className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="nl" className="sr-only">
            Beskriv hva du leter etter
          </label>
          <div className="relative flex-1">
            <LuSearch className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-faint" aria-hidden />
            <input
              id="nl"
              name="nl"
              defaultValue={props.nl}
              placeholder="Beskriv hva du leter etter, f.eks. «byggeoppdrag i Trøndelag over 5 millioner med frist om minst 30 dager»"
              className="h-12 w-full rounded-lg border border-line-strong bg-white pl-11 pr-4 text-[15px] shadow-[0_1px_0_rgba(15,35,64,0.04)] placeholder:text-faint focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-100"
            />
          </div>
          <Button type="submit" size="lg">
            Søk
          </Button>
        </form>
        {props.interpretations.length ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-muted">Tolket som:</span>
            {props.interpretations.map((i) => (
              <Badge key={i} tone="marker">
                {i}
              </Badge>
            ))}
          </div>
        ) : null}
        {props.removedAdvanced ? (
          <Alert tone="info">Noen avanserte filtre ble ikke brukt fordi de ikke er med i planen din.</Alert>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside>
          <button
            type="button"
            data-toggle="#filters"
            aria-expanded="false"
            className={buttonVariants({ variant: 'secondary', className: 'mb-3 w-full lg:hidden' })}
          >
            <LuSlidersHorizontal className="size-4" aria-hidden /> Filtre
          </button>
          <div id="filters" className="drawer" data-open="false">
            <Panel className="p-4">
              <FilterPanel q={query} advanced={props.advanced} nl={props.nl} />
            </Panel>
          </div>
        </aside>

        <section aria-label="Resultater" className="min-w-0">
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
              <p className="num text-[14px] text-ink">
                <strong>{formatInt(results.total)}</strong> {results.total === 1 ? 'kunngjøring' : 'kunngjøringer'}
              </p>
              <form method="get" action="/app/anbud" className="flex items-center gap-2">
                {[...params.entries()]
                  .filter(([k]) => k !== 'sorter' && k !== 'side')
                  .map(([k, v], i) => (
                    <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
                  ))}
                <label htmlFor="sorter" className="text-[13px] text-muted">
                  Sorter
                </label>
                <select id="sorter" name="sorter" defaultValue={sortValue} data-autosubmit className="field-input h-8 w-auto py-0 text-[13px]">
                  {query.q ? <option value="relevance">Mest relevant tekst</option> : null}
                  {matching ? <option value="match">Best match for oss</option> : null}
                  <option value="published">Nyeste først</option>
                  <option value="deadline">Kortest frist</option>
                  <option value="value">Høyest verdi</option>
                </select>
                <noscript>
                  <Button size="sm" variant="secondary">
                    Sorter
                  </Button>
                </noscript>
              </form>
            </div>
            {results.items.length ? (
              <ul className="divide-y divide-line">
                {results.items.map((item) => (
                  <TenderRow key={item.id} item={item} showScore={matching} />
                ))}
              </ul>
            ) : (
              <EmptyState title="Ingen kunngjøringer passer filtrene">
                Prøv færre filtre, et bredere søkeord eller flere fylker. Dataene oppdateres fra kildene flere ganger i døgnet.
              </EmptyState>
            )}
            <Pagination
              page={results.page}
              totalPages={results.totalPages}
              hrefFor={(p) => `/app/anbud?${queryToParams(query, { page: p }).toString()}`}
            />
          </Panel>

          <Panel className="mt-4 p-5">
            <h2 className="text-[15px] font-semibold text-navy-900">Lagre dette søket</h2>
            {props.canSaveSearch ? (
              <PostForm action="/app/sok" className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
                <input type="hidden" name="filters" value={params.toString()} />
                <input type="hidden" name="nl" value={props.nl} />
                <Field label="Navn" htmlFor="ss-name" className="flex-1">
                  <Input id="ss-name" name="name" required maxLength={120} defaultValue={props.nl.slice(0, 80)} placeholder="f.eks. Vakthold i Midt-Norge" />
                </Field>
                <Field label="E-postvarsel" htmlFor="ss-alert">
                  <select id="ss-alert" name="alert" className="field-input" defaultValue={org?.entitlements.alerts === 'full' ? 'daily' : 'daily'}>
                    <option value="off">Ingen varsel</option>
                    {org?.entitlements.alerts === 'full' ? <option value="instant">Med en gang</option> : null}
                    <option value="daily">Daglig</option>
                    <option value="weekly">Ukentlig</option>
                  </select>
                </Field>
                <Button type="submit" variant="secondary">
                  Lagre søk
                </Button>
              </PostForm>
            ) : (
              <p className="mt-2 text-[14px] text-muted">
                {props.savedSearchLimitReached
                  ? 'Dere har nådd grensen for lagrede søk i planen. '
                  : 'Lagrede søk med e-postvarsel er med fra Starter. '}
                <a href="/app/abonnement">Se planer</a>
              </p>
            )}
          </Panel>
        </section>
      </div>
    </AppShell>
  );
}
