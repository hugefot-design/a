# Juridisk pakke – notat til advokat

**Status:** utkast, versjon `2026-11-03`. Tekstene er skrevet ut fra hva appen faktisk gjør, men er **ikke juridisk
gjennomgått**. Til det er gjort, viser hver side et tydelig utkastbanner (`LEGAL_PAGES_REVIEWED=false`).

Notatet er skrevet for advokaten som skal kvalitetssikre tekstene: hva som finnes, hvordan avtalen inngås og
dokumenteres, hvilke valg som er tatt i utkastet, og hva som må bekreftes før lansering.

## 1. Dokumentene

| Dokument | Adresse | Innhold |
|---|---|---|
| Vilkår for bruk | `/vilkar` | 24 punkter: parter, definisjoner, tjenesten, konto, prøveperiode og planer, priser og betaling, oppsigelse, akseptabel bruk, kunngjøringsdata, AI, relevans og lønnsomhet, anbudspartnere, kundedata, immaterielle rettigheter, konfidensialitet, tilgjengelighet, ansvar, force majeure, stenging, opphør, endringer, overdragelse, lovvalg og verneting, kontakt |
| Personvernerklæring | `/personvern` | 17 punkter: behandlingsansvarlig, hvem den gjelder, roller (ansvarlig/databehandler), opplysningskategorier, formål og rettslig grunnlag, markedsføring, kunngjøringsdata, AI, mottakere, overføring ut av EØS, lagringstider, sikkerhet, informasjonskapsler, automatiserte avgjørelser, rettigheter, klage, endringer |
| Databehandleravtale | `/databehandleravtale` | Etter personvernforordningen art. 28, med bilag A (behandlingen), B (underdatabehandlere) og C (sikkerhet) |
| Underleverandører | `/underleverandorer` | Leverandør, formål, opplysninger, lokasjon og overføringsgrunnlag. Lages fra det faktiske oppsettet; leverandører som ikke er tatt i bruk ennå, er merket |
| Informasjonskapsler | `/informasjonskapsler` | De tre kapslene appen setter, formål og varighet |
| Sikkerhet | `/sikkerhet` og `/.well-known/security.txt` | Tiltakene som faktisk er på plass, og hvor sårbarheter meldes |

Alle sidene har versjon og dato, innholdsfortegnelse og nummererte punkter (3.1, 3.2 …), og kan skrives ut. Bunnteksten
på de offentlige sidene lenker til alle dokumentene, og registreringsskjemaet lenker til vilkårene,
databehandleravtalen og personvernerklæringen.

**I koden:** fakta som går igjen (versjon, underleverandører, informasjonskapsler, lagringstider, firmaopplysninger)
står ett sted, i `src/domain/legal/legal.ts`. Tekstene står i `src/ui/pages/legal.tsx`. Testen
`tests/unit/legal.test.ts` feiler hvis appen får en ny informasjonskapsel eller nye slettefrister uten at tekstene
oppdateres.

## 2. Slik inngås og dokumenteres avtalen

- Ved registrering må brukeren krysse av for: *«Jeg godtar vilkårene og databehandleravtalen på vegne av virksomheten,
  og har lest personvernerklæringen.»* Alle tre er lenker. Uten avkrysning opprettes ingen konto (testet).
- Hvilken versjon som ble godtatt, og når, lagres på brukeren (`users.terms_version`, `users.terms_accepted_at`) og i
  revisjonsloggen. Appen har bare lov til å skrive feltene når kontoen opprettes – ikke endre dem senere (testet).
  Feltene er med i brukerens dataeksport.
- Revisjonsloggen slettes etter 12 måneder; feltene på brukeren beholdes så lenge kontoen finnes.
- Kontoer opprettet før 3. november 2026 har ikke lagret versjon (de krysset av for daværende vilkår). Det gjelder
  kontoer fra testperioden.
- **Endringer:** utkastet bygger på varsel minst 30 dager i forveien og fortsatt bruk (vilkårene pkt. 21). Det finnes
  ingen funksjon for å be eksisterende kunder godta en ny versjon aktivt. Se spørsmål 3.1.

## 3. Valg i utkastet advokaten bør ta stilling til

| # | Tema | Utkastet | Spørsmål |
|---|---|---|---|
| 3.1 | Endring av vilkår | Varsel 30 dager før, fortsatt bruk = aksept, rett til å si opp | Holder det, eller bør vesentlige endringer godtas aktivt (krever en ny funksjon)? |
| 3.2 | Bare næringsdrivende | Pkt. 1.2 og 1.4: ingen angrerett eller forbrukerregler | Registreringen sjekker ikke at kunden er en virksomhet (org.nr. er frivillig). Holder avkrysningen «på vegne av virksomheten»? |
| 3.3 | Ansvarsbegrensning | Ikke indirekte tap; samlet ansvar maks det kunden har betalt siste 12 måneder; ikke ved forsett/grov uaktsomhet | I prøveperioden og på gratisnivået er taket 0 kr. Er det rimelig og håndhevbart? |
| 3.4 | Data fra Doffin/TED og AI | Ikke ansvar for feil i kunngjøringsdata, AI-innhold eller frister som ikke fanges opp | Er dette tydelig nok, sett opp mot at tjenesten markedsføres som et hjelpemiddel for frister og krav? |
| 3.5 | Betaling | Månedlig forskudd, automatisk fornyelse, ingen refusjon ved oppsigelse, prisendring varsles 30 dager før | OK for B2B? |
| 3.6 | Verneting | Norsk rett, leverandørens hjemting | OK? |
| 3.7 | Varsling av brudd | Til kunden uten ugrunnet opphold og senest innen 48 timer | Forordningen krever «uten ugrunnet opphold» (art. 33 nr. 2). Er 48 timer riktig nivå? |
| 3.8 | Underdatabehandlere | Generell forhåndsgodkjenning; varsel 30 dager før endring; kunden kan protestere og si opp | OK? |
| 3.9 | Revisjon | Høyst én gang i året (unntatt etter brudd), kunden dekker egne kostnader | OK? |
| 3.10 | Sletting | Straks fra tjenesten, fra sikkerhetskopier innen 30 dager | Se 4.6 om sikkerhetskopier. |
| 3.11 | Partnerprofil | Publisering bygger på samtykke (art. 6 nr. 1 a) og kan trekkes ved å skjule profilen | Er samtykke riktig grunnlag for en bedriftsprofil med kontaktperson, eller heller berettiget interesse? |
| 3.12 | Personer i kunngjøringer | Kontaktpersoner hos oppdragsgiver vises fordi de er publisert; grunnlag berettiget interesse | Informasjonsplikten etter art. 14 – holder unntaket i art. 14 nr. 5 b? |
| 3.13 | Konkurranserett | Pkt. 12.2 og veiledning i appen om konkurranseloven § 10 for samarbeid om anbud | Er veiledningen riktig og tilstrekkelig? |
| 3.14 | Bistand | Bistand ut over funksjonene i tjenesten kan faktureres etter medgått tid | OK? |
| 3.15 | Lagring i nettleseren (8.11.2026) | Valgt lys/mørk modus lagres i localStorage («ar-tema») bare når brukeren selv velger; administratorer får i tillegg informasjonskapselen `__Host-ar_enhet` (kjenner igjen enheten for innloggingsvarsel, 365 dager). Begge er beskrevet på `/informasjonskapsler` og behandlet som unntatt fra samtykke | Holder unntaket i ekomloven § 3-15 for et lagret utseendevalg og en sikkerhetskapsel med denne varigheten? |

## 4. Fakta som må bekreftes (ikke verifisert av oss)

| # | Hva | Status |
|---|---|---|
| 4.1 | Databehandleravtale (DPA) inngått/akseptert med Render, Supabase, Resend, Stripe og AI-leverandøren | **IKKE VERIFISERT.** Må gjøres i hver leverandørs kontrollpanel eller vilkår. |
| 4.2 | Overføringsgrunnlag (SCC, eventuelt EU–US Data Privacy Framework) for hver leverandør, slik `/underleverandorer` beskriver | **IKKE VERIFISERT.** Teksten bygger på leverandørenes vanlige oppsett. Sjekk mot gjeldende DPA. |
| 4.3 | Lokasjon: Render i Frankfurt og Supabase i Irland | Verifisert i oppsettet (region valgt ved opprettelse). |
| 4.4 | AI-leverandøren bruker ikke API-data til trening, og hvor lenge den lagrer dem | **IKKE VERIFISERT** mot gjeldende vilkår. AI er ikke slått på ennå. |
| 4.5 | Resend: domenet `anbudradar.com` er bekreftet med EU-region (Irland), og e-post sendes fra `varsler@anbudradar.com`. Selskapet er amerikansk, og opplysninger kan også behandles i USA | Verifisert 3.11.2026. `/underleverandorer` viser dette. Overføringsgrunnlaget (SCC) må fortsatt bekreftes (4.2). |
| 4.6 | Sikkerhetskopier: Supabase Free har ingen automatiske sikkerhetskopier; betalt plan har daglige | Teksten (sletting fra kopier innen 30 dager) stemmer begge veier, men **uten betalt plan finnes ingen kopier å gjenopprette fra.** |
| 4.7 | Stripe er selvstendig behandlingsansvarlig for blant annet svindelforebygging | Bekreft mot Stripes gjeldende vilkår. Stripe er ikke tatt i bruk ennå. |
| 4.8 | Opplastede dokumenter ligger nå på serverdisken hos Render, som tømmes ved ny versjon | Teknisk forbehold, ikke juridisk – men det betyr at dokumenter kan forsvinne. Flytt til Supabase Storage (`STORAGE_DRIVER=supabase`) før kunder. |
| 4.9 | Vilkårene for Doffins API og gjenbruk av TED-data tillater kommersiell visning slik tjenesten gjør | **IKKE VERIFISERT.** TED: EUs gjenbruksregler (kildeangivelse står i vilkårene og bunnteksten). Doffin: sjekk vilkårene i DFØs API-portal. |
| 4.10 | Kontaktadressen er en gratis Gmail-konto (`anbudradar@gmail.com`). Gratis Gmail har ingen databehandleravtale; Google behandler e-posten etter egne vilkår, også utenfor EØS. Personvernerklæringen sier fra om dette | **Anbefaling:** Google Workspace (med databehandleravtale) eller e-post på eget domene før dere tar inn kunder, siden kunder og andre sender personopplysninger til adressen. |

## 5. Regelverk å sjekke tekstene mot

- **Personvernforordningen / personopplysningsloven:** art. 13–14 (informasjon), 28 (databehandleravtale), 30
  (protokoll – se punkt 6), 32 (sikkerhet), 33–34 (brudd), kapittel V (overføring).
- **Ekomloven § 3-15** (informasjonskapsler): bekreft henvisningen etter at den nye ekomloven trådte i kraft. Appen
  bruker bare nødvendige kapsler og ber derfor ikke om samtykke.
- **E-handelsloven § 8:** firmanavn, adresse, e-post og organisasjonsnummer skal være lett tilgjengelig. Vises i
  bunnteksten på alle sider så snart `COMPANY_*` er fylt inn (før det vises ikke plassholdere som ekte opplysninger).
- **Markedsføringsloven § 15:** e-postmarkedsføring til fysiske personer. Appen sender ikke markedsføring, bare e-post
  om tjenesten.
- **Bokføringsloven:** oppbevaring av regnskapsmateriale (fakturaer ligger i Stripe).
- **Konkurranseloven § 10:** partnerfunksjonen.
- **Avtaleloven § 36:** urimelige vilkår (begrenset i B2B, men relevant for ansvarsbegrensningen).
- **KI-forordningen (EU) 2024/1689 art. 50** (åpenhet om KI-generert innhold) og norsk gjennomføring. AI-innhold er
  merket i appen.
- **Likestillings- og diskrimineringsloven § 18 og forskrift om universell utforming av IKT-løsninger:** avklar om den
  offentlige nettsiden er omfattet.

## 6. Mangler før lansering (juridisk)

- [ ] Firmaopplysninger: `COMPANY_LEGAL_NAME`, `COMPANY_ORG_NUMBER`, `COMPANY_ADDRESS`, `COMPANY_CONTACT_EMAIL`.
      Har dere ikke firma ennå, må det registreres i Brønnøysundregistrene før dere tar betalt.
- [ ] Advokatgjennomgang av alle seks dokumentene → `LEGAL_PAGES_REVIEWED=true`.
- [ ] Databehandleravtaler med leverandørene (4.1).
- [ ] Protokoll over behandlingsaktiviteter (art. 30), både som behandlingsansvarlig og som databehandler.
      `docs/PERSONVERN.md` og `/personvern` er et godt grunnlag, men er ikke en protokoll.
- [ ] Intern rutine for brudd: hvem gjør hva, varsel til Datatilsynet innen 72 timer og til kundene innen 48 timer.
- [ ] Ta stilling til spørsmålene i punkt 3.

## 7. Slik endres tekstene

1. Endre teksten i `src/ui/pages/legal.tsx`, eller fakta i `src/domain/legal/legal.ts`.
2. Ved vesentlige endringer: sett `LEGAL_VERSION` og `LEGAL_UPDATED` til datoen endringen gjelder fra, og varsle
   kundene minst 30 dager før (vilkårene pkt. 21, databehandleravtalen om nye underdatabehandlere).
3. Kjør testene (`npm run test:unit` og `npm run test:integration`).

## 8. Slik legges firmaopplysningene inn

Firmaopplysninger er ikke hemmelige – de skal stå på nettsiden – så de kan sendes i chatten og legges inn derfra.
Selv: Render → **Environment Groups** → `anbudradar` → legg til de fire `COMPANY_*`-variablene → **Save** → på
tjenesten: **Manual Deploy** → **Deploy latest commit**. Endringer i miljøgruppen tas ikke i bruk før ny deploy.
