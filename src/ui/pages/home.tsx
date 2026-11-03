/**
 * Forsiden. Bygd på ekte data fra databasen – ingen oppdiktede kunder, omtaler eller tall:
 * - Tallet i toppen og fristtavla er åpne kunngjøringer fra Doffin og TED akkurat nå.
 * - Kunngjøringen med markeringer er en ekte, åpen kunngjøring; markeringen er ordrett fra teksten.
 * - Kartet og bransjelisten teller åpne konkurranser. Et anbud kan gjelde flere fylker og bransjer.
 * Eneste illustrasjon er stegene, og den er merket «Eksempel».
 */
import type { ReactNode } from 'react';
import { LuArrowRight, LuArrowUpRight } from 'react-icons/lu';
import type { MarketSnapshot, NoticeSpecimen } from '@/domain/tenders/market';
import { useUi } from '../context';
import { buttonVariants, cn } from '../components';
import { PublicLayout } from '../layouts';
import { formatDate, formatInt, formatMoney, sourcesPhrase } from '../format';
import { Container, FaqList, faqItems, PlanCards } from '../marketing';

const TZ = 'Europe/Oslo';
const isoDay = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
const weekdayDate = new Intl.DateTimeFormat('nb-NO', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: TZ });
const clock = new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const longDay = new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });

const time = (d: Date) => clock.format(d).replace(':', '.');

/** Fristen slik den står på tavla: «I dag 12.00», «I morgen», «fre. 07.11». */
export function boardWhen(deadline: Date, timeKnown: boolean, now = new Date()): { day: string; time: string | null } {
  const d = isoDay.format(deadline);
  const day =
    d === isoDay.format(now) ? 'I dag' : d === isoDay.format(new Date(now.getTime() + 86_400_000)) ? 'I morgen' : weekdayDate.format(deadline).replace(/\.$/, '');
  return { day, time: timeKnown ? time(deadline) : null };
}

/** «om 2 timer», «om 3 dager» – til avslutningen. */
function until(deadline: Date, now = new Date()): string {
  const ms = deadline.getTime() - now.getTime();
  const h = Math.round(ms / 3_600_000);
  if (h < 1) return 'om under en time';
  if (h < 36) return `om ${h} ${h === 1 ? 'time' : 'timer'}`;
  const days = Math.round(ms / 86_400_000);
  return `om ${days} dager`;
}

function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[12px] font-medium uppercase tracking-[0.12em]', className)}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Toppseksjon: dagens tall og fristtavla
// ---------------------------------------------------------------------------
function Hero({ m }: { m: MarketSnapshot }) {
  const { trialDays, liveSources } = useUi();
  const fetched = m.lastFetched ?? m.lastIngested;
  return (
    <section className="border-b border-line">
      <Container className="grid grid-cols-1 gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-center lg:gap-14 lg:py-20">
        <div className="min-w-0">
          <Mono className="text-muted">
            {longDay.format(m.at)}
            {fetched ? ` · sist hentet kl. ${time(fetched)}` : ''}
          </Mono>
          {m.open > 0 ? (
            <h1 className="mt-5 text-[44px] font-[780] leading-[0.98] tracking-[-0.035em] text-navy-950 sm:text-[64px] lg:text-[72px]">
              <span className="hl">{formatInt(m.open)}</span> offentlige anbud er åpne i Norge akkurat nå.
            </h1>
          ) : (
            <h1 className="mt-5 text-[44px] font-[780] leading-[0.98] tracking-[-0.035em] text-navy-950 sm:text-[64px]">
              Offentlige anbud i Norge, samlet på ett sted.
            </h1>
          )}
          <p className="mt-6 max-w-[34rem] text-[18px] leading-relaxed text-ink sm:text-[19px]">
            AnbudRadar leser alle sammen og viser bedriften din de som passer – med frist, krav og lenke til kunngjøringen.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="/registrer" className={buttonVariants({ size: 'lg' })}>
              Prøv gratis i {trialDays} dager <LuArrowRight className="size-4" aria-hidden />
            </a>
            <a href="#slik-leser-vi" className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
              Se hva vi leser ut
            </a>
          </div>
          {m.open > 0 ? (
            <dl className="mt-10 grid max-w-[34rem] grid-cols-3 gap-4 border-t border-line pt-5">
              {[
                [formatInt(m.new24h), 'nye siste døgn'],
                [formatInt(m.closingWeek), 'frister de neste 7 dagene'],
                [formatInt(m.buyers), 'oppdragsgivere'],
              ].map(([n, label]) => (
                <div key={label} className="min-w-0">
                  <dt className="sr-only">{label}</dt>
                  <dd>
                    <span className="block text-[26px] font-[750] leading-none tracking-[-0.02em] text-navy-950">{n}</span>
                    <span className="mt-1.5 block text-[13px] leading-snug text-muted">{label}</span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          <p className="mt-6 text-[13px] text-muted">Kilder: {sourcesPhrase(liveSources, true)}.</p>
        </div>
        <Fristtavla rows={m.board} now={m.at} />
      </Container>
    </section>
  );
}

function Fristtavla({ rows, now }: { rows: MarketSnapshot['board']; now: Date }) {
  return (
    <figure className="min-w-0">
      <div className="board overflow-hidden rounded-2xl bg-board text-board-text shadow-[0_30px_70px_-35px_rgba(11,22,38,0.9)]">
        <div className="flex items-center justify-between gap-3 border-b border-board-line px-5 py-3.5">
          <Mono className="text-board-amber">Frister</Mono>
          <Mono className="text-board-dim">Neste {rows.length || ''} · kl. {time(now)}</Mono>
        </div>
        {rows.length ? (
          <ol className="divide-y divide-board-line">
            {rows.map((r, i) => {
              const when = boardWhen(r.deadlineAt, r.deadlineTimeKnown, now);
              return (
                <li key={r.id} className="board-row grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 px-5 py-3 sm:grid-cols-[7.5rem_minmax(0,1fr)]" style={{ animationDelay: `${i * 70}ms` }}>
                  <div className="font-mono text-[13px] leading-snug text-board-amber">
                    <span className="block font-medium uppercase">{when.day}</span>
                    {when.time ? <span className="block text-board-amber/80">kl. {when.time}</span> : null}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold leading-snug text-board-text">{r.title}</p>
                    <p className="mt-0.5 truncate text-[13px] leading-snug text-board-dim">
                      {r.buyerName ?? 'Oppdragsgiver ikke oppgitt'}
                      {r.place ? ` · ${r.place}` : ''}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="px-5 py-10 text-[14px] text-board-dim">Ingen åpne frister akkurat nå. Tavla fylles når neste henting er ferdig.</p>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-board-line px-5 py-3">
          <Mono className="text-board-dim">Doffin · TED</Mono>
          <a href="/registrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-board-amber no-underline hover:text-white">
            Se alle i appen <LuArrowRight className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>
      <figcaption className="mt-3 text-[13px] text-muted">Ekte kunngjøringer, sortert etter frist. Oppdateres fortløpende.</figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// En ekte kunngjøring, markert slik AnbudRadar leser den
// ---------------------------------------------------------------------------
function Ref({ n }: { n: number }) {
  return (
    <span className="ml-1 inline-flex size-5 -translate-y-px items-center justify-center rounded-full bg-navy-950 align-middle font-mono text-[11px] font-medium text-white" aria-hidden>
      {n}
    </span>
  );
}

function AnnotatedNotice({ s }: { s: NoticeSpecimen }) {
  const when = boardWhen(s.deadlineAt, s.deadlineTimeKnown);
  const deadlineText = `${formatDate(s.deadlineAt, true)}${when.time ? ` kl. ${when.time}` : ''}`;
  const sourceName = s.source === 'doffin' ? 'Doffin' : s.source === 'ted' ? 'TED' : s.source;
  const notes: { n: number; label: string; value: string; text: string }[] = [
    { n: 1, label: 'Frist', value: deadlineText, text: 'Du får påminnelse 7, 3 og 1 dag før.' },
    ...(s.excerpt.mark && s.requirement
      ? [{ n: 2, label: 'Krav', value: s.requirement, text: 'Står ordrett i kunngjøringen. Vi viser hvor, så du kan sjekke selv.' }]
      : []),
    { n: s.excerpt.mark ? 3 : 2, label: 'Verdi', value: formatMoney(s.estimatedValue, s.currency), text: 'Anslått av oppdragsgiver. Regn på om det lønner seg før du byr.' },
    { n: s.excerpt.mark ? 4 : 3, label: 'Kilde', value: `${sourceName} ${s.noticeId}`, text: 'Lenke til originalen følger alltid med.' },
  ];
  const ref = (label: string) => notes.find((x) => x.label === label)!.n;
  return (
    <section id="slik-leser-vi" className="scroll-mt-20 border-b border-line bg-paper">
      <Container className="py-16 sm:py-20">
        <div className="max-w-2xl">
          <Mono className="text-navy-600">Slik leser vi en kunngjøring</Mono>
          <h2 className="mt-3 text-[32px] font-[760] leading-[1.04] tracking-[-0.028em] sm:text-[44px]">Det viktigste står ofte gjemt i teksten.</h2>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">
            Under er en ekte, åpen kunngjøring. Det AnbudRadar trekker ut, er markert – med henvisning til hvor det står.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-12">
          <article className="min-w-0 rounded-lg border border-line-strong bg-white p-6 shadow-[0_1px_0_rgba(15,35,64,0.04),0_18px_40px_-28px_rgba(15,35,64,0.35)] sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
              <Mono className="text-muted">Kunngjøring av konkurranse</Mono>
              <Mono className="text-muted">
                <span className="hl-soft">{sourceName} {s.noticeId}</span>
                <Ref n={ref('Kilde')} />
              </Mono>
            </div>
            <h3 className="mt-5 text-[21px] font-[720] leading-snug tracking-[-0.015em] text-navy-950 sm:text-[24px]">{s.title}</h3>
            <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-3 text-[14px] sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Oppdragsgiver</dt>
                <dd className="mt-0.5 font-semibold text-ink">{s.buyerName ?? 'Ikke oppgitt'}</dd>
              </div>
              <div className="min-w-0">
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Sted</dt>
                <dd className="mt-0.5 font-semibold text-ink">{s.place ?? 'Ikke oppgitt'}</dd>
              </div>
              <div className="min-w-0">
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Tilbudsfrist</dt>
                <dd className="mt-0.5 font-semibold text-ink">
                  <span className="hl">{deadlineText}</span>
                  <Ref n={ref('Frist')} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Anslått verdi</dt>
                <dd className="mt-0.5 font-semibold text-ink">
                  <span className="hl">{formatMoney(s.estimatedValue, s.currency)}</span>
                  <Ref n={ref('Verdi')} />
                </dd>
              </div>
            </dl>
            <p className="mt-6 border-t border-line pt-5 text-[15px] leading-relaxed text-ink">
              {s.excerpt.before}
              {s.excerpt.mark ? (
                <>
                  <mark className="hl">{s.excerpt.mark}</mark>
                  <Ref n={ref('Krav')} />
                </>
              ) : null}
              {s.excerpt.after}
            </p>
          </article>
          <ol className="min-w-0 space-y-5 self-center">
            {notes.map((x) => (
              <li key={x.n} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
                <span className="mt-0.5 inline-flex size-6 items-center justify-center rounded-full bg-navy-950 font-mono text-[12px] font-medium text-white" aria-hidden>
                  {x.n}
                </span>
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-navy-950">
                    {x.label}: <span className="font-normal">{x.value}</span>
                  </p>
                  <p className="mt-0.5 text-[14px] leading-relaxed text-muted">{x.text}</p>
                </div>
              </li>
            ))}
            {s.sourceUrl ? (
              <li className="pl-[2.5rem]">
                <a href={s.sourceUrl} rel="noopener" className="inline-flex items-center gap-1 text-[14px] font-semibold">
                  Åpne kunngjøringen hos {sourceName} <LuArrowUpRight className="size-4" aria-hidden />
                </a>
              </li>
            ) : null}
          </ol>
        </div>
      </Container>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Hvor er anbudene? Fylkeskart i ruter + bransjer
// ---------------------------------------------------------------------------
/** Forenklet kart: hvert fylke er én rute, plassert omtrent der det ligger (kolonne, rad). */
const TILE_POS: Record<string, [number, number]> = {
  '56': [3, 0], // Finnmark
  '55': [2, 1], // Troms
  '18': [1, 2], // Nordland
  '50': [1, 3], // Trøndelag
  '15': [0, 4], // Møre og Romsdal
  '34': [1, 4], // Innlandet
  '46': [0, 5], // Vestland
  '33': [1, 5], // Buskerud
  '03': [2, 5], // Oslo
  '32': [3, 5], // Akershus
  '11': [0, 6], // Rogaland
  '40': [1, 6], // Telemark
  '39': [2, 6], // Vestfold
  '31': [3, 6], // Østfold
  '42': [1, 7], // Agder
};
/** Sekvensiell skala i én farge (lys → mørk). Tekst er mørk på lyse ruter og hvit på mørke. */
const RAMP = [
  { bg: 'bg-navy-50', text: 'text-muted' },
  { bg: 'bg-navy-100', text: 'text-navy-950' },
  { bg: 'bg-navy-200', text: 'text-navy-950' },
  { bg: 'bg-navy-300', text: 'text-navy-950' },
  { bg: 'bg-navy-600', text: 'text-white' },
  { bg: 'bg-navy-800', text: 'text-white' },
];
export function rampStep(n: number, max: number): number {
  if (n <= 0 || max <= 0) return 0;
  const r = n / max;
  return r <= 0.2 ? 1 : r <= 0.4 ? 2 : r <= 0.6 ? 3 : r <= 0.8 ? 4 : 5;
}

function MarketMap({ m }: { m: MarketSnapshot }) {
  const max = Math.max(0, ...m.regions.map((r) => r.n));
  const top = m.industries.slice(0, 9);
  return (
    <section className="border-b border-line">
      <Container className="py-16 sm:py-20">
        <div className="max-w-2xl">
          <Mono className="text-navy-600">Akkurat nå</Mono>
          <h2 className="mt-3 text-[32px] font-[760] leading-[1.04] tracking-[-0.028em] sm:text-[44px]">Hvor er anbudene, og hva gjelder de?</h2>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">Åpne konkurranser per fylke og bransje. Et anbud kan gjelde flere fylker og bransjer.</p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
          <figure className="min-w-0">
            <div data-chart tabIndex={0} role="img" aria-label={`Åpne anbud per fylke: ${m.regions.map((r) => `${r.name} ${r.n}`).join(', ')}.`} className="mx-auto grid max-w-[420px] grid-cols-4 gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-navy-600 focus-visible:ring-offset-4">
              {m.regions.map((r) => {
                const [col, row] = TILE_POS[r.code] ?? [0, 0];
                const step = RAMP[rampStep(r.n, max)]!;
                return (
                  <div
                    key={r.code}
                    data-tip={`${formatInt(r.n)} åpne anbud|${r.name}`}
                    className={cn('flex aspect-[1.25] min-w-0 flex-col justify-between rounded-[6px] p-2 transition-opacity data-[active]:opacity-80', step.bg, step.text)}
                    style={{ gridColumnStart: col + 1, gridRowStart: row + 1 }}
                    aria-hidden
                  >
                    <span className="truncate text-[11px] font-semibold leading-tight sm:text-[12px]">{r.name}</span>
                    <span className="font-mono text-[15px] font-medium leading-none sm:text-[17px]">{formatInt(r.n)}</span>
                  </div>
                );
              })}
            </div>
            <figcaption className="mx-auto mt-4 flex max-w-[420px] flex-wrap items-center justify-between gap-3 text-[12px] text-muted">
              <span className="flex items-center gap-1.5">
                Færre
                {RAMP.slice(1).map((s, i) => (
                  <span key={i} className={cn('inline-block size-3 rounded-[3px]', s.bg)} aria-hidden />
                ))}
                Flere
              </span>
              <span>
                Forenklet kart.{m.regionless ? ` ${formatInt(m.regionless)} uten fylke.` : ''}
              </span>
            </figcaption>
          </figure>
          <div className="min-w-0">
            <h3 className="font-mono text-[12px] font-medium uppercase tracking-[0.12em] text-muted">Bransjer med flest åpne anbud</h3>
            {top.length ? (
              <ul className="mt-4 divide-y divide-line border-y border-line">
                {top.map((i) => (
                  <li key={i.id}>
                    <a href={`/bransjer#${i.id}`} className="group flex items-baseline gap-3 py-3 text-ink no-underline">
                      <span className="text-[16px] font-semibold group-hover:underline">{i.name}</span>
                      <span className="mb-1 flex-1 border-b border-dotted border-line-strong" aria-hidden />
                      <span className="font-mono text-[15px] font-medium text-navy-950">{formatInt(i.n)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-[14px] text-muted">Ingen åpne anbud å vise akkurat nå.</p>
            )}
            <a href="/bransjer" className="mt-5 inline-flex items-center gap-1 text-[14px] font-semibold">
              Alle bransjer <LuArrowRight className="size-4" aria-hidden />
            </a>
          </div>
        </div>
      </Container>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tre steg (en ekte rekkefølge), med små utsnitt merket «Eksempel»
// ---------------------------------------------------------------------------
function Steps() {
  const steps: { title: string; text: string; sample: ReactNode }[] = [
    {
      title: 'Fortell hva dere leverer',
      text: 'Bransje, område og størrelse på oppdrag. Det tar et par minutter.',
      sample: (
        <div className="flex flex-wrap gap-1.5">
          {['Renhold', 'Vestland', '1–10 mill. kr', 'ISO 14001'].map((t) => (
            <span key={t} className="rounded-full border border-line-strong bg-white px-2.5 py-0.5 text-[13px] text-ink">
              {t}
            </span>
          ))}
        </div>
      ),
    },
    {
      title: 'Få de som passer',
      text: 'Hvert anbud får en score for hvor godt det passer – og hvorfor.',
      sample: (
        <div>
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="font-semibold text-ink">Samsvar med profilen</span>
            <span className="font-mono font-medium text-navy-950">86</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-navy-100">
            <div className="h-1.5 w-[86%] rounded-full bg-navy-600" />
          </div>
          <p className="mt-2 text-[12px] text-muted">Renhold · Vestland · krav du oppfyller</p>
        </div>
      ),
    },
    {
      title: 'Svar i tide',
      text: 'Påminnelser før fristen, og hjelp med kravene og tilbudet.',
      sample: (
        <div className="flex flex-wrap gap-1.5 font-mono text-[12px]">
          {['7 dager', '3 dager', '1 dag'].map((t) => (
            <span key={t} className="rounded border border-line-strong bg-white px-2 py-0.5 text-ink">
              {t}
            </span>
          ))}
        </div>
      ),
    },
  ];
  return (
    <section className="border-b border-line">
      <Container className="py-16 sm:py-20">
        <Mono className="text-navy-600">Slik kommer du i gang</Mono>
        <ol className="mt-8 grid grid-cols-1 border-t border-line md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className={cn('flex flex-col py-8 md:px-8 md:py-6', i > 0 && 'border-t border-line md:border-l md:border-t-0', i === 0 && 'md:pl-0', i === 2 && 'md:pr-0')}>
              <span className="font-mono text-[13px] font-medium text-muted">Steg {i + 1}</span>
              <h3 className="mt-3 text-[22px] font-[740] leading-tight tracking-[-0.02em]">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.text}</p>
              <div className="mt-5 rounded-md border border-dashed border-line-strong bg-paper p-3">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Eksempel</p>
                {s.sample}
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Priser, spørsmål, avslutning
// ---------------------------------------------------------------------------
function Pricing() {
  const { trialDays } = useUi();
  return (
    <section className="border-b border-line">
      <Container className="py-16 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <Mono className="text-navy-600">Prisliste</Mono>
            <h2 className="mt-3 text-[32px] font-[760] leading-[1.04] tracking-[-0.028em] sm:text-[44px]">Tre planer. Ingen binding.</h2>
          </div>
          <p className="max-w-sm text-[15px] text-muted">
            {`${trialDays} dager gratis med alt i Profesjonell. Ingen kort, og ingenting trekkes automatisk.`}
          </p>
        </div>
        <div className="mt-10">
          <PlanCards maxFeatures={3} />
        </div>
        <a href="/priser" className="mt-6 inline-flex items-center gap-1 text-[14px] font-semibold">
          Se alt som er med i hver plan <LuArrowRight className="size-4" aria-hidden />
        </a>
      </Container>
    </section>
  );
}

function Faq() {
  const { trialDays, liveSources } = useUi();
  return (
    <section className="border-b border-line">
      <Container className="grid grid-cols-1 gap-10 py-16 sm:py-20 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <Mono className="text-navy-600">Spørsmål</Mono>
          <h2 className="mt-3 text-[32px] font-[760] leading-[1.04] tracking-[-0.028em] sm:text-[44px]">Det folk lurer på.</h2>
          <p className="mt-4 text-[15px] text-muted">
            Flere spørsmål? <a href="/kontakt">Skriv til oss</a>.
          </p>
        </div>
        <FaqList items={faqItems({ trialDays, sources: sourcesPhrase(liveSources, true) }).slice(0, 4)} />
      </Container>
    </section>
  );
}

function FinalCta({ m }: { m: MarketSnapshot }) {
  const { trialDays } = useUi();
  const next = m.board[0];
  return (
    <section>
      <Container className="flex flex-col items-start gap-8 py-16 sm:py-24 lg:flex-row lg:items-end lg:justify-between">
        <p className="max-w-3xl text-[34px] font-[760] leading-[1.04] tracking-[-0.03em] text-navy-950 sm:text-[52px]">
          {next ? (
            <>
              Neste frist går ut <span className="hl">{until(next.deadlineAt, m.at)}</span>.
            </>
          ) : (
            'Neste frist venter ikke.'
          )}
        </p>
        <div className="flex flex-wrap gap-3">
          <a href="/registrer" className={buttonVariants({ size: 'lg' })}>
            Prøv gratis i {trialDays} dager <LuArrowRight className="size-4" aria-hidden />
          </a>
          <a href="/priser" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
            Se priser
          </a>
        </div>
      </Container>
    </section>
  );
}

export function HomePage({ market, specimen }: { market: MarketSnapshot; specimen: NoticeSpecimen | null }) {
  return (
    <PublicLayout>
      <Hero m={market} />
      {specimen ? <AnnotatedNotice s={specimen} /> : null}
      <MarketMap m={market} />
      <Steps />
      <Pricing />
      <Faq />
      <FinalCta m={market} />
    </PublicLayout>
  );
}
