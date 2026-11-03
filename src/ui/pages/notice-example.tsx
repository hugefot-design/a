/**
 * En ekte, åpen kunngjøring markert slik AnbudRadar leser den (vises på /funksjoner).
 * Markeringen er ordrett fra teksten, og lenken går til originalen – ingenting er oppdiktet.
 */
import { LuArrowUpRight } from 'react-icons/lu';
import type { NoticeSpecimen } from '@/domain/tenders/market';
import { formatDate, formatMoney } from '../format';
import { Container } from '../marketing';
import { boardWhen, Mono } from './home';

function Ref({ n }: { n: number }) {
  return (
    <span className="ml-1 inline-flex size-5 -translate-y-px items-center justify-center rounded-full bg-navy-950 align-middle font-mono text-[11px] font-medium text-white" aria-hidden>
      {n}
    </span>
  );
}

export function NoticeExample({ s }: { s: NoticeSpecimen }) {
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
          <h2 className="mt-3 text-[30px] font-[760] leading-[1.06] tracking-[-0.028em] sm:text-[40px]">Det viktigste står ofte gjemt i teksten.</h2>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">
            Under er en ekte, åpen kunngjøring. Det AnbudRadar trekker ut, er markert – med henvisning til hvor det står.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-12">
          <article className="min-w-0 rounded-lg border border-line-strong bg-white p-6 shadow-[0_1px_0_rgba(15,35,64,0.04),0_18px_40px_-28px_rgba(15,35,64,0.35)] sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
              <Mono className="text-muted">Kunngjøring av konkurranse</Mono>
              <Mono className="text-muted">
                <span className="hl-soft">
                  {sourceName} {s.noticeId}
                </span>
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
