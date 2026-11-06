/**
 * Små, tilgjengelige diagrammer uten bibliotek, tegnet på serveren.
 *
 * - Søylediagram (én serie): HTML/CSS-søyler, så de skalerer rent på mobil uten forvrengte hjørner
 *   eller bitteliten tekst. Søyler maks 24 px, 4 px avrunding i toppen, 2 px luft mellom søylene,
 *   hårfine rutenettlinjer, runde tall på aksen. Bare høyeste verdi står på søylen; resten vises
 *   når pekeren er over (eller med piltastene, se src/client/main.ts) og i tabellen under.
 * - Trendlinje i tallfelt: dempet historikk (marine 300) og siste punkt fremhevet (marine 600).
 *
 * Fargene er sjekket med dataviz-validatoren mot hvit bakgrunn: marine 600 består alle kontroller.
 * Marine 300 er bevisst grålig (dempet historikk) og under 3:1 mot hvitt; tallet står alltid som
 * tekst ved siden av, så trendlinjen er aldri eneste kilde til verdien.
 */
import type { ReactNode } from 'react';
import { formatInt } from './format';
import { cn } from './components';

const MONTHS = ['jan.', 'feb.', 'mars', 'apr.', 'mai', 'juni', 'juli', 'aug.', 'sep.', 'okt.', 'nov.', 'des.'];

/** «2026-11-03» → «3. nov.» (datoen er allerede en norsk kalenderdag, så ingen tidssonejustering). */
export function dayLabel(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${d}. ${MONTHS[(m ?? 1) - 1]}`;
}

/** Runde aksetall for antall: steg på 1, 2 eller 5 × 10^n, aldri under 1, maks ~4 intervaller. */
export function niceScale(max: number, maxIntervals = 4): { top: number; step: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, step: 1, ticks: [0, 1] };
  const rough = max / maxIntervals;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 5, 10].map((f) => f * pow).find((s) => s >= rough) ?? 10 * pow);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  return { top, step, ticks };
}

export interface ColumnDatum {
  day: string;
  n: number;
}

export function ColumnChart({
  data,
  title,
  noun,
  empty,
}: {
  data: ColumnDatum[];
  /** Hva som telles, f.eks. «Nye anbud per dag» – brukes i tilgjengelig navn og tabell. */
  title: string;
  /** Entall og flertall for verdien, f.eks. ['nytt anbud', 'nye anbud']. */
  noun: [string, string];
  empty: ReactNode;
}) {
  const total = data.reduce((sum, d) => sum + d.n, 0);
  const max = Math.max(0, ...data.map((d) => d.n));
  const { top, ticks } = niceScale(max);
  const maxIndex = data.findIndex((d) => d.n === max);
  const word = (n: number) => (n === 1 ? noun[0] : noun[1]);
  const summary =
    total === 0
      ? `${title}: ingen de siste ${data.length} dagene.`
      : `${title}, siste ${data.length} dager: ${formatInt(total)} totalt, flest ${formatInt(max)} den ${dayLabel(data[maxIndex]!.day)}.`;
  const labelIdx = data.length > 2 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : data.map((_, i) => i);

  return (
    <div className="min-w-0">
      {total === 0 ? (
        <div className="flex h-44 items-center justify-center rounded-md border border-dashed border-line px-4 text-center text-[13px] text-muted">{empty}</div>
      ) : (
        <div
          data-chart
          tabIndex={0}
          role="img"
          aria-label={summary}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-navy-600 focus-visible:ring-offset-2"
        >
          <div className="relative h-44 pl-9 pt-6">
            <div className="relative h-full">
              {ticks.map((t) => (
                <div key={t} className="absolute inset-x-0 border-t border-line" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden>
                  <span className="num absolute -left-9 w-7 -translate-y-1/2 text-right text-[11px] leading-none text-muted">{formatInt(t)}</span>
                </div>
              ))}
              <div className="absolute inset-0 flex items-end gap-[2px]" aria-hidden>
                {data.map((d, i) => (
                  <div
                    key={d.day}
                    data-tip={`${formatInt(d.n)} ${word(d.n)}|${dayLabel(d.day)}`}
                    className="group relative flex h-full min-w-0 flex-1 items-end justify-center"
                  >
                    {i === maxIndex ? (
                      <span
                        className="absolute left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap pb-1 text-[11px] font-semibold leading-none text-ink"
                        style={{ bottom: `${(d.n / top) * 100}%` }}
                      >
                        {formatInt(d.n)}
                      </span>
                    ) : null}
                    <div
                      className="w-full max-w-[24px] rounded-t-[4px] bg-navy-600 transition-opacity group-data-[active]:opacity-70"
                      style={{ height: `${(d.n / top) * 100}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="relative mt-1.5 h-4 pl-9 text-[11px] text-muted" aria-hidden>
            {labelIdx.map((i) => (
              <span
                key={i}
                className={cn('absolute whitespace-nowrap', i === 0 ? 'left-9' : i === data.length - 1 ? 'right-0' : '-translate-x-1/2')}
                style={i !== 0 && i !== data.length - 1 ? { left: `calc(2.25rem + (100% - 2.25rem) * ${(i + 0.5) / data.length})` } : undefined}
              >
                {dayLabel(data[i]!.day)}
              </span>
            ))}
          </div>
        </div>
      )}
      <details className="mt-3 text-[13px]">
        <summary className="cursor-pointer font-semibold text-navy-700">Vis tallene som tabell</summary>
        <div className="scroll-x mt-2 max-h-64 overflow-y-auto rounded-md border border-line">
          <table className="w-full text-[13px]">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-line bg-paper text-left text-muted">
                <th className="px-3 py-1.5 font-semibold">Dag</th>
                <th className="px-3 py-1.5 text-right font-semibold">Antall</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.day} className="border-b border-line last:border-0">
                  <td className="px-3 py-1.5">{dayLabel(d.day)}</td>
                  <td className="num px-3 py-1.5 text-right">{formatInt(d.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Trendlinje i et tallfelt. Tallet står alltid som tekst i feltet; linjen viser bare retningen. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const x = (i: number) => (i / (values.length - 1)) * 100;
  const y = (v: number) => 100 - (v / max) * 100;
  const last = values.length - 1;
  return (
    <div className="relative mt-3 h-7" role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible text-navy-300" aria-hidden>
        <polyline
          points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-navy-600 ring-2 ring-white"
        style={{ left: `${x(last)}%`, top: `${y(values[last]!)}%` }}
        aria-hidden
      />
    </div>
  );
}

/** Rangerte vannrette søyler (del av helhet, én farge), f.eks. organisasjoner per plan. */
export function RankedBars({ rows, noun }: { rows: { label: string; n: number }[]; noun: [string, string] }) {
  const sorted = [...rows].filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...sorted.map((r) => r.n));
  if (!sorted.length) return <p className="text-[13px] text-muted">Ingen ennå.</p>;
  return (
    <ul className="space-y-2.5">
      {sorted.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
          <span className="truncate text-ink">{r.label}</span>
          <span className="h-2 rounded-full bg-navy-50" aria-hidden>
            <span className="block h-2 rounded-full bg-navy-600" style={{ width: `${(r.n / max) * 100}%` }} />
          </span>
          <span className="num text-right font-semibold text-ink">
            {formatInt(r.n)} <span className="sr-only">{r.n === 1 ? noun[0] : noun[1]}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Runde akseverdier for et vilkårlig intervall (ikke fra 0), f.eks. 1,5 – 2 – 2,5 – 3 mill. */
export function niceRange(lo: number, hi: number, intervals = 4): { start: number; end: number; ticks: number[] } {
  let a = Math.min(lo, hi);
  let b = Math.max(lo, hi);
  if (!(b > a)) {
    const pad = Math.max(1, Math.abs(a) * 0.1);
    a -= pad;
    b += pad;
  }
  const rough = (b - a) / intervals;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * pow).find((s) => s >= rough) ?? 10 * pow;
  const start = Math.floor(a / step) * step;
  const end = Math.ceil(b / step) * step;
  const ticks: number[] = [];
  for (let i = 0; start + i * step <= end + step / 2; i++) ticks.push(start + i * step);
  return { start, end, ticks };
}

/**
 * Fordeling på én akse med fremhevede markører («emphasis»): tidligere verdier som dempede prikker (marine 300),
 * den midterste halvdelen som et svakt bånd, medianen som en tynn strek, og egne verdier som ruter i marine 600
 * med navn over. Prikkene er bevisst grå (kontekst, ikke en egen serie) og har lav kontrast mot hvitt – alle tall
 * står derfor i tabellen ved siden av og i verktøytipset. Ruter i stedet for prikker gir form i tillegg til farge.
 * Validert med dataviz-validatoren: marine 600 mot marine 300 har ΔE 28,6 ved fargesvakt syn.
 */
export function StripChart({
  points,
  band,
  markers,
  summary,
  axisLabel,
}: {
  points: { value: number; tip: string }[];
  band: { p25: number; median: number; p75: number } | null;
  markers: { label: string; value: number; tip: string }[];
  /** Tilgjengelig navn: hele poenget i én setning. */
  summary: string;
  /** Får høyeste aksetall med, så hele aksen kan bruke samme enhet (f.eks. «0,6 mill.» … «1,2 mill.»). */
  axisLabel: (n: number, axisMax: number) => string;
}) {
  const all = [...points.map((p) => p.value), ...markers.map((m) => m.value)];
  if (!all.length) return null;
  const { start, end, ticks } = niceRange(Math.min(...all), Math.max(...all));
  const pos = (v: number) => ((v - start) / (end - start)) * 100;
  const sortedMarkers = [...markers].sort((a, b) => a.value - b.value);
  const place = (p: number) => (p < 12 ? 'translate-x-0' : p > 88 ? '-translate-x-full' : '-translate-x-1/2');
  return (
    <div
      data-chart
      tabIndex={0}
      role="img"
      aria-label={summary}
      className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-navy-600 focus-visible:ring-offset-2"
    >
      <div className="mx-2">
        {/* Navn over de egne markørene – én rad per markør, så de aldri kolliderer. */}
        {sortedMarkers.map((m) => (
          <div key={m.label} className="relative h-5" aria-hidden>
            <span className={cn('absolute whitespace-nowrap text-[12px] font-semibold text-ink', place(pos(m.value)))} style={{ left: `${pos(m.value)}%` }}>
              {m.label}
            </span>
          </div>
        ))}
        {band ? (
          <div className="relative h-5" aria-hidden>
            <span className={cn('absolute whitespace-nowrap text-[11px] text-muted', place(pos(band.median)))} style={{ left: `${pos(band.median)}%` }}>
              Median
            </span>
          </div>
        ) : null}
        <div className="relative h-12">
          <div className="absolute inset-x-0 top-1/2 border-t border-line" aria-hidden />
          {band ? (
            <>
              <div
                className="absolute top-1/2 h-8 -translate-y-1/2 rounded bg-navy-600/10"
                style={{ left: `${pos(band.p25)}%`, width: `${Math.max(0.5, pos(band.p75) - pos(band.p25))}%` }}
                aria-hidden
              />
              <div className="absolute top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-navy-900" style={{ left: `${pos(band.median)}%` }} aria-hidden />
            </>
          ) : null}
          {[...points]
            .sort((a, b) => a.value - b.value)
            .map((p, i) => (
              <span
                key={`p${i}`}
                data-tip={p.tip}
                className="group absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                style={{ left: `${pos(p.value)}%`, top: `calc(50% + ${((i % 3) - 1) * 6}px)` }}
              >
                <span className="size-2.5 rounded-full bg-navy-300 ring-2 ring-white group-data-[active]:bg-navy-700" />
              </span>
            ))}
          {sortedMarkers.map((m) => (
            <span
              key={m.label}
              data-tip={m.tip}
              className="group absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
              style={{ left: `${pos(m.value)}%` }}
            >
              <span className="size-3.5 rotate-45 rounded-[2px] bg-navy-600 ring-2 ring-white group-data-[active]:bg-navy-900" />
            </span>
          ))}
        </div>
        <div className="relative h-4 text-[11px] text-muted" aria-hidden>
          {ticks.map((t, i) => (
            <span key={t} className={cn('num absolute whitespace-nowrap', i === 0 ? 'translate-x-0' : i === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2')} style={{ left: `${pos(t)}%` }}>
              {axisLabel(t, ticks[ticks.length - 1]!)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
