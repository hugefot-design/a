/**
 * En ekte, åpen kunngjøring markert slik AnbudRadar leser den (vises på /funksjoner).
 * Markeringen er ordrett fra teksten, og lenken går til originalen – ingenting er oppdiktet.
 */
import { LuArrowUpRight } from 'react-icons/lu';
import type { NoticeSpecimen } from '@/domain/tenders/market';
import { fill, longDate, money } from '@/i18n/format';
import { useUi } from '../context';
import { H2, Kicker, Wrap } from '../site';
import { boardWhen, Mono } from './home';

function Ref({ n }: { n: number }) {
  return (
    <span className="ml-1 inline-flex size-5 -translate-y-px items-center justify-center rounded-full bg-navy-950 align-middle font-mono text-[11px] font-medium text-white" aria-hidden>
      {n}
    </span>
  );
}

export function NoticeExample({ s }: { s: NoticeSpecimen }) {
  const { m, locale } = useUi();
  const t = m.notice;
  const when = boardWhen(s.deadlineAt, s.deadlineTimeKnown, new Date(), locale);
  const deadlineText = when.time ? fill(t.deadlineAt, { date: longDate(locale, s.deadlineAt), time: when.time }) : longDate(locale, s.deadlineAt);
  const valueText = money(locale, s.estimatedValue, s.currency);
  const sourceName = s.source === 'doffin' ? 'Doffin' : s.source === 'ted' ? 'TED' : s.source;
  const notes: { n: number; key: 'deadline' | 'requirement' | 'value' | 'source'; value: string }[] = [
    { n: 1, key: 'deadline', value: deadlineText },
    ...(s.excerpt.mark && s.requirement ? [{ n: 2, key: 'requirement' as const, value: s.requirement }] : []),
    { n: s.excerpt.mark ? 3 : 2, key: 'value', value: valueText },
    { n: s.excerpt.mark ? 4 : 3, key: 'source', value: `${sourceName} ${s.noticeId}` },
  ];
  const ref = (key: string) => notes.find((x) => x.key === key)!.n;
  return (
    <section id="slik-leser-vi" className="scroll-mt-20 bg-cream py-24 sm:py-28">
      <Wrap>
        <div className="reveal max-w-2xl">
          <Kicker>{t.eyebrow}</Kicker>
          <H2 className="mt-4">{t.title}</H2>
          <p className="mt-5 text-[18px] leading-relaxed text-muted">{t.lead}</p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-12">
          <article className="reveal min-w-0 rounded-3xl border border-line bg-white p-6 shadow-[0_40px_90px_-50px_rgba(6,14,27,0.55)] sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
              <Mono className="text-muted">{t.kind}</Mono>
              <Mono className="text-muted">
                <span className="hl-soft">
                  {sourceName} {s.noticeId}
                </span>
                <Ref n={ref('source')} />
              </Mono>
            </div>
            <h3 className="mt-5 text-[21px] font-[720] leading-snug tracking-[-0.015em] text-navy-950 sm:text-[24px]">{s.title}</h3>
            <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-3 text-[14px] sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{t.buyer}</dt>
                <dd className="mt-0.5 font-semibold text-ink">{s.buyerName ?? t.notGiven}</dd>
              </div>
              <div className="min-w-0">
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{t.place}</dt>
                <dd className="mt-0.5 font-semibold text-ink">{s.place ?? t.notGiven}</dd>
              </div>
              <div className="min-w-0">
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{t.deadline}</dt>
                <dd className="mt-0.5 font-semibold text-ink">
                  <span className="hl">{deadlineText}</span>
                  <Ref n={ref('deadline')} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{t.value}</dt>
                <dd className="mt-0.5 font-semibold text-ink">
                  <span className="hl">{valueText}</span>
                  <Ref n={ref('value')} />
                </dd>
              </div>
            </dl>
            <p className="mt-6 border-t border-line pt-5 text-[15px] leading-relaxed text-ink">
              {s.excerpt.before}
              {s.excerpt.mark ? (
                <>
                  <mark className="hl">{s.excerpt.mark}</mark>
                  <Ref n={ref('requirement')} />
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
                    {t.labels[x.key]}: <span className="font-normal">{x.value}</span>
                  </p>
                  <p className="mt-0.5 text-[14px] leading-relaxed text-muted">{t.notes[x.key]}</p>
                </div>
              </li>
            ))}
            {s.sourceUrl ? (
              <li className="pl-[2.5rem]">
                <a href={s.sourceUrl} rel="noopener" className="inline-flex items-center gap-1 text-[14px] font-semibold">
                  {fill(t.open, { source: sourceName })} <LuArrowUpRight className="size-4" aria-hidden />
                </a>
              </li>
            ) : null}
          </ol>
        </div>
      </Wrap>
    </section>
  );
}
