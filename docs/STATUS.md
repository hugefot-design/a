# Status, begrensninger og kostnader

Sist oppdatert 2. november 2026 (Doffin-nedlasting, automatisk XML-berikelse, regelverk/klima på anbudssiden og nektelser i vilkårssøket lagt til samme dag).

## Testresultater

Kjørt i utviklingsmiljøet mot PostgreSQL 16 og Chromium (Playwright). Samme sett kjøres i CI (`.github/workflows/ci.yml`).

| Del | Resultat |
| --- | --- |
| Typesjekk (TypeScript strict) | Ingen feil |
| Enhetstester | 109 av 109 bestått (1 hoppet over: DFØs eksempelfiler, kjøres når SDK-et finnes lokalt) |
| Integrasjonstester (ekte database, ekte HTTP) | 75 av 75 bestått |
| Ende-til-ende i nettleser | 2 av 2 bestått |
| Produksjonsbygg (`npm run build`) og bygget migrering (`node dist/migrate.js`) | OK |
| Visuell kontroll av Profit Intelligence-sidene, 1440 px og 390 px | Ingen JavaScript-feil, ingen horisontal rulling |
| Visuell kontroll av anbudssiden (regelverk/klima) og Admin → Datakilder (XML-berikelse), 1280 px og 390 px | Ingen JavaScript-feil, ingen horisontal rulling |
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
| Resend | **VERIFISERT live 3.11.2026** | Domenet `anbudradar.com` er bekreftet hos Resend (DKIM, SPF og retur-domene, EU-region Irland). Ende-til-ende: kontaktskjemaet på anbudradar.com → appens e-postkø → Resend → e-post fra `varsler@anbudradar.com` levert til testmottakeren. Testlisten (`EMAIL_ALLOWED_RECIPIENTS`) stopper fortsatt e-post til alle andre, og skal først fjernes ved lansering. |
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
- **Profit Intelligence:** ordsøket finner ord, ikke betydning («ingen dagbot» gir treff); kapasitet regnes per år, ikke per uke/sesong; sertifiseringer gjenkjennes fra en kjent liste; partnernettverket er tomt ved lansering.
- **Sitatkontrollen** bekrefter at sitatet står i kilden – ikke at tolkningen er riktig.
- **Kun norsk (bokmål).**
- **Ingen tofaktorinnlogging eller SSO** ennå.
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
3. **Staging på Render + Supabase**, gjenopprettingstest av sikkerhetskopi, overvåking.
4. **Pilot med 3–5 bedrifter i én bransje** (f.eks. vinterdrift/maskin eller renhold) – mål om de finner anbud de ellers ville gått glipp av, og om lønnsomhetskalkylen stemmer med egne tall.
5. **Etter pilot:** automatisk henting av konkurransedokumenter der kildene tillater det, tofaktorinnlogging, feilovervåking, kapasitet per uke/sesong.

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
