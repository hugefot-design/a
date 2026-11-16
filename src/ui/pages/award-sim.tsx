/**
 * Tildelingssimulatoren uten konto (/tildeling, bare norsk): vekten på pris, prisene og kvalitetspoengene inn –
 * hvem som vinner, og prisen der to tilbud står likt, ut. DFØs to prismodeller, utregningen vises, ingenting lagres.
 *
 * Konkurrentens tall er brukerens egne antakelser og merkes slik. Knyttet til et anbud fylles vekten på pris inn fra
 * kunngjøringen når den kan leses sikkert (noticeWeights), og merkes «Fra kunngjøringen».
 */
import { LuArrowRight, LuArrowUpRight, LuCircleCheck, LuScale, LuTriangleAlert } from 'react-icons/lu';
import { DFO_PRICE_SOURCE, fmtPoints, PRICE_MODELS, type AwardSimForm, type AwardSimResult, type NoticeWeights } from '@/domain/profit/award-sim';
import { fmtKr, fmtNumber } from '@/domain/profit/calculator';
import { parseNumber } from '@/domain/profit/service';
import type { PublicTender } from '@/domain/tenders/public-page';
import { Alert, cn, Field, Input, PostForm } from '../components';
import { useUi } from '../context';
import { formatDateTime } from '../format';
import { PublicLayout } from '../layouts';
import { More, NightHero, SignalCta, Wrap } from '../site';

const OUTCOME_TONE = { vinner: 'ok', taper: 'warning', likt: 'info' } as const;

/** «Pris 30 % · Kvalitet 70 %» som små brikker. */
export function WeightChips({ weights, className }: { weights: NoticeWeights; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-2', className)}>
      {weights.criteria.map((c, i) => (
        <li key={`${c.name}-${i}`} className={cn('rounded-full px-3 py-1 text-[13.5px] [overflow-wrap:anywhere]', c.price ? 'bg-marker-soft font-semibold text-strong' : 'bg-paper text-ink')}>
          {c.name} <span className="num whitespace-nowrap">{fmtNumber(c.pct)}&nbsp;%</span>
        </li>
      ))}
    </ul>
  );
}

const pctSigned = (n: number) => `${fmtNumber(Math.abs(n))} %`;

function BreakEvenText({ r }: { r: AwardSimResult }) {
  const be = r.breakEven;
  const lead = r.input.ourQuality - r.input.theirQuality;
  if (be.kind === 'alltid') {
    return <p className="mt-1.5 text-[15px] leading-relaxed text-ink">Med forholdsmessig modell kan ikke prisen ta igjen kvalitetsforspranget: dere står foran uansett pris – så lenge antakelsene stemmer.</p>;
  }
  if (be.kind === 'aldri') {
    return (
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink">
        Med forholdsmessig modell kan dere ikke ta igjen konkurrentens kvalitetsforsprang på pris, uansett hvor lavt dere byr. Det som kan endre utfallet, er bedre kvalitetspoeng.
      </p>
    );
  }
  return (
    <>
      <p className="mt-1 text-[26px] font-[780] leading-tight tracking-[-0.02em] text-strong">{fmtKr(be.price)}</p>
      <p className="mt-1 text-[15px] leading-relaxed text-ink">
        {r.input.pricePct === 100
          ? 'Bare pris teller: laveste pris vinner.'
          : lead === 0
            ? 'Lik kvalitet: laveste pris vinner.'
            : lead > 0
              ? `Så mye kan dere by og fortsatt stå likt – ${pctSigned(be.vsTheirsPct)} over konkurrentens antatte pris. Byr dere lavere, står dere foran.`
              : `Så lavt må dere by for å stå likt – ${pctSigned(be.vsTheirsPct)} under konkurrentens antatte pris. Byr dere lavere, står dere foran.`}
      </p>
    </>
  );
}

export function AwardSimPage({
  form,
  errors = {},
  result,
  tender,
}: {
  form: AwardSimForm;
  errors?: Partial<Record<keyof AwardSimForm, string>>;
  result: AwardSimResult | null;
  tender: PublicTender | null;
}) {
  const { user } = useUi();
  const weights = tender?.awardWeights ?? null;
  const action = `/tildeling${tender ? `?anbud=${tender.id}` : ''}`;
  const calculator = `/kalkulator${tender ? `?anbud=${tender.id}` : ''}`;
  // Merket bare så lenge feltet har vekten fra kunngjøringen – endrer brukeren den, er det deres eget tall.
  const fromNotice = weights !== null && parseNumber(form.pricePct) === weights.pricePct;
  const signup = user ? '/app' : '/registrer';
  const r = result;
  return (
    <PublicLayout>
      <NightHero
        eyebrow="Tildelingssimulator – uten konto"
        title="Hvor mye dyrere kan dere være?"
        lead="Se hvem som vinner når pris og kvalitet vektes – og prisen der dere står likt. Ingenting lagres."
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
                {weights ? (
                  <>
                    <p className="mt-3 text-[13.5px] font-semibold text-strong">Tildelingskriterier fra kunngjøringen</p>
                    <WeightChips weights={weights} className="mt-2" />
                    <p className="mt-2 text-[13px] text-muted">Kvalitet og alle andre kriterier enn pris regnes her som ett kriterium. Sjekk vektene og prismodellen i konkurransegrunnlaget.</p>
                  </>
                ) : (
                  <p className="mt-3 text-[14px] text-ink">Kunngjøringen har ikke vekter vi kan lese sikkert. Se konkurransegrunnlaget og skriv dem inn selv.</p>
                )}
              </article>
            ) : null}

            <PostForm action={action} className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-[18px] font-[740] text-strong">
                <LuScale className="size-5 text-navy-600" aria-hidden /> Tallene
              </h2>
              <p className="mt-1 text-[13.5px] text-muted">Beløp i kroner eks. mva. Kvalitetspoeng fra 0 til 10 – bruker oppdragsgiver 0–100, del på 10.</p>

              <fieldset className="mt-5" aria-describedby={errors.model ? 'model-error' : 'model-hint'}>
                <legend className="text-[13px] font-semibold text-ink">Prismodell</legend>
                <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {PRICE_MODELS.map((p) => (
                    <label key={p.id} className="flex cursor-pointer gap-2.5 rounded-2xl border border-line p-3.5 has-[:checked]:border-strong has-[:checked]:bg-paper">
                      <input type="radio" name="model" value={p.id} defaultChecked={form.model === p.id} className="mt-[3px] accent-navy-900" />
                      <span className="min-w-0">
                        <span className="block text-[14.5px] font-semibold text-strong">{p.label}</span>
                        <span className="mt-0.5 block text-[13px] text-muted">{p.formula}.</span>
                        <span className="mt-0.5 block text-[13px] text-muted">{p.note}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {errors.model ? (
                  <p id="model-error" className="mt-1.5 text-[13px] font-medium text-danger">
                    {errors.model}
                  </p>
                ) : (
                  <p id="model-hint" className="mt-1.5 text-[13px] text-muted">
                    Står i konkurransegrunnlaget. Usikker? Regn med begge.
                  </p>
                )}
              </fieldset>

              <Field
                className="mt-5"
                label={
                  <>
                    Vekt på pris (%)
                    {fromNotice ? <span className="ml-2 rounded-full bg-ok-soft px-2 py-px text-[11px] font-semibold text-ok">Fra kunngjøringen</span> : null}
                  </>
                }
                htmlFor="pricePct"
                hint="Kvalitet og alle andre kriterier får resten."
                error={errors.pricePct}
              >
                <Input id="pricePct" name="pricePct" inputMode="decimal" required defaultValue={form.pricePct} invalid={Boolean(errors.pricePct)} placeholder="f.eks. 30" className="sm:max-w-40" />
              </Field>

              <fieldset className="mt-6">
                <legend className="text-[14.5px] font-semibold text-strong">Deres tilbud</legend>
                <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Pris (kr)" htmlFor="ourPrice" error={errors.ourPrice}>
                    <Input id="ourPrice" name="ourPrice" inputMode="decimal" required defaultValue={form.ourPrice} invalid={Boolean(errors.ourPrice)} placeholder="f.eks. 1 100 000" />
                  </Field>
                  <Field label="Kvalitetspoeng (0–10)" htmlFor="ourQuality" hint="Det dere regner med å få." error={errors.ourQuality}>
                    <Input id="ourQuality" name="ourQuality" inputMode="decimal" defaultValue={form.ourQuality} invalid={Boolean(errors.ourQuality)} placeholder="f.eks. 8" />
                  </Field>
                </div>
              </fieldset>

              <fieldset className="mt-6" aria-describedby="their-hint">
                <legend className="text-[14.5px] font-semibold text-strong">Konkurrenten – deres antakelser</legend>
                <p id="their-hint" className="mt-0.5 text-[13px] text-muted">
                  Simulatoren vet ikke hva andre byr. Skriv det dere tror – og prøv flere tall.
                </p>
                <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Antatt pris (kr)" htmlFor="theirPrice" error={errors.theirPrice}>
                    <Input id="theirPrice" name="theirPrice" inputMode="decimal" required defaultValue={form.theirPrice} invalid={Boolean(errors.theirPrice)} placeholder="f.eks. 1 000 000" />
                  </Field>
                  <Field label="Antatte kvalitetspoeng (0–10)" htmlFor="theirQuality" error={errors.theirQuality}>
                    <Input id="theirQuality" name="theirQuality" inputMode="decimal" defaultValue={form.theirQuality} invalid={Boolean(errors.theirQuality)} placeholder="f.eks. 6" />
                  </Field>
                </div>
              </fieldset>

              <button type="submit" className="btn-dark mt-6 w-full justify-center sm:w-auto">
                Regn ut
              </button>
            </PostForm>
          </div>

          <div className="min-w-0 space-y-6">
            {r ? (
              <>
                <article className="rounded-3xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="resultat">
                  <h2 id="resultat" className="text-[18px] font-[740] text-strong">
                    Resultat
                  </h2>
                  <Alert tone={OUTCOME_TONE[r.outcome]} className="mt-4">
                    {r.outcome === 'vinner'
                      ? `Med disse tallene vinner dere med ${fmtPoints(r.diff)} poeng.`
                      : r.outcome === 'taper'
                        ? `Med disse tallene taper dere med ${fmtPoints(-r.diff)} poeng.`
                        : 'Med disse tallene står dere så godt som likt: forskjellen er under 0,01 poeng.'}{' '}
                    <span className="text-muted">({PRICE_MODELS.find((p) => p.id === r.input.model)!.label.toLowerCase()} prismodell, pris {fmtNumber(r.input.pricePct)} %)</span>
                  </Alert>
                  <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {(
                      [
                        ['Dere', r.ours],
                        ['Konkurrenten (antakelse)', r.theirs],
                      ] as const
                    ).map(([label, s]) => (
                      <div key={label} className="rounded-2xl bg-paper px-4 py-3.5">
                        <dt className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">{label}</dt>
                        <dd className="mt-1 text-[22px] font-[760] leading-tight text-strong">{fmtPoints(s.total)} poeng</dd>
                        <dd className="mt-0.5 text-[12.5px] text-muted">
                          {fmtKr(s.price)} · prispoeng {fmtPoints(s.pricePoints)}
                          {r.input.pricePct < 100 ? ` · kvalitet ${fmtPoints(s.quality)}` : ''}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <h3 className="mt-6 text-[14.5px] font-semibold text-strong">Prisen der dere står likt</h3>
                  <BreakEvenText r={r} />
                  {r.qualityPoint ? (
                    <p className="mt-3 rounded-2xl bg-marker-soft px-4 py-3 text-[14.5px] leading-relaxed text-ink">
                      Ett kvalitetspoeng mer (til {fmtNumber(r.qualityPoint.quality)}) flytter likt-prisen fra {fmtKr(r.qualityPoint.from)} til {fmtKr(r.qualityPoint.to)}:{' '}
                      <strong className="num">{fmtKr(r.qualityPoint.kr)}</strong> mer å gå på.
                    </p>
                  ) : null}

                  <details className="mt-5 rounded-2xl border border-line">
                    <summary className="flex min-h-11 cursor-pointer select-none items-center px-4 text-[14px] font-semibold text-strong">Slik er det regnet</summary>
                    <ul className="space-y-1.5 border-t border-line px-4 py-3 text-[13.5px] text-ink">
                      {r.steps.map((s) => (
                        <li key={s.label} className="flex flex-wrap justify-between gap-x-4">
                          <span className="min-w-0 [overflow-wrap:anywhere]">
                            {s.label}: <span className="text-muted">{s.formula}</span>
                          </span>
                          <span className="num font-semibold">{s.value}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="border-t border-line px-4 py-3 text-[13.5px] text-muted">
                      Prismodellene er fra DFØs veileder{' '}
                      <a href={DFO_PRICE_SOURCE} target="_blank" rel="noopener noreferrer" className="font-semibold">
                        «Regne om pris til poeng»
                      </a>{' '}
                      (anskaffelser.no). Summen er poengene ganget med vekten. Står noe annet i konkurransegrunnlaget, gjelder det.{' '}
                      <a href="/metode#tildeling" className="font-semibold">
                        Hele metoden
                      </a>
                    </p>
                  </details>
                </article>

                <article className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
                  <h2 className="text-[16px] font-[740] text-strong">Før dere bestemmer prisen</h2>
                  <ul className="mt-3 space-y-2 text-[14.5px] leading-relaxed text-ink">
                    <li className="flex gap-2.5">
                      <LuTriangleAlert className="mt-1 size-4 shrink-0 text-urgent" aria-hidden />
                      <span>Konkurrentens pris og poeng er deres egne antakelser. Simulatoren vet ikke hva andre byr.</span>
                    </li>
                    <li className="flex gap-2.5">
                      <LuTriangleAlert className="mt-1 size-4 shrink-0 text-urgent" aria-hidden />
                      <span>Prismodellen, poengskalaen og om kvalitetspoengene justeres (normaliseres), står i konkurransegrunnlaget.</span>
                    </li>
                    <li className="flex gap-2.5">
                      <LuTriangleAlert className="mt-1 size-4 shrink-0 text-urgent" aria-hidden />
                      <span>Regnet med to tilbud. Er det flere, kan laveste pris komme fra en tredje – og da endres prispoengene for begge.</span>
                    </li>
                  </ul>
                </article>

                <div className="rounded-3xl bg-night p-6 text-white sm:p-7">
                  <p className="text-[18px] font-[740] leading-snug text-white">Vinner dere – og tjener dere penger?</p>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-white/70">Sjekk at prisen dekker kostnadene og gir marginen dere vil ha. Samme formler som i appen, uten konto.</p>
                  <a href={calculator} className="btn-signal mt-5">
                    Til lønnsomhetssjekken <LuArrowRight className="size-4" aria-hidden />
                  </a>
                </div>
              </>
            ) : (
              <article className="rounded-3xl border border-dashed border-line-strong bg-surface p-6 sm:p-7">
                <More label={<h2 className="text-[18px] font-[740]">Dette får dere svar på</h2>}>
                  <ul className="space-y-3 text-[15px] leading-relaxed text-ink">
                    {[
                      ['Hvem som vinner', 'prispoeng og kvalitetspoeng lagt sammen med vektene.'],
                      ['Prisen der dere står likt', 'hvor mye dyrere dere kan være – eller hvor mye billigere dere må være.'],
                      ['Hva kvalitet er verdt', 'hvor mye ett kvalitetspoeng mer flytter den prisen, i kroner.'],
                      ['Utregningen', 'steg for steg, med DFØs formler og kilde.'],
                    ].map(([title, text]) => (
                      <li key={title} className="flex gap-2.5">
                        <LuCircleCheck className="mt-1 size-4 shrink-0 text-ok" aria-hidden />
                        <span>
                          <strong>{title}:</strong> {text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </More>
                <p className="mt-4 flex gap-2 text-[13.5px] leading-relaxed text-muted">
                  <LuTriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Konkurrentens pris og poeng er deres egne antakelser. Simulatoren vet ikke hva andre byr.
                </p>
                {!tender ? (
                  <p className="mt-4 text-[14px]">
                    Har dere et bestemt anbud?{' '}
                    <a href="/prov" className="inline-flex items-center gap-1 font-semibold">
                      Finn det her <LuArrowUpRight className="size-3.5" aria-hidden />
                    </a>{' '}
                    – står vektene i kunngjøringen, fylles de inn.
                  </p>
                ) : null}
              </article>
            )}
          </div>
        </Wrap>
      </section>
      <SignalCta
        title="Finn anbudene det er verdt å kjempe om."
        lead="Treff, krav, risiko og lønnsomhet for hvert anbud – med kilde på alt. Ingen kort, og ingenting trekkes automatisk."
        primary={user ? { href: '/app', label: 'Til appen' } : { href: signup, label: 'Start gratis' }}
        secondary={{ href: '/eksempel', label: 'Se et ekte eksempel' }}
      />
    </PublicLayout>
  );
}
