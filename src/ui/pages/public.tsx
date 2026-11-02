import type { ReactNode } from 'react';
import type { IconType } from 'react-icons';
import { LuBellRing, LuCalculator, LuChartColumn, LuFileSearch, LuHandshake, LuListChecks, LuMail, LuRadar, LuSearch, LuX } from 'react-icons/lu';
import { INDUSTRIES, CPV_DIVISIONS } from '@/domain/reference';
import { PAID_PLANS, PLANS } from '@/domain/billing/plans';
import { useUi } from '../context';
import { Alert, Button, buttonVariants, cn, Field, Input, PostForm, Textarea } from '../components';
import { PublicLayout } from '../layouts';
import { formatDate, formatInt, sourcesPhrase } from '../format';
import { CheckList, Container, CtaBand, FaqList, faqItems, IconChip, INDUSTRY_ICONS, PageHero, PlanCards, SectionHeading } from '../marketing';

export { HomePage, type Coverage, type Specimen } from './home';

// ---------------------------------------------------------------------------
const FEATURES: { icon: IconType; title: string; text: string; points: string[] }[] = [
  {
    icon: LuSearch,
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
    icon: LuFileSearch,
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
    icon: LuRadar,
    title: 'Rangering mot profilen',
    text: 'Hvert anbud får en relevansscore fra 0 til 100 basert på bedriftsprofilen. Scoren viser samsvar – ikke sjansen for å vinne.',
    points: ['Begrunnelse for scoren', 'Mangler og avvik, f.eks. sertifiseringer dere ikke har registrert', 'Krav som kan stoppe dere', 'Anbefalte neste steg'],
  },
  {
    icon: LuBellRing,
    title: 'Varsler',
    text: 'Få beskjed om det som betyr noe, så ofte dere vil.',
    points: ['Nye treff og nye anbud i lagrede søk', 'Påminnelser 7, 3 og 1 dag før fristen', 'Endringer og avlysninger i anbud dere følger', 'Ukesoversikt på mandager'],
  },
  {
    icon: LuChartColumn,
    title: 'Konkurrenter og tildelinger',
    text: 'Se hvem som vinner kontraktene i bransjene deres, og hvem som kjøper mest – basert på publiserte tildelinger.',
    points: ['Leverandører med flest tildelinger', 'Oppdragsgivere og hva de kjøper', 'Følg konkurrenter og få varsel når de vinner', 'Dekningen vises alltid; vi anslår aldri priser'],
  },
  {
    icon: LuListChecks,
    title: 'Tilbudsarbeid',
    text: 'Et felles arbeidsområde for tilbudet, med godkjenning før noe sendes.',
    points: [
      'Sjekkliste fra standardpunkter og kravene i dokumentene',
      'Tekstutkast fra bedriftsprofilen – AI finner aldri på erfaring eller tall',
      'Sammenligning av utkastet mot kravene',
      'Eksport til Word og godkjenning i teamet',
    ],
  },
  {
    icon: LuCalculator,
    title: 'Lønner det seg? (Profit Intelligence)',
    text: 'Regn på oppdraget med deres egne kostnader før dere bruker tid på tilbudet. Hvert tall viser om det kommer fra dokumentet, fra dere, fra AI eller fra kalkulatoren.',
    points: [
      'Selvkost, minstepris, prisintervall og margin ved oppdragsgivers verdi – med formel for hvert tall',
      'Dagbøter, betalingsfrist, prisregulering og garantier med dokument, side og sitat – og hva de kan koste',
      'Kapasitet: bemanning, eksisterende kontrakter og utstyr mot det oppdraget krever',
      'Anbefaling: Vurder å by, Undersøk nærmere eller Høy risiko – med begrunnelse, ikke vinnersjanse',
    ],
  },
  {
    icon: LuHandshake,
    title: 'Anbudspartnere',
    text: 'Finn bedrifter som kan dekke det dere mangler – sertifisering, utstyr eller kapasitet – og bli funnet selv.',
    points: [
      'Profilen vises bare når dere publiserer den med samtykke',
      'Kontaktinfo deles bare når mottakeren godtar',
      'Innebygd sperre mot samarbeid mellom bedrifter som kan levere alene (konkurranseloven)',
      'Del aldri priser eller tilbudsstrategi – det minner vi om i hver forespørsel',
    ],
  },
];

export function FeaturesPage() {
  const { user, trialDays } = useUi();
  return (
    <PublicLayout>
      <PageHero
        eyebrow="Funksjoner"
        title="Alt fra kunngjøring til ferdig tilbud"
        lead="Hver funksjon er laget for å spare tid – uten å gjette på noe. Fakta fra kilden står alltid atskilt fra AI-tolkningen."
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={user ? '/app' : '/registrer'} className={buttonVariants({ size: 'lg' })}>
            {user ? 'Til appen' : `Prøv gratis i ${trialDays} dager`}
          </a>
          <a href="/priser" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
            Se priser
          </a>
        </div>
      </PageHero>
      <section className="py-16 sm:py-24">
        <Container>
          <div className="grid gap-5 md:grid-cols-2">
            {FEATURES.map((f) => (
              <article key={f.title} className="lift rounded-2xl border border-line bg-white p-6 sm:p-7">
                <div className="flex items-center gap-3">
                  <IconChip icon={f.icon} />
                  <h2 className="text-[20px] font-semibold text-navy-900">{f.title}</h2>
                </div>
                <p className="mt-3 text-[15px] leading-relaxed text-muted">{f.text}</p>
                <CheckList className="mt-5 text-[15px]" items={f.points} />
              </article>
            ))}
          </div>
          <section className="mt-10 rounded-2xl border border-dashed border-line-strong bg-paper p-6 sm:p-8">
            <h2 className="font-serif text-[22px] font-semibold text-navy-900">Det AnbudRadar ikke gjør</h2>
            <ul className="mt-4 grid gap-4 text-[15px] text-muted md:grid-cols-3">
              {[
                'Vi sender ikke inn tilbud. Det gjør dere selv i oppdragsgivers system.',
                'Vi gir ikke juridisk rådgivning. Konkurransegrunnlaget gjelder alltid.',
                'Vi dikter ikke opp frister, beløp, krav eller konkurrenter. Mangler vises som mangler.',
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-muted ring-1 ring-line">
                    <LuX className="size-3" aria-hidden strokeWidth={3} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </section>
        </Container>
      </section>
      <CtaBand
        title="Se hvilke anbud som passer dere."
        lead="Fyll ut bedriftsprofilen på et par minutter, og få anbudene rangert med begrunnelse."
        primary={user ? { href: '/app', label: 'Til appen' } : { href: '/registrer', label: `Prøv gratis i ${trialDays} dager` }}
        secondary={{ href: '/priser', label: 'Se priser' }}
      />
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
  ['Lønnsomhetskalkulator med kontraktsvilkår og kapasitet', (e) => (e.profitCalculator ? '✓' : '–')],
  ['AI-analyse av lønnsomhet og kontraktsrisiko', (e) => (e.profitAI ? '✓' : '–')],
  ['Partnerprofil (bli funnet som anbudspartner)', (e) => (e.partnerListing ? '✓' : '–')],
  ['Søk etter anbudspartnere', (e) => (e.partnerSearch ? '✓' : '–')],
  ['Brukere', (e) => formatInt(e.maxMembers)],
];

export function PricingPage() {
  const { user, liveSources, trialDays } = useUi();
  return (
    <PublicLayout>
      <PageHero
        eyebrow="Priser"
        title="Enkle priser. Ingen binding."
        lead={`Alle priser er per organisasjon per måned, eks. mva. ${trialDays} dagers gratis prøveperiode med Profesjonell – uten kort.`}
      />
      <section className="py-16 sm:py-24">
        <Container>
          <h2 className="sr-only">Planer</h2>
          <PlanCards />
          <p className="mt-6 text-center text-[14px] text-muted">
            Større organisasjoner med behov for flere brukere, høyere grenser eller faktura: <a href="/kontakt">kontakt oss om Enterprise</a>.
          </p>

          <div className="mt-20">
            <SectionHeading eyebrow="Detaljer">Sammenlign planer</SectionHeading>
          </div>
          <div className="scroll-x mt-8 rounded-2xl border border-line bg-white">
            <table className="w-full min-w-[560px] text-[14px]">
              <thead>
                <tr className="border-b border-line bg-paper text-left">
                  <th className="px-4 py-3.5 font-semibold">Funksjon</th>
                  {PAID_PLANS.map((id) => (
                    <th key={id} className={cn('px-4 py-3.5 text-center font-semibold', id === 'professional' && 'text-navy-900')}>
                      {PLANS[id].name}
                      <span className="num block text-[12px] font-normal text-muted">{PLANS[id].priceNok} kr/mnd</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX.map(([label, fn]) => (
                  <tr key={label} className="border-b border-line last:border-0 hover:bg-navy-50/50">
                    <td className="px-4 py-3">{label}</td>
                    {PAID_PLANS.map((id) => (
                      <td key={id} className={cn('num px-4 py-3 text-center', id === 'professional' && 'bg-navy-50/40')}>
                        {fn(PLANS[id].entitlements)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </section>
      <section className="border-t border-line bg-paper py-16 sm:py-24">
        <Container className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <SectionHeading eyebrow="Spørsmål" lead={<>Finner du ikke svaret? <a href="/kontakt">Kontakt oss</a>.</>}>
            Vanlige spørsmål
          </SectionHeading>
          <FaqList
            items={[
              ...faqItems({ trialDays, sources: sourcesPhrase(liveSources, true) }),
              ['Hva teller som en AI-analyse?', 'Hver ny analyse av en kunngjøring. Analyser som allerede finnes for samme innhold, teller ikke.'],
            ]}
          />
        </Container>
      </section>
      <CtaBand
        title={`Prøv alt i Profesjonell i ${trialDays} dager.`}
        lead="Ingen kort, og ingenting trekkes automatisk når prøveperioden er over."
        primary={user ? { href: '/app', label: 'Til appen' } : { href: '/registrer', label: 'Start prøveperiode' }}
        secondary={{ href: '/funksjoner', label: 'Se funksjoner' }}
      />
    </PublicLayout>
  );
}

// ---------------------------------------------------------------------------
export function IndustriesPage() {
  const { user, trialDays } = useUi();
  return (
    <PublicLayout>
      <PageHero
        eyebrow="Bransjer"
        title="Anbud for deres bransje"
        lead="Bransjene kobles til CPV-kodene oppdragsgiverne bruker i kunngjøringene. Dere kan i tillegg legge inn egne CPV-koder og nøkkelord i profilen."
      >
        <ul className="mt-8 flex flex-wrap gap-2">
          {INDUSTRIES.map((i) => (
            <li key={i.id}>
              <a href={`#${i.id}`} className="inline-flex rounded-full border border-line bg-white px-3 py-1 text-[13px] font-semibold text-navy-800 no-underline hover:border-navy-300">
                {i.name}
              </a>
            </li>
          ))}
        </ul>
      </PageHero>
      <section className="py-16 sm:py-24">
        <Container>
          <div className="grid gap-5 md:grid-cols-2">
            {INDUSTRIES.map((i) => (
              <article key={i.id} id={i.id} className="lift scroll-mt-24 rounded-2xl border border-line bg-white p-6">
                <div className="flex items-center gap-3">
                  <IconChip icon={INDUSTRY_ICONS[i.id] ?? LuRadar} />
                  <h2 className="text-[19px] font-semibold text-navy-900">{i.name}</h2>
                </div>
                <p className="mt-3 text-[15px] text-ink">{i.description}</p>
                <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-muted">CPV-grupper</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {i.cpvPrefixes.map((p) => (
                    <li key={p} className="rounded-md bg-paper px-2 py-0.5 text-[12px] text-muted ring-1 ring-line">
                      <span className="num font-semibold text-navy-800">{p}</span>
                      {p.length === 2 && CPV_DIVISIONS[p] ? ` ${CPV_DIVISIONS[p]}` : ''}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-[13px] text-muted">Typiske ord: {i.keywords.slice(0, 6).join(', ')}</p>
              </article>
            ))}
          </div>
        </Container>
      </section>
      <CtaBand
        title="Se anbudene i deres bransje."
        lead="Velg bransje, område og størrelse i profilen – så rangerer vi kunngjøringene for dere."
        primary={user ? { href: '/app', label: 'Til appen' } : { href: '/registrer', label: `Prøv gratis i ${trialDays} dager` }}
      />
    </PublicLayout>
  );
}

// ---------------------------------------------------------------------------
export function AboutPage({ company }: { company: { name: string; orgNumber: string; address: string; email: string } }) {
  const { liveSources } = useUi();
  return (
    <PublicLayout>
      <PageHero
        eyebrow="Om oss"
        title="Om AnbudRadar"
        lead="Offentlige anskaffelser er et stort marked, men det tar tid å finne de riktige konkurransene og forstå hva som kreves."
      />
      <section className="py-16 sm:py-20">
        <Container className="grid gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="space-y-5 text-[17px] leading-relaxed text-ink">
            <p>Små og mellomstore bedrifter har sjelden egne folk til å lese kunngjøringer hver dag.</p>
            <p>
              AnbudRadar gjør det enklere: vi henter kunngjøringer fra {sourcesPhrase(liveSources)}, viser hvilke som passer bedriften og hjelper dere å forstå kravene – med
              kildehenvisning, slik at dere alltid kan sjekke originalen.
            </p>
            <h2 className="pt-4 font-serif text-[24px] font-semibold text-navy-900">Prinsippene våre</h2>
            <CheckList
              className="text-[16px]"
              items={[
                'Vi viser fakta fra kilden atskilt fra AI-tolkning.',
                'Vi dikter aldri opp frister, beløp, krav eller konkurrenter. Det som mangler, sier vi at mangler.',
                'Relevansscoren viser samsvar med profilen – ikke sjansen for å vinne.',
                'Dere eier dataene deres og kan eksportere eller slette dem når som helst.',
              ]}
            />
          </div>
          <aside className="h-fit rounded-2xl border border-line bg-paper p-6">
            <h2 className="text-[17px] font-semibold text-navy-900">Selskapet</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink">
              {company.name}, org.nr. {company.orgNumber}
              <br />
              {company.address}
            </p>
            <a href={`mailto:${company.email}`} className="mt-4 inline-flex items-center gap-2 text-[15px] font-semibold">
              <LuMail className="size-4" aria-hidden /> {company.email}
            </a>
          </aside>
        </Container>
      </section>
    </PublicLayout>
  );
}

export function ContactPage({ sent = false, errors = {}, values = {} }: { sent?: boolean; errors?: Record<string, string>; values?: Record<string, string> }) {
  return (
    <PublicLayout>
      <PageHero eyebrow="Kontakt" title="Snakk med oss" lead="Spørsmål om produktet, Enterprise-avtaler eller data? Skriv til oss, så svarer vi på e-post." />
      <section className="py-16 sm:py-20">
        <Container className="max-w-2xl">
          {sent ? (
            <Alert tone="ok" title="Takk for meldingen">
              Vi svarer så snart vi kan.
            </Alert>
          ) : (
            <PostForm action="/kontakt" className="space-y-4 rounded-2xl border border-line bg-white p-6 shadow-[0_20px_50px_-35px_rgba(15,35,64,0.5)] sm:p-8">
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
              <Button type="submit" size="lg">
                Send melding
              </Button>
            </PostForm>
          )}
        </Container>
      </section>
    </PublicLayout>
  );
}

function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const { legalReviewed } = useUi();
  return (
    <PublicLayout>
      <PageHero title={title} lead={`Sist oppdatert ${updated}`} />
      <Container className="max-w-3xl py-12 sm:py-16">
        {!legalReviewed ? (
          <Alert tone="warning" className="mb-8">
            Utkast. Teksten er ikke juridisk gjennomgått ennå og må kvalitetssikres før lansering.
          </Alert>
        ) : null}
        <div className="legal space-y-4 text-[16px] leading-relaxed text-ink [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-[22px] [&_h2]:font-semibold [&_h2]:text-navy-900 [&_li]:ml-5 [&_li]:list-disc">
          {children}
        </div>
      </Container>
    </PublicLayout>
  );
}

const AI_PROCESSOR: Record<string, string | null> = {
  anthropic: 'Anthropic – AI-analyser (kan behandle data i USA).',
  openai: 'OpenAI – AI-analyser (kan behandle data i USA).',
  mock: null,
  none: null,
};

export function PrivacyPage({ company, aiProvider = 'anthropic' }: { company: { name: string; orgNumber: string; address: string; email: string }; aiProvider?: string }) {
  const aiProcessor = AI_PROCESSOR[aiProvider] ?? null;
  return (
    <LegalShell title="Personvernerklæring" updated={formatDate(new Date('2026-11-02'), true)}>
      <p>
        Denne erklæringen forklarer hvordan {company.name} (org.nr. {company.orgNumber}, {company.address}) behandler personopplysninger i AnbudRadar. Vi er
        behandlingsansvarlig. Kontakt: <a href={`mailto:${company.email}`}>{company.email}</a>.
      </p>
      <h2>Hvilke opplysninger vi behandler</h2>
      <ul>
        <li>Kontoopplysninger: navn, e-postadresse og passord (lagret som sikker hash, aldri i klartekst).</li>
        <li>Organisasjon og bedriftsprofil: firmanavn, organisasjonsnummer og det dere selv legger inn om tjenester, område og kvalifikasjoner.</li>
        <li>Bruk av tjenesten: lagrede anbud og søk, varsler, tilbudsarbeid og dokumenter dere laster opp.</li>
        <li>
          Lønnsomhet og kapasitet: kalkyler, timekost, marginer, utstyr, eksisterende kontrakter og bemanning. Bemanning registreres som roller og antall –
          ikke navn på ansatte. Dette er bedriftsopplysninger som bare organisasjonen selv ser.
        </li>
        <li>
          Anbudspartnere: partnerprofilen dere velger å publisere, og navn og e-post til kontaktpersonen i forespørsler dere sender eller godtar.
        </li>
        <li>Teknisk informasjon: innloggingsøkter, nettlesertype og en pseudonymisert IP-adresse for sikkerhet og misbrukskontroll.</li>
        <li>Betaling: håndteres av Stripe. Vi lagrer ikke kortnummer, bare referanser til kunde og abonnement.</li>
      </ul>
      <h2>Formål og behandlingsgrunnlag</h2>
      <ul>
        <li>Levere tjenesten dere har avtale om (personvernforordningen art. 6 nr. 1 b).</li>
        <li>Sikkerhet, revisjonslogg og forebygging av misbruk (berettiget interesse, art. 6 nr. 1 f).</li>
        <li>Fakturering og regnskap (rettslig forpliktelse, art. 6 nr. 1 c).</li>
        <li>E-postvarsler dere selv har slått på. Dere kan endre eller slå dem av under Varsler.</li>
        <li>
          Publisering av partnerprofil: samtykke (art. 6 nr. 1 a). Samtykket kan trekkes når som helst ved å skjule profilen – den forsvinner da straks for
          andre.
        </li>
      </ul>
      <h2>Anbudspartnere</h2>
      <p>
        En partnerprofil vises bare for andre kunder av AnbudRadar, og bare etter at en eier eller administrator har publisert den med samtykke. Profilen inneholder
        det dere selv skriver om bedriften. Kalkyler, priser, kunder og dokumenter deles aldri. Sender dere en forespørsel, ser mottakeren meldingen og
        kontaktpersonen dere oppgir. Mottakerens kontaktperson deles med dere bare hvis mottakeren godtar. Ubesvarte forespørsler slettes etter 180 dager,
        avslåtte eller trukne etter 12 måneder og godtatte etter 24 måneder.
      </p>
      <h2>Kunngjøringsdata</h2>
      <p>
        Kunngjøringer hentes fra offentlige kilder (Doffin og TED). De kan inneholde navn på kontaktpersoner hos oppdragsgiver eller leverandører som har vunnet
        kontrakter. Vi viser bare det som allerede er offentliggjort, og lenker til kilden.
      </p>
      <h2>AI-behandling</h2>
      <p>
        Når dere ber om en AI-analyse, sendes kunngjøringstekst og eventuelle dokumenter dere har lastet opp til vår AI-leverandør for behandling. For
        egnethetsvurdering og tekstutkast sendes også opplysninger fra bedriftsprofilen. Lønnsomhetsanalysen sender bare kunngjøringen og dokumentene – ikke
        kostnadene, marginene eller bemanningen deres; regnestykket gjøres hos oss. Vi bruker ikke dataene deres til å trene AI-modeller, og vi velger
        leverandører med databehandleravtale. Hvilken leverandør som brukes, står i listen over databehandlere.
      </p>
      <h2>Databehandlere</h2>
      <p>Vi bruker disse underleverandørene (databehandlere) ved ordinær drift:</p>
      <ul>
        <li>Supabase – database og fillagring (EU-region).</li>
        <li>Render – kjøring av appen og bakgrunnsjobber (EU-region).</li>
        <li>Resend – utsending av e-post.</li>
        <li>Stripe – betaling og fakturering.</li>
        {aiProcessor ? <li>{aiProcessor}</li> : <li>AI-leverandør: ikke tatt i bruk ennå.</li>}
      </ul>
      <p>
        Ved overføring utenfor EØS bruker vi EUs standardkontraktsbestemmelser eller annet gyldig overføringsgrunnlag. Endringer i listen varsles på denne siden.
      </p>
      <h2>Lagringstid</h2>
      <ul>
        <li>Konto og organisasjonsdata: så lenge kontoen er aktiv. Slettes når dere sletter kontoen eller organisasjonen.</li>
        <li>Innloggingsøkter: til de utløper (inntil 30 dager uten bruk).</li>
        <li>Varsler: leste varsler i 180 dager, øvrige i inntil 12 måneder.</li>
        <li>E-postlogg: 90 dager. Revisjonslogg: 12 måneder.</li>
        <li>Partnerforespørsler: ubesvarte 180 dager, avslåtte og trukne 12 måneder, godtatte 24 måneder.</li>
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
    <LegalShell title="Vilkår for bruk" updated={formatDate(new Date('2026-11-02'), true)}>
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
      <h2>Lønnsomhetsberegninger</h2>
      <p>
        Lønnsomhetskalkulatoren regner på tallene dere selv legger inn og på det som står i kunngjøringen og dokumentene. Resultatet er ikke en garanti for
        fortjeneste, og ikke en prognose for hvilken pris som vinner eller hva andre leverandører byr. Dere er selv ansvarlige for prisen dere tilbyr.
      </p>
      <h2>Anbudspartnere</h2>
      <ul>
        <li>AnbudRadar formidler kontakt mellom kunder som selv har publisert en partnerprofil. Vi er ikke part i et samarbeid som avtales.</li>
        <li>
          Dere er selv ansvarlige for at et samarbeid er lovlig, blant annet etter konkurranseloven § 10. Bedrifter som hver for seg kan levere, skal som
          hovedregel ikke gi felles tilbud. Del aldri priser, marginer eller tilbudsstrategi med en konkurrent. Veiledningen i tjenesten er ikke juridisk
          rådgivning.
        </li>
        <li>Opplysningene i partnerprofilen skal være riktige. Vi kan skjule profiler som er villedende eller brukes til markedsføring som ikke gjelder samarbeid.</li>
      </ul>
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
