/**
 * Forsiden. Ærlig markedsføring: ingen oppdiktede kunder, omtaler eller tall.
 * - Produktbildet er en tydelig merket illustrasjon med fiktive anbud.
 * - «Rett fra databasen» er en ekte kunngjøring (eksempeldata merkes).
 * - Antall kunngjøringer og kilder vises bare når de er ekte og verifisert.
 */
import type { ReactNode } from 'react';
import type { IconType } from 'react-icons';
import {
  LuArrowRight,
  LuBellRing,
  LuBuilding2,
  LuCalculator,
  LuChartColumn,
  LuFileSearch,
  LuHandshake,
  LuListChecks,
  LuRadar,
} from 'react-icons/lu';
import { INDUSTRIES } from '@/domain/reference';
import { useUi } from '../context';
import { Badge, buttonVariants, cn, SampleBadge } from '../components';
import { PublicLayout } from '../layouts';
import { daysUntil, formatDateTime, formatInt, formatMoney, relativeTime, sourcesPhrase } from '../format';
import { CheckList, Container, CtaBand, FaqList, faqItems, INDUSTRY_ICONS, PlanCards, RadarDecor, ScoreRing, SectionHeading } from '../marketing';

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


function ExampleTag({ dark = false }: { dark?: boolean }) {
  return <span className={cn('text-[11px] font-semibold uppercase tracking-wide', dark ? 'text-navy-300' : 'text-muted')}>Eksempel</span>;
}

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
          <p className="mt-6 max-w-lg text-[18px] leading-relaxed text-navy-100">
            AnbudRadar henter kunngjøringer fra {sourcesPhrase(liveSources)}, rangerer dem etter hva dere leverer, og forklarer kravene – med kilde og sidetall.
          </p>
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
          <LiveSpecimen s={specimen} className="relative z-10 mx-3 -mt-8 sm:mx-0 sm:-mt-12 sm:ml-[-6%] sm:w-[74%]" />
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
// Slik virker det
// ---------------------------------------------------------------------------
function HowItWorks() {
  const steps: { icon: IconType; title: string; text: string }[] = [
    { icon: LuBuilding2, title: 'Fortell hva dere leverer', text: 'Bransje, tjenester, område, kontraktsstørrelse og sertifiseringer. Det tar et par minutter.' },
    { icon: LuRadar, title: 'Få anbudene rangert og forklart', text: 'Hvert anbud får en relevansscore med begrunnelse: hva som passer, hva som mangler og hva som kan stoppe dere.' },
    { icon: LuListChecks, title: 'Forbered tilbudet sammen', text: 'Sjekkliste, tekstutkast fra profilen og godkjenning i teamet. Innsendingen gjør dere i oppdragsgivers system.' },
  ];
  return (
    <section id="slik-virker-det" className="scroll-mt-20 py-20 sm:py-28">
      <Container>
        <SectionHeading eyebrow="Slik virker det" lead="Tre steg – så bruker dere tiden på anbudene som faktisk passer.">
          Fra kunngjøring til tilbud uten å lete
        </SectionHeading>
        <ol className="relative mt-12 grid gap-5 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="lift relative rounded-2xl border border-line bg-white p-6">
              <div className="flex items-center gap-3">
                <span className="relative flex size-12 items-center justify-center rounded-xl bg-navy-900 text-white shadow-[0_10px_24px_-12px_rgba(15,35,64,0.8)]">
                  <s.icon className="size-5" aria-hidden />
                  <span className="num absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-marker text-[12px] font-semibold text-ink ring-2 ring-white">
                    {i + 1}
                  </span>
                </span>
              </div>
              <h3 className="mt-5 text-[19px] font-semibold text-navy-900">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Funksjoner (bento)
// ---------------------------------------------------------------------------
function FeatureCard({ icon: Icon, title, text, children, className }: { icon: IconType; title: string; text: string; children: ReactNode; className?: string }) {
  return (
    <article className={cn('lift flex flex-col rounded-2xl border border-line bg-white p-6', className)}>
      <span className="flex size-10 items-center justify-center rounded-xl bg-navy-50 text-navy-700">
        <Icon className="size-5" aria-hidden />
      </span>
      <h3 className="mt-4 text-[18px] font-semibold text-navy-900">{title}</h3>
      <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{text}</p>
      <div className="mt-5 flex-1 rounded-xl border border-line bg-paper p-4 text-[13px]">{children}</div>
    </article>
  );
}

function Features() {
  return (
    <section className="border-y border-line bg-paper py-20 sm:py-28">
      <Container>
        <SectionHeading eyebrow="Funksjoner" lead="Alt fra første treff til ferdig tilbud – og hvert svar viser hvor det kommer fra.">
          Mindre leting. Bedre beslutninger.
        </SectionHeading>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={LuRadar}
            className="lg:col-span-2"
            title="Rangert etter hva dere leverer"
            text="Hvert anbud får en relevansscore fra 0 til 100 med begrunnelse. Scoren viser samsvar med profilen – ikke sjansen for å vinne."
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <ScoreRing value={88} size={52} />
                <p className="font-semibold text-navy-900">Renhold av skoler og barnehager</p>
              </div>
              <ExampleTag />
            </div>
            <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
              <li className="flex gap-2">
                <span className="font-semibold text-ok">✓</span> Tjenesten passer: renhold
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-ok">✓</span> Innenfor området dere dekker
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-ok">✓</span> Verdi innenfor ønsket størrelse
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-urgent">!</span>
                <span>
                  Krever <span className="hl">ISO 14001</span> – ikke i profilen
                </span>
              </li>
            </ul>
          </FeatureCard>

          <FeatureCard icon={LuFileSearch} title="Krav med kilde og sidetall" text="AI leser kunngjøringen og dokumentene dere laster opp. Vi sjekker at sitatene faktisk står der.">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[14px] text-ink">Leverandøren må dokumentere et kvalitetssystem.</p>
              <ExampleTag />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="outline">Konkurransegrunnlag, s. 4</Badge>
              <Badge tone="ok">Sitat funnet i kilden</Badge>
            </div>
          </FeatureCard>

          <FeatureCard icon={LuBellRing} title="Varsler før det er for sent" text="Nye treff, endringer, avlysninger og påminnelser 7, 3 og 1 dag før fristen.">
            <ul className="space-y-2">
              <li className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-line">
                <span className="truncate">Frist om 3 dager: Vinduspuss</span>
                <span className="num shrink-0 rounded bg-marker px-1.5 text-[11px] font-semibold">3 d</span>
              </li>
              <li className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-line">
                <span className="truncate">Endret: fristen er forlenget</span>
                <span className="shrink-0 text-[11px] text-faint">Doffin</span>
              </li>
            </ul>
          </FeatureCard>

          <FeatureCard
            icon={LuCalculator}
            className="lg:col-span-2"
            title="Lønner det seg å by?"
            text="Legg inn timekost og marginer én gang. Se selvkost, minstepris og vilkårene som kan koste dere penger – med side og sitat."
          >
            <div className="mb-1 flex justify-end">
              <ExampleTag />
            </div>
            <dl className="divide-y divide-line">
              {[
                ['Selvkost', '660 000 kr', 'Beregnet'],
                ['Minstepris (margin 8 %, risikopåslag 5 %)', '753 261 kr', 'Beregnet'],
                ['Oppdragsgivers estimerte verdi', '1 000 000 kr', 'Dokument'],
                ['Dagbot, tak 10 %', 'maks 100 000 kr', 'Dokument, s. 3'],
              ].map(([label, value, basis]) => (
                <div key={label} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <dt className="text-muted">{label}</dt>
                  <dd className="flex items-center gap-2">
                    <span className="num font-semibold text-navy-900">{value}</span>
                    <Badge tone={basis === 'Beregnet' ? 'marker' : 'info'}>{basis}</Badge>
                  </dd>
                </div>
              ))}
            </dl>
          </FeatureCard>

          <FeatureCard icon={LuChartColumn} title="Konkurrenter og tildelinger" text="Se hvem som vinner kontraktene i bransjen, basert på publiserte tildelinger.">
            <div className="mb-2 flex justify-end">
              <ExampleTag />
            </div>
            <ul className="space-y-2">
              {[
                ['Leverandør A', 12],
                ['Leverandør B', 8],
                ['Leverandør C', 5],
              ].map(([name, n]) => (
                <li key={name as string} className="grid grid-cols-[88px_minmax(0,1fr)_24px] items-center gap-2">
                  <span className="truncate">{name}</span>
                  <span className="h-2 rounded-full bg-navy-600" style={{ width: `${((n as number) / 12) * 100}%` }} aria-hidden />
                  <span className="num text-right font-semibold text-navy-900">{n}</span>
                </li>
              ))}
            </ul>
          </FeatureCard>

          <FeatureCard icon={LuListChecks} title="Tilbudsarbeid i team" text="Sjekkliste fra kravene, tekstutkast fra profilen og godkjenning før noe sendes.">
            <div className="mb-1 flex justify-end">
              <ExampleTag />
            </div>
            <ul className="space-y-1.5">
              {[
                ['Skatteattest', true],
                ['HMS-egenerklæring', true],
                ['Referanser (2 av 3)', false],
              ].map(([label, done]) => (
                <li key={label as string} className="flex items-center gap-2">
                  <span className={cn('flex size-4 items-center justify-center rounded border text-[10px]', done ? 'border-ok bg-ok text-white' : 'border-line-strong bg-white')} aria-hidden>
                    {done ? '✓' : ''}
                  </span>
                  <span className={done ? 'text-muted line-through' : 'text-ink'}>{label}</span>
                </li>
              ))}
            </ul>
          </FeatureCard>

          <FeatureCard icon={LuHandshake} title="Anbudspartnere" text="Finn bedrifter som dekker det dere mangler – og bli funnet selv. Alltid med samtykke.">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-lg bg-white px-2.5 py-1.5 font-semibold text-navy-900 ring-1 ring-line">Dere</span>
              <span className="h-px flex-1 border-t-2 border-dashed border-line-strong" aria-hidden />
              <span className="rounded-lg bg-white px-2.5 py-1.5 font-semibold text-navy-900 ring-1 ring-line">Partner med ISO 14001</span>
            </div>
            <p className="mt-2 text-[12px] text-muted">Kontaktinfo deles først når mottakeren godtar.</p>
          </FeatureCard>
        </div>
        <p className="mt-8 text-center">
          <a href="/funksjoner" className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-navy-800 no-underline hover:underline">
            Se alle funksjoner <LuArrowRight className="size-4" aria-hidden />
          </a>
        </p>
      </Container>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Prinsipper
// ---------------------------------------------------------------------------
function Principles() {
  const items: { title: string; text: string }[] = [
    { title: 'Fakta fra kilden står for seg', text: 'Frist, verdi og krav vises slik de står i kunngjøringen – med lenke til originalen hos Doffin eller TED.' },
    { title: 'AI viser hvor svaret står', text: 'Hver påstand har dokument og sidetall, og vi sjekker at sitatet finnes. Det som ikke kan kontrolleres, merkes.' },
    { title: 'Ingen gjetning', text: 'Mangler en opplysning, står den som mangel. Relevansscoren viser samsvar – aldri sjansen for å vinne.' },
  ];
  return (
    <section className="py-20 sm:py-28">
      <Container className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
        <SectionHeading eyebrow="Fakta først. AI etterpå." lead="Når det gjelder kontrakter verdt millioner, må dere kunne stole på det dere leser.">
          Ærlig om hva vi vet – og hva vi ikke vet
        </SectionHeading>
        <ol className="space-y-4">
          {items.map((it, i) => (
            <li key={it.title} className="flex gap-4 rounded-2xl border border-line bg-white p-5">
              <span className="num flex size-9 shrink-0 items-center justify-center rounded-full bg-navy-900 font-serif text-[15px] font-semibold text-white">{i + 1}</span>
              <div>
                <h3 className="text-[17px] font-semibold text-navy-900">{it.title}</h3>
                <p className="mt-1 text-[15px] leading-relaxed text-muted">{it.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bransjer
// ---------------------------------------------------------------------------
function Industries() {
  return (
    <section className="border-t border-line bg-paper py-20 sm:py-28">
      <Container>
        <SectionHeading eyebrow="Bransjer" lead="Rangeringen bygger på CPV-kodene oppdragsgiverne selv bruker – fra vakthold og renhold til IT, bygg og helse.">
          Laget for bransjer som lever av offentlige kontrakter
        </SectionHeading>
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
// Priser (kort) og spørsmål
// ---------------------------------------------------------------------------
function PricingTeaser() {
  const { trialDays } = useUi();
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <SectionHeading center eyebrow="Priser" lead={`Per organisasjon per måned, eks. mva. ${trialDays} dager gratis med alt i Profesjonell – uten kort.`}>
          Enkle priser. Ingen binding.
        </SectionHeading>
        <div className="mt-12">
          <PlanCards maxFeatures={4} />
        </div>
        <p className="mt-8 text-center">
          <a href="/priser" className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-navy-800 no-underline hover:underline">
            Sammenlign alle planer <LuArrowRight className="size-4" aria-hidden />
          </a>
        </p>
      </Container>
    </section>
  );
}

function Faq() {
  const { liveSources, trialDays } = useUi();
  return (
    <section className="border-t border-line bg-paper py-20 sm:py-28">
      <Container className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <SectionHeading eyebrow="Spørsmål" lead={<>Finner du ikke svaret? <a href="/kontakt">Kontakt oss</a>.</>}>
          Vanlige spørsmål
        </SectionHeading>
        <FaqList items={faqItems({ trialDays, sources: sourcesPhrase(liveSources, true) })} />
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
      <Features />
      <Principles />
      <Industries />
      <PricingTeaser />
      <Faq />
      <CtaBand
        title="Neste frist venter ikke."
        lead="Opprett konto, fyll ut profilen og se hvilke anbud som passer dere i dag."
        primary={user ? { href: '/app', label: 'Til appen' } : { href: '/registrer', label: `Prøv gratis i ${trialDays} dager` }}
        secondary={{ href: '/priser', label: 'Se priser' }}
      />
    </PublicLayout>
  );
}
