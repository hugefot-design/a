import type { ReactNode } from 'react';
import { INDUSTRIES, CPV_DIVISIONS } from '@/domain/reference';
import { PAID_PLANS, PLANS } from '@/domain/billing/plans';
import { useUi } from '../context';
import { Alert, Badge, Button, buttonVariants, cn, Field, Input, PostForm, SampleBadge, Textarea } from '../components';
import { PublicLayout } from '../layouts';
import { daysUntil, formatDate, formatDateTime, formatInt, formatMoney, relativeTime, sourcesPhrase } from '../format';

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

function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto max-w-6xl px-4 sm:px-6', className)}>{children}</div>;
}

function SectionTitle({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      <h2 className="font-serif text-[28px] font-semibold leading-tight text-navy-900 sm:text-[34px]">{children}</h2>
      {lead ? <p className="mt-3 text-[17px] leading-relaxed text-muted">{lead}</p> : null}
    </div>
  );
}

/** Utsnitt av en ekte kunngjøring fra databasen, med markeringer på det som avgjør. */
function NoticeSpecimen({ s }: { s: Specimen | null }) {
  if (!s) {
    return (
      <figure className="rounded-lg bg-white p-6 text-ink shadow-[0_20px_60px_-20px_rgba(0,0,0,0.5)]">
        <p className="text-[12px] font-semibold text-muted">Illustrasjon – ikke en ekte kunngjøring</p>
        <p className="mt-3 font-serif text-[20px] font-semibold leading-snug text-navy-900">Renhold av kommunale bygg</p>
        <p className="mt-4 text-[15px]">
          Tilbudsfrist: <span className="hl hl-draw">om 21 dager</span>
        </p>
        <p className="mt-2 text-[15px]">
          Krav: <span className="hl hl-draw">godkjent i renholdsregisteret</span>
        </p>
      </figure>
    );
  }
  const days = daysUntil(s.deadlineAt);
  return (
    <figure className="rounded-lg bg-white p-6 text-ink shadow-[0_20px_60px_-20px_rgba(0,0,0,0.5)] sm:p-7">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
        <span>Utsnitt fra en kunngjøring i AnbudRadar nå</span>
        {s.isSample ? <SampleBadge /> : null}
      </figcaption>
      <p className="mt-3 font-serif text-[20px] font-semibold leading-snug text-navy-900">{s.title}</p>
      {s.buyerName ? <p className="mt-1 text-[14px] text-muted">{s.buyerName}</p> : null}
      <dl className="mt-5 space-y-2.5 text-[15px]">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted">Tilbudsfrist</dt>
          <dd>
            <span className="hl hl-draw num">{s.deadlineAt ? formatDateTime(s.deadlineAt, s.deadlineTimeKnown) : 'ikke oppgitt'}</span>
            {days !== null && days > 0 ? <span className="text-muted"> ({days} dager igjen)</span> : null}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted">Estimert verdi</dt>
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
      <p className="mt-5 border-t border-line pt-3 text-[12px] text-muted">Markert av AnbudRadar: fakta som avgjør om dere bør gi tilbud.</p>
    </figure>
  );
}

export function HomePage({ specimen, coverage }: { specimen: Specimen | null; coverage: Coverage }) {
  const { user, liveSources } = useUi();
  return (
    <PublicLayout heroDark>
      <section className="relative overflow-hidden bg-navy-900 pb-20 pt-10 text-white sm:pb-28 sm:pt-16">
        <svg aria-hidden className="pointer-events-none absolute -right-40 -top-40 hidden h-[640px] w-[640px] opacity-[0.07] lg:block" viewBox="0 0 100 100">
          {[48, 38, 28, 18, 8].map((r) => (
            <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#fff" strokeWidth="0.3" />
          ))}
        </svg>
        <Container className="relative grid items-center gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div>
            <h1 className="max-w-xl font-serif text-[38px] font-semibold leading-[1.08] tracking-[-0.015em] text-white sm:text-[54px]">
              Finn offentlige anbud som passer bedriften – før fristen går ut.
            </h1>
            <p className="mt-6 max-w-lg text-[18px] leading-relaxed text-navy-100">
              AnbudRadar henter kunngjøringer fra {sourcesPhrase(liveSources)}, rangerer dem etter hva dere leverer, og forklarer kravene med kildehenvisning.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={user ? '/app' : '/registrer'} className={buttonVariants({ variant: 'inverse', size: 'lg' })}>
                {user ? 'Til appen' : 'Prøv gratis i 14 dager'}
              </a>
              <a href="/funksjoner" className={buttonVariants({ variant: 'ghost', size: 'lg', className: 'text-white hover:bg-white/10' })}>
                Se hvordan det virker
              </a>
            </div>
            <p className="mt-5 text-[14px] text-navy-200">Ingen kort kreves for prøveperioden. Fra 199 kr per måned etterpå.</p>
          </div>
          <NoticeSpecimen s={specimen} />
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <SectionTitle lead="Tre steg, og dere bruker tiden på anbudene som faktisk passer.">Slik fungerer det</SectionTitle>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {[
              ['Fortell hva dere leverer', 'Bransje, tjenester, område, kontraktsstørrelse og sertifiseringer. Det tar et par minutter.'],
              ['Få anbud rangert og forklart', 'Hvert anbud får en relevansscore med begrunnelse: hva som passer, hva som mangler og hva som kan stoppe dere.'],
              ['Forbered tilbudet sammen', 'Sjekkliste, tekstutkast fra profilen og godkjenning i teamet. Innsendingen gjør dere i oppdragsgivers system.'],
            ].map(([title, text], i) => (
              <li key={title} className="border-t-2 border-navy-900 pt-5">
                <p className="num font-serif text-[15px] font-semibold text-muted">Steg {i + 1}</p>
                <h3 className="mt-2 text-[19px] font-semibold text-navy-900">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="border-y border-line bg-paper py-20">
        <Container className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
          <SectionTitle lead="Frister, beløp og krav vises slik de står i kunngjøringen. AI-tolkningen står for seg selv, med kilde og sidetall – og vi sjekker at sitatene faktisk står i dokumentet.">
            Fakta først. AI etterpå.
          </SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-white p-5">
              <p className="text-[13px] font-semibold text-navy-900">Fra kunngjøringen</p>
              <p className="mt-0.5 text-[12px] text-muted">Hentet direkte fra kilden. Ingen AI.</p>
              <dl className="mt-4 space-y-2 text-[14px]">
                <div>
                  <dt className="text-muted">Tilbudsfrist</dt>
                  <dd className="num font-semibold">
                    <span className="hl">Dato og klokkeslett fra kilden</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Estimert verdi</dt>
                  <dd>Slik oppdragsgiver har oppgitt den</dd>
                </div>
                <div>
                  <dt className="text-muted">Kilde</dt>
                  <dd>Lenke til Doffin eller TED</dd>
                </div>
              </dl>
            </div>
            <div className="rounded-lg border border-ai/30 bg-ai-soft p-5">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-navy-900">
                AI-tolkning <Badge tone="ai">Ikke verifisert</Badge>
              </p>
              <p className="mt-0.5 text-[12px] text-muted">Hver påstand har kilde og sidetall.</p>
              <div className="mt-4 rounded-md border border-line bg-white p-3 text-[14px]">
                <p>Leverandøren må dokumentere et kvalitetssystem.</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone="outline">Konkurransegrunnlag, s. 4</Badge>
                  <Badge tone="ok">Sitat funnet i kilden</Badge>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {coverage.openReal > 0 ? (
        <section className="py-16">
          <Container className="flex flex-wrap items-end justify-between gap-8">
            <div>
              <p className="num font-serif text-[48px] font-semibold leading-none text-navy-900">{formatInt(coverage.openReal)}</p>
              <p className="mt-2 text-[15px] text-muted">åpne kunngjøringer i databasen akkurat nå</p>
            </div>
            <div className="text-[14px] text-muted">
              <p>Sist hentet {coverage.lastIngested ? relativeTime(coverage.lastIngested) : '–'}.</p>
              <p>
                Kilder:{' '}
                {coverage.sources
                  .filter((s) => (s.id === 'ted' || s.id === 'doffin') && s.lastSuccessAt)
                  .map((s) => s.name)
                  .join(' og ') || 'under oppstart'}
                .
              </p>
            </div>
          </Container>
        </section>
      ) : null}

      <section className={cn('py-20', coverage.openReal > 0 && 'border-t border-line')}>
        <Container>
          <SectionTitle lead="Fra vakthold og renhold til IT, bygg og helse. Rangeringen bygger på CPV-kodene oppdragsgiverne selv bruker.">
            Laget for bransjer som lever av offentlige kontrakter
          </SectionTitle>
          <ul className="mt-10 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {INDUSTRIES.map((i) => (
              <li key={i.id} className="border-b border-line pb-3">
                <a href={`/bransjer#${i.id}`} className="text-[16px] font-semibold text-navy-900 no-underline hover:underline">
                  {i.name}
                </a>
                <p className="mt-0.5 text-[14px] text-muted">{i.description}</p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section className="bg-navy-900 py-20 text-white">
        <Container className="flex flex-wrap items-center justify-between gap-8">
          <div className="max-w-xl">
            <h2 className="font-serif text-[30px] font-semibold leading-tight text-white">Neste frist venter ikke.</h2>
            <p className="mt-3 text-[17px] text-navy-100">Opprett konto, fyll ut profilen og se hvilke anbud som passer dere i dag.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href="/registrer" className={buttonVariants({ variant: 'inverse', size: 'lg' })}>
              Prøv gratis
            </a>
            <a href="/priser" className={buttonVariants({ variant: 'ghost', size: 'lg', className: 'text-white hover:bg-white/10' })}>
              Se priser
            </a>
          </div>
        </Container>
      </section>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------------------
const FEATURES: { title: string; text: string; points: string[] }[] = [
  {
    title: 'Finn anbud',
    text: 'Søk i offentlige kunngjøringer med filtre for bransje, fylke, kommune, verdi, frist, oppdragsgiver, status og CPV-kode.',
    points: [
      'Skriv som du snakker: «renhold i Trøndelag over 1 million med frist om minst 3 uker»',
      'Se alltid hvordan søket ble tolket – ingenting skjer skjult',
      'Lagre søk og få e-post når nye anbud passer',
      'Ekskluder ord, bransjer og CPV-koder dere ikke vil se',
    ],
  },
  {
    title: 'Forstå anbudet',
    text: 'AI leser kunngjøringen og konkurransegrunnlaget dere laster opp, og lager en strukturert oversikt med kildehenvisning for hver opplysning.',
    points: [
      'Sammendrag på enkel norsk og hva som skal kjøpes',
      'Krav, kvalifikasjoner, sertifiseringer og økonomiske krav',
      'Tildelingskriterier, varighet, risikoer og spørsmål å avklare',
      'Sitater kontrolleres mot dokumentet; det som mangler, står som mangel',
    ],
  },
  {
    title: 'Rangering mot profilen',
    text: 'Hvert anbud får en relevansscore fra 0 til 100 basert på bedriftsprofilen. Scoren viser samsvar – ikke sjansen for å vinne.',
    points: ['Begrunnelse for scoren', 'Mangler og avvik, f.eks. sertifiseringer dere ikke har registrert', 'Krav som kan stoppe dere', 'Anbefalte neste steg'],
  },
  {
    title: 'Varsler',
    text: 'Få beskjed om det som betyr noe, så ofte dere vil.',
    points: ['Nye treff og nye anbud i lagrede søk', 'Påminnelser 7, 3 og 1 dag før fristen', 'Endringer og avlysninger i anbud dere følger', 'Ukesoversikt på mandager'],
  },
  {
    title: 'Konkurrenter og tildelinger',
    text: 'Se hvem som vinner kontraktene i bransjene deres, og hvem som kjøper mest – basert på publiserte tildelinger.',
    points: ['Leverandører med flest tildelinger', 'Oppdragsgivere og hva de kjøper', 'Følg konkurrenter og få varsel når de vinner', 'Dekningen vises alltid; vi anslår aldri priser'],
  },
  {
    title: 'Tilbudsarbeid',
    text: 'Et felles arbeidsområde for tilbudet, med godkjenning før noe sendes.',
    points: [
      'Sjekkliste fra standardpunkter og kravene i dokumentene',
      'Tekstutkast fra bedriftsprofilen – AI finner aldri på erfaring eller tall',
      'Sammenligning av utkastet mot kravene',
      'Eksport til Word og godkjenning i teamet',
    ],
  },
];

export function FeaturesPage() {
  return (
    <PublicLayout>
      <Container className="py-16">
        <SectionTitle lead="Alt dere trenger fra kunngjøring til ferdig tilbud. Hver funksjon er laget for å spare tid uten å gjette på noe.">Funksjoner</SectionTitle>
        <div className="mt-12 grid gap-x-12 gap-y-14 md:grid-cols-2">
          {FEATURES.map((f) => (
            <section key={f.title}>
              <h2 className="text-[21px] font-semibold text-navy-900">{f.title}</h2>
              <p className="mt-2 text-[16px] leading-relaxed text-muted">{f.text}</p>
              <ul className="mt-4 space-y-2 text-[15px]">
                {f.points.map((p) => (
                  <li key={p} className="flex gap-2.5">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-navy-900" aria-hidden />
                    {p}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="mt-16 rounded-lg border border-line bg-paper p-6">
          <h2 className="text-[17px] font-semibold text-navy-900">Det AnbudRadar ikke gjør</h2>
          <ul className="mt-3 space-y-1.5 text-[15px] text-muted">
            <li>Vi sender ikke inn tilbud. Det gjør dere selv i oppdragsgivers system.</li>
            <li>Vi gir ikke juridisk rådgivning. Konkurransegrunnlaget gjelder alltid.</li>
            <li>Vi dikter ikke opp frister, beløp, krav eller konkurrenter. Mangler vises som mangler.</li>
          </ul>
        </div>
      </Container>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------------------
const MATRIX: [string, (p: (typeof PLANS)['starter']['entitlements']) => ReactNode][] = [
  ['Søk med filtre og naturlig språk', () => '✓'],
  ['Avansert søk (CPV, oppdragsgiver, ekskluderinger)', (e) => (e.advancedSearch ? '✓' : '–')],
  ['Lagrede anbud', (e) => (e.maxBookmarks >= 1_000_000 ? 'Ubegrenset' : formatInt(e.maxBookmarks))],
  ['Lagrede søk med e-postvarsel', (e) => (e.maxSavedSearches ? formatInt(e.maxSavedSearches) : '–')],
  ['Fristvarsler og endringsvarsler', (e) => (e.alerts === 'full' ? '✓' : '–')],
  ['AI-analyser per måned', (e) => formatInt(e.aiAnalysesPerMonth)],
  ['Full analyse med kildehenvisning og dokumentopplasting', (e) => (e.aiFullAnalysis ? '✓' : 'Kort sammendrag')],
  ['Personlig rangering med begrunnelse', (e) => (e.matching ? '✓' : '–')],
  ['Tilbudsarbeid med AI-utkast', (e) => (e.bidAssistant ? `${e.aiBidDraftsPerMonth} utkast/mnd` : '–')],
  ['Konkurrent- og tildelingsinnsikt', (e) => (e.competitorIntel ? '✓' : '–')],
  ['Brukere', (e) => formatInt(e.maxMembers)],
];

export function PricingPage() {
  const { liveSources } = useUi();
  return (
    <PublicLayout>
      <Container className="py-16">
        <SectionTitle lead="Alle priser er per organisasjon per måned, eks. mva. 14 dagers gratis prøveperiode med Profesjonell – uten kort.">Priser</SectionTitle>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {PAID_PLANS.map((id) => {
            const p = PLANS[id];
            return (
              <section key={id} className={cn('flex flex-col rounded-lg border bg-white p-6', id === 'professional' ? 'border-navy-900' : 'border-line')}>
                <h2 className="text-[18px] font-semibold text-navy-900">{p.name}</h2>
                <p className="mt-1 text-[14px] text-muted">{p.tagline}</p>
                <p className="mt-5">
                  <span className="num font-serif text-[40px] font-semibold text-navy-900">{p.priceNok}</span>
                  <span className="text-[15px] text-muted"> kr/mnd</span>
                </p>
                <ul className="mt-5 flex-1 space-y-2 text-[15px]">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2.5">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-navy-900" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
                <a href="/registrer" className={buttonVariants({ variant: id === 'professional' ? 'primary' : 'secondary', className: 'mt-6 w-full' })}>
                  Start prøveperiode
                </a>
              </section>
            );
          })}
        </div>
        <p className="mt-5 text-[14px] text-muted">
          Større organisasjoner med behov for flere brukere, høyere grenser eller faktura: <a href="/kontakt">kontakt oss om Enterprise</a>.
        </p>

        <h2 className="mt-16 font-serif text-[24px] font-semibold text-navy-900">Sammenlign planer</h2>
        <div className="scroll-x mt-5 rounded-lg border border-line">
          <table className="w-full min-w-[560px] text-[14px]">
            <thead>
              <tr className="border-b border-line bg-paper text-left">
                <th className="px-4 py-3 font-semibold">Funksjon</th>
                {PAID_PLANS.map((id) => (
                  <th key={id} className="px-4 py-3 text-center font-semibold">
                    {PLANS[id].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map(([label, fn]) => (
                <tr key={label} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">{label}</td>
                  {PAID_PLANS.map((id) => (
                    <td key={id} className="num px-4 py-2.5 text-center">
                      {fn(PLANS[id].entitlements)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="mt-16 font-serif text-[24px] font-semibold text-navy-900">Vanlige spørsmål</h2>
        <dl className="mt-5 grid gap-6 md:grid-cols-2">
          {[
            ['Hva skjer etter prøveperioden?', 'Kontoen går over til gratisnivået med søk og inntil 5 lagrede anbud. Dere velger selv om dere vil betale – ingenting trekkes automatisk.'],
            ['Kan vi si opp når som helst?', 'Ja. Abonnementet løper ut perioden dere har betalt for, og fornyes ikke etter det.'],
            ['Hvordan betaler vi?', 'Med kort via Stripe. Kvittering og faktura finner dere under Abonnement.'],
            ['Hvor kommer dataene fra?', `Fra ${sourcesPhrase(liveSources, true)}. Hver kunngjøring lenker til originalen.`],
            ['Er AI-analysen alltid riktig?', 'Nei. Den er et hjelpemiddel. Hver opplysning har kilde, og konkurransegrunnlaget gjelder alltid ved avvik.'],
            ['Hva teller som en AI-analyse?', 'Hver ny analyse av en kunngjøring. Analyser som allerede finnes for samme innhold, teller ikke.'],
          ].map(([q, a]) => (
            <div key={q}>
              <dt className="font-semibold text-navy-900">{q}</dt>
              <dd className="mt-1 text-[15px] text-muted">{a}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------------------
export function IndustriesPage() {
  return (
    <PublicLayout>
      <Container className="py-16">
        <SectionTitle lead="Bransjene kobles til CPV-kodene oppdragsgiverne bruker i kunngjøringene. Dere kan i tillegg legge inn egne CPV-koder og nøkkelord i profilen.">
          Bransjer
        </SectionTitle>
        <div className="mt-12 divide-y divide-line border-y border-line">
          {INDUSTRIES.map((i) => (
            <section key={i.id} id={i.id} className="grid gap-4 py-7 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
              <h2 className="text-[19px] font-semibold text-navy-900">{i.name}</h2>
              <div className="space-y-3">
                <p className="text-[15px] text-ink">{i.description}</p>
                <p className="text-[14px] text-muted">
                  CPV-grupper:{' '}
                  {i.cpvPrefixes
                    .map((p) => (p.length === 2 && CPV_DIVISIONS[p] ? `${p} ${CPV_DIVISIONS[p]}` : p))
                    .join('; ')}
                </p>
                <p className="text-[14px] text-muted">Typiske ord: {i.keywords.slice(0, 6).join(', ')}</p>
              </div>
            </section>
          ))}
        </div>
        <div className="mt-10">
          <a href="/registrer" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
            Se anbud i deres bransje
          </a>
        </div>
      </Container>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------------------
export function AboutPage({ company }: { company: { name: string; orgNumber: string; address: string; email: string } }) {
  const { liveSources } = useUi();
  return (
    <PublicLayout>
      <Container className="max-w-3xl py-16">
        <SectionTitle>Om AnbudRadar</SectionTitle>
        <div className="mt-8 space-y-5 text-[17px] leading-relaxed text-ink">
          <p>
            Offentlige anskaffelser er et stort marked, men det tar tid å finne de riktige konkurransene og forstå hva som kreves. Små og mellomstore bedrifter har
            sjelden egne folk til å lese kunngjøringer hver dag.
          </p>
          <p>
            AnbudRadar gjør det enklere: vi henter kunngjøringer fra {sourcesPhrase(liveSources)}, viser hvilke som passer bedriften og hjelper dere å forstå kravene – med
            kildehenvisning, slik at dere alltid kan sjekke originalen.
          </p>
          <h2 className="pt-4 font-serif text-[22px] font-semibold text-navy-900">Prinsippene våre</h2>
          <ul className="space-y-2 text-[16px]">
            <li>Vi viser fakta fra kilden atskilt fra AI-tolkning.</li>
            <li>Vi dikter aldri opp frister, beløp, krav eller konkurrenter. Det som mangler, sier vi at mangler.</li>
            <li>Relevansscoren viser samsvar med profilen – ikke sjansen for å vinne.</li>
            <li>Dere eier dataene deres og kan eksportere eller slette dem når som helst.</li>
          </ul>
          <h2 className="pt-4 font-serif text-[22px] font-semibold text-navy-900">Selskapet</h2>
          <p className="text-[16px]">
            {company.name}, org.nr. {company.orgNumber}
            <br />
            {company.address}
            <br />
            <a href={`mailto:${company.email}`}>{company.email}</a>
          </p>
        </div>
      </Container>
    </PublicLayout>
  );
}

export function ContactPage({ sent = false, errors = {}, values = {} }: { sent?: boolean; errors?: Record<string, string>; values?: Record<string, string> }) {
  return (
    <PublicLayout>
      <Container className="max-w-2xl py-16">
        <SectionTitle lead="Spørsmål om produktet, Enterprise-avtaler eller data? Skriv til oss, så svarer vi på e-post.">Kontakt</SectionTitle>
        {sent ? (
          <Alert tone="ok" className="mt-8" title="Takk for meldingen">
            Vi svarer så snart vi kan.
          </Alert>
        ) : (
          <PostForm action="/kontakt" className="mt-8 space-y-4">
            <div className="hidden" aria-hidden>
              <label htmlFor="website">Ikke fyll ut dette feltet</label>
              <input id="website" name="website" tabIndex={-1} autoComplete="off" />
            </div>
            <Field label="Navn" htmlFor="c-name" error={errors.name}>
              <Input id="c-name" name="name" required maxLength={120} defaultValue={values.name} autoComplete="name" />
            </Field>
            <Field label="E-post" htmlFor="c-email" error={errors.email}>
              <Input id="c-email" name="email" type="email" required maxLength={254} defaultValue={values.email} autoComplete="email" />
            </Field>
            <Field label="Melding" htmlFor="c-msg" error={errors.message}>
              <Textarea id="c-msg" name="message" rows={6} required maxLength={5000} defaultValue={values.message} />
            </Field>
            <p className="text-[13px] text-muted">
              Vi bruker opplysningene bare til å svare deg. Se <a href="/personvern">personvernerklæringen</a>.
            </p>
            <Button type="submit">Send melding</Button>
          </PostForm>
        )}
      </Container>
    </PublicLayout>
  );
}

function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const { legalReviewed } = useUi();
  return (
    <PublicLayout>
      <Container className="max-w-3xl py-16">
        <h1 className="font-serif text-[34px] font-semibold text-navy-900">{title}</h1>
        <p className="mt-2 text-[14px] text-muted">Sist oppdatert {updated}</p>
        {!legalReviewed ? (
          <Alert tone="warning" className="mt-6">
            Utkast. Teksten er ikke juridisk gjennomgått ennå og må kvalitetssikres før lansering.
          </Alert>
        ) : null}
        <div className="legal mt-8 space-y-4 text-[16px] leading-relaxed text-ink [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-[22px] [&_h2]:font-semibold [&_h2]:text-navy-900 [&_li]:ml-5 [&_li]:list-disc">
          {children}
        </div>
      </Container>
    </PublicLayout>
  );
}

export function PrivacyPage({ company }: { company: { name: string; orgNumber: string; address: string; email: string } }) {
  return (
    <LegalShell title="Personvernerklæring" updated={formatDate(new Date('2026-11-01'), true)}>
      <p>
        Denne erklæringen forklarer hvordan {company.name} (org.nr. {company.orgNumber}, {company.address}) behandler personopplysninger i AnbudRadar. Vi er
        behandlingsansvarlig. Kontakt: <a href={`mailto:${company.email}`}>{company.email}</a>.
      </p>
      <h2>Hvilke opplysninger vi behandler</h2>
      <ul>
        <li>Kontoopplysninger: navn, e-postadresse og passord (lagret som sikker hash, aldri i klartekst).</li>
        <li>Organisasjon og bedriftsprofil: firmanavn, organisasjonsnummer og det dere selv legger inn om tjenester, område og kvalifikasjoner.</li>
        <li>Bruk av tjenesten: lagrede anbud og søk, varsler, tilbudsarbeid og dokumenter dere laster opp.</li>
        <li>Teknisk informasjon: innloggingsøkter, nettlesertype og en pseudonymisert IP-adresse for sikkerhet og misbrukskontroll.</li>
        <li>Betaling: håndteres av Stripe. Vi lagrer ikke kortnummer, bare referanser til kunde og abonnement.</li>
      </ul>
      <h2>Formål og behandlingsgrunnlag</h2>
      <ul>
        <li>Levere tjenesten dere har avtale om (personvernforordningen art. 6 nr. 1 b).</li>
        <li>Sikkerhet, revisjonslogg og forebygging av misbruk (berettiget interesse, art. 6 nr. 1 f).</li>
        <li>Fakturering og regnskap (rettslig forpliktelse, art. 6 nr. 1 c).</li>
        <li>E-postvarsler dere selv har slått på. Dere kan endre eller slå dem av under Varsler.</li>
      </ul>
      <h2>Kunngjøringsdata</h2>
      <p>
        Kunngjøringer hentes fra offentlige kilder (Doffin og TED). De kan inneholde navn på kontaktpersoner hos oppdragsgiver eller leverandører som har vunnet
        kontrakter. Vi viser bare det som allerede er offentliggjort, og lenker til kilden.
      </p>
      <h2>AI-behandling</h2>
      <p>
        Når dere ber om en AI-analyse, sendes kunngjøringstekst og eventuelle dokumenter dere har lastet opp til vår AI-leverandør for behandling. For
        tekstutkast sendes også opplysninger fra bedriftsprofilen. Vi bruker ikke dataene deres til å trene AI-modeller, og vi velger leverandører med
        databehandleravtale. Hvilken leverandør som brukes, står i listen over databehandlere.
      </p>
      <h2>Databehandlere</h2>
      <p>Vi bruker underleverandører for drift: vertstjeneste og database, e-postutsending, betaling (Stripe) og AI. Oppdatert liste fås ved henvendelse. Ved overføring utenfor EØS bruker vi EUs standardkontraktsbestemmelser eller annet gyldig overføringsgrunnlag.</p>
      <h2>Lagringstid</h2>
      <ul>
        <li>Konto og organisasjonsdata: så lenge kontoen er aktiv. Slettes når dere sletter kontoen eller organisasjonen.</li>
        <li>Innloggingsøkter: til de utløper (inntil 30 dager uten bruk).</li>
        <li>Varsler: leste varsler i 180 dager, øvrige i inntil 12 måneder.</li>
        <li>E-postlogg: 90 dager. Revisjonslogg: 12 måneder.</li>
        <li>Regnskapsopplysninger: så lenge bokføringsloven krever.</li>
      </ul>
      <h2>Informasjonskapsler</h2>
      <p>Vi bruker bare nødvendige informasjonskapsler: innlogging, beskyttelse mot falske skjemainnsendinger og korte statusmeldinger. Vi bruker ikke sporings- eller reklamekapsler.</p>
      <h2>Rettighetene dine</h2>
      <p>
        Du kan be om innsyn, retting, sletting, begrensning og dataportabilitet, og du kan protestere mot behandling basert på berettiget interesse. Eksport og
        sletting kan du gjøre selv under Innstillinger. Du kan klage til Datatilsynet.
      </p>
    </LegalShell>
  );
}

export function TermsPage({ company }: { company: { name: string; orgNumber: string; address: string; email: string } }) {
  return (
    <LegalShell title="Vilkår for bruk" updated={formatDate(new Date('2026-11-01'), true)}>
      <p>
        Vilkårene gjelder for bruk av AnbudRadar, levert av {company.name} (org.nr. {company.orgNumber}). Ved å opprette konto godtar du vilkårene på vegne av
        deg selv og organisasjonen du representerer.
      </p>
      <h2>Tjenesten</h2>
      <p>
        AnbudRadar samler og presenterer offentlige kunngjøringer, rangerer dem mot bedriftsprofilen og tilbyr AI-baserte hjelpemidler. Tjenesten er et
        hjelpemiddel. Kunngjøringen og konkurransegrunnlaget hos oppdragsgiver gjelder alltid.
      </p>
      <h2>Data fra offentlige kilder</h2>
      <p>
        Vi henter data fra Doffin, TED og andre offentlige kilder. Vi kan ikke garantere at dataene er fullstendige, oppdaterte eller feilfrie. Sjekk alltid
        frister og krav i originalkilden før dere handler.
      </p>
      <h2>AI-funksjoner</h2>
      <p>
        AI-analyser og tekstutkast kan inneholde feil. De er ikke juridisk rådgivning. Dere er selv ansvarlige for innholdet i tilbud dere sender inn, og for at
        opplysningene om bedriften er riktige.
      </p>
      <h2>Abonnement og betaling</h2>
      <ul>
        <li>Prøveperioden er gratis og går automatisk over til gratisnivået når den er over.</li>
        <li>Betalte planer faktureres månedlig på forskudd via Stripe. Priser er oppgitt eks. mva.</li>
        <li>Abonnementet kan sies opp når som helst og gjelder ut perioden som er betalt.</li>
        <li>Vi varsler om prisendringer minst 30 dager i forveien.</li>
      </ul>
      <h2>Kundens innhold</h2>
      <p>Dere eier innholdet dere legger inn og laster opp. Vi bruker det bare for å levere tjenesten.</p>
      <h2>Akseptabel bruk</h2>
      <p>Det er ikke tillatt å forsøke å omgå tilgangskontroll, belaste tjenesten unødig, eller videreselge data fra tjenesten i strid med kildenes vilkår.</p>
      <h2>Ansvar</h2>
      <p>
        Vi er ikke ansvarlige for tap som følge av feil eller mangler i data fra offentlige kilder, AI-innhold eller tapte konkurranser. Vårt samlede ansvar er
        begrenset til beløpet dere har betalt de siste 12 månedene, så langt annet ikke følger av ufravikelig lov.
      </p>
      <h2>Endringer og opphør</h2>
      <p>Vi kan endre vilkårene med 30 dagers varsel. Vi kan stenge kontoer som bryter vilkårene.</p>
      <h2>Lovvalg</h2>
      <p>Avtalen reguleres av norsk rett. Tvister løses ved norske domstoler.</p>
    </LegalShell>
  );
}
