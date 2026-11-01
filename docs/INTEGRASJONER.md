# Integrasjoner – hva du må skaffe

Alle integrasjoner er bygget, men **ingen er testet mot den ekte tjenesten** fra utviklingsmiljøet (nettverket var stengt for alt unntatt pakkeregistre). Tabellen viser hva som er gjort, og hva du må gjøre.

| Integrasjon | Trenger fra deg | Kostnad | Status i koden |
| --- | --- | --- | --- |
| TED (EU) | Ingenting (åpent API) | Gratis | Bygget etter TEDs søke-API v3. Oversettelsen er testet med konstruerte svar. Ikke kjørt mot live API. |
| Doffin | Abonnementsnøkkel fra Doffins API-portal | Gratis | Bygget etter Doffins offentlige API-modell. Feltnavn og typeverdier må bekreftes mot live API. |
| Stripe | Konto, 3 produkter/priser, webhook-hemmelighet | Transaksjonsgebyrer | Checkout, kundeportal, planbytte, oppsigelse og webhooks. Testet med simulert Stripe og signerte testhendelser. |
| E-post (Resend) | Konto, API-nøkkel, verifisert avsenderdomene | Gratis til 3 000 e-poster/mnd | Utgående kø med nye forsøk. Uten nøkkel logges e-post (vises i Admin → E-post). |
| AI (Anthropic eller OpenAI) | API-nøkkel, valgt modell, priser | Etter forbruk | Strukturerte svar, kildekontroll, kvoter, hurtigbuffer, kostnadslogg. Testet med simulert leverandør. |
| Fillagring (Supabase Storage) | Privat bøtte + service role-nøkkel | Inkludert i Supabase Pro | Testet lokalt med disklagring. |

## TED

- Endepunkt: `POST {TED_API_BASE_URL}/v3/notices/search` med spørringen `buyer-country=NOR AND publication-date>=ÅÅÅÅMMDD`, 100 per side, iterasjon med `iterationNextToken`, 0,5 s pause mellom sider.
- Felt som hentes: se `TED_FIELDS` i `src/connectors/ted.ts`.
- **Gjør først:** `npm run ingest -- --source ted --dry-run --limit 20`. Sjekk at titler, oppdragsgivere, frister og CPV-koder ser riktige ut. Blir felt tomme, juster `TED_FIELDS` og `mapTedNotice` (testene i `tests/unit/connectors.test.ts` viser forventet form).
- Vilkår: TED-data kan gjenbrukes med kildehenvisning («© Den europeiske union»), som står i bunnteksten. Les TEDs gjeldende vilkår for API-bruk før lansering.

## Doffin

1. Registrer deg i Doffins API-portal (lenke fra doffin.no / DFØ) og abonner på det offentlige API-et.
2. Sett `DOFFIN_API_KEY`. Sjekk at `DOFFIN_API_BASE_URL` stemmer med portalen (standard: `https://api.doffin.no/public/v2`).
3. Kjør `npm run ingest -- --source doffin --dry-run --limit 20` og sammenlign med de samme kunngjøringene på doffin.no.
4. Usikre punkter som må bekreftes: søkeparametrene (`issueDateFrom`, `page`, `numHitsPerPage`, `sortBy`), typeverdiene som brukes til livssyklus (`ANNOUNCEMENT_OF_COMPETITION`, `RESULT`, …) og datoformatet på `deadline`. Alt ligger i `src/connectors/doffin.ts`.
5. Vi bruker bare det offentlige API-et – ikke nettsidens interne API-er eller skraping.

En kilde vises først som tilkoblet for brukerne etter en vellykket ekte henting (`data_sources.verified_live`). Inntil da omtaler nettsiden bare «offentlige kilder».

## Stripe

1. Opprett konto (norsk selskap), og jobb i **testmodus** først.
2. Lag ett produkt med tre månedlige priser i NOK: 199 (Starter), 499 (Profesjonell), 999 (Bedrift). Sett `STRIPE_PRICE_*`.
   Prisene på nettsiden er eks. mva. – avklar med regnskapsfører om dere skal bruke Stripe Tax eller legge mva. på prisene.
3. Webhook-endepunkt: `https://din-domene.no/api/webhooks/stripe` med hendelsene
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`.
   Sett `STRIPE_WEBHOOK_SECRET` til signeringshemmeligheten.
4. Slå på **kundeportalen** (Settings → Billing → Customer portal): betalingsmåte, fakturaer, oppsigelse.
5. Test: kjøp med testkort `4242 4242 4242 4242`, sjekk at planen endres i appen (det skjer først når webhooken kommer), test feilende kort og oppsigelse.

Sikkerhet: betalt tilgang aktiveres bare av webhooks med gyldig signatur. Retur fra Checkout (`?checkout=fullfort`) endrer ingenting. Hendelser behandles én gang (`stripe_events`), og eldre hendelser kan ikke overskrive nyere.

## E-post (Resend)

1. Opprett konto og legg til domenet (DNS-poster for SPF/DKIM).
2. Sett `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM="AnbudRadar <varsler@ditt-domene.no>"`.
3. Test registrering (bekreftelseslenke) og glemt passord.

## AI

Velg én leverandør:

- **Anthropic:** `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL=claude-sonnet-5-5` (god kvalitet på norsk) eller `claude-haiku-5-5` (billigst). Priser per 1. nov. 2026: Sonnet 5.5 $2 inn / $10 ut, Haiku 5.5 $0,10 / $0,50 per million tokens. Sett `AI_INPUT_PRICE_PER_MTOK_USD` og `AI_OUTPUT_PRICE_PER_MTOK_USD` tilsvarende.
- **OpenAI:** `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL` (en modell med støtte for strukturerte svar / `json_schema`) og prisene.

Sett en månedlig utgiftsgrense hos leverandøren. Kvotene per plan (10/60/250 analyser per måned) begrenser i tillegg forbruket per kunde, og identiske analyser hentes fra hurtigbufferen uten ny kostnad.

Dokumenttekst behandles som upålitelig: den pakkes i egne kildemarkører, markører i selve teksten fjernes, modellen instrueres om å ignorere instruksjoner i kildene, og svaret må følge et fast JSON-skjema. Sitater kontrolleres mot kildeteksten, og bare kontrollerte sitater merkes «Sitat funnet i kilden».

## Fillagring

`STORAGE_DRIVER=supabase` med en **privat** bøtte. Filene lagres under `orgs/<org-id>/…` og leses bare via appen etter tilgangskontroll. Lokal lagring (`STORAGE_DRIVER=local`) er for utvikling.
