/**
 * Kundereisen på forsiden: hvert steg vist med ekte, offentlige data i appens eget utseende
 * (se src/domain/tenders/showcase.ts). Ingen oppdiktede anbud, tall eller kunder. Eksempelprofilen er
 * merket som eksempel; leverandørnavn vises ikke.
 */
import type { ReactNode } from 'react';
import { LuArrowUpRight, LuCalendarClock, LuSquare } from 'react-icons/lu';
import type { Showcase, ShowcaseQuote } from '@/domain/tenders/showcase';
import { compactNumber, fill, money, monthYear, plural, shortDate } from '@/i18n/format';
import { cn } from './components';
import { useUi } from './context';
import { StripChart } from './charts';

/** Et vindu fra appen: liten etikett øverst (hvor dataene kommer fra) og innholdet i appens stil. */
export function AppFrame({ label, href, children, className }: { label: ReactNode; href?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-[0_24px_60px_-40px_rgba(6,14,27,0.55)]', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line bg-paper/60 px-4 py-2.5">
        <p className="min-w-0 truncate font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted">{label}</p>
        {href ? (
          <a href={href} target="_blank" rel="noopener" className="inline-flex min-h-6 shrink-0 items-center gap-1 py-1 text-[12px] font-semibold text-navy-700 no-underline hover:text-strong">
            {href.includes('doffin') ? 'Doffin' : 'TED'} <LuArrowUpRight className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

function Quote({ q }: { q: ShowcaseQuote }) {
  const i = q.match ? q.text.indexOf(q.match) : -1;
  if (i < 0) return <>{q.text}</>;
  // Uthev hele ordet, ikke bare treffet («minstekrav» i «minstekravene»).
  let end = i + q.match.length;
  while (end < q.text.length && /\p{L}/u.test(q.text[end]!)) end++;
  return (
    <>
      {q.text.slice(0, i)}
      <mark className="rounded bg-marker-soft px-0.5 text-ink">{q.text.slice(i, end)}</mark>
      {q.text.slice(end)}
    </>
  );
}

const KIND_TONE: Record<string, string> = {
  avvisning: 'bg-danger-soft text-danger',
  minstekrav: 'bg-urgent-soft text-urgent',
  kvalifikasjon: 'bg-navy-50 text-navy-800',
  befaring: 'bg-info-soft text-info',
};

function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold leading-5', className)}>{children}</span>;
}

function Missing() {
  const { m } = useUi();
  return <p className="rounded-xl border border-dashed border-line-strong bg-paper/40 px-4 py-6 text-center text-[13.5px] text-muted">{m.home.journey.missing}</p>;
}

// 1. Finn muligheten
export function MatchesVisual({ s }: { s: Showcase }) {
  const { m, locale } = useUi();
  const t = m.home.journey;
  if (!s.matches.length) return <Missing />;
  return (
    <AppFrame label={t.matchNote}>
      <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
        <span className="font-semibold uppercase tracking-[0.1em]">{t.exampleProfile}</span>
        <Chip className="bg-navy-50 text-navy-800">{m.industries.names[s.industry.id]?.name ?? s.industry.name}</Chip>
        {s.region ? <Chip className="bg-navy-50 text-navy-800">{s.region.name}</Chip> : null}
      </p>
      <ul className="mt-3 divide-y divide-line">
        {s.matches.map((x) => (
          <li key={x.id} className="flex items-start gap-3 py-3 first:pt-1 last:pb-0">
            <span className="num flex size-10 shrink-0 flex-col items-center justify-center rounded-xl bg-night text-white" aria-label={`${t.score} ${x.score}`}>
              <span className="text-[15px] font-[750] leading-none">{x.score}</span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[14px] font-semibold leading-snug text-strong">{x.title}</p>
              <p className="mt-0.5 truncate text-[12.5px] text-muted">{[x.buyerName, x.place].filter(Boolean).join(' · ')}</p>
              {x.deadlineAt ? <Chip className="mt-1.5 bg-paper text-ink">{fill(t.deadline, { date: shortDate(locale, x.deadlineAt) })}</Chip> : null}
            </div>
          </li>
        ))}
      </ul>
    </AppFrame>
  );
}

// 2. Vurder krav og risiko
export function RiskVisual({ s }: { s: Showcase }) {
  const { m } = useUi();
  const t = m.home.journey;
  const n = s.notice;
  const sourceName = n.source === 'doffin' ? 'Doffin' : n.source === 'ted' ? 'TED' : n.source;
  return (
    <AppFrame label={fill(t.realNotice, { source: sourceName, id: n.noticeId })} href={n.sourceUrl}>
      <p className="line-clamp-2 text-[14.5px] font-semibold leading-snug text-strong">{n.title}</p>
      {n.buyerName ? <p className="mt-0.5 truncate text-[12.5px] text-muted">{n.buyerName}</p> : null}
      <ul className="mt-3 space-y-2.5">
        {s.requirements.slice(0, 3).map((r) => (
          <li key={r.kind} className="border-l-2 border-line-strong pl-3">
            <Chip className={KIND_TONE[r.kind]}>{t.kinds[r.kind as keyof typeof t.kinds] ?? r.kind}</Chip>
            <p className="mt-1 text-[13px] leading-relaxed text-ink">
              <Quote q={r} />
            </p>
          </li>
        ))}
        {s.terms.slice(0, 1).map((r) => (
          <li key={r.kind} className="border-l-2 border-signal pl-3">
            <Chip className="bg-marker-soft text-ink">
              {t.costly}: {t.terms[r.kind as keyof typeof t.terms] ?? r.kind}
            </Chip>
            <p className="mt-1 text-[13px] leading-relaxed text-ink">
              <Quote q={r} />
            </p>
          </li>
        ))}
      </ul>
    </AppFrame>
  );
}

// 3. Beregn lønnsomhet
export function ProfitVisual({ s }: { s: Showcase }) {
  const { m, locale } = useUi();
  const t = m.home.journey;
  const mk = s.market;
  const kr = (v: number) => money(locale, v, mk?.currency ?? 'NOK');
  return (
    <AppFrame label={mk ? `${plural(locale, t.market, mk.n)} · ${mk.label}` : t.calc.join(' · ')}>
      <dl className="grid grid-cols-3 gap-2">
        {t.calc.map((c) => (
          <div key={c} className="rounded-xl bg-paper px-3 py-2.5">
            <dt className="text-[11.5px] font-semibold text-muted [overflow-wrap:anywhere] sm:uppercase sm:tracking-[0.08em]">{c}</dt>
            <dd className="mt-1 h-2 w-3/4 rounded-full bg-navy-100" aria-hidden />
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-[12px] text-muted">{t.calcNote}</p>
      {mk ? (
        <div className="mt-4 border-t border-line pt-4">
          <StripChart
            points={mk.values.map((v) => ({ value: v, tip: kr(v) }))}
            band={{ p25: mk.p25, median: mk.median, p75: mk.p75 }}
            markers={[]}
            summary={`${fill(t.median, { value: kr(mk.median) })}. ${fill(t.middle, { from: kr(mk.p25), to: kr(mk.p75) })}.`}
            axisLabel={(v) => compactNumber(locale, v)}
          />
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink">
            <span className="font-semibold">{fill(t.median, { value: kr(mk.median) })}</span>
            <span className="text-muted">{fill(t.middle, { from: kr(mk.p25), to: kr(mk.p75) })}</span>
          </p>
          {mk.hidden ? <p className="mt-1 text-[12px] text-muted">{fill(plural(locale, t.hidden, mk.hidden.n), { value: kr(mk.hidden.above) })}</p> : null}
        </div>
      ) : null}
    </AppFrame>
  );
}

// 4. Forbered tilbudet
export function ChecklistVisual({ s }: { s: Showcase }) {
  const { m } = useUi();
  const t = m.home.journey;
  // Kravene først; utdrag fra vilkårene bare hvis det er for få krav. «…» foran beholdes når utdraget starter midt i
  // en setning (ellers ser punktet ut som en setning med liten forbokstav).
  const reqs = s.requirements.map((r) => r.text);
  const items = (reqs.length >= 3 ? reqs : [...reqs, ...s.terms.map((r) => r.text)]).slice(0, 4);
  return (
    <AppFrame label={`${t.checklist} · ${s.notice.title}`}>
      <ul className="space-y-2">
        {items.map((text, i) => (
          <li key={i} className="flex items-start gap-2.5 rounded-xl border border-line px-3 py-2.5">
            <LuSquare className="mt-0.5 size-4 shrink-0 text-line-strong" aria-hidden />
            <span className="line-clamp-2 text-[13px] leading-snug text-ink">{text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-muted">{t.checklistNote}</p>
    </AppFrame>
  );
}

// 5. Følg resultatet
export function ResultVisual({ s }: { s: Showcase }) {
  const { m, locale } = useUi();
  const t = m.home.journey;
  const a = s.award;
  if (!a) return <Missing />;
  return (
    <AppFrame label={t.publicAward}>
      <Chip className="bg-ok-soft text-ok">{fill(t.awarded, { date: shortDate(locale, a.awardDate) })}</Chip>
      <p className="mt-2 line-clamp-2 text-[14.5px] font-semibold leading-snug text-strong">{a.title}</p>
      {a.buyerName ? <p className="mt-0.5 truncate text-[12.5px] text-muted">{a.buyerName}</p> : null}
      <div className="mt-3 flex flex-wrap gap-1.5" aria-hidden>
        {t.result.map((r) => (
          <span key={r} className="rounded-full border border-line-strong px-3 py-1 text-[12.5px] font-semibold text-strong">
            {r}
          </span>
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-paper px-3 py-2.5">
          <dt className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">{t.yourPrice}</dt>
          <dd className="num mt-1 text-[15px] font-semibold text-muted">–</dd>
        </div>
        <div className="rounded-xl bg-paper px-3 py-2.5">
          <dt className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">{t.winnerPrice}</dt>
          <dd className="num mt-1 text-[15px] font-semibold text-strong">{money(locale, a.value, a.currency)}</dd>
        </div>
      </dl>
    </AppFrame>
  );
}

// 6. Lær til neste konkurranse
export function ExpiryVisual({ s }: { s: Showcase }) {
  const { m, locale } = useUi();
  const t = m.home.journey;
  if (!s.expiring.length) return <Missing />;
  return (
    <AppFrame label={`${t.soon} · ${m.industries.names[s.industry.id]?.name ?? s.industry.name}`}>
      <ul className="divide-y divide-line">
        {s.expiring.map((x, i) => (
          <li key={i} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <LuCalendarClock className="mt-0.5 size-4 shrink-0 text-navy-600" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-strong">{x.title}</p>
              {x.buyerName ? <p className="truncate text-[12.5px] text-muted">{x.buyerName}</p> : null}
              <p className="mt-1 text-[12.5px] text-ink">
                <span className="font-semibold">{fill(t.expires, { date: monthYear(locale, x.expectedEnd) })}</span>
                <span className="text-muted"> · {t.basis[x.basis]}</span>
              </p>
            </div>
          </li>
        ))}
      </ul>
    </AppFrame>
  );
}

export const JOURNEY_VISUALS = [MatchesVisual, RiskVisual, ProfitVisual, ChecklistVisual, ResultVisual, ExpiryVisual];
