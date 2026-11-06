/**
 * Juridiske sider: vilkår, personvern, databehandleravtale, underleverandører, informasjonskapsler
 * og sikkerhet. Felles fakta (leverandører, kapsler, lagringstider, firma) kommer fra
 * src/domain/legal/legal.ts. Tekstene er utkast som skal gjennomgås av advokat (LEGAL_PAGES_REVIEWED).
 */
import type { ReactNode } from 'react';
import {
  companyInfo,
  contactIsGmail,
  cookies,
  isPlaceholder,
  LEGAL_DOCS,
  LEGAL_UPDATED,
  LEGAL_VERSION,
  RETENTION,
  subprocessors,
  type CompanyInfo,
} from '@/domain/legal/legal';
import { useUi } from '../context';
import { Alert, Badge, cn } from '../components';
import { PublicLayout } from '../layouts';
import { formatDate } from '../format';
import { Container } from '../marketing';

interface Section {
  id: string;
  title: string;
  /** Innhold; får seksjonsnummeret, så underpunkter kan nummereres «3.1», «3.2» … */
  body: (n: number) => ReactNode;
}

/** Nummererte underpunkter i kontraktsstil: 3.1, 3.2 … */
function Clauses({ n, items }: { n: number; items: ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-1">
          <span className="num font-semibold text-navy-800">
            {n}.{i + 1}
          </span>
          <div>{item}</div>
        </li>
      ))}
    </ol>
  );
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-navy-300">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="scroll-x my-4 rounded-xl border border-line">
      <table className="w-full min-w-[560px] text-left text-[14px]">
        <thead>
          <tr className="border-b border-line bg-paper">
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-semibold text-navy-900">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line align-top last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-2.5 leading-relaxed">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Firmaopplysning – plassholdere (ikke fylt inn ennå) markeres tydelig i stedet for å se ekte ut. */
function Fact({ value, label }: { value: string; label: string }) {
  return isPlaceholder(value) ? (
    <mark className="rounded bg-marker/40 px-0.5 text-navy-900" title="Ikke fylt inn ennå">
      [{label}]
    </mark>
  ) : (
    <>{value}</>
  );
}

function Email({ c }: { c: CompanyInfo }) {
  return isPlaceholder(c.email) ? <Fact value={c.email} label="e-post" /> : <a href={`mailto:${c.email}`}>{c.email}</a>;
}

function CompanyLine({ c }: { c: CompanyInfo }) {
  return (
    <>
      <Fact value={c.name} label="selskapsnavn" />, org.nr. <Fact value={c.orgNumber} label="org.nr." />, <Fact value={c.address} label="adresse" />, e-post{' '}
      <Email c={c} />
    </>
  );
}

function LegalDocument({ title, lead, sections }: { title: string; lead: ReactNode; sections: Section[] }) {
  const { legalReviewed, path } = useUi();
  return (
    <PublicLayout>
      <section className="border-b border-line bg-paper">
        <Container className="py-12 sm:py-16">
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-navy-600">Juridisk</p>
          <h1 className="mt-2 font-serif text-[34px] font-semibold leading-tight text-navy-900 sm:text-[44px]">{title}</h1>
          <p className="mt-3 text-[15px] text-muted">
            Versjon {LEGAL_VERSION} · Sist oppdatert {formatDate(LEGAL_UPDATED, true)}
          </p>
          <nav aria-label="Juridiske dokumenter" className="mt-6 flex flex-wrap gap-2 print:hidden">
            {LEGAL_DOCS.map((d) => (
              <a
                key={d.href}
                href={d.href}
                aria-current={path === d.href ? 'page' : undefined}
                className={cn(
                  'rounded-full border px-3 py-1 text-[13px] font-semibold no-underline',
                  path === d.href ? 'border-navy-900 bg-navy-900 text-white' : 'border-line bg-white text-navy-800 hover:border-navy-300',
                )}
              >
                {d.label}
              </a>
            ))}
          </nav>
        </Container>
      </section>

      <Container className="grid gap-10 py-10 sm:py-14 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="print:hidden">
          <details className="rounded-xl border border-line bg-white p-4 lg:hidden">
            <summary className="cursor-pointer text-[14px] font-semibold text-navy-900">Innhold</summary>
            <Toc sections={sections} />
          </details>
          <div className="sticky top-24 hidden lg:block">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Innhold</p>
            <Toc sections={sections} />
          </div>
        </aside>

        <article className="min-w-0 max-w-3xl text-[16px] leading-relaxed text-ink [&_a]:font-medium [&_p]:my-3">
          {!legalReviewed ? (
            <Alert tone="warning" className="mb-8 print:hidden">
              Utkast. Teksten er ikke juridisk gjennomgått ennå og skal kvalitetssikres av advokat før lansering.
            </Alert>
          ) : null}
          <div className="text-[17px] text-ink">{lead}</div>
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24 border-t border-line pt-6 mt-8 first-of-type:mt-10">
              <h2 className="font-serif text-[22px] font-semibold text-navy-900">
                <span className="num mr-2 text-navy-300">{i + 1}.</span>
                {s.title}
              </h2>
              <div className="mt-3">{s.body(i + 1)}</div>
            </section>
          ))}
        </article>
      </Container>
    </PublicLayout>
  );
}

function Toc({ sections }: { sections: Section[] }) {
  return (
    <ol className="mt-3 space-y-1.5 text-[14px]">
      {sections.map((s, i) => (
        <li key={s.id}>
          <a href={`#${s.id}`} className="flex gap-2 text-muted no-underline hover:text-navy-900">
            <span className="num w-6 shrink-0 text-right text-navy-300">{i + 1}.</span>
            <span>{s.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

// ===========================================================================
// Vilkår for bruk
// ===========================================================================
export function TermsPage() {
  const { trialDays } = useUi();
  const c = companyInfo();
  const sections: Section[] = [
    {
      id: 'om-vilkarene',
      title: 'Om vilkårene og partene',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>
              Disse vilkårene («Vilkårene») gjelder for bruk av AnbudRadar («Tjenesten»), levert av <CompanyLine c={c} /> («Leverandøren», «vi»).
            </>,
            <>
              Tjenesten tilbys næringsdrivende og offentlige virksomheter. Avtalen inngås mellom Leverandøren og virksomheten som opprettes i Tjenesten
              («Kunden»). Den som oppretter kontoen, bekrefter å ha fullmakt til å inngå avtalen på vegne av Kunden.
            </>,
            <>
              <a href="/personvern">Personvernerklæringen</a>, <a href="/databehandleravtale">Databehandleravtalen</a> og prisene på <a href="/priser">/priser</a> er
              en del av avtalen. Ved motstrid gjelder Databehandleravtalen foran Vilkårene når det gjelder behandling av personopplysninger.
            </>,
            <>Fordi Tjenesten bare tilbys næringsdrivende, gjelder ikke reglene om angrerett og forbrukerkjøp.</>,
          ]}
        />
      ),
    },
    {
      id: 'definisjoner',
      title: 'Definisjoner',
      body: () => (
        <Bullets
          items={[
            <>
              <strong>Bruker:</strong> en person som har tilgang til Tjenesten gjennom Kundens konto.
            </>,
            <>
              <strong>Kundedata:</strong> alt Kunden og Brukerne legger inn eller laster opp, for eksempel bedriftsprofil, lagrede anbud, notater, dokumenter,
              tilbudsarbeid og kalkyler.
            </>,
            <>
              <strong>Kunngjøringsdata:</strong> offentlige kunngjøringer hentet fra Doffin, TED og andre offentlige kilder.
            </>,
            <>
              <strong>AI-innhold:</strong> tekst laget med kunstig intelligens i Tjenesten, for eksempel analyser, vurderinger og tekstutkast.
            </>,
            <>
              <strong>Plan:</strong> abonnementsnivået Kunden har valgt (Start, Profesjonell eller Bedrift), eller gratisnivået.
            </>,
          ]}
        />
      ),
    },
    {
      id: 'tjenesten',
      title: 'Tjenesten',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>
              Tjenesten henter og viser offentlige kunngjøringer, rangerer dem mot Kundens profil og tilbyr hjelpemidler for analyse, lønnsomhetsberegning,
              tilbudsarbeid og partnersøk. Hva som er med i hver Plan, står på <a href="/priser">/priser</a>.
            </>,
            <>Tjenesten er et hjelpemiddel. Kunden leverer selv tilbud i oppdragsgivers system. Kunngjøringen og konkurransegrunnlaget hos oppdragsgiver gjelder alltid.</>,
            <>Tjenesten gir ikke juridisk, økonomisk eller annen faglig rådgivning.</>,
          ]}
        />
      ),
    },
    {
      id: 'konto',
      title: 'Konto og brukere',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>Kunden er ansvarlig for at opplysningene ved registrering er riktige, og for Brukernes bruk av Tjenesten.</>,
            <>Innlogging er personlig og skal ikke deles. Passord skal holdes hemmelig. Mistanke om uautorisert bruk skal meldes til oss uten ugrunnet opphold.</>,
            <>Kundens eiere og administratorer bestemmer hvem som har tilgang, og med hvilken rolle.</>,
          ]}
        />
      ),
    },
    {
      id: 'prove-og-planer',
      title: 'Prøveperiode og planer',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>Nye kunder får en gratis prøveperiode på {trialDays} dager med funksjonene i Profesjonell. Det kreves ikke betalingskort.</>,
            <>
              Etter prøveperioden går kontoen over til gratisnivået med begrensede funksjoner, med mindre Kunden velger en betalt Plan. Ingenting faktureres
              automatisk ved overgangen.
            </>,
            <>Kunden kan bytte Plan når som helst. Eventuell forholdsmessig justering av prisen beregnes av betalingsløsningen.</>,
          ]}
        />
      ),
    },
    {
      id: 'betaling',
      title: 'Priser og betaling',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>
              Prisene står på <a href="/priser">/priser</a>. De gjelder per organisasjon per måned og er oppgitt eksklusive merverdiavgift.
            </>,
            <>Betalte Planer faktureres månedlig på forskudd gjennom betalingsleverandøren Stripe, og fornyes automatisk hver måned til de sies opp.</>,
            <>Ved manglende betaling kan tilgangen til betalte funksjoner begrenses etter varsel. Kundedata slettes ikke på grunn av manglende betaling.</>,
            <>Prisendringer varsles minst 30 dager før de trer i kraft. Kunden kan si opp før endringen gjelder.</>,
            <>Betalt periode refunderes ikke ved oppsigelse, med mindre annet følger av ufravikelig lov eller feil hos oss.</>,
          ]}
        />
      ),
    },
    {
      id: 'oppsigelse',
      title: 'Oppsigelse fra Kunden',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>Kunden kan si opp en betalt Plan når som helst i kundeportalen under Abonnement. Planen gjelder ut perioden som er betalt, og fornyes ikke.</>,
            <>Kunden kan når som helst eksportere data og slette organisasjonen og brukerkontoene under Innstillinger. Sletting kan ikke angres.</>,
          ]}
        />
      ),
    },
    {
      id: 'akseptabel-bruk',
      title: 'Akseptabel bruk',
      body: () => (
        <>
          <p>Kunden og Brukerne skal ikke:</p>
          <Bullets
            items={[
              'forsøke å få tilgang til andre kunders data, eller omgå tilgangskontroll eller sikkerhetstiltak;',
              'laste ned eller kopiere data fra Tjenesten maskinelt eller i et omfang som går ut over vanlig bruk (skraping), eller belaste Tjenesten unødig;',
              'videreselge Tjenesten, eller gjøre Kunngjøringsdata eller AI-innhold tilgjengelig som en egen tjeneste;',
              'laste opp innhold som er ulovlig, krenker andres rettigheter eller inneholder skadelig kode;',
              'bruke partnerfunksjonen til markedsføring som ikke gjelder samarbeid om anbud, eller på en måte som bryter konkurranseloven;',
              'dele innloggingen sin med andre.',
            ]}
          />
        </>
      ),
    },
    {
      id: 'kunngjoringsdata',
      title: 'Kunngjøringsdata fra offentlige kilder',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>
              Kunngjøringsdata hentes fra Doffin (drevet av Direktoratet for forvaltning og økonomistyring, DFØ), TED (Den europeiske unions
              publikasjonskontor) og andre offentlige kilder. Hver kunngjøring lenker til originalen.
            </>,
            <>
              Vi kontrollerer og strukturerer dataene, men kan ikke garantere at de er fullstendige, oppdaterte eller feilfrie, eller at alle relevante
              kunngjøringer fanges opp.
            </>,
            <>Kunden skal alltid kontrollere frister, krav og dokumenter i originalkilden før Kunden handler.</>,
            <>TED-data: © Den europeiske union. Gjenbrukt i samsvar med EUs regler for gjenbruk av dokumenter.</>,
          ]}
        />
      ),
    },
    {
      id: 'ai',
      title: 'AI-funksjoner',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>
              AI-innhold er merket i Tjenesten og viser så langt mulig hvor i kunngjøringen eller dokumentet opplysningen står. Vi kontrollerer at sitater finnes
              i kilden, men AI-innhold kan likevel være feil eller ufullstendig.
            </>,
            <>Kunden er selv ansvarlig for å kontrollere AI-innhold før det brukes, og for innholdet i tilbud Kunden leverer.</>,
            <>
              AI-behandling skjer hos underleverandøren som står på <a href="/underleverandorer">/underleverandorer</a>, og bare når en Bruker ber om det.
              Kundedata brukes ikke til å trene AI-modeller.
            </>,
            <>Antall AI-analyser følger Planen. Vi kan sette et rimelig kostnadstak per organisasjon for å hindre misbruk.</>,
          ]}
        />
      ),
    },
    {
      id: 'relevans-og-lonnsomhet',
      title: 'Relevans, lønnsomhet og anbefalinger',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>Relevansscoren viser samsvar mellom kunngjøringen og Kundens profil – ikke sjansen for å vinne.</>,
            <>
              Lønnsomhetsberegninger bygger på tallene Kunden selv legger inn og på kunngjøringen og dokumentene. De er ikke en garanti for fortjeneste, og ikke en
              prognose for hvilken pris som vinner eller hva andre leverandører byr.
            </>,
            <>Anbefalinger som «Vurder å by», «Undersøk nærmere» og «Høy risiko» er hjelpemidler. Beslutningen om å gi tilbud, og prisen, er Kundens.</>,
          ]}
        />
      ),
    },
    {
      id: 'partnere',
      title: 'Anbudspartnere',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>Vi formidler kontakt mellom kunder som selv har publisert en partnerprofil. Vi er ikke part i et samarbeid som avtales.</>,
            <>
              Kunden er selv ansvarlig for at et samarbeid er lovlig, blant annet etter konkurranseloven § 10. Bedrifter som hver for seg kan levere, skal som
              hovedregel ikke gi felles tilbud. Del aldri priser, marginer eller tilbudsstrategi med en konkurrent. Veiledningen i Tjenesten er ikke juridisk
              rådgivning.
            </>,
            <>Opplysningene i partnerprofilen skal være riktige. Vi kan skjule profiler som er villedende eller brukes i strid med Vilkårene.</>,
          ]}
        />
      ),
    },
    {
      id: 'kundedata',
      title: 'Kundedata og personopplysninger',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>Kunden eier Kundedata. Kunden gir oss rett til å behandle Kundedata i den grad det er nødvendig for å levere og sikre Tjenesten.</>,
            <>
              Når vi behandler personopplysninger på vegne av Kunden, gjelder <a href="/databehandleravtale">Databehandleravtalen</a>, som Kunden godtar sammen
              med Vilkårene.
            </>,
            <>
              Vår egen behandling av personopplysninger, for eksempel om Brukerne, er beskrevet i <a href="/personvern">Personvernerklæringen</a>.
            </>,
          ]}
        />
      ),
    },
    {
      id: 'rettigheter',
      title: 'Immaterielle rettigheter',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>
              Tjenesten, programvaren, designet og tekstene tilhører Leverandøren eller våre lisensgivere. Kunden får en ikke-eksklusiv rett, som ikke kan
              overdras, til å bruke Tjenesten i avtaleperioden.
            </>,
            <>Tilbakemeldinger og forslag til forbedringer kan vi bruke fritt.</>,
          ]}
        />
      ),
    },
    {
      id: 'konfidensialitet',
      title: 'Konfidensialitet',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>
              Partene skal behandle opplysninger om den andre partens virksomhet som de får gjennom avtalen, konfidensielt. Det gjelder ikke opplysninger som er
              offentlige, eller som må utleveres etter lov eller pålegg fra offentlig myndighet.
            </>,
            <>Taushetsplikten gjelder også etter at avtalen er avsluttet.</>,
          ]}
        />
      ),
    },
    {
      id: 'tilgjengelighet',
      title: 'Tilgjengelighet, vedlikehold og endringer i Tjenesten',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>Vi arbeider for at Tjenesten skal være stabil og tilgjengelig, men gir ingen garanti for oppetid med mindre det er avtalt skriftlig.</>,
            <>Planlagt vedlikehold legges så langt mulig til tider med lite bruk.</>,
            <>
              Vi kan videreutvikle og endre Tjenesten. Vesentlige reduksjoner i funksjonene i en betalt Plan varsles minst 30 dager i forveien, og gir Kunden
              rett til å si opp med virkning fra endringen.
            </>,
          ]}
        />
      ),
    },
    {
      id: 'ansvar',
      title: 'Ansvar og ansvarsbegrensning',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>
              Vi er ikke ansvarlige for tap som skyldes feil eller mangler i Kunngjøringsdata eller AI-innhold, at en frist eller kunngjøring ikke fanges opp, eller
              at Kunden ikke vinner en konkurranse.
            </>,
            <>Vi er ikke ansvarlige for indirekte tap, herunder tapt fortjeneste, tapte kontrakter, tap av data eller krav fra tredjeparter.</>,
            <>Vårt samlede ansvar er begrenset til det Kunden har betalt for Tjenesten de siste 12 månedene før tapet oppsto.</>,
            <>Begrensningene gjelder ikke ved forsett eller grov uaktsomhet, eller der annet følger av ufravikelig lov.</>,
          ]}
        />
      ),
    },
    {
      id: 'force-majeure',
      title: 'Force majeure',
      body: () => (
        <p>
          Ingen av partene er ansvarlige for forhold utenfor deres kontroll som de ikke med rimelighet kunne forutse eller avverge, for eksempel
          naturkatastrofer, krig, omfattende strøm- eller nettverksbrudd, alvorlige dataangrep mot infrastruktur eller pålegg fra myndighetene. Det samme gjelder
          feil hos underleverandører som skyldes slike forhold.
        </p>
      ),
    },
    {
      id: 'suspensjon',
      title: 'Stenging og oppsigelse fra vår side',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>
              Vi kan midlertidig stenge tilgangen helt eller delvis når det er nødvendig for å hindre skade på Tjenesten, andre kunder eller tredjeparter, eller ved
              vesentlig brudd på Vilkårene. Vi varsler Kunden så snart som mulig.
            </>,
            <>Vi kan si opp avtalen med 30 dagers varsel, eller straks ved vesentlig mislighold som ikke er rettet innen en rimelig frist etter varsel.</>,
          ]}
        />
      ),
    },
    {
      id: 'opphor',
      title: 'Når avtalen opphører',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>Kunden kan eksportere data så lenge kontoen finnes.</>,
            <>
              Sletter Kunden organisasjonen, slettes Kundedata fra Tjenesten. Eventuelle kopier i sikkerhetskopier slettes når sikkerhetskopiene roteres, senest innen
              30 dager.
            </>,
            <>Bestemmelser som etter sin art skal gjelde etter opphør, blant annet om konfidensialitet og ansvar, gjelder fortsatt.</>,
          ]}
        />
      ),
    },
    {
      id: 'endringer',
      title: 'Endringer i Vilkårene',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>Vi kan endre Vilkårene. Vesentlige endringer varsles på e-post og i Tjenesten minst 30 dager før de trer i kraft.</>,
            <>Bruker Kunden Tjenesten etter at endringen har trådt i kraft, gjelder de nye Vilkårene. Kunden kan si opp før endringen gjelder.</>,
            <>Hver versjon er datert. Vi lagrer hvilken versjon som ble godtatt, og når.</>,
          ]}
        />
      ),
    },
    {
      id: 'overdragelse',
      title: 'Overdragelse',
      body: () => (
        <p>
          Kunden kan ikke overdra avtalen uten vårt samtykke. Vi kan overdra avtalen til et selskap som overtar Tjenesten, eller i forbindelse med en
          omorganisering, med varsel til Kunden.
        </p>
      ),
    },
    {
      id: 'lovvalg',
      title: 'Lovvalg og tvister',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>Avtalen reguleres av norsk rett.</>,
            <>
              Partene skal først forsøke å løse tvister ved forhandlinger. Fører ikke forhandlingene frem, avgjøres tvisten av de alminnelige domstolene, med
              Leverandørens hjemting som verneting.
            </>,
          ]}
        />
      ),
    },
    {
      id: 'kontakt',
      title: 'Kontakt',
      body: () => (
        <p>
          <CompanyLine c={c} />.
        </p>
      ),
    },
  ];
  return (
    <LegalDocument
      title="Vilkår for bruk"
      lead={<p>Abonnementsvilkår for AnbudRadar. De gjelder fra Kunden oppretter konto, og sammen med Databehandleravtalen og Personvernerklæringen.</p>}
      sections={sections}
    />
  );
}

// ===========================================================================
// Personvernerklæring
// ===========================================================================
export function PrivacyPage() {
  const c = companyInfo();
  const subs = subprocessors();
  const sections: Section[] = [
    {
      id: 'hvem-vi-er',
      title: 'Hvem som er ansvarlig',
      body: () => (
        <>
          <p>
            Behandlingsansvarlig er <CompanyLine c={c} />.
          </p>
          <p>Vi har ikke personvernombud. Spørsmål om personvern sender du til e-postadressen over.</p>
        </>
      ),
    },
    {
      id: 'hvem-gjelder',
      title: 'Hvem erklæringen gjelder for',
      body: () => (
        <Bullets
          items={[
            'Brukere av AnbudRadar og personer som er invitert til en organisasjon.',
            'Kontaktpersoner hos kunder og hos bedrifter som bruker partnerfunksjonen.',
            'Personer som sender oss en henvendelse eller besøker nettsiden.',
            'Personer som er nevnt i offentlige kunngjøringer vi viser (for eksempel kontaktpersoner hos oppdragsgivere).',
          ]}
        />
      ),
    },
    {
      id: 'roller',
      title: 'Behandlingsansvarlig eller databehandler',
      body: () => (
        <>
          <p>
            Vi er behandlingsansvarlige for opplysninger om brukere og kontoer, for sikkerhet og for fakturering. For innhold kundene selv legger inn – for eksempel
            dokumenter, tilbudstekster og notater som kan inneholde personopplysninger – er kunden behandlingsansvarlig og vi databehandler. Det er regulert i{' '}
            <a href="/databehandleravtale">Databehandleravtalen</a>.
          </p>
        </>
      ),
    },
    {
      id: 'opplysninger',
      title: 'Hvilke opplysninger vi behandler',
      body: () => (
        <Table
          head={['Kategori', 'Eksempler', 'Kilde']}
          rows={[
            ['Kontoopplysninger', 'Navn, e-postadresse og passord (lagret som en sikker hash, aldri i klartekst)', 'Deg'],
            ['Organisasjon og roller', 'Firmanavn, organisasjonsnummer, hvem som er medlem og med hvilken rolle, invitasjoner', 'Deg eller en kollega'],
            ['Bedriftsprofil og innstillinger', 'Bransje, tjenester, område, kvalifikasjoner, varselinnstillinger', 'Kunden'],
            [
              'Innhold kunden legger inn',
              'Lagrede anbud, notater, dokumenter, tilbudsarbeid, kalkyler og kapasitet (bemanning registreres som roller og antall – ikke navn)',
              'Kunden',
            ],
            ['Partnerfunksjonen', 'Partnerprofil og navn og e-post til kontaktpersonen i forespørsler', 'Kunden'],
            ['Kommunikasjon', 'Henvendelser via kontaktskjemaet, logg over e-post vi har sendt', 'Deg og oss'],
            ['Teknisk informasjon', 'Innloggingsøkter, nettlesertype, pseudonymisert IP-adresse (enveis-kryptert), revisjonslogg', 'Bruken av tjenesten'],
            ['Betaling', 'Kunde- og abonnementsreferanser. Kortopplysninger håndteres bare av Stripe.', 'Stripe'],
            ['Offentlige kunngjøringer', 'Navn og kontaktopplysninger som oppdragsgivere har publisert, navn på leverandører som har vunnet kontrakter', 'Doffin og TED'],
          ]}
        />
      ),
    },
    {
      id: 'formal',
      title: 'Formål og rettslig grunnlag',
      body: () => (
        <Table
          head={['Formål', 'Rettslig grunnlag (personvernforordningen)']}
          rows={[
            ['Levere tjenesten: konto, innlogging, søk, varsler, analyser og tilbudsarbeid', 'Avtalen med kunden (art. 6 nr. 1 b) og berettiget interesse i å gi brukerne hos kunden tilgang (art. 6 nr. 1 f)'],
            ['E-post om tjenesten: bekreftelser, varsler og ukesoversikt (kan slås av under Varsler)', 'Avtalen (art. 6 nr. 1 b)'],
            ['Sikkerhet, misbrukskontroll og revisjonslogg', 'Berettiget interesse (art. 6 nr. 1 f)'],
            ['Fakturering og bokføring', 'Rettslig forpliktelse (art. 6 nr. 1 c), bokføringsloven'],
            ['Svare på henvendelser', 'Berettiget interesse (art. 6 nr. 1 f)'],
            ['Publisere partnerprofil', 'Samtykke (art. 6 nr. 1 a). Kan trekkes tilbake når som helst ved å skjule profilen.'],
            ['Ukesbrevet «Ukens anbud» til de som har meldt seg på uten konto', 'Samtykke (art. 6 nr. 1 a), gitt ved påmelding og bekreftet med lenke i e-post. Trekkes tilbake med avmeldingslenken i hver e-post.'],
            ['Vise offentlige kunngjøringer', 'Berettiget interesse i å gjøre offentlig publiserte kunngjøringer tilgjengelige (art. 6 nr. 1 f)'],
          ]}
        />
      ),
    },
    {
      id: 'markedsforing',
      title: 'Markedsføring',
      body: () => (
        <p>
          Vi sender ikke markedsføring på e-post uten samtykke. Ukesbrevet «Ukens anbud» får bare de som har meldt seg på og bekreftet adressen sin via en
          lenke i e-post. Hver utsending har en avmeldingslenke, og når du melder deg av, sletter vi adressen. Ellers gjelder e-postene vi sender, tjenesten
          du bruker.
        </p>
      ),
    },
    {
      id: 'kunngjoringer',
      title: 'Opplysninger i offentlige kunngjøringer',
      body: () => (
        <p>
          Kunngjøringene hentes fra Doffin og TED og kan inneholde navn på kontaktpersoner hos oppdragsgiver eller på leverandører som har vunnet kontrakter. Vi viser
          bare det som allerede er publisert, og lenker til kilden. Ønsker du at noe rettes eller fjernes, kontakt oss – og gjerne også kilden.
        </p>
      ),
    },
    {
      id: 'ai',
      title: 'AI-behandling',
      body: () => (
        <p>
          Når en bruker ber om en AI-analyse, sendes kunngjøringsteksten og eventuelle dokumenter kunden har lastet opp til AI-leverandøren. Ved egnethetsvurdering og
          tekstutkast sendes også utdrag fra bedriftsprofilen. Lønnsomhetsanalysen sender bare kunngjøringen og dokumentene – ikke kostnader, marginer eller
          bemanning; regnestykket gjøres hos oss. Dataene brukes ikke til å trene AI-modeller. AI-innhold er merket i tjenesten.
        </p>
      ),
    },
    {
      id: 'mottakere',
      title: 'Mottakere og underleverandører',
      body: () => (
        <>
          <p>
            Vi selger aldri personopplysninger. Vi bruker disse underleverandørene (databehandlere) for å levere tjenesten. Full oversikt med formål, lokasjon og
            overføringsgrunnlag står på <a href="/underleverandorer">/underleverandorer</a>.
          </p>
          <Bullets items={subs.map((s) => `${s.name} – ${s.purpose.toLowerCase()}${s.planned ? ' (ikke tatt i bruk ennå)' : ''}`)} />
          {contactIsGmail(c) ? <p>E-post du sender til kontaktadressen vår, mottas og lagres hos Google (Gmail), også utenfor EU/EØS.</p> : null}
          <p>Vi kan også utlevere opplysninger når loven krever det, for eksempel etter pålegg fra offentlig myndighet.</p>
        </>
      ),
    },
    {
      id: 'overforing',
      title: 'Overføring utenfor EU/EØS',
      body: () => (
        <p>
          Databasen og nettsiden driftes i EU. Noen leverandører er amerikanske eller behandler data i USA (se <a href="/underleverandorer">/underleverandorer</a>).
          Slike overføringer skjer bare med gyldig grunnlag etter personvernforordningen kapittel V, normalt EUs standardavtaler (SCC) eller EU–US Data Privacy
          Framework.
        </p>
      ),
    },
    {
      id: 'lagringstid',
      title: 'Hvor lenge vi lagrer opplysningene',
      body: () => (
        <>
          <Table head={['Opplysninger', 'Lagringstid']} rows={RETENTION.map((r) => [r.what, r.how])} />
          <p>Slettingen kjøres automatisk én gang i døgnet.</p>
        </>
      ),
    },
    {
      id: 'sikkerhet',
      title: 'Sikkerhet',
      body: () => (
        <p>
          Opplysningene beskyttes blant annet med kryptert forbindelse, sikker lagring av passord og streng atskillelse mellom kundene i databasen. Se{' '}
          <a href="/sikkerhet">/sikkerhet</a>.
        </p>
      ),
    },
    {
      id: 'kapsler',
      title: 'Informasjonskapsler',
      body: () => (
        <p>
          Vi bruker bare nødvendige informasjonskapsler – ingen sporing eller reklame. Se <a href="/informasjonskapsler">/informasjonskapsler</a>.
        </p>
      ),
    },
    {
      id: 'automatiserte',
      title: 'Automatiserte avgjørelser',
      body: () => (
        <p>
          Tjenesten rangerer anbud mot bedriftsprofilen og kan gi anbefalinger. Dette er hjelpemidler for kunden og ikke avgjørelser som har rettsvirkning for deg
          (personvernforordningen art. 22).
        </p>
      ),
    },
    {
      id: 'rettigheter',
      title: 'Dine rettigheter',
      body: () => (
        <>
          <Bullets
            items={[
              'Innsyn i opplysningene vi har om deg.',
              'Retting av opplysninger som er feil.',
              'Sletting, når opplysningene ikke lenger trengs eller behandlingen er ulovlig.',
              'Begrensning av behandlingen i visse tilfeller.',
              'Dataportabilitet: å få opplysningene utlevert i et maskinlesbart format.',
              'Å protestere mot behandling som bygger på berettiget interesse.',
              'Å trekke tilbake samtykke når som helst.',
            ]}
          />
          <p>
            Eksport og sletting kan du gjøre selv under Innstillinger i appen. Ellers kan du skrive til <Email c={c} />. Vi svarer innen
            én måned og kan be deg bekrefte hvem du er. Gjelder det innhold en kunde har lagt inn, sender vi forespørselen videre til kunden.
          </p>
        </>
      ),
    },
    {
      id: 'klage',
      title: 'Klage',
      body: () => (
        <p>
          Mener du at vi behandler personopplysninger i strid med regelverket, kan du klage til Datatilsynet (<a href="https://www.datatilsynet.no">datatilsynet.no</a>).
          Vi setter pris på om du tar kontakt med oss først.
        </p>
      ),
    },
    {
      id: 'endringer',
      title: 'Endringer i erklæringen',
      body: () => <p>Vi oppdaterer erklæringen når tjenesten endres. Vesentlige endringer varsles på e-post og i tjenesten. Versjonsdatoen står øverst.</p>,
    },
  ];
  return (
    <LegalDocument
      title="Personvernerklæring"
      lead={<p>Her forklarer vi hvilke personopplysninger AnbudRadar behandler, hvorfor, hvor lenge, og hvilke rettigheter du har.</p>}
      sections={sections}
    />
  );
}

// ===========================================================================
// Databehandleravtale
// ===========================================================================
export function DpaPage() {
  const c = companyInfo();
  const subs = subprocessors();
  const sections: Section[] = [
    {
      id: 'parter',
      title: 'Parter og bakgrunn',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>
              Avtalen gjelder mellom Kunden (behandlingsansvarlig) og <CompanyLine c={c} /> (databehandler), og regulerer behandlingen av personopplysninger vi utfører
              på vegne av Kunden når vi leverer AnbudRadar.
            </>,
            <>
              Avtalen er inngått når Kunden godtar <a href="/vilkar">Vilkårene</a>, og oppfyller kravene i personvernforordningen artikkel 28. Ved motstrid gjelder
              denne avtalen foran Vilkårene for behandling av personopplysninger.
            </>,
          ]}
        />
      ),
    },
    {
      id: 'instruks',
      title: 'Formål og instruks',
      body: (n) => (
        <Clauses
          n={n}
          items={[
            <>Vi behandler personopplysninger bare for å levere Tjenesten etter Vilkårene og etter Kundens dokumenterte instrukser.</>,
            <>Kundens bruk og innstillinger i Tjenesten regnes som instruks. Andre instrukser gis skriftlig.</>,
            <>Mener vi at en instruks er i strid med personvernregelverket, varsler vi Kunden.</>,
          ]}
        />
      ),
    },
    {
      id: 'behandlingen',
      title: 'Behandlingen (bilag A)',
      body: () => (
        <Table
          head={['', '']}
          rows={[
            ['Formål', 'Lagre og vise Kundens innhold, gjennomføre AI-analyser Kunden ber om, sende varsler og levere Tjenestens øvrige funksjoner.'],
            ['Art', 'Lagring, strukturering, søk, visning, overføring til underdatabehandlere, eksport og sletting.'],
            [
              'Registrerte',
              'Brukere hos Kunden, kontaktpersoner Kunden registrerer (for eksempel i partnerforespørsler), og personer som er nevnt i dokumenter og tekster Kunden laster opp eller skriver (for eksempel CV-er og referanser i tilbud).',
            ],
            [
              'Opplysninger',
              'Navn, kontaktopplysninger, rolle og stilling, og annet innhold i dokumenter og tekster. Tjenesten er ikke beregnet for særlige kategorier (art. 9) eller opplysninger om straffedommer (art. 10). Kunden skal ikke legge inn slike uten at det er nødvendig og lovlig.',
            ],
            ['Varighet', 'Så lenge Kunden bruker Tjenesten, og til opplysningene er slettet etter punktet om sletting.'],
          ]}
        />
      ),
    },
    {
      id: 'taushet',
      title: 'Taushetsplikt',
      body: () => <p>Alle som har tilgang til personopplysningene hos oss, har taushetsplikt.</p>,
    },
    {
      id: 'sikkerhet',
      title: 'Sikkerhet (bilag C)',
      body: () => (
        <p>
          Vi gjennomfører tekniske og organisatoriske tiltak etter personvernforordningen artikkel 32. Tiltakene er beskrevet på <a href="/sikkerhet">/sikkerhet</a>, blant
          annet kryptert forbindelse, sikker lagring av passord, atskillelse mellom kundene i databasen, tilgangsstyring og revisjonslogg.
        </p>
      ),
    },
    {
      id: 'underdatabehandlere',
      title: 'Underdatabehandlere (bilag B)',
      body: (n) => (
        <>
          <Clauses
            n={n}
            items={[
              <>Kunden gir generell forhåndsgodkjenning til å bruke underdatabehandlerne på listen under og på <a href="/underleverandorer">/underleverandorer</a>.</>,
              <>
                Vi varsler Kunden minst 30 dager før vi tar i bruk eller bytter en underdatabehandler. Kunden kan protestere, og kan si opp avtalen med virkning før
                endringen dersom vi ikke kommer til enighet.
              </>,
              <>Underdatabehandlerne har tilsvarende plikter som oss. Vi er ansvarlige overfor Kunden for deres behandling.</>,
            ]}
          />
          <Table head={['Underdatabehandler', 'Formål', 'Lokasjon']} rows={subs.map((s) => [s.planned ? `${s.name} (ikke tatt i bruk ennå)` : s.name, s.purpose, s.location])} />
        </>
      ),
    },
    {
      id: 'overforing',
      title: 'Overføring utenfor EU/EØS',
      body: () => <p>Personopplysninger overføres bare til land utenfor EU/EØS med gyldig grunnlag etter personvernforordningen kapittel V, normalt EUs standardavtaler (SCC).</p>,
    },
    {
      id: 'bistand',
      title: 'Bistand til Kunden',
      body: () => (
        <p>
          Vi hjelper Kunden med å oppfylle de registrertes rettigheter (art. 12–22) og pliktene etter art. 32–36, blant annet med eksport og sletting i Tjenesten.
          Bistand ut over funksjonene i Tjenesten kan faktureres etter medgått tid.
        </p>
      ),
    },
    {
      id: 'avvik',
      title: 'Brudd på personopplysningssikkerheten',
      body: () => (
        <p>
          Vi varsler Kunden uten ugrunnet opphold, og senest innen 48 timer etter at vi ble kjent med et brudd som berører Kundens personopplysninger. Varselet
          beskriver så langt mulig hva som har skjedd, hvilke opplysninger og registrerte som er berørt, sannsynlige konsekvenser og tiltakene vi har satt i verk.
        </p>
      ),
    },
    {
      id: 'revisjon',
      title: 'Dokumentasjon og revisjon',
      body: () => (
        <p>
          Vi gir Kunden informasjonen som trengs for å vise at avtalen følges. Kunden kan gjennomføre revisjon, selv eller med en uavhengig revisor med taushetsplikt,
          med rimelig varsel og normalt høyst én gang i året, med mindre det har skjedd et brudd. Kunden dekker egne kostnader.
        </p>
      ),
    },
    {
      id: 'sletting',
      title: 'Varighet, sletting og tilbakelevering',
      body: () => (
        <p>
          Avtalen gjelder så lenge vi behandler personopplysninger for Kunden. Kunden kan eksportere data når som helst. Sletter Kunden organisasjonen, slettes
          opplysningene straks fra Tjenesten, og fra eventuelle sikkerhetskopier senest innen 30 dager, med mindre lov krever lagring.
        </p>
      ),
    },
    {
      id: 'ansvar',
      title: 'Ansvar',
      body: () => (
        <p>Ansvar overfor de registrerte følger av personvernforordningen artikkel 82. Mellom partene gjelder ellers ansvarsbestemmelsene i Vilkårene, så langt loven tillater det.</p>
      ),
    },
    {
      id: 'lovvalg',
      title: 'Lovvalg og verneting',
      body: () => <p>Avtalen reguleres av norsk rett. Verneting er det samme som i Vilkårene.</p>,
    },
  ];
  return (
    <LegalDocument
      title="Databehandleravtale"
      lead={<p>Avtale etter personvernforordningen artikkel 28 om personopplysninger vi behandler på vegne av kundene. Den inngås sammen med Vilkårene.</p>}
      sections={sections}
    />
  );
}

// ===========================================================================
// Underleverandører
// ===========================================================================
export function SubprocessorsPage() {
  const subs = subprocessors();
  const sections: Section[] = [
    {
      id: 'liste',
      title: 'Underleverandører som behandler personopplysninger',
      body: () => (
        <Table
          head={['Leverandør', 'Formål', 'Opplysninger', 'Lokasjon', 'Overføringsgrunnlag']}
          rows={subs.map((s) => [
            <>
              <strong>{s.name}</strong>
              {s.planned ? (
                <span className="mt-1 block">
                  <Badge tone="outline">Ikke tatt i bruk ennå</Badge>
                </span>
              ) : null}
            </>,
            s.purpose,
            s.data,
            s.location,
            s.transfer,
          ])}
        />
      ),
    },
    {
      id: 'kilder',
      title: 'Offentlige datakilder',
      body: () => (
        <p>
          Kunngjøringene hentes fra Doffin (DFØ) og TED (EUs publikasjonskontor). Dette er offentlige kilder vi henter fra – ikke leverandører som behandler data
          på våre vegne.
        </p>
      ),
    },
    {
      id: 'endringer',
      title: 'Endringer',
      body: () => (
        <p>
          Vi varsler kundene minst 30 dager før vi tar i bruk eller bytter en underleverandør, slik <a href="/databehandleravtale">Databehandleravtalen</a> beskriver.
          Listen viser bare leverandører som er satt opp; de som ikke er tatt i bruk ennå, er merket.
        </p>
      ),
    },
  ];
  return <LegalDocument title="Underleverandører" lead={<p>Leverandørene som hjelper oss å levere AnbudRadar, og hva de gjør.</p>} sections={sections} />;
}

// ===========================================================================
// Informasjonskapsler
// ===========================================================================
export function CookiesPage() {
  const sections: Section[] = [
    {
      id: 'hvilke',
      title: 'Informasjonskapslene vi bruker',
      body: () => <Table head={['Navn', 'Formål', 'Varighet']} rows={cookies().map((k) => [<code key={k.name}>{k.name}</code>, k.purpose, k.duration])} />,
    },
    {
      id: 'ingen-sporing',
      title: 'Ingen sporing eller reklame',
      body: () => (
        <p>
          Vi bruker ikke analyseverktøy fra andre, sporing, reklame eller informasjonskapsler fra tredjeparter. Skrifttypene ligger hos oss, så nettleseren din
          kontakter ikke andre tjenester når du besøker sidene. Vi teller besøk på de offentlige sidene selv, uten informasjonskapsler: bare dato, side og hvilken
          nettside besøket kom fra (domenet, for eksempel google.com). Vi lagrer ikke IP-adresse eller annen informasjon om deg, så tellingen kan ikke knyttes
          til deg. Innloggede brukere telles ikke.
        </p>
      ),
    },
    {
      id: 'samtykke',
      title: 'Hvorfor vi ikke spør om samtykke',
      body: () => (
        <p>
          Alle kapslene er strengt nødvendige for å levere tjenesten du ber om (innlogging og sikkerhet). Slike kapsler krever ikke samtykke etter
          ekomloven § 3-15. Tar vi i bruk andre kapsler, spør vi om samtykke først.
        </p>
      ),
    },
    {
      id: 'blokkere',
      title: 'Slik blokkerer du informasjonskapsler',
      body: () => <p>Du kan blokkere eller slette informasjonskapsler i nettleseren. Da kan du ikke logge inn.</p>,
    },
  ];
  return <LegalDocument title="Informasjonskapsler" lead={<p>Vi bruker så få informasjonskapsler som mulig – bare de som trengs for at du skal kunne logge inn trygt.</p>} sections={sections} />;
}

// ===========================================================================
// Sikkerhet
// ===========================================================================
export function SecurityPage() {
  const c = companyInfo();
  const sections: Section[] = [
    {
      id: 'kryptering',
      title: 'Kryptert forbindelse',
      body: () => (
        <p>
          All trafikk går over HTTPS. Nettleseren instrueres til alltid å bruke kryptert forbindelse (HSTS). Forbindelsen mellom appen og databasen er også
          kryptert.
        </p>
      ),
    },
    {
      id: 'isolasjon',
      title: 'Atskillelse mellom kundene',
      body: () => (
        <p>
          Hver organisasjons data er skilt fra andres i selve databasen (radnivåsikkerhet). Appen kobler til med en egen bruker som bare ser dataene til
          organisasjonen den jobber for – så en feil i appen gir ikke tilgang til andre kunders data. Dette testes automatisk.
        </p>
      ),
    },
    {
      id: 'innlogging',
      title: 'Innlogging og passord',
      body: () => (
        <Bullets
          items={[
            'Passord lagres med scrypt og unik salt – aldri i klartekst.',
            'Innloggingsforsøk begrenses per IP-adresse og per konto, og kontoen låses midlertidig etter gjentatte feil.',
            'Totrinnsinnlogging med kode-app kan slås på under Innstillinger, og er påkrevd for AnbudRadars egne administratorer. Hemmeligheten lagres kryptert, og reservekodene bare som hash.',
            'I stedet for koden kan du bruke en passkey: Face ID, fingeravtrykk, Windows Hello eller en sikkerhetsnøkkel. Den virker bare på vår adresse, så en falsk innloggingsside kan ikke bruke den. Vi lagrer bare den offentlige nøkkelen.',
            'Etter mange feil koder settes innlogging med kode på pause for kontoen, og du får beskjed på e-post. Du får også e-post når totrinn eller en passkey legges til eller fjernes, med en lenke som logger ut alle enheter.',
            'Administratorer må bekrefte på nytt hver 12. time og før viktige endringer, og får e-post ved hver innlogging.',
            'Økter utløper etter 30 dager uten bruk, og du kan logge ut alle andre økter under Innstillinger.',
            'Eiere og administratorer styrer hvem i organisasjonen som har tilgang, og med hvilken rolle.',
          ]}
        />
      ),
    },
    {
      id: 'nettleser',
      title: 'Beskyttelse i nettleseren',
      body: () => (
        <Bullets
          items={[
            'Informasjonskapsler er satt som HttpOnly, Secure og SameSite.',
            'Alle skjemaer er beskyttet mot falske innsendinger (CSRF).',
            'Streng innholdssikkerhetspolicy (CSP), og siden kan ikke bygges inn i andre nettsider.',
          ]}
        />
      ),
    },
    {
      id: 'personvern',
      title: 'Personvern i logger',
      body: () => (
        <p>
          IP-adresser lagres bare enveis-kryptert (pseudonymisert). Viktige handlinger, som endring av roller, betaling og sletting, revisjonslogges og slettes etter 12
          måneder.
        </p>
      ),
    },
    {
      id: 'drift',
      title: 'Drift og utvikling',
      body: () => (
        <Bullets
          items={[
            <>
              Nettsiden og databasen driftes hos leverandører i EU (se <a href="/underleverandorer">/underleverandorer</a>).
            </>,
            'Tjenesten har automatiske tester, blant annet for at én kunde ikke kan se en annen kundes data.',
            'Avhengighetene sjekkes for kjente sårbarheter i den automatiske testkjøringen.',
            'Opplastede dokumenter er bare tilgjengelige for organisasjonen som lastet dem opp.',
          ]}
        />
      ),
    },
    {
      id: 'sarbarhet',
      title: 'Meld fra om sårbarheter',
      body: () => (
        <p>
          Har du funnet en sårbarhet, send en e-post til <Email c={c} />. Ikke test på andres data, og gi oss rimelig tid til å rette feilen før du omtaler den.
          {!isPlaceholder(c.email) ? (
            <>
              {' '}
              Kontaktinformasjonen står også i <a href="/.well-known/security.txt">security.txt</a>.
            </>
          ) : null}
        </p>
      ),
    },
  ];
  return <LegalDocument title="Sikkerhet" lead={<p>Slik beskytter vi dataene i AnbudRadar. Vi beskriver bare tiltak som faktisk er på plass.</p>} sections={sections} />;
}
