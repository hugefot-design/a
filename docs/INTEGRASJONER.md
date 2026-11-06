# Integrasjoner – status og hva du må skaffe

Sist oppdatert 2. november 2026. **VERIFISERT** betyr kjørt mot den ekte tjenesten fra utviklingsmiljøet. **IKKE VERIFISERT** betyr bygget etter leverandørens dokumentasjon og testet med simulerte svar – det må prøves med ekte nøkler før lansering.

| Integrasjon | Status | Trenger fra deg | Kostnad |
| --- | --- | --- | --- |
| TED (EU) | **VERIFISERT** mot live API 1.11.2026: 1 194 norske kunngjøringer hentet, ekte import 1 110 nye + 82 slått sammen, ny kjøring ga 0 duplikater og 0 falske endringer | Ingenting (åpent API) | Gratis |
| Doffin | **VERIFISERT live 2.11.2026** – søk og nedlasting med ekte nøkkel (9 av 9 nedlastede kunngjøringer lest riktig; nasjonale skjema ikke sett live ennå) | Abonnementsnøkkel fra Doffins API-portal ([dof-notices-prod-api.developer.azure-api.net](https://dof-notices-prod-api.developer.azure-api.net/), produktet «Public Api») | Gratis |
| Stripe | **IKKE VERIFISERT** – Checkout, kundeportal, webhooks, refusjon/tvist og avstemming testet med simulert Stripe-API og signerte testhendelser | Konto i testmodus, 3 priser, webhook-hemmelighet | 2,4 % + 2 kr per kortbetaling + 0,7 % Billing |
| E-post (Resend) | **IKKE VERIFISERT** – kø, nye forsøk, idempotensnøkkel og avmelding testet lokalt | Konto, API-nøkkel, verifisert avsenderdomene | Gratis til 3 000/mnd (100/dag), deretter 20 USD |
| AI (Anthropic) | **IKKE VERIFISERT** – offisiell SDK, strukturerte svar og kildekontroll testet med simulert leverandør | API-nøkkel, valgt modell, utgiftsgrense | Etter forbruk (se under) |
| Supabase (database + lagring) | **IKKE VERIFISERT** – migreringer og RLS testet mot PostgreSQL 16 lokalt | Prosjekt i EU-region, app-rolle, privat bøtte | Pro 25 USD/mnd |
| Render (drift) | **IKKE VERIFISERT** – `render.yaml` følger Blueprint-spesifikasjonen, ikke prøvd | Konto, Blueprint, hemmeligheter i dashbordet | Se STATUS.md |

Hemmeligheter (API-nøkler, webhook-hemmeligheter, databasepassord) legges **bare** inn som miljøvariabler hos verten (Render → Environment) eller i leverandørens kontrollpanel – aldri i koden, i Git eller i chat.

## TED

- Endepunkt: `POST {TED_API_BASE_URL}/v3/notices/search` med spørringen `buyer-country=NOR AND publication-date>=ÅÅÅÅMMDD`, 100 per side, iterasjon med `iterationNextToken`, 0,5 s pause mellom sider.
- Felt som hentes: se `TED_FIELDS` i `src/connectors/ted.ts`.
- **Gjør først:** `npm run ingest -- --source ted --dry-run --limit 20`. Sjekk at titler, oppdragsgivere, frister og CPV-koder ser riktige ut. Blir felt tomme, juster `TED_FIELDS` og `mapTedNotice` (testene i `tests/unit/connectors.test.ts` viser forventet form).
- Vilkår: TED-data kan gjenbrukes med kildehenvisning («© Den europeiske union»), som står i bunnteksten. Les TEDs gjeldende vilkår for API-bruk før lansering.
- Verifisert 1.11.2026: tilbudsfrist hentes fra `deadline-receipt-tender-date-lot` (BT-131); frist for å be om å delta (BT-1311) og spørsmålsfrist (BT-13) vises separat. Frist fantes på 98,4 % av konkurransekunngjøringene, dokumentlenke på 82,9 %. Fylke utledes fra NUTS 2024-koder.

## Doffin

1. Registrer deg i Doffins API-portal (https://dof-notices-prod-api.developer.azure-api.net/) og abonner på produktet **Public Api** (ikke «Doffin Notices API», som er for publisering). Nøkkelen står under Profile → Primary key.
2. Sett `DOFFIN_API_KEY`. Sjekk at `DOFFIN_API_BASE_URL` stemmer med portalen (standard: `https://api.doffin.no/public/v2`).
3. Kjør `npm run ingest -- --source doffin --dry-run --limit 20` og sammenlign med de samme kunngjøringene på doffin.no.
4. Slik er hentingen bygget (etter API-portalens dokumentasjon): `GET /public/v2/search` med `Ocp-Apim-Subscription-Key`, sider fra 1, høyst 10 sider à 100 treff per søk – derfor hentes én dag om gangen, delt på kunngjøringstyper. Tempoet holdes under grensen på 30 søk per minutt, og `Retry-After` respekteres. Bekreft ved første kjøring: typeverdiene for livssyklus, datoformatet på frister og at antall treff per dag stemmer med doffin.no. Alt ligger i `src/connectors/doffin.ts`.
5. `--dry-run` lagrer og endrer ingenting (dekket av tester).
6. Vi bruker bare det offentlige API-et – ikke nettsidens interne API-er eller skraping.

En kilde vises først som tilkoblet for brukerne etter en vellykket ekte henting (`data_sources.verified_live`). Inntil da omtaler nettsiden bare «offentlige kilder».

### Nedlasting av én kunngjøring (eForms-XML)

`GET {DOFFIN_API_BASE_URL}/download/{doffinId}` med headeren `Ocp-Apim-Subscription-Key`. Doffin-ID har formatet `ÅÅÅÅ-NNNNNN` (som i adressen `doffin.no/notices/…`). Svaret leses som eForms-XML med feltstiene fra DFØs eForms SDK NOR, og gir det søket mangler:
- dokument- og innleveringslenke,
- frister per delkontrakt og spørsmålsfrist,
- varighet og rammeavtale,
- tildelingskriterier med vekt, også det norske klima- og miljøkriteriet,
- kvalifikasjonskrav, rettsgrunnlag og skjematype (N4/N16/N29, E2/E3/E4 eller EU),
- eForms-ID-ene som kobler rettelser og tildelinger til riktig anbud,
- vinnere med beløp og avtaledato.

Når full kunngjøring er hentet, viser anbudssiden i tillegg kunngjøringstype (nasjonal under EØS-terskelverdiene, eller EU-kunngjøring som også går til TED) med skjemanummer, regelverk med lenke til forskriften på Lovdata, klima- og miljøhensyn (vektet kriterium, krav i spesifikasjonen eller unntak), strategisk anskaffelse og om elektronisk innlevering er påkrevd. Klimakrav i spesifikasjonen og unntak vises ikke som tildelingskriterier – verken på siden eller i teksten AI-en får. Lovdata-lenkene bruker adresseformatet offentlige virksomheter lenker med (`lovdata.no/dokument/SF/forskrift/2016-08-12-974`). **IKKE VERIFISERT:** Lovdata avviser automatiske kall fra utviklingsmiljøet, så lenkene er ikke åpnet derfra. Ukjente rettsgrunnlag vises som tekst uten lenke.

- **Grense:** maks 10 nedlastinger per minutt per abonnement. Appen holder 6,5 s mellom kall gjennom en felles luke i databasen (`api_slots`), så webapp, arbeider og kommandolinje til sammen aldri går over grensen.
- **429:** venter så lenge `Retry-After` sier (sekunder eller dato; 60 s hvis headeren mangler) og skyver luken for alle prosesser. Over 5 minutter: kjøringen stopper, og resten prøves senere.
- **404:** registreres som feil på den ene kunngjøringen, og resten fortsetter. **401/403:** kjøringen stopper med beskjed om å sjekke nøkkelen.
- Svar som er ZIP med XML pakkes ut. Andre formater rapporteres og kan lagres med `--save-raw`.
- Hentes en kunngjøring som allerede finnes fra søket, berikes den uten endringsvarsler. Senere søketreff overskriver ikke XML-dataene, men kan melde at konkurransen er avlyst eller tildelt.
- En henting per ID flytter ikke `last_success_at` og markerer ikke kilden som verifisert.

**Test med én ekte kunngjøring** (når nøkkelen er satt i miljøet – aldri i koden eller i chat):

```bash
npm run ingest -- --source doffin --id 2026-123456 --dry-run --save-raw ./storage/doffin-xml
```

Dry-run lagrer ingen kunngjøringsdata, men oppdaterer tempo-luken. Kontroller i utskriften at `downloads[0].outcome` er `ok`, at `format` er `eforms-xml`, og at frist, dokumentlenke og kriterier stemmer med kunngjøringen på doffin.no. Filen i `./storage/doffin-xml` (utelatt fra Git) viser hva Doffin faktisk leverte.

### Automatisk XML-berikelse (av til live-test)

Det planlagte sveipet bruker søket (raskt, 30 kall/min). Arbeideren kan i tillegg hente full XML for nye treff med download-endepunktet. Det er **av** til én ekte kunngjøring er kontrollert som over. Slå på med `DOFFIN_ENRICH_XML=true` på både webtjenesten og arbeideren (webtjenesten bruker den i admin-oversikten og for `/api/cron`).

- **Hvilke:** Doffin-treff som bare har søkedata, i denne rekkefølgen: åpne konkurranser med frist fram i tid → konkurranser uten oppgitt frist → planlagte → andre publisert siste 30 dager (f.eks. tildelinger). Treff som ikke også finnes i TED går først. Avsluttede, eldre kunngjøringer og kunngjøringer som allerede har XML hoppes over.
- **Tempo:** hvert `DOFFIN_ENRICH_INTERVAL_MINUTES` (10) minutt, høyst `DOFFIN_ENRICH_MAX_PER_RUN` (25) per kjøring. Det gir inntil 3 600 nedlastinger per døgn med standardverdiene. Samme luke som `--id` (6,5 s mellom kall), så grensen på 10 per minutt holdes også når begge kjører.
- **Feil:** 404 prøves igjen etter ett døgn og gis opp etter tre forsøk. Andre feil prøves igjen etter 1, 6 og 24 timer og gis opp etter fire forsøk. 429 og ugyldig nøkkel stopper kjøringen uten å telle som forsøk. Forsøkene lagres i `doffin_enrichment` (ingen persondata).
- **Oversikt:** Admin → Datakilder viser hvor mange som er lagret som XML, hentet siste døgn, venter, prøves igjen og er gitt opp, med de siste problemene.
- **Antakelse (ikke verifisert):** at grensene for søk (30/min) og nedlasting (10/min) gjelder hver for seg, slik API-portalen beskriver dem. Hvis Doffin svarer 429, håndteres det uansett som over.

```bash
npm run ingest -- --source doffin --enrich --plan                # hvilke som ville blitt hentet (ingen kall mot Doffin)
npm run ingest -- --source doffin --enrich --dry-run --limit 3   # last ned og vis, LAGRER INGENTING
npm run ingest -- --source doffin --enrich --limit 10            # last ned og lagre
```

## Stripe

1. Opprett konto (norsk selskap), og jobb i **testmodus** først.
2. Lag ett produkt med tre månedlige priser i NOK: 299 (Start), 699 (Profesjonell), 1490 (Bedrift). Enterprise (fra 4 990) settes opp manuelt i admin. Sett `STRIPE_PRICE_*`. Kontroller deretter under **Admin → Helse → Priser i Stripe** at pris-ID-ene er aktive, i NOK, månedlige og har riktig beløp (kontrollen leser bare).
   Prisene på nettsiden er eks. mva. – avklar med regnskapsfører om dere skal bruke Stripe Tax eller legge mva. på prisene.
3. Webhook-endepunkt: `https://din-domene.no/api/webhooks/stripe` med hendelsene
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`.
   Sett `STRIPE_WEBHOOK_SECRET` til signeringshemmeligheten.
4. Slå på **kundeportalen** (Settings → Billing → Customer portal): betalingsmåte, fakturaer, oppsigelse.
5. Test: kjøp med testkort `4242 4242 4242 4242`, sjekk at planen endres i appen (det skjer først når webhooken kommer), test feilende kort og oppsigelse.

Sikkerhet: betalt tilgang aktiveres bare av webhooks med gyldig signatur. Retur fra Checkout (`?checkout=fullfort`) endrer ingenting. Hendelser behandles én gang (`stripe_events`), og eldre hendelser kan ikke overskrive nyere.

## E-post (Resend)

1. Opprett konto og legg til domenet (DNS-poster for SPF/DKIM).
2. Sett `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM="AnbudRadar <varsler@ditt-domene.no>"`.
3. Test registrering (bekreftelseslenke) og glemt passord.

## AI

- **Anthropic (anbefalt):** `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL=claude-sonnet-5-5` (analyse, egnethet, lønnsomhet og tilbudstekst) og gjerne `ANTHROPIC_MODEL_FAST=claude-haiku-5-5` (korte sammendrag og ukesoversikt).
  Listepriser kontrollert 2.11.2026 ([Anthropic](https://platform.claude.com/docs/en/about-claude/pricing)): Sonnet 5.5 $2 inn / $10 ut per million tokens, bufret kildetekst $0,10; Haiku 5.5 $0,10 / $0,50 (inntil 100 000 tokens per forespørsel). Appen har disse prisene innebygd for kostnadssporingen.
- **OpenAI:** `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL` (med støtte for strukturerte svar / `json_schema`) og prisene i `AI_*_PRICE_PER_MTOK_USD`.

Sett en månedlig utgiftsgrense hos leverandøren. I tillegg begrenser kvotene per plan (10/60/250 analyser per måned) og `AI_MONTHLY_COST_LIMIT_USD_PER_ORG` forbruket per kunde, og identiske analyser hentes fra hurtigbufferen uten ny kostnad.

**Slik verifiserer du AI-en (én gang, med testdata):** sett nøkkelen i miljøet, åpne en ekte TED-kunngjøring, last opp et konkurransegrunnlag dere har lov til å bruke, og kjør analyse, egnethet og lønnsomhet. Kontroller at sitatene er merket «Sitat kontrollert», at tall uten kontrollert sitat ikke brukes i beregninger, og at kostnaden vises i Admin → AI-bruk.

Dokumenttekst behandles som upålitelig: den pakkes i egne kildemarkører, markører i selve teksten fjernes, modellen instrueres om å ignorere instruksjoner i kildene, og svaret må følge et fast JSON-skjema. Sitater og tall kontrolleres mot kildeteksten.

## Fillagring

`STORAGE_DRIVER=supabase` med en **privat** bøtte. Filene lagres under `orgs/<org-id>/…` og leses bare via appen etter tilgangskontroll. Lokal lagring (`STORAGE_DRIVER=local`) er for utvikling.
