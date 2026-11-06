/**
 * Fylkessidene (bare norsk): /fylker (alle fylker) og /fylker/<fylke> (åpne anbud i ett fylke,
 * fordelt på bransjer, med frister og de største oppdragsgiverne). Alt er ekte tall fra databasen.
 */
import { LuArrowRight, LuBellRing, LuBuilding2, LuMapPin } from 'react-icons/lu';
import { INDUSTRY_ICONS } from '../marketing';
import type { CountyOverview, MarketSnapshot } from '@/domain/tenders/market';
import { industryRegionPath, MIN_OPEN_FOR_INDEXING } from '@/domain/slugs';
import { REGION_BY_CODE } from '@/domain/reference';
import { useUi } from '../context';
import { PublicLayout } from '../layouts';
import { NightHero, SignalCta, Wrap } from '../site';
import { CountyGrid, signupWith, TenderRows } from './public';
import { NewsletterSignup } from '../newsletter';
import { regionPath } from '@/domain/slugs';
import type { ReactNode } from 'react';

const count = (n: number) => (n === 1 ? '1 åpent anbud' : `${n.toLocaleString('nb-NO')} åpne anbud`);

function LivePill({ children }: { children: ReactNode }) {
  return (
    <span className="glass inline-flex items-center gap-2.5 rounded-full px-3.5 py-2 text-[14px] text-white/90">
      <span className="live-dot" aria-hidden />
      {children}
    </span>
  );
}

export function CountiesPage({ regions, open }: { regions: MarketSnapshot['regions']; open: number }) {
  const { user, lp } = useUi();
  return (
    <PublicLayout>
      <NightHero
        eyebrow={
          <a href={lp('/bransjer')} className="text-signal no-underline hover:text-white">
            Alle bransjer
          </a>
        }
        title="Offentlige anbud per fylke"
        lead="Åpne anbud fra kommuner, fylkeskommuner, statlige etater og andre offentlige oppdragsgivere – sortert etter hvor oppdraget skal utføres. Hentet fra Doffin og TED flere ganger i døgnet."
      >
        <div className="mt-8">
          <LivePill>
            <strong className="font-semibold text-white">{open.toLocaleString('nb-NO')}</strong> åpne anbud i hele landet akkurat nå
          </LivePill>
        </div>
      </NightHero>
      <section className="bg-cream py-16 sm:py-20">
        <Wrap>
          <CountyGrid regions={regions} />
          <p className="mt-6 text-[13px] text-muted">Et anbud som gjelder flere fylker, telles i hvert av dem.</p>
          <NewsletterSignup sourcePath="/fylker" className="mt-12 max-w-xl bg-white" />
        </Wrap>
      </section>
      <SignalCta
        title="Få beskjed når et anbud passer bedriften"
        lead="Velg bransje og fylke én gang. AnbudRadar sier fra når nye anbud dukker opp."
        primary={user ? { href: '/app', label: 'Til appen' } : { href: lp('/registrer'), label: 'Start gratis' }}
      />
    </PublicLayout>
  );
}

export function CountyPage({ region, overview }: { region: string; overview: CountyOverview }) {
  const { user, lp } = useUi();
  const name = REGION_BY_CODE.get(region)?.name ?? region;
  const alertHref = user ? '/app/onboarding' : signupWith(lp, `/app/onboarding?fylke=${region}`);
  return (
    <PublicLayout>
      <NightHero
        eyebrow={
          <a href="/fylker" className="text-signal no-underline hover:text-white">
            Alle fylker
          </a>
        }
        title={
          <span className="flex items-center gap-4">
            <span className="hidden size-14 shrink-0 items-center justify-center rounded-2xl bg-signal text-night sm:flex">
              <LuMapPin className="size-7" aria-hidden strokeWidth={1.8} />
            </span>
            Offentlige anbud i {name}
          </span>
        }
        lead={`Åpne anbud der oppdraget skal utføres i ${name}, fra kommuner, statlige etater og andre offentlige oppdragsgivere. Hentet fra Doffin og TED flere ganger i døgnet.`}
      >
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <LivePill>
            <strong className="font-semibold text-white">{overview.open.toLocaleString('nb-NO')}</strong> {overview.open === 1 ? 'åpent anbud nå' : 'åpne anbud nå'}
          </LivePill>
          <a href={alertHref} className="btn-signal">
            <LuBellRing className="size-4" aria-hidden /> Få varsel om nye anbud
          </a>
        </div>
      </NightHero>

      <section className="bg-white py-14 sm:py-20">
        <Wrap className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <h2 className="text-[22px] font-[740] tracking-[-0.02em] text-night">Nærmeste frister i {name}</h2>
            {overview.rows.length ? (
              <TenderRows rows={overview.rows} />
            ) : (
              <p className="mt-5 rounded-2xl border border-dashed border-line-strong p-6 text-[15px] text-muted">Ingen åpne anbud i {name} akkurat nå.</p>
            )}

            {overview.industries.length ? (
              <>
                <h2 className="mt-12 text-[22px] font-[740] tracking-[-0.02em] text-night">Bransjer i {name}</h2>
                <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {overview.industries.map((i) => {
                    const Icon = INDUSTRY_ICONS[i.id] ?? LuBuilding2;
                    return (
                      <li key={i.id}>
                        <a
                          href={industryRegionPath(i.id, region)}
                          className="card-lift group flex items-center gap-3.5 rounded-2xl border border-line bg-white p-4 text-night no-underline"
                          rel={i.n < MIN_OPEN_FOR_INDEXING ? 'nofollow' : undefined}
                        >
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-night text-signal">
                            <Icon className="size-5" aria-hidden strokeWidth={1.7} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-semibold">{i.name}</span>
                            <span className="block text-[13.5px] text-muted">{count(i.n)}</span>
                          </span>
                          <LuArrowRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-1 group-hover:text-night" aria-hidden />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
          </div>

          <aside className="h-fit space-y-4 lg:sticky lg:top-24">
            {overview.buyers.length ? (
              <div className="rounded-3xl bg-cream p-6">
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Flest åpne anbud nå</p>
                <ul className="mt-4 space-y-2.5">
                  {overview.buyers.map((b) => (
                    <li key={b.name} className="flex items-baseline justify-between gap-3 text-[14px]">
                      <span className="min-w-0 truncate text-night">{b.name}</span>
                      <span className="num shrink-0 font-semibold text-night">{b.n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="night rounded-3xl p-6">
              <p className="text-[18px] font-[720] leading-snug text-white">Få beskjed når et anbud i {name} passer bedriften din.</p>
              <a href={alertHref} className="btn-signal mt-5 w-full">
                Start gratis
              </a>
            </div>
            <NewsletterSignup region={region} sourcePath={regionPath(region)} />
          </aside>
        </Wrap>
      </section>
    </PublicLayout>
  );
}
