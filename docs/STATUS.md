# Status, begrensninger og kostnader

Sist oppdatert 7. november 2026 (veikartpunkt 1–11, og gratis drift for punkt 12–15 – se [VEIKART.md](VEIKART.md) og [FORSLAG.md](FORSLAG.md)).

## Testresultater

Kjørt i utviklingsmiljøet mot PostgreSQL 16 og Chromium (Playwright). Samme sett kjøres i CI (`.github/workflows/ci.yml`).

| Del | Resultat |
| --- | --- |
| Typesjekk (TypeScript strict) | Ingen feil |
| Enhetstester | 195 av 195 bestått (1 hoppet over: DFØs eksempelfiler, kjøres når SDK-et finnes lokalt) – 7.11.2026 |
| Integrasjonstester (ekte database, ekte HTTP) | 171 av 171 bestått – 7.11.2026 |
| Ende-til-ende i nettleser | 5 av 5 bestått (inkl. appen på telefon) – 7.11.2026 |
| Produksjonsbygg (`npm run build`) og bygget migrering (`node dist/migrate.js`) | OK |
| Visuell kontroll av Profit Intelligence-sidene, 1440 px og 390 px | Ingen JavaScript-feil, ingen horisontal rulling |
| Visuell kontroll av anbudssiden (regelverk/klima) og Admin → Datakilder (XML-berikelse), 1280 px og 390 px | Ingen JavaScript-feil, ingen horisontal rulling |
| Visuell kontroll av Admin → Feil, 1280 px og iPhone 13 | Ingen JavaScript-feil, ingen horisontal rulling, ingen e-postadresser synlige – 7.11.2026 |
| Visuell kontroll av de offentlige sidene etter redesign (forside, funksjoner, priser, bransjer, om, kontakt, personvern), 1440 px og 390 px | Ingen JavaScript-feil, ingen horisontal rulling |

**Mutasjonssjekker** (testene skal feile når beskyttelsen fjernes – det gjorde de):
- dry-run som skriver til databasen,
- konkurranserettslig sperre for partnerforespørsler,
- tallkontroll av AI-svar,
- Doffin-nedlasting som ignorerer `Retry-After`,
- søketreff som overskriver XML-data,
- falske varsler ved XML-berikelse,
- automatisk XML-berikelse: av-bryteren, utvalget (allerede beriket, gamle, rekkefølge), dry-run som lagrer forsøk, 429 som teller som forsøk, og antall/pause før den gir opp (8 av 8 fanget),
- vilkårssøket: nektelser merket uten forbehold, i feil kategori, med vilkårlige ord imellom, eller slik at et senere ekte vilkår skjules.
- anbudssiden: regelverk/klima fjernet, feil kilde valgt når anbudet også finnes i TED, og klimakrav i spesifikasjonen sendt til AI-en som tildelingskriterium.

**Avhengigheter:** `npm audit` melder 0 sårbarheter (2.11.2026). `zod` er oppgradert fra 3 til 4 (rettet GHSA-mrhx-c7xc-m3w5), og standardmeldinger for validering er på norsk.

Det som dekkes:

- **Datakilder:** TED-hentingen er kjørt mot live API (se under). Paginering, nye forsøk med `Retry-After`, duplikater på tvers av kilder, at `--dry-run` aldri skriver, frister (tilbud, deltakelse, spørsmål), CPV, NUTS/fylke, varighet, dokumentlenker og at manglende verdier aldri fylles inn.
- **Sikkerhet:** registrering, e-postbekreftelse, innlogging, glemt passord, CSRF og opprinnelse, CSP, ingen hemmeligheter i HTML, ingen kan gjøre seg selv til administrator, medlemmer kan ikke endre roller, fjernede medlemmer mister tilgang straks, RLS på alle tabeller.
- **Organisasjonsisolasjon:** to kunder side om side – ingen ser eller endrer den andres data, verken via nettsidene eller direkte i databasen, heller ikke med forfalsket organisasjonskontekst. Gjelder også kalkyler, økonomi, bemanning, utstyr, kontrakter og partnerforespørsler.
- **Betaling:** bare signerte webhooks aktiverer planer; samme hendelse behandles én gang, også ved samtidige kall; eldre hendelser kan ikke gjenopplive et avsluttet abonnement; refusjon, tvist, avstemming mot Stripe, nedgradering med for mange medlemmer.
- **E-post:** ingen duplikater (nøkkel per hendelse + idempotensnøkkel hos Resend), avmelding med ett klikk (RFC 8058), varige feil prøves ikke på nytt.
- **AI:** kildeblokken kan ikke brytes ut av, sitater og tall kontrolleres mot kilden, «ukjent» blir aldri et tall, kvoter og kostnadstak håndheves, planer låses på serveren. Alle AI-tester bruker den simulerte leverandøren.
- **Profit Intelligence:** formler, opphav på hvert tall, valideringsfeil, testpris, AI-import uten priser, kapasitet med overlapp, anbefalingsregler, partnerprofil med samtykke, sperre når begge kan levere alene, kontaktinfo bare ved godkjenning, statusoverganger håndhevet i databasen.
- **Personvern:** eksport (inkl. Profit-data) uten passord-hasher eller tokens, sletting av konto og organisasjon med filer, automatisk sletting etter faste frister.
- **Nettleser:** kundereisen fra forsiden til analyse og låst Bedrift-funksjon uten JavaScript-feil; offentlige sider på mobilbredde uten horisontal rulling.

## Verifisering mot ekte tjenester

| Tjeneste | Status | Bevis / hva som mangler |
| --- | --- | --- |
| TED | **VERIFISERT** 1.11.2026 | 1 194 norske kunngjøringer hentet; frist på 98,4 % av konkurransene og dokumentlenke på 82,9 %; ekte import ga 1 110 nye og 82 sammenslåtte; ny kjøring ga 0 duplikater og 0 falske endringer. Seks ekte kunngjøringer ligger som testdata i `tests/fixtures/`. |
| Doffin | **VERIFISERT live 2.11.2026** med nøkkel | Søk: 51 kunngjøringer for ett døgn, 0 feil; tittel, beskrivelse, oppdragsgiver og CPV på alle, frist på 97 % av konkurransene. Nedlasting (eForms-XML): 9 av 9 ekte kunngjøringer lastet ned og lest riktig (konkurranse, direkte tildeling, planlagt – alle EU-skjema). Live-testen avdekket og rettet to ting: rettsgrunnlag i `cbc:RegulatoryDomain` og varighet oppgitt som datoer. Nasjonale skjema (under EØS-terskel) er ikke sett live ennå – bare testet mot DFØs eksempler. |
| Stripe | **IKKE VERIFISERT** | Testet med simulert Stripe-API og signerte hendelser. Må kjøres i testmodus med ekte konto. |
| Resend | **VERIFISERT live 3.11.2026** | Domenet `anbudradar.com` er bekreftet hos Resend (DKIM, SPF og retur-domene, EU-region Irland). Ende-til-ende: kontaktskjemaet på anbudradar.com → appens e-postkø → Resend → e-post fra `varsler@anbudradar.com` levert til testmottakeren. Testlisten (`EMAIL_ALLOWED_RECIPIENTS`) ble fjernet 6.11.2026 etter godkjenning fra eier, så ekte kunder får bekreftelser og varsler. Reserverte testdomener (example.com o.l.) sendes aldri. |
| AI (Anthropic) | **IKKE VERIFISERT** | All AI i testene er simulert og merket «Testmodus». Kvaliteten på ekte svar (særlig kontraktsvilkår på norsk) er ikke målt. |
| Supabase | **VERIFISERT live 2.–3.11.2026** (gratisplan) | Database i EU (Irland) via session pooler. Migreringene (0001–0013) kjøres ved hver deploy, og appen kobler til med egen databaserolle med radnivåsikkerhet – innloggingen med den rollen sjekkes ved hver deploy. Ikke prøvd mot Supabase: isolasjonstesten mellom to kunder (kjøres lokalt), fillagring (`STORAGE_DRIVER=supabase`) og gjenoppretting – gratisplanen har ingen automatiske sikkerhetskopier. |
| Render | **VERIFISERT live 2.–3.11.2026** (gratisplan) | Nettsiden kjører i Frankfurt med automatisk utrulling fra grenen, helsesjekk på `/api/health` og bakgrunnsjobbene i samme tjeneste (`RUN_WORKER_IN_WEB`). Eget domene `anbudradar.com` med sertifikat; den gamle onrender-adressen sendes videre. Tjenesten er satt opp manuelt – `render.yaml` (Blueprint) er ikke prøvd. Gratisplanen sover etter 15 minutter uten trafikk, så henting og varsler går bare når siden er våken. |

Fremgangsmåte for hver: [INTEGRASJONER.md](INTEGRASJONER.md).

## Kjente begrensninger

- **Konkurransedokumenter hentes ikke automatisk.** Kunngjøringen og lenken importeres; vedlegg lastes opp av brukeren for full analyse og kontraktsrisiko.
- **Skannede PDF-er** (bilder uten tekst) kan ikke leses – brukeren får beskjed. OCR er ikke bygget.
- **Kommune** filtreres på stedstekst, ikke kommunenummer. Fylke utledes fra NUTS 2024-koder.
- **CPV-listen** har hovedgrupper og et utvalg koder; full liste lastes med `npm run import:cpv`.
- **Naturlig språk-søket** er regelbasert. Tolkningen vises alltid.
- **Konkurrentinnsikt** er bare så god som tildelingskunngjøringene.
- **Relevansscoren** er samsvar med profilen, ikke sannsynlighet for å vinne.
- **Profit Intelligence:** ordsøket finner ord, ikke betydning (nektelser som «ingen dagbot» merkes, men ikke alle formuleringer fanges); kapasitet regnes per år og per måned (sesong), ikke per uke; sertifiseringer gjenkjennes fra en kjent liste; partnernettverket er tomt ved lansering.
- **Sitatkontrollen** bekrefter at sitatet står i kilden – ikke at tolkningen er riktig.
- **Krav- og avvisningssjekken** er ordsøk: den finner setninger med kjente kravord (avvisning, minstekrav, kvalifikasjonskrav,
  befaring, «skal»/«må»), ikke betydning. Krav skrevet med andre ord fanges ikke opp, og noen treff kan være generelle.
  Høyst 30 treff vises per kategori (alle telles), og høyst 10 dokumenter leses per anbud.
- **Kun norsk (bokmål).**
- **Ingen SSO** ennå (totrinn og passkeys finnes – se under).
- **Juridiske tekster er utkast** og merket slik til `LEGAL_PAGES_REVIEWED=true`. Pakken består av vilkår,
  personvernerklæring, databehandleravtale, underleverandører, informasjonskapsler og sikkerhet; versjonen kunden
  godtar lagres ved registrering. Spørsmål og forbehold til advokaten står i [JURIDISK.md](JURIDISK.md).
- **Priser er eks. mva.** MVA i Stripe (fast sats eller Stripe Tax) må avklares med regnskapsfører.

## Kostnadsestimat per måned

**Kontrollerte priser** (hentet 2.11.2026, eks. mva.): Supabase Pro 25 USD inkl. 10 USD databasekapasitet (Micro), Small-kapasitet 15 USD, PITR 100 USD per 7 dager ([Supabase](https://supabase.com/pricing)); Resend gratis til 3 000 e-poster/mnd og 100/dag, Pro 20 USD for 50 000 ([Resend](https://resend.com/pricing)); Stripe 2,4 % + 2 kr per norsk/EØS-kort og Billing 0,7 % ([Stripe Norge](https://stripe.com/en-no/pricing)); Claude Sonnet 5.5 2 USD inn / 10 USD ut per million tokens, bufret 0,10 USD, Haiku 5.5 0,10 / 0,50 USD ([Anthropic](https://platform.claude.com/docs/en/about-claude/pricing)). Kurs 9,25 kr per USD ([USD/NOK 29.10–2.11.2026](https://www.poundsterlinglive.com/history/USD-NOK-2026)).

**Anslått (ikke kontrollert hos leverandøren):** Render 25 USD for webapp 1 CPU/2 GB og 7 USD for arbeider 0,5 CPU/512 MB, fra tredjepartskilder oktober 2026 ([MakerKit](https://makerkit.dev/pricing-calculator/render), [Activepieces](https://www.activepieces.com/blog/render-pricing-2026-free-tier-workers-total-cost.md)). Render endret planene i 2026, og en arbeidsområdeavgift kan komme i tillegg – Blueprint-forhåndsvisningen viser riktig pris før du bekrefter.

**Antakelser (anslag):** kundemiks 30 % Start, 50 % Profesjonell, 20 % Bedrift. AI-analyse med dokumenter ca. 35 000 tokens inn og 4 000 ut (ca. 0,11 USD med Sonnet 5.5), uten dokumenter ca. 0,04 USD, kort sammendrag med Haiku ca. 0,001 USD, tilbudsutkast ca. 0,04 USD. «Vanlig» bruk = 30 % av kvoten; «maks» = hele kvoten med dokumenter. Delte analyser av offentlige kunngjøringer (som koster én gang for alle kunder) er ikke trukket fra – tallene er forsiktige.

| | 10 kunder | 50 kunder | 100 kunder | 500 kunder |
| --- | --- | --- | --- | --- |
| Inntekt (eks. mva.) | 5 090 kr | 25 450 kr | 50 900 kr | 254 500 kr |
| Drift: Supabase + Render + Resend | 527 kr (57 USD) | 712 kr (77 USD) | 759 kr (82 USD) | 1 915 kr (207 USD) ¹ |
| AI, vanlig bruk | 278 kr | 1 391 kr | 2 781 kr | 13 907 kr |
| AI, maks (hele kvoten) | 927 kr | 4 636 kr | 9 271 kr | 46 356 kr |
| Stripe-gebyrer ² | 178 kr | 889 kr | 1 778 kr | 8 890 kr |
| **Sum, vanlig bruk** | **983 kr (19 %)** | **2 992 kr (12 %)** | **5 318 kr (10 %)** | **24 712 kr (10 %)** |
| **Sum, maks AI** | **1 632 kr (32 %)** | **6 237 kr (25 %)** | **11 808 kr (23 %)** | **57 161 kr (22 %)** |

¹ Ved 500 kunder: Small-kapasitet i Supabase, PITR (100 USD) og to webapp-instanser. ² Per betaling: Start 8,17 kr, Profesjonell 17,47 kr, Bedrift 32,97 kr. Norske selskaper betaler 25 % mva. på Stripe-gebyrer (fradragsberettiget når selskapet er mva.-registrert).

Ikke med: lønn, regnskap, advokat, markedsføring, domene, feilovervåking og eventuell arbeidsområdeavgift hos Render. De faste driftskostnadene dekkes av to kunder på Profesjonell. Kostnadstaket `AI_MONTHLY_COST_LIMIT_USD_PER_ORG` (40 USD i `render.yaml`) hindrer at én kunde gir uventet høy AI-kostnad.

## Neste steg

Se [LANSERING.md](LANSERING.md) for sjekkliste og rekkefølge. Kort:

1. **Koble til ekte tjenester i testmodus** – Doffin-nøkkel, Stripe testmodus, Resend med testmottakere, Anthropic med utgiftsgrense – og kjør verifiseringen i [INTEGRASJONER.md](INTEGRASJONER.md).
2. **Juridisk gjennomgang** av personvernerklæring, vilkår, samtykketekst for partnerprofiler og konkurranserettslig veiledning; databehandleravtaler.
3. **Sikkerhetskopi, døgnåpen drift og overvåking** – forslag med pris i [FORSLAG.md](FORSLAG.md) (krever eiers godkjenning).
4. **Pilot med 3–5 bedrifter i én bransje** (f.eks. vinterdrift/maskin eller renhold) – mål om de finner anbud de ellers ville gått glipp av, om kravsjekken og forhåndsvurderingen treffer, og om lønnsomhetskalkylen og markedsprisen stemmer med egne tall.
5. **Etter pilot:** flere land via TED, OCR og dokumentinnhenting (se [FORSLAG.md](FORSLAG.md)), varsel om kontrakter som nærmer seg utløp.
6. **Utrulling av veikartpunkt 1–11:** Render → tjenesten → *Manual Deploy* → *Deploy latest commit*. Migreringene 0018–0021 kjøres automatisk og endrer ingen eksisterende data.

## Abonnement og gratisplan (3.11.2026)

- **Gratis** (uten kort): ekte anbud fra Doffin og TED, 5 søk per dag (distinkte søk; bla/gjenta teller ikke),
  3 lagrede anbud, 1 AI-sammendrag per måned (krever bekreftet e-post), ingen automatiske varsler, ingen Profit
  Intelligence eller Future Opportunities. Håndhevet på serveren, testet (`tests/integration/free-tier.test.ts`).
- **Misbruksvern:** prøveperioden gis én gang per bruker (før kunne man få ny ved å opprette ny organisasjon);
  søke- og AI-grensen gjelder også per bruker på tvers av organisasjoner; maks 5 organisasjoner per bruker;
  lås mot samtidige forespørsler.
- **Planer og priser (endret 6. november 2026 etter ønske fra eier):** Start 299, Profesjonell 699, Bedrift 1 490 og Enterprise fra 4 990 kr/mnd eks. mva. Bedrift har 150 AI-analyser og 50 AI-utkast per måned, Enterprise inntil 25 brukere, 500 analyser og 200 utkast. Begrunnelse og regnestykke: [PRISER.md](PRISER.md)
  (settes manuelt i admin). Future Opportunities bare i Enterprise – se [FUTURE_OPPORTUNITIES.md](FUTURE_OPPORTUNITIES.md).
- **Stripe** er fortsatt ikke testet mot en ekte testkonto (mangler testnøkkel); betalingsflyten er testet mot simulert Stripe.

## Vekst uten annonser (6. november 2026)

- **Google-sider:** norske adresser (`/bransjer/renhold`), 15 fylkessider (`/fylker/<fylke>`) og bransje per fylke
  (`/bransjer/<bransje>/<fylke>`) med ekte åpne anbud. Live: nettstedskartet har 208 adresser (16 fylkessider og 110
  bransje-per-fylke-sider med minst 3 åpne anbud). Tynnere sider har `noindex`.
- **Ukesbrevet «Ukens anbud»** uten konto (dobbel bekreftelse, mandag kl. 07, ettklikks-avmelding). **VERIFISERT live:**
  påmelding på anbudradar.com → bekreftelses-e-post levert fra `varsler@anbudradar.com` til Resends testadresse.
- **E-post til alle:** testlisten fjernet etter godkjenning fra eier; reserverte testdomener sendes aldri.
- **Admin → Besøk** (uten informasjonskapsler/IP) og **Admin → LinkedIn** (ferdig tekst med ukens største nye anbud).
- **IKKE VERIFISERT:** første ordinære utsending av ukesbrevet (skjer mandag morgen), effekt i Google (tar dager–uker),
  og hvor mange e-poster per dag Resend-kontoen tillater ved mange påmeldte.
- Søkesider bare på norsk; AI er fortsatt av i produksjon (eiers valg: vent).

## Totrinnsinnlogging og passkeys (6. november 2026)

- Kode-app (TOTP, RFC 6238) med QR-kode, 10 reservekoder (hash), kryptert hemmelighet (AES-256-GCM), maks 5 forsøk per
  innlogging, utfordringen gjelder i 10 minutter, og samme kode kan ikke brukes to ganger.
- **Påkrevd for administratorer** (`/admin` sender til oppsettet til det er gjort). Valgfritt for kunder (Innstillinger).
- Tester: `tests/unit/totp.test.ts` (inkl. testvektorene i RFC 6238), `tests/integration/mfa.test.ts`, `admin-login.test.ts`.
- **Strengere admin (samme dag):** ny bekreftelse etter 12 timer, viktige endringer (tilganger, plan, datakilder,
  filimport, passkeys) krever bekreftelse de siste 15 minuttene. Pause etter 10 feil koder på 15 min / 30 per døgn.
- **Passkeys** (Face ID, fingeravtrykk, Windows Hello, sikkerhetsnøkkel) som andre steg i stedet for koden, via
  `@simplewebauthn/server` og `/browser` (MIT, gratis, ingen ekstern tjeneste). Bare offentlig nøkkel lagres.
- **Sikkerhetsvarsler på e-post** ved hver admin-innlogging, mange feil koder og endringer i innloggingsmåter, med
  signert «logg ut alle enheter»-lenke (7 dager, krever et ekstra klikk).
- Tester: `tests/integration/admin-stepup.test.ts`, `tests/integration/passkeys.test.ts` (programvare-autentikator som
  signerer som en ekte enhet: falsk side, gjenbruk og kopiert nøkkel avvises) og `tests/e2e/admin-passkey.test.ts`
  (Chromium med virtuell autentikator: legg til Face ID, logg inn og bekreft med den).
- **IKKE VERIFISERT:** passkey på en ekte telefon/Mac mot produksjonsdomenet (krever eierens enhet), og at
  varsel-e-posten kommer fram til eierens innboks i produksjon.
- Gjenoppretting og drift: [DRIFT.md](DRIFT.md#6b-totrinnsinnlogging-passkeys-og-sikkerhetsvarsler).

## Krav- og avvisningssjekk (6. november 2026)

- **Hva:** panelet «Krav og avvisningsrisiko» på anbudssiden viser setninger om avvisning, minstekrav, befaring og
  frister, kvalifikasjonskrav, tildelingskriterier og andre «skal»-krav – hver med kilde («Kunngjøringen»,
  «Kunngjøringen (eget felt)» eller «Dokument.pdf, s. 4») og ordet som ga treffet uthevet. Ingen AI, så det virker også
  når AI er av i produksjon.
- **Kilder:** beskrivelsen i kunngjøringen, kvalifikasjons- og tildelingskriteriene fra eForms-feltene, og
  konkurransegrunnlaget når kunden har lastet det opp (Profesjonell og Bedrift). Uten opplasting sier panelet tydelig at
  bare kunngjøringen er sjekket.
- **Sjekklisten (Bedrift):** «Legg i sjekklisten» (anbudssiden) og «Hent krav fra dokumentene» (tilbudsarbeidet) legger
  kravene inn som punkter med kategori og kilde. Samme punkt legges aldri inn to ganger; høyst 100 om gangen; låst når
  tilbudet er sendt inn; en annen organisasjon får 404. Migrering `0018` tillater kilden `krav` i sjekklisten.
- **Rettet samtidig:** `\b` i JavaScript kjenner bare a–z, så `\bmå\b` traff aldri «må ha», men traff «måler». Gjaldt
  reservelisten for kravsjekk av tilbudsutkast (`bids/ai.ts`) og testmodus-AI-en; nå avgrenset med æøå.
- **Tester:** `tests/unit/requirements.test.ts` (kategorier, sider, innholdsfortegnelse, overskrifter, økonomi/vekting,
  setningsdeling, 600 000 tegn under 2 s) og `tests/integration/requirements.test.ts` (anbudssiden med og uten dokument,
  PDF med sidetall, sjekkliste uten duplikater, annen organisasjon, låst tilbud, plankrav). Visuell kontroll 1280 og
  390 px.
- **IKKE VERIFISERT:** treffsikkerhet på ekte konkurransegrunnlag fra Doffin (bare eksempel-PDF og konstruerte tekster er
  testet). Ikke rullet ut.

## Tilbudsresultat og læring (6. november 2026)

- **Registrering:** på anbudssiden (Status for dere) registreres deres pris, vinner, vinnerens pris og hva som avgjorde
  (pris, kvalitet, ikke kvalifisert, avvist, annet) når statusen er «Tilbud levert», «Vunnet» eller «Ikke vunnet».
  Tidspunkt for levert og avgjort lagres. «Levert» i tilbudsarbeidet setter også tidspunktet. Migrering `0019`
  (nye, valgfrie kolonner på lagrede anbud – ingen eksisterende data endres).
- **Tildelingen:** når tildelingskunngjøringen nevner organisasjonens org.nr., vises «Tildelingen nevner dere som vinner»
  og «Dere» i tildelingslisten, med en knapp for å registrere seieren. Ingenting settes automatisk, og «Ikke vunnet»
  foreslås aldri ut fra kunngjøringen. Varsler om tildeling lenker rett til resultatfeltene.
- **Resultater** (ny side i menyen, alle planer): levert, vunnet, ikke vunnet, venter, vinnerandel; ventende tilbud med
  tildelingen når den er publisert; «Pris: dere mot vinneren» og «Kalkylen mot resultatet» (median avvik, med kilde for
  hver vinnerpris); hva som avgjorde; hvem som vant når dere ikke vant; oppdragsgivere. På anbudssiden vises tidligere
  resultater hos samme oppdragsgiver.
- **Ærlige tall:** vinnerpris fra tildelingsbrevet (registrert av kunden) brukes først. Verdien i
  tildelingskunngjøringen brukes bare ved én vinner, samme valuta og ikke rammeavtale (der er den ofte et anslag).
  Samme vinner fra TED og Doffin telles én gang.
- **Tester:** `tests/unit/results.test.ts` (tallformat, sammenslåing av tildelinger, vinnerpris-regler, statistikk,
  selskapsnavn) og `tests/integration/results.test.ts` (registrering og validering, statusskjemaet i listen tømmer ikke
  resultatet, «vi vant» bare med riktig org.nr., en annen organisasjon kan verken se, endre eller bekrefte, eksporten
  har resultatene). Mutasjonssjekk: fjernet vern i begge tilfeller ga feilende test. Visuell kontroll 1280 og 390 px uten
  JavaScript-feil eller horisontal rulling.
- **IKKE VERIFISERT:** med ekte kunder og ekte tildelinger i produksjon. Org.nr.-treff krever at kunden har lagt inn
  organisasjonsnummer. Ikke rullet ut.

## Markedspris fra tidligere tildelinger (6. november 2026)

- **Hva:** panelet «Markedspris fra tidligere tildelinger» under Lønnsomhet viser hva lignende kontrakter faktisk ble
  tildelt for: median og midterste halvdel per år (totalt når varigheten mangler), antall tildelinger og listen med
  oppdragsgiver, vinner, verdi, verdi per år og dato. Minstepris, målpris og en testpris («Hva om vi byr …?») plasseres
  i fordelingen («lavere enn 56 % av tildelingene») – det er prissimuleringen.
- **Lignende = samme CPV**, så spesifikt som datagrunnlaget tillater (5, 4 eller 3 siffer; går et nivå opp ved under 8
  tildelinger). For brede koder (f.eks. 45000000 bygg og anlegg) sammenlignes ikke.
- **Ærlige tall:** bare verdier fra tildelingskunngjøringer, siste fem år. Rammeavtaler (verdien er ofte et tak),
  annen valuta og tildelinger uten verdi holdes utenfor og telles opp. Samme vinner fra TED og Doffin telles én gang.
  Ingen statistikk på færre enn tre; under åtte merkes «Få – tolk med forsiktighet». Anbefalingen endres ikke av
  markedsdata (den bygger fortsatt bare på kalkyle, risiko, kapasitet og kvalifikasjoner).
- **Erfaring:** hvor målprisen i tidligere kalkyler lå mot det som vant (fra Resultater) vises i panelet.
- **Rettet samtidig (fra punkt 3):** målprisen ble lest fra feil sted i lagrede kalkyler (`result->'calc'`), så
  «Kalkylen mot resultatet» og hjelpeteksten «Målpris i kalkylen» ville aldri vist noe. Funnet av den nye
  integrasjonstesten; ikke rullet ut.
- **Diagram:** fordelingen tegnes som prikker (tidligere tildelinger, dempet) med bånd for midterste halvdel, strek for
  median og ruter for egne priser (fremhevet). Fargene er kjørt gjennom dataviz-validatoren; tall finnes også som tabell
  og i verktøytips (mus og piltaster).
- **Tester:** `tests/unit/market.test.ts` (kvartiler, CPV-nivåer og -valg mot lagrede prefikser, utelatelser, per år,
  prisposisjon, akse) og `tests/integration/market.test.ts` (ekte side med tildelinger, kalkyle og testpris med
  håndregnede tall, for bred CPV, erfaring fra Resultater). Visuell kontroll 1280 og 390 px.
- **IKKE VERIFISERT:** hvor mange tildelinger med verdi som finnes per bransje i produksjon (mange
  tildelingskunngjøringer oppgir ikke verdi; Doffins søk gir aldri verdi). Ikke rullet ut.

## Kontraktsutløp-radar (6. november 2026)

- **Hva:** «Kontrakter som utløper» under Konkurrenter (Bedrift): tildelte kontrakter som trolig utløper innen 6, 12 eller
  24 måneder – og de som utløp de siste tre månedene, fordi de ofte utlyses på nytt nå. Hver rad viser oppdragsgiver,
  hvem som har kontrakten i dag, tildelt verdi og grunnlaget for anslaget. Filtrert på bransjene og fylkene i profilen,
  eller valgfri bransje/fylke/hele landet.
- **Anbudssiden (alle planer):** tildelte anbud viser «Kontrakten utløper trolig …» med grunnlaget.
- **Anslaget:** sluttdato fra kunngjøringen når den finnes, ellers oppstart (eller tildelingsdato) + varighet. Opsjoner om
  forlengelse står sjelden i dataene og er ikke med – det står på siden. Uten dato eller varighet gjettes det ikke, og
  siden viser hvor mange kontrakter vi kan anslå utløp for.
- **Tester:** `tests/unit/expiry.test.ts` (månedsregning ved månedsslutt og skuddår, grunnlag, ingen gjetning) og
  `tests/integration/expiry.test.ts` (rekkefølge, periode, nylig utløpt, uten varighet, profilfilter, alle bransjer,
  plankrav, anbudssiden). Visuell kontroll 1280 og 390 px.
- **Funnet underveis:** `duration_months` er desimaltall i databasen, og `make_interval` krever heltall – siden ga feil
  før det ble rundet av. Fanget av integrasjonstesten.
- **Ikke bygget ennå:** varsel når en kontrakt i bransjen nærmer seg utløp (krever ny varselinnstilling, så kunden selv
  styrer det). **IKKE VERIFISERT:** hvor mange tildelinger i produksjon som har varighet og dato. Ikke rullet ut.

## Forhåndsvurdering av treff (6. november 2026)

- **Hva:** hvert treff får «Verdt å se på», «Sjekk først» eller «Passer trolig ikke» med grunnene, alvorligst først:
  frist (mot profilens «minst dager til frist»), krav dere ikke oppfyller (fra matchingen), obligatorisk befaring,
  kostbare vilkår nevnt i kunngjøringen (dagbøter, garantier/sikkerhetsstillelse, erstatningsansvar – nektelser teller
  ikke), opplysninger som mangler og høy usikkerhet. Kravsetninger om avvisning/minstekrav vises som informasjon.
- **Hvor:** søkeresultater og «Beste treff» på Oversikt (med matching: merkelapp og viktigste grunn), og øverst i
  «Passer det for oss?» på anbudssiden (alle planer – uten matching vurderes frist og kunngjøring).
- **Uten AI og uten lagring:** regnes ut når siden vises, fra kunngjøringen og profilen. Ingen nye kolonner, ingen
  endring av eksisterende data. Tåler eldre lagrede matchforklaringer.
- **Tester:** `tests/unit/screening.test.ts` (signaler, nektelser, rekkefølge, alle tre vurderinger, eldre data) og
  `tests/integration/screening.test.ts` (anbudssiden, søk og Oversikt med matching, Start-plan uten merkelapper).
  Visuell kontroll 1280 og 390 px.
- **Begrensning:** bygger bare på kunngjøringen – konkurransegrunnlaget kan ha flere krav (det står under vurderingen).
  Ikke rullet ut.

## Flere skjulte kostnader i vilkårssøket (7. november 2026)

- **Nye kategorier** i ordsøket under Lønnsomhet → Kontraktsrisiko: lønns- og arbeidsvilkår (tariff/allmenngjøring,
  lærlinger, HMS-kort, ledd i kontraktskjeden), miljø- og klimakrav (utslippsfrie kjøretøy, HVO, Euro 6, svanemerket),
  rapportering og oppfølging (månedsrapporter, statusmøter, timelister) og oppstart/innfasing/virksomhetsoverdragelse
  (arbeidsmiljøloven kap. 16). Hver med dokument, side og utdrag, og et tips om hva som bør inn i kalkylen.
- **Vern mot falske treff:** «hvordan» gir ikke HVO, «Euro 60 000» gir ikke Euro 6; ord med æøå avgrenses ikke med `\b`.
- **Tester:** `tests/unit/terms-costs.test.ts` (treff per kategori, falske treff, «ikke funnet») og
  `tests/integration/terms-costs.test.ts` (Lønnsomhet-siden med tips, nektelse av dagbot fortsatt merket).
  Ikke rullet ut.

## «Til handling» på Oversikt (7. november 2026)

- **Hva:** én arbeidsliste øverst på Oversikt, det som haster først: tilbudsfrister og spørsmålsfrister innen en uke
  (lagrede anbud som ikke er levert), obligatorisk befaring, tilbud som venter på godkjenning eller er godkjent men ikke
  levert (Bedrift), leverte tilbud der tildelingen er publisert (eller levert for over tre måneder siden) og inntil tre
  sterke nye treff (75+) som ikke er lagret. Hvert punkt lenker dit det løses. Høyst ti punkter.
- **Bare egne data**, ingen anslag. «I dag/i morgen» regnes i kalenderdager i norsk tid (riktig rundt midnatt og ved
  sommertid). Uten noe som haster står en kort forklaring.
- **Tester:** `tests/unit/actions.test.ts` (rekkefølge, kalenderdager rundt midnatt og sommertid) og
  `tests/integration/actions.test.ts` (alle punkttypene, rekkefølge, ingen arbeidspunkter fra andre organisasjoner,
  tom liste). Visuell kontroll 1280 og 390 px. Ikke rullet ut.

## Kapasitet per måned og sesong (7. november 2026)

- **Hva:** eksisterende kontrakter (Kapasitet og økonomi) og kalkylen (Lønnsomhet) kan få «måneder med arbeid», f.eks.
  vinterdrift nov–mar. Ingen avkrysning = hele året, som før. Kapasitetspanelet viser belastning måned for måned og sier
  fra om sesongtopper: «I nov–mar mangler dere opptil 70 timer per måned, selv om året samlet går opp».
- **Riktigere årstall:** en sesongkontrakt binder timer bare i sine måneder (20 t/mnd i fem måneder = 100 t/år, ikke 240).
- **Status:** mangel i enkelte måneder gir «Stram kapasitet», eller «For lite kapasitet» når toppen er over 10 % av
  månedens behov. Tilgjengelige timer fordeles likt på månedene (ferie og fravær er ikke trukket fra per måned – det står
  i panelet).
- **Data:** migrering `0020` legger til valgfri `active_months` på eksisterende kontrakter (ingen data endres). Sesongen
  for kalkylen lagres i kalkylens egne felt.
- **Tester:** `tests/unit/capacity-season.test.ts` (måneder fra skjema, «nov–mar» over nyttår, sesongtopp, «stram» vs.
  «for lite», sesongkontrakt per år) og `tests/integration/capacity-season.test.ts` (registrering, lagret sesong,
  panelet med håndregnede tall). Visuell kontroll 1280 og 390 px. Ikke rullet ut.

## Mobil og navigasjon i appen (7. november 2026)

- **Gjennomgang:** 19 sider i appen kontrollert automatisk på iPhone 13-bredde: ingen vannrett rulling og ingen
  JavaScript-feil. Menyen (skuffen) har store trykkflater og alle punktene, også «Resultater».
- **Rettet:** på telefon lå frist og «Passer det for oss?» ca. 3 500 px ned på anbudssiden (etter beskrivelse og
  dokumenter). Nå står frist og forhåndsvurdering rett under tittelen på skjermer under 1024 px, med lenke til hele
  vurderingen. Sjekklistens avkrysning og sletteknapp (20 og 16 px) har nå 32 px trykkflate; fil-opplasting og alle
  «vis mer»-linjer er minst 24 px høye (WCAG 2.5.8).
- **Samme tall overalt:** forhåndsvurderingen runder dager opp som fristfeltet (4,99 døgn = «5 dager»), så to tall
  aldri spriker på samme side.
- **Test som vakt:** `tests/e2e/mobile-app.test.ts` sjekker ti sider på telefon (vannrett rulling, feil, trykkflater
  under 24 px) og at frist og vurdering står før beskrivelsen på anbudssiden.

## «Spør om anbudet» – AI med kontrollerte kildehenvisninger (7. november 2026)

- **Hva:** på anbudssiden kan brukeren stille spørsmål om hele anbudet (kunngjøringen, og opplastede dokumenter for
  planer med full analyse). Svaret deles i påstander merket «Står i kilden» (med dokument, side og ordrett sitat) eller
  «Vurdering». Står svaret ikke i kildene, sier den det («Står ikke i kildene») i stedet for å gjette.
- **Mot hallusinasjoner:** samme regler og isolerte kildeblokk som AI-analysen (teksten i dokumentene er data, ikke
  instruksjoner). «Står i kilden» vises bare når sitatet finnes ordrett i kilden **og** sidetallet finnes – ellers
  «Sitat ikke bekreftet».
- **Kostnad og kontroll:** hvert nye spørsmål teller som én AI-analyse i planens kvote (vises ved feltet). Samme
  spørsmål igjen – også med annen skrivemåte – hentes fra hurtigbufferen uten kostnad. Spørsmål og svar lagres bare for
  organisasjonen. Migrering `0021` utvider listen over AI-typer (ingen data endres).
- **I produksjon:** vises bare når AI er slått på – i dag er AI av (eiers valg), så ingenting endres for kundene før det
  skjer.
- **Tester:** `tests/unit/chat.test.ts` (testmodus-svar, sitatkontroll med feil sitat og feil side, «står ikke i
  kildene») og `tests/integration/chat.test.ts` (svar med kilde, hurtigbuffer uten ny kostnad – fant og rettet at annen
  skrivemåte kostet på nytt –, private svar, tomt spørsmål). **IKKE VERIFISERT** med ekte AI-leverandør.

## Gratis drift: sikkerhetskopi, oppetid, feilovervåking og fillagring (7. november 2026)

Svar på «gjør alt som er gratis eller finn alternativer» (se [FORSLAG.md](FORSLAG.md)). Ingen nye leverandører, ingen
kostnader, ingen endring i Render eller Supabase.

- **Sikkerhetskopi hver natt** (`.github/workflows/sikkerhetskopi.yml`, `scripts/backup/`): kryptert kopi (AES-256) til
  en privat bøtte i Supabase Storage, 30 dager, med generalprøve (gjenoppretting i tom database + migreringene kjørt mot
  kopien). Prøvd lokalt: 68 tabeller, 22 migreringer, radnivåsikkerhet på alle tabeller; feil passordfrase og ikke-tom
  måldatabase avvises; loggen viser ikke antall kunder (repoet er offentlig). Kjørt på GitHub 7.11.2026: hoppet over med
  advarsel fordi hemmelighetene mangler – som planlagt. **IKKE VERIFISERT mot produksjonsdatabasen.**
- **Helsesjekk hver time** (`.github/workflows/drift.yml`): vekker tjenesten og åpner/lukker GitHub-saken «Driftsvarsel».
  **Verifisert mot produksjon** 7.11.2026: `{"ok":true,"db":"ok","ms":21}`.
- **Feilovervåking i appen** (Admin → Feil, `src/domain/ops/errors.ts`, migrering `0022`): alt som logges som feil samles
  gruppert, uten e-post, lange tall, nøkler eller bruker-ID; én e-post i timen ved nye feil; «Merk som løst», og feilen
  åpnes igjen hvis den kommer tilbake. Bakgrunnsjobber som gir opp, logges nå som feil. Lesbare feilsteder i loggene
  (`--enable-source-maps` i `npm start`/`npm run worker`). Tester: `tests/unit/error-tracking.test.ts`,
  `tests/integration/error-tracking.test.ts`.
- **Fillagring:** Admin → Oversikt sjekker om filene lagres i en privat Supabase-bøtte eller på serverdisken (der de
  forsvinner). I produksjon i dag: serverdisken – oppsett i [DRIFT.md](DRIFT.md) §2.
- **Flere land via TED:** dry-run per land med volum og plassbehov (`--country SWE`); lagring av andre land er sperret.
  Målt mot TED 7.11.2026: Sverige 2 341 kunngjøringer per måned (Norge 1 144). Test: `tests/integration/ted-country.test.ts`.
- **OCR:** ikke bygget – Admin → Systemhelse teller nå opplastede dokumenter som ikke kan leses, som grunnlag.
- **GitHub Actions** oppdatert til `checkout@v5`, `setup-node@v5` og `github-script@v8` (Node 24).
- **Rullet ut til produksjon 7.11.2026 kl. 10:55 UTC** (versjon `5fe650c`, eiers ja): migreringene 0018–0022 kjørt i
  byggesteget uten feil; server og bakgrunnsjobber startet; ingen advarsler eller feil i loggen etter oppstart; helsesjekk
  OK; alle offentlige sider, språkversjoner og et utvalg bransje- og fylkessider svarer 200; admin er fortsatt skjult
  (404) for besøkende; driftssjekken på GitHub grønn mot ny versjon. Innloggede sider er **IKKE VERIFISERT i produksjon**
  (krever innlogging med totrinn) – de er dekket av testene over.

## Admin-tilgang, produktoversikt og kundereise (7. november 2026)

- **Admin kan bruke alle produktene:** organisasjoner som eies av en plattform-administrator får alle funksjoner
  (Enterprise) uten betaling, merket «admin-tilgang» i appen. Abonnementet og Stripe endres ikke, og det gjelder ikke
  kunders organisasjoner der administratoren bare er medlem. E-postvarslene følger samme regel.
- **AI i testmodus for admin:** når ekte AI er av (som nå), kjører AI-funksjonene for admin-organisasjoner med
  simulerte svar, tydelig merket. Svarene lagres bare for admin-organisasjonen og blandes aldri med ekte AI-svar
  (egen hurtigbuffer per leverandør). Kunder har fortsatt ikke AI.
- **Admin → Produkter:** alle produktene med lenke rett inn i appen, hvilken plan kundene trenger, og om funksjonen
  virker fullt ut (AI, betaling og fillagring krever oppsett).
- **Admin → Kundereise:** registrert → bekreftet e-post → profil → gode treff → lagret anbud → tilbudsarbeid → betaler,
  for 30 dager, 90 dager eller alle. Bare antall; administratorer og administratorens egen organisasjon er ikke med.
  Største frafall fremheves.
- **Automatiske tester på GitHub** ved hver endring på arbeidsgrenen. Første kjøring 7.11.2026: grønn.
- **Rullet ut 7.11.2026 kl. 11:31 UTC** (versjon `f148325`, eiers ja): ingen databaseendringer; ingen advarsler eller
  feil i loggen etter oppstart; helsesjekk OK; alle offentlige sider svarer 200; Admin → Produkter og Admin →
  Kundereise er skjult (404) for besøkende. Sidene bak innlogging er **IKKE VERIFISERT i produksjon** (krever totrinn) –
  dekket av testene og CI.
- Tester: `tests/integration/admin-access.test.ts` (fant at vernet virker: uten privat lagring av simulerte svar feiler
  testen), `tests/integration/journey.test.ts`, `tests/unit/journey.test.ts`. Visuell kontroll av Kundereise,
  Produkter og appen med admin-tilgang på 1280 px og iPhone 13: ingen JavaScript-feil, ingen vannrett rulling.

## Ny forside og posisjonering (7. november 2026)

**«Ikke bare finn anbudet. Finn ut om det er verdt å vinne.»** Bare frontend og tekst – ingen endring i priser,
planer, betaling, database, API-er eller integrasjoner.

- **Rullet ut 7.11.2026** (versjon `c0511f3`, eiers ja – og fra nå rulles hver oppdatering ut når testene på GitHub er
  grønne, se [DRIFT.md](DRIFT.md) punkt 7). Kontrollert på anbudradar.com: helsesjekk OK; forsiden, funksjoner, priser,
  registrering og /en, /sv, /da svarer 200 på mobil (390 px) og PC (1440 px), uten vannrett rulling og uten
  JavaScript-feil; eksemplet var en ekte norsk Doffin-kunngjøring.
- **Funnet i produksjon og rettet:** eksemplet viste en standardsetning om eBevis merket «Avvisning», SSA-R som
  «kostbart vilkår», intetsigende setninger i sjekklisten, ingen markedspris, tomt steg 6 og en kodetittel blant
  treffene. Utvalget er strammet inn (reglene står i [MARKEDSFORING.md](MARKEDSFORING.md)); appens ordsøk er uendret.
  Oppdragsgivernavn med bare store bokstaver får nå små småord («Barne-, Ungdoms- og Familiedirektoratet»).
  **Rullet ut** (versjon `80f7de6`): produksjonen viser nå en norsk Doffin-kunngjøring med konkrete krav og alle seks
  stegene med ekte data; loggen etter oppstart hadde 0 advarsler og 0 feil.
- **Funnet i andre kontroll:** én kontrakt på 11 mrd. kr presset de 19 andre sammen ved 0 i markedsprisfiguren, og
  sjekklisten startet midt i en setning. Rettet: svært store kontrakter tegnes ikke inn (er med i medianen, og det
  står under figuren), og «…» beholdes foran utdrag. **Rullet ut** (versjon `9eebe4b`) og kontrollert på
  anbudradar.com: figuren går 0–80 mill. kr med noten «1 svært stor kontrakt (over 110 mill. kr) er ikke tegnet inn»;
  alle sider 200 på mobil og PC, ingen vannrett rulling, ingen JavaScript-feil, 0 advarsler og 0 feil i loggen.

- **Forsiden:** ny toppseksjon; «Hvorfor AnbudRadar» med sju fordeler og planen hver finnes i (regnes ut fra planene);
  kundereisen i seks steg vist med **ekte, offentlige data** (krav ordrett fra en åpen kunngjøring, markedspris fra
  tildelinger, kontrakter som utløper – ingen leverandørnavn); sammenligning med søk og varsling som funksjon (ikke
  navngitte tjenester); «Dette får dere – og dette får dere ikke». Fjernet: et oppdiktet AI-eksempel og oppdiktede
  illustrasjoner, og påstanden «gratis med alt» (prøveperioden gjelder Profesjonell).
- **AI markedsføres ikke** så lenge ekte AI er av: funksjonssiden viser AI-kortet bare med ekte leverandør; prissiden
  sier at AI-funksjonene i planene ikke er slått på; registreringssiden lover ikke lenger AI-sammendrag.
- **Funksjonssiden:** ni funksjoner i samme rekkefølge som fordelene; ingen AI-løfter.
- **Engelsk, svensk og dansk:** oversatt, og sier at bare norske anbud dekkes og at appen er på norsk.
- **Delingsbildet** (lenker på LinkedIn o.l.) er laget på nytt med ny overskrift på fire språk.
- **Navnerisiko:** [NAVNERISIKO.md](NAVNERISIKO.md) – anbudsradar.no (FOA) i samme marked. **Påstandsregister:**
  [MARKEDSFORING.md](MARKEDSFORING.md).
- **Kontrollert:** desktop (1440 px), nettbrett (iPad) og mobil (iPhone 13) for forside, funksjoner, priser,
  registrering og /en, /sv, /da – ingen vannrett rulling, ingen JavaScript-feil, trykkflater minst 24 px (unntatt
  avkrysningsboksen for vilkår, som har klikkbar tekst). Forsiden har ca. 1 000 synlige ord (testgrense 1 300).
- **Tester:** `tests/integration/showcase.test.ts` (ekte data, ingen leverandørnavn, ingen AI-løfter, engelsk side),
  `tests/unit/showcase.test.ts`, oppdatert `public-pages.test.ts` og `e2e/flow.test.ts`.
- **Eksemplene i produksjon:** sett på anbudradar.com etter utrulling (se over). Hvilket anbud som vises, endres av
  seg selv når nye kunngjøringer kommer (hver 30. minutt), så kvaliteten avhenger av hva som finnes i databasen.
