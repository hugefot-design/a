import { LuTrophy } from 'react-icons/lu';
import { OUTCOME_REASONS, type Learning, type PriceComparison, type ResultRow } from '@/domain/tenders/results';
import { useUi } from '../../context';
import { Badge, Button, EmptyState, LinkButton, PageHeader, Panel, PanelHeader, PostForm, Stat } from '../../components';
import { AppShell } from '../../layouts';
import { formatDate, formatInt, formatMoney } from '../../format';

const STATUS: Record<ResultRow['status'], { label: string; tone: 'ok' | 'danger' | 'neutral' }> = {
  won: { label: 'Vunnet', tone: 'ok' },
  lost: { label: 'Ikke vunnet', tone: 'danger' },
  submitted: { label: 'Venter', tone: 'neutral' },
};

const pct = (n: number) => `${n > 0 ? '+' : ''}${new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 1 }).format(n)} %`;

const SOURCE_LABEL: Record<PriceComparison['source'], string> = {
  tildelingsbrev: 'Tildelingsbrevet (registrert av dere)',
  kunngjøring: 'Tildelingskunngjøringen',
  egen_pris: 'Deres pris (dere vant)',
};

function direction(median: number, over: string, under: string): string {
  if (Math.abs(median) < 0.5) return 'omtrent likt med';
  return median > 0 ? over : under;
}

const kr = (n: number) => formatMoney(n, 'NOK', false);

/** Liste i stedet for tabell, så avviket alltid synes – også på telefon. Hele beløp, ikke «mill.». */
function ComparisonList({ rows, priceLabel }: { rows: PriceComparison[]; priceLabel: string }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.tenderId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3">
          <a href={`/app/anbud/${r.tenderId}#resultat`} className="min-w-0 flex-1 basis-64 font-semibold">
            {r.title}
          </a>
          <span className="num whitespace-nowrap text-[13.5px] text-muted">
            {priceLabel} <span className="text-ink">{kr(r.price)}</span> · vant <span className="text-ink">{kr(r.winningPrice)}</span>
          </span>
          <span className={`num whitespace-nowrap font-semibold ${r.diffPct > 0 ? 'text-danger' : 'text-ok'}`}>{pct(r.diffPct)}</span>
          <p className="w-full text-[12px] text-muted">Kilde for vinnerprisen: {SOURCE_LABEL[r.source]}</p>
        </li>
      ))}
    </ul>
  );
}

export function ResultsPage({ learning: l, rows }: { learning: Learning; rows: ResultRow[] }) {
  const { org } = useUi();
  const competitorLinks = Boolean(org?.entitlements.competitorIntel);
  const decided = rows.filter((r) => r.status !== 'submitted');
  return (
    <AppShell>
      <PageHeader
        title="Resultater og læring"
        description="Hva dere har levert, hva som skjedde – og hva det betyr for neste tilbud. Bygger på statusen dere setter på lagrede anbud og det dere registrerer fra tildelingsbrevet."
      />
      {!l.delivered ? (
        <Panel>
          <EmptyState
            icon={<LuTrophy className="size-8" aria-hidden />}
            title="Ingen leverte tilbud registrert ennå"
            action={<LinkButton href="/app/lagret" variant="secondary">Til lagrede anbud</LinkButton>}
          >
            Sett status «Tilbud levert» på et lagret anbud. Når resultatet kommer, registrerer dere «Vunnet» eller «Ikke vunnet» – gjerne med pris og
            vinner fra tildelingsbrevet. Da samles vinnerandel, prisavvik og hvem dere taper mot her.
          </EmptyState>
        </Panel>
      ) : (
        <div className="space-y-6">
          <Panel>
            <div className="grid grid-cols-2 gap-5 px-5 py-5 sm:grid-cols-5">
              <Stat label="Levert" value={formatInt(l.delivered)} />
              <Stat label="Vunnet" value={formatInt(l.won)} />
              <Stat label="Ikke vunnet" value={formatInt(l.lost)} />
              <Stat label="Venter på resultat" value={formatInt(l.pending)} />
              <Stat
                label="Vinnerandel"
                value={l.winRatePct !== null ? `${new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 1 }).format(l.winRatePct)} %` : '–'}
                hint={l.winRatePct !== null ? `av ${formatInt(l.won + l.lost)} avgjorte` : 'ingen avgjort ennå'}
              />
            </div>
            {l.won + l.lost > 0 && l.won + l.lost < 5 ? (
              <p className="border-t border-line px-5 py-2.5 text-[12.5px] text-muted">Få avgjorte tilbud – tallene blir mer pålitelige etter hvert som dere registrerer flere.</p>
            ) : null}
          </Panel>

          {l.awaiting.length ? (
            <Panel>
              <PanelHeader title={`Venter på resultat (${formatInt(l.awaiting.length)})`} description="Leverte tilbud uten registrert resultat. Når tildelingen er publisert, står vinneren her." />
              <ul className="divide-y divide-line">
                {l.awaiting.map((r) => {
                  const others = r.awards.filter((a) => !a.isUs);
                  const us = r.awards.some((a) => a.isUs);
                  return (
                    <li key={r.bookmarkId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <a href={`/app/anbud/${r.tenderId}#resultat`} className="font-semibold">
                          {r.title}
                        </a>
                        <p className="text-[13px] text-muted">
                          {r.buyerName ?? 'Ukjent oppdragsgiver'}
                          {r.deadlineAt ? ` · frist ${formatDate(r.deadlineAt)}` : ''}
                        </p>
                        {r.awards.length ? (
                          <p className="mt-0.5 text-[13px] text-ink">
                            Tildelt: {us ? 'dere' : ''}
                            {us && others.length ? ', ' : ''}
                            {others.map((a) => a.supplierName).join(', ')}
                          </p>
                        ) : (
                          <p className="mt-0.5 text-[13px] text-muted">Ingen tildeling publisert ennå.</p>
                        )}
                      </div>
                      {us ? (
                        <PostForm action={`/app/lagret/${r.bookmarkId}/vunnet`}>
                          <input type="hidden" name="back" value="/app/resultater" />
                          <Button size="sm">Registrer som vunnet</Button>
                        </PostForm>
                      ) : (
                        <LinkButton href={`/app/anbud/${r.tenderId}#resultat`} size="sm" variant="secondary">
                          Registrer resultat
                        </LinkButton>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}

          {l.priceVsWinner.length ? (
            <Panel>
              <PanelHeader
                title="Pris: dere mot vinneren"
                description={
                  l.medianPriceDiffPct !== null
                    ? `Når dere ikke vant, lå prisen deres i snitt (median) ${pct(l.medianPriceDiffPct)} – ${direction(l.medianPriceDiffPct, 'over', 'under')} vinneren. ${formatInt(l.priceVsWinner.length)} ${l.priceVsWinner.length === 1 ? 'anbud' : 'anbud'} med begge priser.`
                    : undefined
                }
              />
              <ComparisonList rows={l.priceVsWinner} priceLabel="Deres pris" />
            </Panel>
          ) : null}

          {l.calcVsResult.length ? (
            <Panel>
              <PanelHeader
                title="Kalkylen mot resultatet"
                description={
                  l.medianCalcDiffPct !== null
                    ? `Målprisen i Lønnsomhet-kalkylen lå i snitt (median) ${pct(l.medianCalcDiffPct)} – ${direction(l.medianCalcDiffPct, 'over', 'under')} det som vant. Bruk det når dere setter målmargin.`
                    : undefined
                }
              />
              <ComparisonList rows={l.calcVsResult} priceLabel="Kalkylen" />
            </Panel>
          ) : null}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {l.reasons.length ? (
              <Panel>
                <PanelHeader title="Hva avgjorde" description="Slik dere har registrert det fra tildelingsbrevet." />
                <ul className="divide-y divide-line">
                  {l.reasons.map((r) => (
                    <li key={r.reason ?? 'ukjent'} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[14px]">
                      <span>{r.reason ? OUTCOME_REASONS[r.reason] : 'Ikke registrert'}</span>
                      <span className="num flex gap-2">
                        {r.won ? <Badge tone="ok">{formatInt(r.won)} vunnet</Badge> : null}
                        {r.lost ? <Badge tone="danger">{formatInt(r.lost)} ikke vunnet</Badge> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            {l.winnersAgainstUs.length ? (
              <Panel>
                <PanelHeader title="Hvem vant når dere ikke vant" description="Fra tildelingskunngjøringene, ellers det dere har registrert." />
                <ul className="divide-y divide-line">
                  {l.winnersAgainstUs.map((w) => (
                    <li key={w.name} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[14px]">
                      {competitorLinks && w.supplierId ? (
                        <a href={`/app/konkurrenter/leverandor/${w.supplierId}`} className="font-semibold">
                          {w.name}
                        </a>
                      ) : (
                        <span className="font-semibold text-navy-900">{w.name}</span>
                      )}
                      <span className="num text-muted">{formatInt(w.count)}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
          </div>

          <Panel>
            <PanelHeader title="Oppdragsgivere" description="Hvor dere har levert, og hvor dere vinner." />
            <div className="scroll-x">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-line text-left text-[13px] text-muted">
                    <th className="px-5 py-2 font-semibold">Oppdragsgiver</th>
                    <th className="px-3 py-2 text-right font-semibold">Levert</th>
                    <th className="px-3 py-2 text-right font-semibold">Vunnet</th>
                    <th className="px-5 py-2 text-right font-semibold">Ikke vunnet</th>
                  </tr>
                </thead>
                <tbody>
                  {l.buyers.map((b) => (
                    <tr key={b.authorityId ?? b.name} className="border-b border-line last:border-0">
                      <td className="px-5 py-2.5">
                        {competitorLinks && b.authorityId ? <a href={`/app/konkurrenter/oppdragsgiver/${b.authorityId}`}>{b.name}</a> : b.name}
                      </td>
                      <td className="num px-3 py-2.5 text-right">{formatInt(b.delivered)}</td>
                      <td className="num px-3 py-2.5 text-right">{formatInt(b.won)}</td>
                      <td className="num px-5 py-2.5 text-right">{formatInt(b.lost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {decided.length ? (
            <Panel>
              <PanelHeader title="Alle resultater" />
              <div className="scroll-x">
                <table className="w-full text-[14px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[13px] text-muted">
                      <th className="px-5 py-2 font-semibold">Anbud</th>
                      <th className="px-3 py-2 font-semibold">Resultat</th>
                      <th className="px-3 py-2 text-right font-semibold">Deres pris</th>
                      <th className="px-3 py-2 font-semibold">Avgjorde</th>
                      <th className="px-5 py-2 text-right font-semibold">Registrert</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decided.map((r) => (
                      <tr key={r.bookmarkId} className="border-b border-line last:border-0">
                        <td className="max-w-[340px] px-5 py-2.5">
                          <a href={`/app/anbud/${r.tenderId}#resultat`} className="line-clamp-2">
                            {r.title}
                          </a>
                          <p className="text-[12.5px] text-muted">{r.buyerName ?? ''}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                          {r.outcomeSource === 'tildeling' ? <p className="mt-0.5 text-[12px] text-muted">Bekreftet av tildelingen</p> : null}
                        </td>
                        <td className="num whitespace-nowrap px-3 py-2.5 text-right">{r.ourPrice !== null ? kr(r.ourPrice) : '–'}</td>
                        <td className="px-3 py-2.5">{r.reason ? OUTCOME_REASONS[r.reason] : <span className="text-muted">–</span>}</td>
                        <td className="num whitespace-nowrap px-5 py-2.5 text-right">{r.decidedAt ? formatDate(r.decidedAt) : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}

          <p className="text-[12.5px] text-muted">
            Vinnerpriser fra tildelingskunngjøringer er vinnerens tilbudsverdi (eForms) eller samlet tildelt verdi (TED). De brukes bare når det er én
            vinner og ikke rammeavtale – for rammeavtaler er verdien ofte et anslag. Priser fra tildelingsbrevet registrerer dere selv på anbudet.
          </p>
        </div>
      )}
    </AppShell>
  );
}
