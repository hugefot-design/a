/**
 * Forsiden – kort med vilje: ett tall, en fristtavle, tre punkter og én oppfordring.
 * Bygd på ekte data fra databasen – ingen oppdiktede kunder, omtaler eller tall:
 * tallet i toppen og fristtavla er åpne kunngjøringer fra Doffin og TED akkurat nå.
 * Detaljene (en markert kunngjøring, alle funksjoner, priser og spørsmål) står på undersidene.
 */
import type { ReactNode } from 'react';
import { LuArrowRight } from 'react-icons/lu';
import { PAID_PLANS, PLANS } from '@/domain/billing/plans';
import type { MarketSnapshot } from '@/domain/tenders/market';
import { useUi } from '../context';
import { buttonVariants, cn } from '../components';
import { PublicLayout } from '../layouts';
import { formatInt, sourcesPhrase } from '../format';
import { Container } from '../marketing';

const TZ = 'Europe/Oslo';
const isoDay = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
const weekdayDate = new Intl.DateTimeFormat('nb-NO', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: TZ });
const clock = new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const longDay = new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const shortDate = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', timeZone: TZ });

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

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[12px] font-medium uppercase tracking-[0.12em]', className)}>{children}</span>;
}

function StartButton({ className }: { className?: string }) {
  const { user, trialDays } = useUi();
  return (
    <a href={user ? '/app' : '/registrer'} className={cn(buttonVariants({ size: 'lg' }), className)}>
      {user ? 'Til appen' : `Prøv gratis i ${trialDays} dager`} <LuArrowRight className="size-4" aria-hidden />
    </a>
  );
}

// ---------------------------------------------------------------------------
// Toppen: dagens tall og fristtavla
// ---------------------------------------------------------------------------
function Hero({ m }: { m: MarketSnapshot }) {
  const { user } = useUi();
  const fetched = m.lastFetched ?? m.lastIngested;
  return (
    <section>
      <Container className="grid grid-cols-1 gap-12 pb-16 pt-12 sm:pb-20 sm:pt-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center lg:gap-16 lg:pb-24 lg:pt-20">
        <div className="min-w-0">
          <Mono className="text-muted">
            <span className="whitespace-nowrap">{longDay.format(m.at)}</span>
            {fetched ? (
              <>
                {' · '}
                <span className="whitespace-nowrap">
                  sist hentet {isoDay.format(fetched) === isoDay.format(m.at) ? '' : `${shortDate.format(fetched)} `}kl. {time(fetched)}
                </span>
              </>
            ) : null}
          </Mono>
          <h1 className="mt-5 text-[40px] font-[760] leading-[1.02] tracking-[-0.035em] text-navy-950 sm:text-[54px] lg:text-[60px]">
            {m.open > 0 ? (
              <>
                <span className="hl">{formatInt(m.open)}</span> offentlige anbud er åpne i Norge akkurat nå.
              </>
            ) : (
              'Offentlige anbud i Norge, samlet på ett sted.'
            )}
          </h1>
          <p className="mt-6 max-w-[31rem] text-[18px] leading-relaxed text-muted">
            AnbudRadar leser alle sammen og viser bedriften din de som passer – med frist, krav og lenke til kunngjøringen.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <StartButton />
            <a href="/priser" className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
              Se priser
            </a>
          </div>
          {user ? null : <p className="mt-4 text-[13px] text-muted">Uten kort. Ingenting trekkes automatisk.</p>}
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
          <Mono className="text-board-dim">kl. {time(now)}</Mono>
        </div>
        {rows.length ? (
          <ol className="divide-y divide-board-line">
            {rows.map((r, i) => {
              const when = boardWhen(r.deadlineAt, r.deadlineTimeKnown, now);
              return (
                <li key={r.id} className="board-row grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 px-5 py-3.5 sm:grid-cols-[7.5rem_minmax(0,1fr)]" style={{ animationDelay: `${i * 70}ms` }}>
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
      <figcaption className="mt-3 text-[13px] text-muted">Ekte kunngjøringer, sortert etter frist.</figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Tre punkter – alt som står her, gjør appen i dag
// ---------------------------------------------------------------------------
function Points() {
  const { liveSources } = useUi();
  const points = [
    { title: 'Alt på ett sted', text: `Kunngjøringer fra ${sourcesPhrase(liveSources)} hentes automatisk flere ganger i døgnet.` },
    { title: 'Bare det som passer', text: 'Fortell hva dere leverer og hvor. Hvert anbud får en score fra 0 til 100, med begrunnelse.' },
    { title: 'Aldri for sent', text: 'Påminnelse 7, 3 og 1 dag før fristen for anbudene dere har lagret.' },
  ];
  return (
    <section className="border-t border-line bg-paper">
      <Container>
        <h2 className="sr-only">Hva AnbudRadar gjør</h2>
        <ul className="grid grid-cols-1 md:grid-cols-3">
          {points.map((p, i) => (
            <li
              key={p.title}
              className={cn('py-8 md:px-8 md:py-14', i > 0 && 'border-t border-line md:border-l md:border-t-0', i === 0 && 'md:pl-0', i === points.length - 1 && 'md:pr-0')}
            >
              <Mono className="text-navy-600">0{i + 1}</Mono>
              <h3 className="mt-3 text-[20px] font-[720] leading-tight tracking-[-0.015em] text-navy-950">{p.title}</h3>
              <p className="mt-2 max-w-[22rem] text-[15px] leading-relaxed text-muted">{p.text}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Avslutning
// ---------------------------------------------------------------------------
function Closing({ m }: { m: MarketSnapshot }) {
  const next = m.board[0];
  const from = Math.min(...PAID_PLANS.map((p) => PLANS[p].priceNok ?? Number.POSITIVE_INFINITY));
  return (
    <section className="border-t border-line">
      <Container className="flex flex-col items-start gap-8 py-16 sm:py-24 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <h2 className="text-[34px] font-[760] leading-[1.04] tracking-[-0.03em] text-navy-950 sm:text-[48px]">
            {next ? (
              <>
                Neste frist går ut <span className="hl">{until(next.deadlineAt, m.at)}</span>.
              </>
            ) : (
              'Kom i gang på et par minutter.'
            )}
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-muted">
            Gratis å starte. Betalte planer fra {formatInt(from)} kr/mnd eks. mva., uten binding. <a href="/priser">Se priser</a>
          </p>
        </div>
        <StartButton className="shrink-0" />
      </Container>
    </section>
  );
}

export function HomePage({ market }: { market: MarketSnapshot }) {
  return (
    <PublicLayout>
      <Hero m={market} />
      <Points />
      <Closing m={market} />
    </PublicLayout>
  );
}
