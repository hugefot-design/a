/**
 * Offentlig eksempel (/eksempel, bare norsk): en ekte, åpen kunngjøring vurdert med de samme reglene som i appen.
 * Bedriften er et eksempel og står beskrevet øverst, så ingen tror det er en ekte kunde eller et ekte resultat.
 * Lenker inn i appen går til registrering med lenken som neste side (innloggede går rett dit).
 */
import { LuArrowRight, LuBuilding2, LuCircleCheck, LuExternalLink, LuFileDown, LuInfo } from 'react-icons/lu';
import type { DemoReport } from '@/domain/intelligence/demo';
import { useUi } from '../context';
import { formatDateTime } from '../format';
import { PublicLayout } from '../layouts';
import { NightHero, SignalCta, Wrap } from '../site';
import { AppHrefProvider, IntelligenceBody } from './app/intelligence';

/** Lenke inn i appen fra eksempelet: innloggede går rett dit, andre via registrering (planer → prissiden). */
export function demoAppHref(loggedIn: boolean) {
  return (href: string): string => {
    if (loggedIn) return href;
    if (href === '/app/abonnement') return '/priser';
    return `/registrer?neste=${encodeURIComponent(href)}`;
  };
}

const SOURCE_NAME: Record<string, string> = { doffin: 'Doffin', ted: 'TED' };

export function DemoPage({ demo }: { demo: DemoReport | null }) {
  const { user } = useUi();
  const app = demoAppHref(Boolean(user));
  if (!demo) {
    return (
      <PublicLayout>
        <NightHero eyebrow="Eksempel" title="Eksempelet er ikke klart akkurat nå." lead="Vi viser bare eksempler laget av ekte, åpne kunngjøringer. Akkurat nå finnes det ingen som passer. Prøv igjen senere – eller se anbudene som passer dere." />
        <SignalCta
          title="Se anbudene som passer dere."
          lead="Fyll ut bedriftsprofilen på ett minutt, og få anbudene rangert med begrunnelse."
          primary={user ? { href: '/app', label: 'Til appen' } : { href: '/registrer', label: 'Start gratis' }}
        />
      </PublicLayout>
    );
  }
  const r = demo.report;
  const t = r.tender;
  const mine = app(`/app/anbud/${t.id}/intelligence`);
  const sources = t.sources.filter((s) => s.source === 'doffin' || s.source === 'ted');
  return (
    <PublicLayout>
      <NightHero
        eyebrow="Eksempel på en vurdering"
        title="Et ekte anbud, vurdert før dere bruker tid på det."
        lead="Under er en åpen kunngjøring, vurdert med de samme reglene som i appen: passer det, hva kan gi avvisning, hva kan koste penger, og hva lignende kontrakter faktisk ble tildelt for. Ingen AI er brukt, og ingenting er fylt inn."
      >
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a href={mine} className="btn-signal">
            Vurder anbudet for deres bedrift <LuArrowRight className="size-4" aria-hidden />
          </a>
          <a href="/eksempel/rapport.pdf" className="btn-ghost-light">
            <LuFileDown className="size-4" aria-hidden /> Last ned som PDF
          </a>
        </div>
      </NightHero>

      <section className="bg-cream py-12 sm:py-16">
        <Wrap>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <article className="rounded-3xl border border-line bg-surface p-6 sm:p-7">
              <p className="text-[12.5px] font-semibold uppercase tracking-[0.12em] text-navy-700">Anbudet – ekte og åpent</p>
              <h2 className="mt-2 text-[22px] font-[740] leading-snug tracking-[-0.015em] text-strong sm:text-[26px]">{t.title}</h2>
              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-[14.5px] sm:grid-cols-2">
                <div>
                  <dt className="text-muted">Oppdragsgiver</dt>
                  <dd className="font-semibold text-strong">{t.buyerName ?? 'Ikke oppgitt'}</dd>
                </div>
                <div>
                  <dt className="text-muted">{t.deadlineKind === 'participation' ? 'Frist for å be om å delta' : 'Tilbudsfrist'}</dt>
                  <dd className="num font-semibold text-strong">{t.deadlineAt ? formatDateTime(t.deadlineAt, t.deadlineTimeKnown) : 'Ikke oppgitt'}</dd>
                </div>
              </dl>
              {sources.length ? (
                <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
                  {sources.map((s) =>
                    s.url ? (
                      <a key={`${s.source}-${s.noticeId}`} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold">
                        Kunngjøringen hos {SOURCE_NAME[s.source] ?? s.source} <LuExternalLink className="size-3.5" aria-hidden />
                      </a>
                    ) : (
                      <span key={`${s.source}-${s.noticeId}`} className="text-muted">
                        {SOURCE_NAME[s.source] ?? s.source} {s.noticeId}
                      </span>
                    ),
                  )}
                </p>
              ) : null}
            </article>
            <aside className="rounded-3xl border border-dashed border-line-strong bg-surface p-6 sm:p-7" aria-labelledby="eksempelbedrift">
              <p id="eksempelbedrift" className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-[0.12em] text-navy-700">
                <LuBuilding2 className="size-4" aria-hidden /> Eksempelbedriften – ikke en ekte kunde
              </p>
              <ul className="mt-3 space-y-1.5 text-[14.5px] text-ink">
                <li>
                  Leverer: <strong>{demo.company.industry}</strong>
                </li>
                <li>
                  Område: <strong>{demo.company.region ?? 'Hele landet'}</strong>
                </li>
                <li>Godkjenninger og sertifiseringer: ingen registrert</li>
                <li>Omsetning, bemanning og kostnader: ikke lagt inn</li>
                <li>Plan: {demo.plan} (det samme som prøveperioden gir)</li>
              </ul>
              <p className="mt-4 flex gap-2 text-[13.5px] leading-relaxed text-muted">
                <LuInfo className="mt-0.5 size-4 shrink-0" aria-hidden />
                Med deres egen profil blir vurderingen deres: hvilke krav dere oppfyller, og lønnsomhet regnet med deres kostnader.
              </p>
            </aside>
          </div>
        </Wrap>
      </section>

      <section className="bg-cream pb-16 sm:pb-20">
        <Wrap>
          <AppHrefProvider value={app}>
            <IntelligenceBody report={r} />
          </AppHrefProvider>
          <div className="mt-8 flex flex-col items-start gap-4 rounded-3xl bg-night p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <p className="flex max-w-2xl gap-2.5 text-[16px] leading-relaxed text-white/80">
              <LuCircleCheck className="mt-1 size-5 shrink-0 text-signal" aria-hidden />
              Slik ser alle anbud ut i AnbudRadar – vurdert mot deres egen profil, med kilde på hvert punkt.
            </p>
            <a href={mine} className="btn-signal shrink-0">
              Vurder anbudet for deres bedrift <LuArrowRight className="size-4" aria-hidden />
            </a>
          </div>
        </Wrap>
      </section>

      <SignalCta
        title="Se anbudene som passer dere."
        lead="Fyll ut bedriftsprofilen på ett minutt. Ingen kort, og ingenting trekkes automatisk."
        primary={user ? { href: '/app', label: 'Til appen' } : { href: '/registrer', label: 'Start gratis' }}
        secondary={{ href: '/priser', label: 'Se priser' }}
      />
    </PublicLayout>
  );
}
