/**
 * Byggeklosser for nettsiden: radaren, kort for nye anbud, den rullende raden med oppdragsgivere og den
 * mørke avslutningen. Alt som vises som fakta, kommer fra databasen (kundereisen: src/ui/showcase.tsx).
 */
import { industrySlugNb } from '@/domain/slugs';
import type { ReactNode } from 'react';
import { LuArrowRight, LuBell, LuFileText } from 'react-icons/lu';
import type { BoardRow, MarketSnapshot } from '@/domain/tenders/market';
import { fill, int, plural, rich, shortDate, timeUntil } from '@/i18n/format';
import { cn } from './components';
import { useUi } from './context';
import { INDUSTRY_ICONS } from './marketing';

export function Wrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-7xl px-4 sm:px-6', className)}>{children}</div>;
}

/** Liten etikett over overskrifter, med et gult signalpunkt. */
export function Kicker({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <p className={cn('inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.14em]', dark ? 'text-signal' : 'text-navy-700')}>
      <span className={cn('size-1.5 rounded-full', dark ? 'bg-signal' : 'bg-signal-strong')} aria-hidden />
      {children}
    </p>
  );
}

export function H2({ children, dark = false, className }: { children: ReactNode; dark?: boolean; className?: string }) {
  return <h2 className={cn('text-[34px] font-[760] leading-[1.04] tracking-[-0.03em] sm:text-[52px]', dark ? 'text-white' : 'text-strong', className)}>{children}</h2>;
}

export function ExampleTag({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-strong/5 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{children}</span>;
}

// ---------------------------------------------------------------------------
// Radaren
// ---------------------------------------------------------------------------
/** Omtrentlig midtpunkt i hvert fylke (lengdegrad, breddegrad). */
const COUNTY_POS: Record<string, [number, number]> = {
  '03': [10.75, 59.91],
  '32': [11.35, 60.1],
  '31': [11.15, 59.3],
  '33': [9.4, 60.3],
  '34': [10.6, 61.45],
  '39': [10.15, 59.2],
  '40': [8.55, 59.45],
  '42': [7.85, 58.45],
  '11': [5.9, 58.9],
  '46': [6.3, 60.7],
  '15': [7.4, 62.7],
  '50': [11.2, 63.75],
  '18': [14.8, 67.1],
  '55': [19.2, 69.4],
  '56': [25.5, 70.2],
};
const SWEEP_SECONDS = 6;

/** Plasserer fylket i radaren (prosent fra venstre/topp) og regner ut når sveipet passerer. */
export function blipPosition(code: string): { x: number; y: number; delay: number } | null {
  const pos = COUNTY_POS[code];
  if (!pos) return null;
  const [lon, lat] = pos;
  const x = 16 + ((lon - 4.5) / 22.5) * 68;
  const y = 88 - ((lat - 57.8) / 13.2) * 76;
  let deg = (Math.atan2(x - 50, -(y - 50)) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return { x, y, delay: (deg / 360) * SWEEP_SECONDS };
}

export function Radar({ regions, className }: { regions: MarketSnapshot['regions']; className?: string }) {
  const { m, locale } = useUi();
  const max = Math.max(1, ...regions.map((r) => r.n));
  const label = `${m.home.radar}: ${regions.filter((r) => r.n > 0).map((r) => `${r.name} ${int(locale, r.n)}`).join(', ')}.`;
  return (
    <div className={cn('radar', className)} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden>
        {[12.5, 25, 37.5, 49.4].map((r) => (
          <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="0.25" />
        ))}
        <line x1="50" y1="0.6" x2="50" y2="99.4" stroke="rgba(255,255,255,0.06)" strokeWidth="0.25" />
        <line x1="0.6" y1="50" x2="99.4" y2="50" stroke="rgba(255,255,255,0.06)" strokeWidth="0.25" />
      </svg>
      <div className="radar-sweep" aria-hidden />
      {regions.map((r) => {
        const p = blipPosition(r.code);
        if (!p || r.n <= 0) return null;
        const size = 5 + 11 * Math.sqrt(r.n / max);
        return (
          <span
            key={r.code}
            className="blip"
            title={`${r.name}: ${int(locale, r.n)}`}
            style={{ left: `${p.x}%`, top: `${p.y}%`, width: size, height: size, animationDelay: `${p.delay.toFixed(2)}s` }}
          />
        );
      })}
      <span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" aria-hidden />
    </div>
  );
}

/** Radaren uten data – bare sveipet og ringene (merkevare, f.eks. ved innlogging). */
export function RadarDecor({ className }: { className?: string }) {
  return (
    <div className={cn('radar', className)} aria-hidden>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
        {[12.5, 25, 37.5, 49.4].map((r) => (
          <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="0.25" />
        ))}
        <line x1="50" y1="0.6" x2="50" y2="99.4" stroke="rgba(255,255,255,0.06)" strokeWidth="0.25" />
        <line x1="0.6" y1="50" x2="99.4" y2="50" stroke="rgba(255,255,255,0.06)" strokeWidth="0.25" />
      </svg>
      <div className="radar-sweep" />
    </div>
  );
}

/** Et nytt, ekte anbud som et lite varsel ved radaren. */
export function TenderPing({ t, delay = 0, className }: { t: BoardRow & { industryId: string | null }; delay?: number; className?: string }) {
  const { m, locale } = useUi();
  const industry = t.industryId ? m.industries.names[t.industryId]?.name : null;
  return (
    <div className={cn('glass slide-in rounded-2xl p-4 text-left shadow-[0_20px_50px_-25px_rgba(0,0,0,0.8)]', className)} style={{ animationDelay: `${delay}ms` }}>
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-signal">
        <LuBell className="size-3.5" aria-hidden />
        {m.home.newTender}
        {industry ? <span className="truncate font-medium normal-case tracking-normal text-white/55">· {industry}</span> : null}
      </p>
      <p className="mt-1.5 line-clamp-2 text-[14.5px] font-semibold leading-snug text-white">{t.title}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12.5px] text-white/55">
        <span className="truncate">{[t.buyerName, t.place].filter(Boolean).join(' · ')}</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 font-medium text-white/80">{fill(m.home.deadline, { date: shortDate(locale, t.deadlineAt) })}</span>
      </p>
    </div>
  );
}

/** Rullende rad med oppdragsgivere som har åpne anbud akkurat nå. */
export function BuyerTicker({ buyers }: { buyers: string[] }) {
  const { m } = useUi();
  if (buyers.length < 6) return null;
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center gap-10 pr-10" aria-hidden={hidden || undefined}>
      {buyers.map((b) => (
        <li key={b} className="whitespace-nowrap text-[15px] font-medium text-white/60">
          {b}
        </li>
      ))}
    </ul>
  );
  return (
    <section className="border-y border-white/10 bg-night-800 py-6 text-white">
      <Wrap className="flex flex-col gap-4 md:flex-row md:items-center md:gap-8">
        <p className="shrink-0 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/45">{m.home.buyers}</p>
        <div className="marquee min-w-0 flex-1">
          <div className="marquee-track">
            {row(false)}
            {row(true)}
          </div>
        </div>
      </Wrap>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bransjer med antall åpne anbud
// ---------------------------------------------------------------------------
export function IndustryTiles({ industries, limit }: { industries: MarketSnapshot['industries']; limit?: number }) {
  const { m, locale, lp } = useUi();
  const list = limit ? industries.slice(0, limit) : industries;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((i, idx) => {
        const Icon = INDUSTRY_ICONS[i.id] ?? LuFileText;
        return (
          <li key={i.id} className={cn('reveal', idx % 3 === 1 && 'delay-1', idx % 3 === 2 && 'delay-2')}>
            <a
              href={lp(`/bransjer/${industrySlugNb(i.id)}`)}
              className="card-lift group flex h-full items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-strong no-underline sm:p-5"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-night text-signal">
                <Icon className="size-6" aria-hidden strokeWidth={1.7} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold">{m.industries.names[i.id]?.name ?? i.name}</span>
                <span className="block text-[14px] text-muted">{plural(locale, m.home.industries.open, i.n)}</span>
              </span>
              <LuArrowRight className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-1 group-hover:text-strong" aria-hidden />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Mørk topp for undersidene og mørk avslutning
// ---------------------------------------------------------------------------
export function NightHero({ eyebrow, title, lead, children }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; children?: ReactNode }) {
  return (
    <section className="night relative overflow-hidden">
      <div className="dot-grid absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_70%_20%,#000_15%,transparent_70%)]" aria-hidden />
      <div className="pointer-events-none absolute -right-48 -top-48 size-[620px] rounded-full border border-white/[0.07]" aria-hidden />
      <div className="pointer-events-none absolute -right-24 -top-24 size-[400px] rounded-full border border-white/[0.07]" aria-hidden />
      <Wrap className="relative pb-20 pt-16 sm:pb-24 sm:pt-24">
        {eyebrow ? <Kicker dark>{eyebrow}</Kicker> : null}
        <h1 className="mt-5 max-w-4xl text-[40px] font-[800] leading-[1] tracking-[-0.04em] text-white sm:text-[64px]">{title}</h1>
        {lead ? <p className="mt-6 max-w-2xl text-[18px] leading-relaxed text-white/70 sm:text-[19px]">{lead}</p> : null}
        {children}
      </Wrap>
    </section>
  );
}

/** Mørk avslutning med én tydelig handling. */
export function SignalCta({
  title,
  lead,
  primary,
  secondary,
  note,
}: {
  title: ReactNode;
  lead?: ReactNode;
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
  note?: ReactNode;
}) {
  return (
    <section className="night relative overflow-hidden">
      <div className="dot-grid absolute inset-0 opacity-60" aria-hidden />
      <div className="pointer-events-none absolute -right-40 -top-40 size-[560px] rounded-full border border-white/10" aria-hidden />
      <div className="pointer-events-none absolute -right-20 -top-20 size-[360px] rounded-full border border-white/10" aria-hidden />
      <Wrap className="relative py-24 text-center sm:py-32">
        <h2 className="reveal mx-auto max-w-4xl text-[36px] font-[780] leading-[1.03] tracking-[-0.035em] text-white sm:text-[60px]">{title}</h2>
        {lead ? <p className="reveal delay-1 mx-auto mt-5 max-w-xl text-[18px] leading-relaxed text-white/70">{lead}</p> : null}
        <div className="reveal delay-2 mt-9 flex flex-wrap items-center justify-center gap-3">
          <a href={primary.href} className="btn-signal">
            {primary.label} <LuArrowRight className="size-4" aria-hidden />
          </a>
          {secondary ? (
            <a href={secondary.href} className="btn-ghost-light">
              {secondary.label}
            </a>
          ) : null}
        </div>
        {note ? <p className="reveal delay-3 mt-5 text-[14px] text-white/50">{note}</p> : null}
      </Wrap>
    </section>
  );
}

export function FinalCta({ next, now, fromPrice }: { next: Date | null; now: Date; fromPrice: number }) {
  const { m, locale, lp, user } = useUi();
  const t = m.home.final;
  return (
    <SignalCta
      title={next ? rich(t.next, { when: <span className="text-gradient-signal">{timeUntil(locale, next, now)}</span> }) : t.none}
      lead={t.lead}
      primary={user ? { href: '/app', label: m.nav.toApp } : { href: lp('/registrer'), label: m.nav.start }}
      secondary={{ href: lp('/priser'), label: m.home.seePrices }}
      note={fill(t.price, { price: int(locale, fromPrice) })}
    />
  );
}
