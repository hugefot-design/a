/**
 * Forsiden. Ærlig markedsføring: ingen oppdiktede kunder, omtaler eller tall.
 * - Produktbildet er en tydelig merket illustrasjon med fiktive anbud.
 * - «Rett fra databasen» er en ekte kunngjøring (eksempeldata merkes).
 * - Antall kunngjøringer og kilder vises bare når de er ekte og verifisert.
 */
import type { IconType } from 'react-icons';
import {
  LuArrowRight,
  LuBellRing,
  LuBuilding2,
  LuCalculator,
  LuFileSearch,
  LuRadar,
  LuShieldCheck,
} from 'react-icons/lu';
import { INDUSTRIES } from '@/domain/reference';
import { useUi } from '../context';
import { buttonVariants, cn, SampleBadge } from '../components';
import { PublicLayout } from '../layouts';
import { daysUntil, formatDateTime, formatInt, formatMoney, relativeTime, sourcesPhrase } from '../format';
import { CheckList, Container, CtaBand, FaqList, faqItems, IconChip, INDUSTRY_ICONS, PlanCards, RadarDecor, ScoreRing, SectionHeading } from '../marketing';

export interface Specimen {
  id: string;
  title: string;
  buyerName: string | null;
  deadlineAt: Date | null;
  deadlineTimeKnown: boolean;
  estimatedValue: number | null;
  currency: string | null;
  requirement: string | null;
  isSample: boolean;
}

export interface Coverage {
  openReal: number;
  totalReal: number;
  lastIngested: Date | null;
  sources: { id: string; name: string; enabled: boolean; verifiedLive: boolean; lastSuccessAt: Date | null }[];
}

// Fiktive anbud til produktbildet. Navnene er oppdiktet.
const DEMO_TENDERS = [
  { title: 'Renhold av skoler og barnehager 2027–2030', buyer: 'Fjordvik kommune', value: '4,2 mill. kr', days: 18, source: 'Doffin', score: 92 },
  { title: 'Rammeavtale vinduspuss og fasadevask', buyer: 'Nordvik helseforetak', value: '1,1 mill. kr', days: 9, source: 'Doffin', score: 81 },
  { title: 'Drift og renhold av administrasjonsbygg', buyer: 'Vestlia fylkeskommune', value: '12,5 mill. kr', days: 26, source: 'TED', score: 67 },
];



// ---------------------------------------------------------------------------
// Toppseksjon
// ---------------------------------------------------------------------------
function ProductWindow() {
  return (
    <figure className="relative overflow-hidden rounded-xl bg-white text-ink shadow-[0_40px_90px_-30px_rgba(0,0,0,0.7)] ring-1 ring-white/10">
      <div className="flex items-center gap-3 border-b border-line bg-paper px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-[#f87171]" />
          <span className="size-2.5 rounded-full bg-[#fbbf24]" />
          <span className="size-2.5 rounded-full bg-[#4ade80]" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-muted">Finn anbud · rangert for Fjordvik Renhold AS</span>
        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-muted ring-1 ring-line">Illustrasjon · fiktive data</span>
      </div>
      <ul className="divide-y divide-line" aria-label="Fiktive anbud, rangert etter relevans">
        {DEMO_TENDERS.map((t, i) => (
          <li key={t.title} className={cn('flex items-center gap-3.5 px-4 py-3.5 sm:px-5', i === 0 && 'bg-navy-50/60')}>
            <ScoreRing value={t.score} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-navy-900">{t.title}</p>
              <p className="truncate text-[12px] text-muted">
                {t.buyer} · <span className="num">{t.value}</span>
              </p>
            </div>
            <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
              <span className={cn('num rounded px-1.5 py-0.5 text-[12px] font-semibold', t.days <= 10 ? 'bg-marker text-ink' : 'bg-marker-soft text-ink')}>
                {t.days} dager igjen
              </span>
              <span className="text-[11px] font-semibold text-faint">{t.source}</span>
            </div>
          </li>
        ))}
      </ul>
      <div aria-hidden className="flex items-center justify-between border-t border-line bg-paper px-4 py-2.5 text-[12px] text-faint sm:px-5">
        <span>Sortert etter relevans</span>
        <span className="font-semibold text-navy-700">Lagre søket</span>
      </div>
    </figure>
  );
}

/** Ekte kunngjøring fra databasen (eller en tydelig merket illustrasjon når basen er tom). */
function LiveSpecimen({ s, className }: { s: Specimen | null; className?: string }) {
  if (!s) {
    return (
      <figure className={cn('rounded-xl bg-white p-5 text-ink shadow-[0_30px_70px_-30px_rgba(0,0,0,0.6)] ring-1 ring-black/5', className)}>
        <figcaption className="text-[11px] font-semibold uppercase tracking-wide text-muted">Illustrasjon – ikke en ekte kunngjøring</figcaption>
        <p className="mt-2 font-serif text-[17px] font-semibold leading-snug text-navy-900">Renhold av kommunale bygg</p>
        <p className="mt-3 text-[14px]">
          Krav: <span className="hl hl-draw">godkjent i renholdsregisteret</span>
        </p>
      </figure>
    );
  }
  const days = daysUntil(s.deadlineAt);
  return (
    <figure className={cn('rounded-xl bg-white p-5 text-ink shadow-[0_30px_70px_-30px_rgba(0,0,0,0.6)] ring-1 ring-black/5', className)}>
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ok">
          <span className="live-dot" aria-hidden /> Rett fra databasen nå
        </span>
        {s.isSample ? <SampleBadge /> : null}
      </figcaption>
      <p className="mt-2 line-clamp-2 font-serif text-[17px] font-semibold leading-snug text-navy-900">{s.title}</p>
      {s.buyerName ? <p className="mt-0.5 truncate text-[13px] text-muted">{s.buyerName}</p> : null}
      <dl className="mt-3 space-y-1.5 text-[14px]">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted">Frist</dt>
          <dd>
            <span className="hl hl-draw num">{s.deadlineAt ? formatDateTime(s.deadlineAt, s.deadlineTimeKnown) : 'ikke oppgitt'}</span>
            {days !== null && days > 0 ? <span className="text-muted"> · {days} dager igjen</span> : null}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted">Verdi</dt>
          <dd className="num">{formatMoney(s.estimatedValue, s.currency, false)}</dd>
        </div>
        {s.requirement ? (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted">Nevner krav om</dt>
            <dd>
              <span className="hl hl-draw">{s.requirement}</span>
            </dd>
          </div>
        ) : null}
      </dl>
    </figure>
  );
}

function Hero({ specimen }: { specimen: Specimen | null }) {
  const { user, liveSources, trialDays } = useUi();
  return (
    <section className="relative isolate overflow-hidden bg-navy-950 text-white">
      <div aria-hidden className="hero-grid absolute inset-0 -z-10" />
      <div aria-hidden className="absolute -right-[20%] -top-[30%] -z-10 h-[900px] w-[900px] rounded-full bg-[radial-gradient(closest-side,rgba(51,90,150,0.45),transparent)]" />
      <Container className="grid grid-cols-1 items-center gap-14 pb-20 pt-10 sm:pb-24 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10 lg:pb-28 lg:pt-20">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[13px] font-semibold text-navy-100">
            {liveSources.length ? (
              <>
                <span className="live-dot" aria-hidden /> Henter nye kunngjøringer fra {sourcesPhrase(liveSources)}
              </>
            ) : (
              <>
                <LuRadar className="size-4 text-marker" aria-hidden /> Offentlige anbud for norske bedrifter
              </>
            )}
          </p>
          <h1 className="mt-6 max-w-xl font-serif text-[40px] font-semibold leading-[1.06] tracking-[-0.02em] text-white sm:text-[56px] lg:text-[60px]">
            Finn anbudene som passer – <span className="text-marker">før fristen går ut.</span>
          </h1>
          <p className="mt-6 max-w-lg text-[19px] leading-relaxed text-navy-100">Vi samler offentlige anbud på ett sted og viser dere de som passer best.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={user ? '/app' : '/registrer'} className={buttonVariants({ variant: 'inverse', size: 'lg', className: 'group shadow-[0_10px_30px_-10px_rgba(255,255,255,0.4)]' })}>
              {user ? 'Til appen' : `Prøv gratis i ${trialDays} dager`}
              <LuArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </a>
            <a href="#slik-virker-det" className={buttonVariants({ variant: 'ghost', size: 'lg', className: 'text-white hover:bg-white/10' })}>
              Se hvordan det virker
            </a>
          </div>
          <CheckList
            dark
            inline
            className="mt-8 text-[14px] text-navy-100"
            items={[`${trialDays} dager gratis`, 'Ingen kort', 'Fra 199 kr/mnd eks. mva.']}
          />
        </div>

        <div className="relative mx-auto w-full min-w-0 max-w-[560px] lg:max-w-none">
          <RadarDecor className="left-1/2 top-1/2 -z-10 w-[150%] -translate-x-1/2 -translate-y-1/2 sm:w-[125%]" />
          <ProductWindow />
          {/* Ekte kunngjøring fra databasen – bare på store skjermer, så mobilen ikke får mer å lese. */}
          <LiveSpecimen s={specimen} className="relative z-10 -mt-12 ml-[-6%] hidden w-[74%] lg:block" />
        </div>
      </Container>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Kilder og dekning (bare ekte tall)
// ---------------------------------------------------------------------------
function SourcesStrip({ coverage }: { coverage: Coverage }) {
  const { liveSources } = useUi();
  const sources = [
    { id: 'doffin', name: 'Doffin', sub: 'Norges kunngjøringsdatabase' },
    { id: 'ted', name: 'TED', sub: 'EUs kunngjøringsdatabase' },
  ].filter((s) => liveSources.includes(s.id));
  if (!sources.length && coverage.openReal === 0) return null;
  return (
    <section className="border-b border-line bg-white">
      <Container className={cn('flex flex-col gap-5 py-7 md:flex-row md:items-center', sources.length ? 'md:justify-between' : 'items-center md:justify-center')}>
        {sources.length ? (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Kunngjøringer fra</p>
            {sources.map((s) => (
              <p key={s.id} className="flex items-baseline gap-2">
                <span className="font-serif text-[22px] font-semibold text-navy-900">{s.name}</span>
                <span className="text-[13px] text-muted">{s.sub}</span>
              </p>
            ))}
          </div>
        ) : null}
        {coverage.openReal > 0 ? (
          <p className="flex items-center gap-3 text-[14px] text-muted">
            <span className="num font-serif text-[28px] font-semibold leading-none text-navy-900">{formatInt(coverage.openReal)}</span>
            <span>
              åpne kunngjøringer akkurat nå
              {coverage.lastIngested ? <span className="block text-[12px] text-muted">Sist hentet {relativeTime(coverage.lastIngested)}</span> : null}
            </span>
          </p>
        ) : null}
      </Container>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Slik virker det – tre korte steg
// ---------------------------------------------------------------------------
function HowItWorks() {
  const steps: { icon: IconType; title: string; text: string }[] = [
    { icon: LuBuilding2, title: 'Fortell hva dere gjør', text: 'Bransje, område og størrelse. Tar et par minutter.' },
    { icon: LuRadar, title: 'Få anbudene som passer', text: 'Vi sorterer anbudene etter hvor godt de passer dere.' },
    { icon: LuBellRing, title: 'Svar i tide', text: 'Påminnelse før fristen og hjelp med tilbudet.' },
  ];
  return (
    <section id="slik-virker-det" className="scroll-mt-20 py-20 sm:py-24">
      <Container>
        <SectionHeading center>Slik virker det</SectionHeading>
        <ol className="mt-12 grid gap-5 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="lift flex items-start gap-5 rounded-2xl border border-line bg-white p-5 md:block md:p-7 md:text-center">
              <span className="relative flex size-14 shrink-0 items-center justify-center rounded-2xl bg-navy-900 text-white shadow-[0_10px_24px_-12px_rgba(15,35,64,0.8)] md:mx-auto">
                <s.icon className="size-6" aria-hidden />
                <span className="num absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full bg-marker text-[13px] font-semibold text-ink ring-2 ring-white">
                  {i + 1}
                </span>
              </span>
              <div className="min-w-0">
                <h3 className="text-[19px] font-semibold text-navy-900 md:mt-5 md:text-[20px]">{s.title}</h3>
                <p className="mt-1 text-[16px] leading-relaxed text-muted md:mt-2">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Det dere får – fire fordeler, én kort setning hver
// ---------------------------------------------------------------------------
function Benefits() {
  const { liveSources } = useUi();
  const items: { icon: IconType; title: string; text: string }[] = [
    { icon: LuRadar, title: 'Alt på ett sted', text: `Anbud fra ${sourcesPhrase(liveSources)}, hentet automatisk.` },
    { icon: LuFileSearch, title: 'Forstå kravene raskt', text: 'Kort oppsummering – og hvor i dokumentet det står.' },
    { icon: LuBellRing, title: 'Varsel før fristen', text: 'Påminnelse 7, 3 og 1 dag før det er for sent.' },
    { icon: LuCalculator, title: 'Se om det lønner seg', text: 'Regn på pris og risiko med deres egne tall.' },
  ];
  return (
    <section className="border-y border-line bg-paper py-20 sm:py-24">
      <Container>
        <SectionHeading center>Mindre leting – mer tid til tilbudene</SectionHeading>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it) => (
            <article key={it.title} className="lift flex items-start gap-4 rounded-2xl border border-line bg-white p-5 sm:block sm:p-6">
              <IconChip icon={it.icon} className="size-12 [&_svg]:size-6" />
              <div className="min-w-0">
                <h3 className="text-[19px] font-semibold text-navy-900 sm:mt-4">{it.title}</h3>
                <p className="mt-1 text-[16px] leading-relaxed text-muted sm:mt-1.5">{it.text}</p>
              </div>
            </article>
          ))}
        </div>
        <p className="mx-auto mt-10 flex max-w-2xl items-start gap-3 rounded-2xl bg-white px-5 py-4 text-[16px] text-ink ring-1 ring-line">
          <LuShieldCheck className="mt-0.5 size-6 shrink-0 text-ok" aria-hidden />
          <span>
            <strong className="text-navy-900">Vi finner aldri på noe.</strong> Frister og krav vises slik de står i kunngjøringen, og AI-en viser hvor svaret står.
          </span>
        </p>
        <p className="mt-8 text-center">
          <a href="/funksjoner" className="inline-flex items-center gap-1.5 text-[16px] font-semibold text-navy-800 no-underline hover:underline">
            Se alle funksjoner <LuArrowRight className="size-4" aria-hidden />
          </a>
        </p>
      </Container>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bransjer – bare navn og ikon
// ---------------------------------------------------------------------------
function Industries() {
  return (
    <section className="py-20 sm:py-24">
      <Container>
        <SectionHeading center>For bransjer som selger til det offentlige</SectionHeading>
        <ul className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {INDUSTRIES.map((i) => {
            const Icon = INDUSTRY_ICONS[i.id] ?? LuRadar;
            return (
              <li key={i.id}>
                <a
                  href={`/bransjer#${i.id}`}
                  className="lift flex h-full items-center gap-3 rounded-xl border border-line bg-white px-4 py-3.5 text-[15px] font-semibold text-navy-900 no-underline hover:border-navy-300"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-700">
                    <Icon className="size-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0">{i.name}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Priser (bare pris og knapp) og spørsmål
// ---------------------------------------------------------------------------
function PricingTeaser() {
  const { trialDays } = useUi();
  return (
    <section className="border-t border-line bg-paper py-20 sm:py-24">
      <Container>
        <SectionHeading center lead={`${trialDays} dager gratis. Ingen kort. Ingen binding.`}>
          Enkle priser
        </SectionHeading>
        <div className="mt-12">
          <PlanCards showFeatures={false} />
        </div>
        <p className="mt-8 text-center">
          <a href="/priser" className="inline-flex items-center gap-1.5 text-[16px] font-semibold text-navy-800 no-underline hover:underline">
            Se hva som er med i hver plan <LuArrowRight className="size-4" aria-hidden />
          </a>
        </p>
      </Container>
    </section>
  );
}

function Faq() {
  const { liveSources, trialDays } = useUi();
  return (
    <section className="py-20 sm:py-24">
      <Container className="max-w-3xl">
        <SectionHeading center>Vanlige spørsmål</SectionHeading>
        <div className="mt-10">
          <FaqList items={faqItems({ trialDays, sources: sourcesPhrase(liveSources, true) }).slice(0, 4)} />
        </div>
        <p className="mt-6 text-center text-[15px] text-muted">
          Flere spørsmål? <a href="/kontakt">Kontakt oss</a>.
        </p>
      </Container>
    </section>
  );
}

export function HomePage({ specimen, coverage }: { specimen: Specimen | null; coverage: Coverage }) {
  const { user, trialDays } = useUi();
  return (
    <PublicLayout heroDark>
      <Hero specimen={specimen} />
      <SourcesStrip coverage={coverage} />
      <HowItWorks />
      <Benefits />
      <Industries />
      <PricingTeaser />
      <Faq />
      <CtaBand
        title="Neste frist venter ikke."
        lead="Lag en konto og se hvilke anbud som passer dere i dag."
        primary={user ? { href: '/app', label: 'Til appen' } : { href: '/registrer', label: `Prøv gratis i ${trialDays} dager` }}
        secondary={{ href: '/priser', label: 'Se priser' }}
      />
    </PublicLayout>
  );
}
