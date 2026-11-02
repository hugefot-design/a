# Status, begrensninger og kostnader

Sist oppdatert 2. november 2026 (Doffin-nedlasting lagt til samme dag).

## Testresultater

Kjørt i utviklingsmiljøet mot PostgreSQL 16 og Chromium (Playwright). Samme sett kjøres i CI (`.github/workflows/ci.yml`).

| Del | Resultat |
| --- | --- |
| Typesjekk (TypeScript strict) | Ingen feil |
| Enhetstester | 98 av 98 bestått (1 hoppet over: DFØs eksempelfiler, kjøres når SDK-et finnes lokalt) |
| Integrasjonstester (ekte database, ekte HTTP) | 64 av 64 bestått |
| Ende-til-ende i nettleser | 2 av 2 bestått |
| Produksjonsbygg (`npm run build`) og bygget migrering (`node dist/migrate.js`) | OK |
| Visuell kontroll av Profit Intelligence-sidene, 1440 px og 390 px | Ingen JavaScript-feil, ingen horisontal rulling |

**Mutasjonssjekker** (testene skal feile når beskyttelsen fjernes – det gjorde de):
- dry-run som skriver til databasen,
- konkurranserettslig sperre for partnerforespørsler,
- tallkontroll av AI-svar,
- Doffin-nedlasting som ignorerer `Retry-After`,
- søketreff som overskriver XML-data,
- falske varsler ved XML-berikelse.

**Kjent sårbarhet:** `npm audit` melder en høy sårbarhet i `zod` 3.x (minnebruk ved validering av svært store samlinger, GHSA-mrhx-c7xc-m3w5). Retting krever overgang til zod 4, som er en større endring. Skjemaene våre har lengdegrenser, og forespørsler har størrelsesgrense, men oppgraderingen bør planlegges.

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
| Doffin | **IKKE VERIFISERT** med nøkkel | Søk og nedlasting (`/v2/download/{doffinId}`) er bygget etter API-portalen. Nedlastingsadressen er kontrollert live 2.11.2026: den svarer 401 uten nøkkel, og klienten gir riktig melding. Formatet på et vellykket svar er ikke sett ennå. eForms-parseren er testet mot DFØs offisielle eksempler (N4/N16/N29, E2/E3/E4, EU). |
| Stripe | **IKKE VERIFISERT** | Testet med simulert Stripe-API og signerte hendelser. Må kjøres i testmodus med ekte konto. |
| Resend | **IKKE VERIFISERT** | E-post logges lokalt. Må testes med verifisert domene og testmottakere. |
| AI (Anthropic) | **IKKE VERIFISERT** | All AI i testene er simulert og merket «Testmodus». Kvaliteten på ekte svar (særlig kontraktsvilkår på norsk) er ikke målt. |
| Supabase | **IKKE VERIFISERT** | Migreringer og RLS kjører mot PostgreSQL 16 lokalt; Supabase-roller og pooler er ikke prøvd. |
| Render | **IKKE VERIFISERT** | `render.yaml` følger Blueprint-spesifikasjonen, men er ikke prøvd. |

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
- **Juridiske tekster er utkast** og merket slik til `LEGAL_PAGES_REVIEWED=true`.
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
