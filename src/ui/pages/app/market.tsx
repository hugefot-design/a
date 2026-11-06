import { pricePositions, SOLID_COMPARABLES, type MarketPrice } from '@/domain/profit/market';
import type { ProfitWorkspace } from '@/domain/profit/service';
import { EmptyState, Panel, PanelHeader, Stat } from '../../components';
import { StripChart } from '../../charts';
import { formatDate, formatInt, formatMoney } from '../../format';

const nf1 = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 1 });
const kr = (n: number) => formatMoney(n, 'NOK', false);
const compact = (n: number) => formatMoney(n).replace(/ kr$/, '');
/** Aksetall i én enhet for hele aksen: «0,6 mill.» … «1,2 mill.», eller hele tusen under en million. */
const axisMoney = (n: number, axisMax: number) => (axisMax >= 1_000_000 ? `${nf1.format(n / 1_000_000)} mill.` : formatInt(n));

export interface CalcHistory {
  /** Median avvik (prosent) mellom målprisen i kalkylen og det som vant, fra Resultater. */
  medianPct: number;
  n: number;
}

function cheaperText(pct: number): string {
  if (pct >= 100) return 'lavere enn alle tildelingene';
  if (pct <= 0) return 'høyere enn alle tildelingene';
  return `lavere enn ${pct} % av tildelingene`;
}

/**
 * Markedspris fra tidligere tildelinger, med bedriftens egne priser plassert i fordelingen. Viser bare ekte
 * tildelte verdier og sier tydelig hva som er holdt utenfor.
 */
export function MarketPanel({ ws, market, calcHistory }: { ws: ProfitWorkspace; market: MarketPrice; calcHistory: CalcHistory | null }) {
  const n = market.awards.length;
  const prices = [
    { key: 'minstepris', label: 'Minstepris', total: ws.calc.minPrice },
    { key: 'malpris', label: 'Målpris', total: ws.calc.targetPrice },
    { key: 'testpris', label: 'Testpris', total: ws.testPrice },
  ];
  const position = pricePositions(market, ws.inputs.durationMonths, prices);
  const perYear = position?.unit === 'per_year';
  const unit = perYear ? 'per år' : 'totalt';
  const target = position?.positions.find((p) => p.key === 'malpris') ?? null;
  const excludedNote = [
    market.excluded.frameworks ? `${formatInt(market.excluded.frameworks)} rammeavtaler (verdien er ofte et tak)` : null,
    market.excluded.otherCurrency ? `${formatInt(market.excluded.otherCurrency)} i annen valuta` : null,
  ].filter(Boolean);

  return (
    <Panel>
      <div id="marked" className="scroll-mt-24" />
      <PanelHeader
        title="Markedspris fra tidligere tildelinger"
        description={
          market.match
            ? `Tildelte kontrakter med CPV-kode som begynner på ${market.match.prefix}${market.match.label ? ` (${market.match.label})` : ''}, siste fem år. Bare verdier fra tildelingskunngjøringer – ingen anslag.`
            : 'Anbudet har ingen CPV-kode som er spesifikk nok (minst tre siffer), så vi finner ikke lignende kontrakter.'
        }
      />
      {!position ? (
        <EmptyState title={n ? 'For få sammenlignbare tildelinger' : 'Ingen sammenlignbare tildelinger med verdi'}>
          {n
            ? `Vi fant ${formatInt(n)} ${n === 1 ? 'tildeling' : 'tildelinger'} med verdi. Vi viser ikke statistikk på færre enn tre.`
            : 'Mange tildelingskunngjøringer oppgir ikke verdi, og rammeavtaler holdes utenfor.'}
          {excludedNote.length ? ` Holdt utenfor: ${excludedNote.join(', ')}.` : ''}
        </EmptyState>
      ) : (
        <div className="space-y-5 px-5 py-4">
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            <Stat label={`Median ${unit}`} value={compact(position.stats.median) + ' kr'} />
            <Stat label="Midterste halvdel" value={<span className="text-[18px]">{`${compact(position.stats.p25)} – ${compact(position.stats.p75)}`}</span>} hint={`kr ${unit}`} />
            <Stat
              label="Tildelinger"
              value={formatInt(position.stats.n)}
              hint={position.stats.n < SOLID_COMPARABLES ? 'Få – tolk med forsiktighet' : perYear ? 'med kjent varighet' : undefined}
            />
          </div>

          <StripChart
            points={market.awards
              .filter((a) => (perYear ? a.perYear !== null : true))
              .slice(0, 80)
              .map((a) => ({
                value: perYear ? a.perYear! : a.value,
                tip: `${kr(perYear ? a.perYear! : a.value)} ${unit}|${a.supplierName} · ${a.buyerName ?? 'ukjent oppdragsgiver'}${a.awardDate ? ` · ${formatDate(a.awardDate)}` : ''}`,
              }))}
            band={{ p25: position.stats.p25, median: position.stats.median, p75: position.stats.p75 }}
            markers={position.positions.map((p) => ({ label: p.label, value: p.value, tip: `${kr(p.value)} ${unit}|${p.label} – ${cheaperText(p.cheaperThanPct)}` }))}
            summary={`Tildelt ${unit} for ${formatInt(position.stats.n)} lignende kontrakter: median ${kr(position.stats.median)}, midterste halvdel ${kr(position.stats.p25)} til ${kr(position.stats.p75)}.${target ? ` Målprisen deres er ${kr(target.value)} ${unit}, ${cheaperText(target.cheaperThanPct)}.` : ''}`}
            axisLabel={axisMoney}
          />

          {position.positions.length ? (
            <ul className="space-y-1 text-[14px]">
              {position.positions.map((p) => (
                <li key={p.key}>
                  <span className="font-semibold text-navy-900">{p.label}:</span> <span className="num">{kr(p.value)}</span> {unit} – {cheaperText(p.cheaperThanPct)}.
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-muted">Legg inn kostnadene i kalkylen, så ser dere hvor minstepris og målpris ligger.</p>
          )}

          {target ? (
            <p className="rounded-lg border border-line bg-paper px-3 py-2 text-[13.5px] text-ink">
              {target.value > position.stats.p75
                ? 'Målprisen ligger over tre av fire tidligere tildelinger. Vurder om dere kan konkurrere på pris – eller om kvalitet veier tungt i denne konkurransen.'
                : target.value < position.stats.p25
                  ? 'Målprisen ligger under tre av fire tidligere tildelinger. Sjekk at kalkylen har med alle kostnader før dere går lavt.'
                  : 'Målprisen ligger i den midterste halvdelen av tidligere tildelinger.'}{' '}
              {!perYear ? 'Sammenlignet totalt fordi varigheten mangler – legg inn varighet for en sammenligning per år.' : ''}
            </p>
          ) : null}

          {calcHistory ? (
            <p className="text-[13.5px] text-ink">
              <span className="font-semibold">Erfaring:</span> i {formatInt(calcHistory.n)} {calcHistory.n === 1 ? 'tidligere anbud' : 'tidligere anbud'} lå målprisen i
              kalkylen deres i snitt {nf1.format(Math.abs(calcHistory.medianPct))} % {calcHistory.medianPct >= 0 ? 'over' : 'under'} det som vant.{' '}
              <a href="/app/resultater">Se resultatene</a>
            </p>
          ) : null}

          <details className="text-[13px]">
            <summary className="cursor-pointer font-semibold text-navy-700">Vis tildelingene ({formatInt(n)})</summary>
            <div className="scroll-x mt-2 max-h-80 overflow-y-auto rounded-md border border-line">
              <table className="w-full text-[13px]">
                <caption className="sr-only">Sammenlignbare tildelinger</caption>
                <thead>
                  <tr className="border-b border-line bg-paper text-left text-muted">
                    <th className="px-3 py-1.5 font-semibold">Kontrakt</th>
                    <th className="px-3 py-1.5 font-semibold">Vinner</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Tildelt</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Per år</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Dato</th>
                  </tr>
                </thead>
                <tbody>
                  {market.awards.slice(0, 50).map((a, i) => (
                    <tr key={`${a.tenderId}-${i}`} className="border-b border-line last:border-0">
                      <td className="max-w-[280px] px-3 py-1.5">
                        <a href={`/app/anbud/${a.tenderId}`} className="line-clamp-2">
                          {a.title}
                        </a>
                        <span className="text-muted">{a.buyerName ?? ''}</span>
                      </td>
                      <td className="px-3 py-1.5">{a.supplierName}</td>
                      <td className="num whitespace-nowrap px-3 py-1.5 text-right">{kr(a.value)}</td>
                      <td className="num whitespace-nowrap px-3 py-1.5 text-right">{a.perYear !== null ? kr(a.perYear) : '–'}</td>
                      <td className="num whitespace-nowrap px-3 py-1.5 text-right">{a.awardDate ? formatDate(a.awardDate) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <p className="text-[12px] text-muted">
            Verdien er vinnerens tilbudsverdi (eForms) eller samlet tildelt verdi (TED) – en pekepinn på prisnivået, ikke en fasit. Omfang,
            kvalitetskrav og opsjoner varierer.{excludedNote.length ? ` Holdt utenfor: ${excludedNote.join(', ')}.` : ''} Per år = tildelt verdi ÷
            varighet.
          </p>
        </div>
      )}
    </Panel>
  );
}
