# Integrasjoner – status og hva du må skaffe

Sist oppdatert 2. november 2026. **VERIFISERT** betyr kjørt mot den ekte tjenesten fra utviklingsmiljøet. **IKKE VERIFISERT** betyr bygget etter leverandørens dokumentasjon og testet med simulerte svar – det må prøves med ekte nøkler før lansering.

| Integrasjon | Status | Trenger fra deg | Kostnad |
| --- | --- | --- | --- |
| TED (EU) | **VERIFISERT** mot live API 1.11.2026: 1 194 norske kunngjøringer hentet, ekte import 1 110 nye + 82 slått sammen, ny kjøring ga 0 duplikater og 0 falske endringer | Ingenting (åpent API) | Gratis |
| Doffin | **IKKE VERIFISERT** – bygget etter Doffins offentlige API v2 (dokumentasjon i API-portalen) | Abonnementsnøkkel fra Doffins API-portal | Gratis |
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

1. Registrer deg i Doffins API-portal (lenke fra doffin.no / DFØ) og abonner på det offentlige API-et.
2. Sett `DOFFIN_API_KEY`. Sjekk at `DOFFIN_API_BASE_URL` stemmer med portalen (standard: `https://api.doffin.no/public/v2`).
3. Kjør `npm run ingest -- --source doffin --dry-run --limit 20` og sammenlign med de samme kunngjøringene på doffin.no.
4. Slik er hentingen bygget (etter API-portalens dokumentasjon): `GET /public/v2/search` med `Ocp-Apim-Subscription-Key`, sider fra 1, høyst 10 sider à 100 treff per søk – derfor hentes én dag om gangen, delt på kunngjøringstyper. Tempoet holdes under grensen på 30 søk per minutt, og `Retry-After` respekteres. Bekreft ved første kjøring: typeverdiene for livssyklus, datoformatet på frister og at antall treff per dag stemmer med doffin.no. Alt ligger i `src/connectors/doffin.ts`.
5. `--dry-run` lagrer og endrer ingenting (dekket av tester).
6. Vi bruker bare det offentlige API-et – ikke nettsidens interne API-er eller skraping.

En kilde vises først som tilkoblet for brukerne etter en vellykket ekte henting (`data_sources.verified_live`). Inntil da omtaler nettsiden bare «offentlige kilder».

## Stripe

1. Opprett konto (norsk selskap), og jobb i **testmodus** først.
2. Lag ett produkt med tre månedlige priser i NOK: 199 (Start), 499 (Profesjonell), 999 (Bedrift). Sett `STRIPE_PRICE_*`. Kontroller deretter under **Admin → Helse → Priser i Stripe** at pris-ID-ene er aktive, i NOK, månedlige og har riktig beløp (kontrollen leser bare).
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
