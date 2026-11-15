/**
 * To verktøy som virker uten konto (bare norsk, som appen):
 *
 * - «Prøv uten konto» (/prov): velg bransje og fylke og skriv hva dere leverer – de åpne anbudene rangeres med
 *   samme treffmotor som i appen. Bare de fem beste vises, og ingenting lagres.
 * - Lønnsomhetssjekken (/kalkulator): egne tall inn, selvkost, målpris og margin ut – med appens formler.
 *
 * Skjemaet til «Prøv uten konto» står også på forsiden (TryBand) på alle språk.
 */
import { LuArrowRight, LuArrowUpRight, LuCalculator, LuCalendarClock, LuCircleCheck, LuInfo, LuTriangleAlert } from 'react-icons/lu';
import { INDUSTRIES, REGIONS } from '@/domain/reference';
import { QUICK_GOOD, QUICK_TOP, type QuickResult } from '@/domain/matching/quick';
import { fmtKr, fmtNumber } from '@/domain/profit/calculator';
import type { QuickCalcForm, QuickCalcResult } from '@/domain/profit/quick-calc';
import type { PublicTender } from '@/domain/tenders/public-page';
import { compactNumber, money } from '@/i18n/format';
import { StripChart } from '../charts';
import { Alert, cn, Field, Input, PostForm } from '../components';
import { useUi } from '../context';
import { daysUntil, formatDate, formatDateTime } from '../format';
import { PublicLayout } from '../layouts';
import { Kicker, NightHero, SignalCta, Wrap } from '../site';

export interface TryValues {
  industry: string;
  region: string;
  words: string;
}

/** Adressen til registreringen der valgene følger med til oppstartsskjemaet. */
export function trySignupHref(v: TryValues): string {
  const q = new URLSearchParams();
  if (v.industry) q.set('bransje', v.industry);
  if (v.region) q.set('fylke', v.region);
  if (v.words.trim()) q.set('tjenester', v.words.trim().slice(0, 200));
  const next = `/app/onboarding${q.size ? `?${q.toString()}` : ''}`;
  return `/registrer?neste=${encodeURIComponent(next)}`;
}

/** Skjemaet: bransje, fylke og hva dere leverer. Vanlig GET – virker uten JavaScript, og adressen kan deles. */
export function TryForm({ values, idPrefix = 'prov' }: { values?: Partial<TryValues>; idPrefix?: string }) {
  const { m } = useUi();
  const t = m.home.try;
  const label = 'mb-1.5 block text-[13px] font-semibold text-ink';
  return (
    <form method="get" action="/prov" className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_auto] lg:items-end">
      <div className="min-w-0">
        <label htmlFor={`${idPrefix}-bransje`} className={label}>
          {t.industry}
        </label>
        <select id={`${idPrefix}-bransje`} name="bransje" required className="field-input" defaultValue={values?.industry ?? ''}>
          <option value="" disabled>
            {t.chooseIndustry}
          </option>
          {INDUSTRIES.map((i) => (
            <option key={i.id} value={i.id}>
              {m.industries.names[i.id]?.name ?? i.name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0">
        <label htmlFor={`${idPrefix}-fylke`} className={label}>
          {t.region}
        </label>
        <select id={`${idPrefix}-fylke`} name="fylke" className="field-input" defaultValue={values?.region ?? ''}>
          <option value="">{t.allRegions}</option>
          {REGIONS.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0">
        <label htmlFor={`${idPrefix}-ord`} className={label}>
          {t.words}
        </label>
        <input id={`${idPrefix}-ord`} name="ord" maxLength={200} className="field-input" placeholder={t.wordsPlaceholder} defaultValue={values?.words ?? ''} />
      </div>
      <button type="submit" className="btn-signal h-[46px] justify-center whitespace-nowrap">
        {t.submit} <LuArrowRight className="size-4" aria-hidden />
      </button>
    </form>
  );
}

/** Forsiden: prøv med egen bransje rett under toppen. Skjules når verktøyene er slått av. */
export function TryBand() {
  const { m, publicTools } = useUi();
  if (!publicTools) return null;
  const t = m.home.try;
  return (
    <section id="prov" className="scroll-mt-20 bg-cream py-12 sm:py-16">
      <Wrap>
        <div className="reveal rounded-3xl border border-line bg-surface p-6 shadow-[0_24px_60px_-45px_rgba(6,14,27,0.5)] sm:p-8">
          <div className="max-w-3xl">
            <Kicker>{t.eyebrow}</Kicker>
            <h2 className="mt-3 text-[26px] font-[760] leading-tight tracking-[-0.025em] text-strong sm:text-[32px]">{t.title}</h2>
            <p className="mt-2 text-[16px] leading-relaxed text-muted">{t.lead}</p>
          </div>
          <div className="mt-6">
            <TryForm idPrefix="forside" />
          </div>
          {t.languageNote ? <p className="mt-3 text-[13px] text-muted">{t.languageNote}</p> : null}
        </div>
      </Wrap>
    </section>
  );
}

// ---------------------------------------------------------------------------
// /prov
// ---------------------------------------------------------------------------
export function TryPage({ values, result, limited = false }: { values: TryValues; result: QuickResult | null; limited?: boolean }) {
  const { user, publicTenderPages } = useUi();
  const signup = user ? '/app/anbud' : trySignupHref(values);
  const tenderHref = (id: string) => (user ? `/app/anbud/${id}` : publicTenderPages ? `/anbud/${id}` : `/registrer?neste=${encodeURIComponent(`/app/anbud/${id}`)}`);
  return (
    <PublicLayout>
      <NightHero
        eyebrow="Prøv uten konto"
        title="Se anbudene som passer dere."
        lead="Velg bransje og fylke, og skriv gjerne hva dere leverer. De åpne anbudene rangeres med de samme reglene som i appen. Ingenting lagres."
      />
      <section className="bg-cream py-10 sm:py-14">
        <Wrap>
          <div className="rounded-3xl border border-line bg-surface p-5 sm:p-7">
            <TryForm values={values} />
          </div>

          {limited ? (
            <Alert tone="warning" className="mt-6" title="For mange forsøk på kort tid">
              Vent et par minutter og prøv igjen.
            </Alert>
          ) : null}

          {result ? (
            <div className="mt-8">
              <h2 className="text-[22px] font-[760] leading-tight tracking-[-0.02em] text-strong sm:text-[26px]">
                {result.open === 0
                  ? `Ingen åpne anbud i ${result.industry.name} akkurat nå`
                  : result.open === 1
                    ? `1 åpent anbud i ${result.industry.name} akkurat nå`
                    : `${result.open.toLocaleString('nb-NO')} åpne anbud i ${result.industry.name} – ${result.rows.length === result.open ? 'her er de' : `her er de ${result.rows.length} som passer best`}`}
              </h2>
              {result.open > 0 ? (
                <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-muted">
                  Rangert etter bransjen{result.region ? `, ${result.region.name}` : ''}
                  {result.words.length ? ` og ordene «${result.words.join('», «')}»` : ''}.{' '}
                  {result.good > 0
                    ? `${result.good.toLocaleString('nb-NO')} av dem er gode treff (${QUICK_GOOD} eller mer av 100).`
                    : result.words.length
                      ? 'Ingen av dem skiller seg ut som gode treff på ordene deres ennå – prøv andre ord for det dere leverer.'
                      : 'Skriv hva dere leverer, så skiller vi de beste fra resten.'}{' '}
                  {result.ranked < result.open ? `Rangert blant de ${result.ranked.toLocaleString('nb-NO')} med nærmest frist. ` : ''}
                  Tallet viser hvor godt anbudet passer – ikke sjansen for å vinne.{' '}
                  <a href="/metode#treff" className="font-semibold">
                    Slik regnes det
                  </a>
                </p>
              ) : (
                <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-muted">
                  Nye anbud kommer fortløpende. Med konto får dere beskjed så snart det kommer noe som passer.
                </p>
              )}

              <ol className="mt-6 space-y-3">
                {result.rows.map((x) => {
                  const days = daysUntil(x.deadlineAt);
                  return (
                    <li key={x.id} className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
                      <div className="flex items-start gap-4">
                        <span className="num flex size-12 shrink-0 flex-col items-center justify-center rounded-xl bg-night text-white" aria-label={`Treff ${x.score} av 100`}>
                          <span className="text-[17px] font-[750] leading-none">{x.score}</span>
                          <span className="mt-0.5 text-[9.5px] uppercase tracking-[0.1em] text-white/60" aria-hidden>
                            av 100
                          </span>
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-[16.5px] font-semibold leading-snug [overflow-wrap:anywhere]">
                            <a href={tenderHref(x.id)} className="text-strong no-underline hover:underline">
                              {x.title}
                            </a>
                          </h3>
                          <p className="mt-0.5 text-[13.5px] text-muted">{[x.buyerName, x.place].filter(Boolean).join(' · ') || 'Oppdragsgiver ikke oppgitt'}</p>
                          {x.reasons.length ? (
                            <p className="mt-2 flex gap-1.5 text-[14px] leading-snug text-ink">
                              <LuCircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
                              <span>
                                <span className="font-semibold">Passer fordi:</span> {x.reasons.join(' · ')}
                              </span>
                            </p>
                          ) : null}
                          {x.gap ? (
                            <p className="mt-1 flex gap-1.5 text-[13.5px] leading-snug text-muted">
                              <LuInfo className="mt-0.5 size-4 shrink-0" aria-hidden />
                              {x.gap}
                            </p>
                          ) : null}
                          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px]">
                            {x.deadlineAt ? (
                              <span className="inline-flex items-center gap-1.5 text-ink">
                                <LuCalendarClock className="size-4 text-muted" aria-hidden />
                                Frist {formatDate(x.deadlineAt)}
                                {days !== null && days >= 0 ? <span className="text-muted">({days === 0 ? 'i dag' : days === 1 ? '1 dag' : `${days} dager`})</span> : null}
                              </span>
                            ) : null}
                            <a href={tenderHref(x.id)} className="font-semibold">
                              Se krav og risiko
                            </a>
                            {!user ? (
                              <a href={`/kalkulator?anbud=${x.id}`} className="font-semibold">
                                Regn på lønnsomheten
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>

              <div className="mt-8 flex flex-col items-start gap-4 rounded-3xl bg-night p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-7">
                <div className="max-w-2xl">
                  <p className="text-[18px] font-[740] leading-snug text-white">
                    {result.open > QUICK_TOP ? `Dette er ${QUICK_TOP} av ${result.open.toLocaleString('nb-NO')}. Med konto ser dere alle.` : 'Med konto får dere beskjed når nye kommer.'}
                  </p>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-white/70">
                    Da teller også godkjenninger, kontraktsstørrelse og det dere ikke vil ha – og hvert anbud vurderes mot krav, risiko og kostnadene deres.
                  </p>
                </div>
                <a href={signup} className="btn-signal shrink-0">
                  {user ? 'Åpne i appen' : 'Lagre valgene og se alle'} <LuArrowRight className="size-4" aria-hidden />
                </a>
              </div>
            </div>
          ) : null}
        </Wrap>
      </section>
      <SignalCta
        title="Få bare anbudene som passer dere."
        lead="Rangert mot bedriften, med krav og risiko for hvert anbud. Ingen kort, og ingenting trekkes automatisk."
        primary={user ? { href: '/app', label: 'Til appen' } : { href: signup, label: 'Start gratis' }}
        secondary={{ href: '/eksempel', label: 'Se et ekte eksempel' }}
      />
    </PublicLayout>
  );
}

// ---------------------------------------------------------------------------
// /kalkulator
// ---------------------------------------------------------------------------
export interface CalculatorMarket {
  label: string;
  n: number;
  values: number[];
  band: { p25: number; median: number; p75: number };
  /** Andelen av tildelingene som var høyere enn målprisen. */
  cheaperThanPct: number | null;
}

const VERDICT_TONE = { over_target: 'ok', under_target: 'warning', loss: 'danger' } as const;

export function CalculatorPage({
  form,
  errors = {},
  result,
  tender,
  market,
}: {
  form: QuickCalcForm;
  errors?: Partial<Record<keyof QuickCalcForm, string>>;
  result: QuickCalcResult | null;
  tender: PublicTender | null;
  market: CalculatorMarket | null;
}) {
  const { user, locale } = useUi();
  const action = `/kalkulator${tender ? `?anbud=${tender.id}` : ''}`;
  const appPath = tender ? `/app/anbud/${tender.id}/lonnsomhet` : '/app/lonnsomhet';
  const signup = user ? appPath : `/registrer?neste=${encodeURIComponent(appPath)}`;
  const c = result?.calc ?? null;
  const at = c?.atContractValue ?? null;
  // Kalkulatoren regner i kroner: anslått verdi i annen valuta vises, men brukes ikke.
  const nok = tender?.currency === 'NOK';
  const noticeValue = nok ? (tender?.estimatedValue ?? null) : null;
  const foreignValue = tender && !nok && tender.estimatedValue ? money(locale, tender.estimatedValue, tender.currency) : null;
  return (
    <PublicLayout>
      <NightHero
        eyebrow="Lønnsomhetssjekk – uten konto"
        title="Lønner anbudet seg?"
        lead="Legg inn egne tall og se selvkost, prisen dere må ta for ønsket margin, og hva dere sitter igjen med. Samme formler som i appen. Ingenting lagres."
      />
      <section className="bg-cream py-10 sm:py-14">
        <Wrap className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="min-w-0 space-y-6">
            {tender ? (
              <article className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
                <p className="text-[12.5px] font-semibold uppercase tracking-[0.12em] text-navy-700">Anbudet dere regner på</p>
                <h2 className="mt-2 text-[18px] font-[740] leading-snug text-strong [overflow-wrap:anywhere]">
                  <a href={`/anbud/${tender.id}`} className="text-strong no-underline hover:underline">
                    {tender.title}
                  </a>
                </h2>
                <p className="mt-1 text-[14px] text-muted">
                  {[tender.buyerName, tender.deadlineAt ? `frist ${formatDateTime(tender.deadlineAt, tender.deadlineTimeKnown)}` : null].filter(Boolean).join(' · ')}
                </p>
                <p className="mt-2 text-[14px] text-ink">
                  Anslått verdi fra oppdragsgiver: <strong className="num">{noticeValue ? fmtKr(noticeValue) : (foreignValue ?? 'ikke oppgitt')}</strong>
                  {tender.isFramework && noticeValue ? ' (rammeavtale – et anslag eller tak, ikke garantert omsetning)' : ''}
                  {foreignValue ? ' (annen valuta – brukes ikke i regnestykket, som er i kroner)' : ''}
                </p>
              </article>
            ) : null}

            <PostForm action={action} className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-[18px] font-[740] text-strong">
                <LuCalculator className="size-5 text-navy-600" aria-hidden /> Deres tall
              </h2>
              <p className="mt-1 text-[13.5px] text-muted">Alle beløp i kroner eks. mva., for hele kontrakten.</p>
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Timer" htmlFor="hours" error={errors.hours}>
                  <Input id="hours" name="hours" inputMode="decimal" defaultValue={form.hours} invalid={Boolean(errors.hours)} placeholder="f.eks. 1 200" />
                </Field>
                <Field label="Timekost (kr per time)" htmlFor="hourlyCost" hint="Lønn og sosiale kostnader." error={errors.hourlyCost}>
                  <Input id="hourlyCost" name="hourlyCost" inputMode="decimal" defaultValue={form.hourlyCost} invalid={Boolean(errors.hourlyCost)} placeholder="f.eks. 520" />
                </Field>
                <Field label="Materialer og utstyr" htmlFor="materials" error={errors.materials}>
                  <Input id="materials" name="materials" inputMode="decimal" defaultValue={form.materials} invalid={Boolean(errors.materials)} />
                </Field>
                <Field label="Underleverandører og annet" htmlFor="other" error={errors.other}>
                  <Input id="other" name="other" inputMode="decimal" defaultValue={form.other} invalid={Boolean(errors.other)} />
                </Field>
                <Field label="Påslag for indirekte kostnader (%)" htmlFor="overheadPct" hint="Administrasjon, lokaler, forsikring. Tomt = 0." error={errors.overheadPct}>
                  <Input id="overheadPct" name="overheadPct" inputMode="decimal" defaultValue={form.overheadPct} invalid={Boolean(errors.overheadPct)} />
                </Field>
                <Field label="Ønsket margin (%)" htmlFor="marginPct" error={errors.marginPct}>
                  <Input id="marginPct" name="marginPct" inputMode="decimal" required defaultValue={form.marginPct} invalid={Boolean(errors.marginPct)} placeholder="f.eks. 10" />
                </Field>
                <Field
                  label="Kontraktsverdi"
                  htmlFor="contractValue"
                  className="sm:col-span-2"
                  hint={noticeValue ? `Tomt = oppdragsgivers anslag (${fmtKr(noticeValue)}).` : 'Det dere venter å få betalt for hele kontrakten. Kan stå tomt.'}
                  error={errors.contractValue}
                >
                  <Input id="contractValue" name="contractValue" inputMode="decimal" defaultValue={form.contractValue} invalid={Boolean(errors.contractValue)} />
                </Field>
              </div>
              <button type="submit" className="btn-dark mt-6 w-full justify-center sm:w-auto">
                Regn ut
              </button>
            </PostForm>
          </div>

          <div className="min-w-0 space-y-6">
            {c && result ? (
              <>
                <article className="rounded-3xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="resultat">
                  <h2 id="resultat" className="text-[18px] font-[740] text-strong">
                    Resultat
                  </h2>
                  <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {(
                      [
                        ['Selvkost', fmtKr(c.breakEven), 'Prisen der dere går i null'],
                        [`Målpris`, c.targetPrice !== null ? fmtKr(c.targetPrice) : 'Kan ikke regnes', `For ${fmtNumber(result.marginPct)} % margin`],
                        ['Ved kontraktsverdien', at ? `${fmtNumber(at.marginPct)} % margin` : 'Verdi mangler', at ? `${at.profit < 0 ? 'Tap' : 'Fortjeneste'} ${fmtKr(Math.abs(at.profit))}` : 'Legg inn kontraktsverdi'],
                      ] as const
                    ).map(([label, value, hint]) => (
                      <div key={label} className="rounded-2xl bg-paper px-4 py-3.5">
                        <dt className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">{label}</dt>
                        <dd className="mt-1 text-[20px] font-[760] leading-tight text-strong">{value}</dd>
                        <dd className="mt-0.5 text-[12.5px] text-muted">{hint}</dd>
                      </div>
                    ))}
                  </dl>
                  {result.verdict && at && result.contractValue ? (
                    <Alert tone={VERDICT_TONE[result.verdict]} className="mt-4">
                      {result.verdict === 'loss'
                        ? `Ved ${fmtKr(result.contractValue.value)} taper dere ${fmtKr(Math.abs(at.profit))}: selvkosten er høyere enn kontraktsverdien.`
                        : result.verdict === 'over_target'
                          ? `Ved ${fmtKr(result.contractValue.value)} sitter dere igjen med ${fmtKr(at.profit)} – ${fmtNumber(at.marginPct)} % margin, som er over målet på ${fmtNumber(result.marginPct)} %.`
                          : `Ved ${fmtKr(result.contractValue.value)} sitter dere igjen med ${fmtKr(at.profit)} – ${fmtNumber(at.marginPct)} % margin, under målet på ${fmtNumber(result.marginPct)} %.${c.targetPrice !== null ? ` For å nå målet må prisen være ${fmtKr(c.targetPrice)}.` : ''}`}{' '}
                      <span className="text-muted">
                        (
                        {result.contractValue.basis === 'dokument'
                          ? 'Kontraktsverdien er oppdragsgivers anslag fra kunngjøringen. Det gjelder ofte hele perioden med opsjoner – legg inn kostnadene for samme periode'
                          : 'Kontraktsverdien er deres eget tall'}
                        {at.note ? `. ${at.note}` : '.'})
                      </span>
                    </Alert>
                  ) : null}

                  <h3 className="mt-6 text-[14.5px] font-semibold text-strong">Hvis kostnadene blir høyere</h3>
                  <p className="mt-0.5 text-[13px] text-muted">{at && result.contractValue ? `Margin ved kontraktsverdien på ${fmtKr(result.contractValue.value)}.` : 'Margin hvis dere tar målprisen.'}</p>
                  <div className="scroll-x mt-2 rounded-2xl border border-line">
                    <table className="w-full text-[14px]">
                      <thead>
                        <tr className="border-b border-line bg-cream text-left text-[12.5px] text-muted">
                          <th className="rounded-tl-2xl px-3 py-2.5 font-semibold sm:px-4">Kostnader</th>
                          <th className="px-3 py-2.5 text-right font-semibold sm:px-4">Selvkost</th>
                          <th className="rounded-tr-2xl px-3 py-2.5 text-right font-semibold sm:px-4">Margin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.sensitivity.map((s) => {
                          const margin = at ? s.marginAtContractValue : s.marginAtTarget;
                          return (
                            <tr key={s.increasePct} className="border-b border-line last:border-0">
                              <td className="px-3 py-2.5 text-ink sm:px-4">{s.increasePct === 0 ? 'Som lagt inn' : `+${s.increasePct} %`}</td>
                              <td className="num whitespace-nowrap px-3 py-2.5 text-right text-ink sm:px-4">{fmtKr(s.cost)}</td>
                              <td className={cn('whitespace-nowrap px-3 py-2.5 text-right font-semibold sm:px-4', margin !== null && margin < 0 ? 'text-danger' : 'text-strong')}>
                                {margin !== null ? `${fmtNumber(margin)} %` : '–'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <details className="mt-5 rounded-2xl border border-line">
                    <summary className="flex min-h-11 cursor-pointer select-none items-center px-4 text-[14px] font-semibold text-strong">Slik er det regnet</summary>
                    <ul className="space-y-1.5 border-t border-line px-4 py-3 text-[13.5px] text-ink">
                      {result.steps.map((f) => (
                        <li key={f.label} className="flex flex-wrap justify-between gap-x-4">
                          <span>
                            {f.label}: <span className="text-muted">{f.formula}</span>
                          </span>
                          <span className="num font-semibold">{fmtKr(f.value)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="border-t border-line px-4 py-3 text-[13.5px]">
                      <a href="/metode#kalkyle" className="font-semibold">
                        Hele metoden
                      </a>{' '}
                      <span className="text-muted">– også markedspris og hva vi ikke vet.</span>
                    </p>
                  </details>
                </article>

                {market && c.targetPrice !== null ? (
                  <article className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
                    <h2 className="text-[18px] font-[740] text-strong">Målprisen blant tidligere tildelinger</h2>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
                      {market.n} publiserte tildelinger med oppgitt verdi ({market.label}). Andre kontrakter enn denne – en pekepinn, ikke et anslag for anbudet.
                    </p>
                    <div className="mt-4">
                      <StripChart
                        points={market.values.map((v) => ({ value: v, tip: fmtKr(v) }))}
                        band={market.band}
                        markers={[{ label: 'Målpris', value: c.targetPrice, tip: fmtKr(c.targetPrice) }]}
                        summary={`Median ${fmtKr(market.band.median)}. Midterste halvdel ${fmtKr(market.band.p25)} – ${fmtKr(market.band.p75)}. Målprisen deres er ${fmtKr(c.targetPrice)}.`}
                        axisLabel={(v) => compactNumber(locale, v)}
                      />
                    </div>
                    <p className="mt-3 text-[14px] text-ink">
                      Median <strong className="num">{fmtKr(market.band.median)}</strong> · midterste halvdel{' '}
                      <span className="num">
                        {fmtKr(market.band.p25)} – {fmtKr(market.band.p75)}
                      </span>
                      {market.cheaperThanPct !== null ? (
                        <>
                          . Målprisen deres er lavere enn <strong className="num">{market.cheaperThanPct} %</strong> av tildelingene.
                        </>
                      ) : (
                        '.'
                      )}
                    </p>
                  </article>
                ) : null}

                <div className="rounded-3xl bg-night p-6 text-white sm:p-7">
                  <p className="text-[18px] font-[740] leading-snug text-white">En rask sjekk – ikke hele regnestykket.</p>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-white/70">
                    I appen legger dere inn kostnadene linje for linje, med risikopåslag og minstepris. Dagbøter, betalingsfrist og andre vilkår fra dokumentene regnes om til kroner, kapasiteten
                    sjekkes, og kalkylen lagres på anbudet.
                  </p>
                  <a href={signup} className="btn-signal mt-5">
                    {user ? 'Åpne kalkulatoren i appen' : 'Regn videre i appen – gratis'} <LuArrowRight className="size-4" aria-hidden />
                  </a>
                </div>
              </>
            ) : (
              <article className="rounded-3xl border border-dashed border-line-strong bg-surface p-6 sm:p-7">
                <h2 className="text-[18px] font-[740] text-strong">Dette får dere svar på</h2>
                <ul className="mt-4 space-y-3 text-[15px] leading-relaxed text-ink">
                  {[
                    ['Selvkost', 'prisen der dere går i null – alt under er tap.'],
                    ['Målpris', 'det dere må ta for å få marginen dere ønsker.'],
                    ['Ved kontraktsverdien', 'hva dere sitter igjen med hvis dere får det oppdragsgiver anslår.'],
                    ['Følsomhet', 'hva som skjer hvis kostnadene blir 5, 10 eller 20 % høyere.'],
                  ].map(([title, text]) => (
                    <li key={title} className="flex gap-2.5">
                      <LuCircleCheck className="mt-1 size-4 shrink-0 text-ok" aria-hidden />
                      <span>
                        <strong>{title}:</strong> {text}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-5 flex gap-2 text-[13.5px] leading-relaxed text-muted">
                  <LuTriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Regnestykket bruker bare tallene dere skriver inn. Det sier ingenting om hvilken pris som vinner.
                </p>
                {!tender ? (
                  <p className="mt-4 text-[14px]">
                    Har dere et bestemt anbud?{' '}
                    <a href="/prov" className="inline-flex items-center gap-1 font-semibold">
                      Finn det her <LuArrowUpRight className="size-3.5" aria-hidden />
                    </a>{' '}
                    – da henter vi anslått verdi og tidligere tildelinger.
                  </p>
                ) : null}
              </article>
            )}
          </div>
        </Wrap>
      </section>
      <SignalCta
        title="Finn ut om det er verdt å vinne."
        lead="Treff, krav, risiko og lønnsomhet for hvert anbud – med kilde på alt. Ingen kort, og ingenting trekkes automatisk."
        primary={user ? { href: '/app', label: 'Til appen' } : { href: signup, label: 'Start gratis' }}
        secondary={{ href: '/eksempel', label: 'Se et ekte eksempel' }}
      />
    </PublicLayout>
  );
}
