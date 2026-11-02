# Personvern – teknisk oversikt

Grunnlag for personvernerklæringen og databehandleravtaler. Ikke juridisk rådgivning – la en jurist gå gjennom før lansering.

## Hvilke personopplysninger lagres

| Data | Hvorfor | Hvor |
| --- | --- | --- |
| Navn, e-post, passord (scrypt-hash) | Konto og innlogging | `users` |
| Sesjoner (hash av token), nettleser, IP-hash | Innlogging, sikkerhet | `sessions` |
| Medlemskap og roller | Tilgangskontroll | `organization_members` |
| Bedriftsprofil (oppgitt av kunden) | Matching og tilbudsutkast | `company_profiles` |
| Lagrede søk, lagrede anbud, notater | Funksjonalitet | `saved_searches`, `bookmarks` |
| Opplastede dokumenter og tilbudstekster | Analyse og tilbudsarbeid | `tender_documents`, `bid_*`, fillagring |
| Varsler og e-postlogg | Varsling | `notifications`, `email_outbox` |
| Revisjonslogg (hvem gjorde hva, IP-hash) | Sikkerhet og sporbarhet | `audit_logs` |
| Søkestatistikk: valgte bransjer/fylker og antall treff – ingen fritekst og ingen bruker-ID | Produktstatistikk | `search_events` |
| Økonomi og kapasitet: timekost, marginer, utstyr, eksisterende kontrakter (kan inneholde kundenavn), bemanning som **roller og antall – ikke navn** | Lønnsomhets- og kapasitetsanalyse | `org_economics`, `org_staff`, `org_equipment`, `org_contracts` |
| Kalkyler per anbud | Lønnsomhetsanalyse | `tender_calculations` |
| Partnerprofil (publiseres bare med samtykke; tidspunkt og tekstversjon lagres) | Anbudspartnere | `partner_profiles` |
| Partnerforespørsler med kontaktpersonens navn og e-post | Formidle kontakt (mottakerens kontaktinfo deles bare ved godkjenning) | `partner_requests` |

Ikke lagret: kortnummer (håndteres av Stripe), IP-adresser i klartekst, sporingskapsler, tredjeparts analyseverktøy.

Kunngjøringsdata er offentlige, men kan inneholde navn på kontaktpersoner og leverandører. De lagres slik kilden publiserer dem.

## Oppbevaring (automatisk sletting, daglig)

| Data | Slettes |
| --- | --- |
| Utløpte sesjoner | Straks de er utløpt |
| Lenker for e-postbekreftelse/passord | 7 dager etter utløp |
| Leste varsler | 180 dager (alle varsler etter 365 dager) |
| E-postlogg | 90 dager |
| Revisjonslogg og søkestatistikk | 365 dager |
| Importfeil, avsluttede jobber | 90 / 30 dager |
| Gamle invitasjoner | 90 dager |
| Partnerforespørsler | Ubesvarte 180 dager, avslåtte/trukne 12 måneder, godtatte 24 måneder |

Regler: `applyRetention()` i `src/domain/ops/tasks.ts`.

## Rettigheter

- **Innsyn/dataportabilitet:** Innstillinger → Personvern → «Last ned eksport» (JSON med konto, medlemskap, egen revisjonslogg, lagrede søk og varsler; for eier/administrator også bedriftsprofil, lagrede anbud, tilbudsarbeid, abonnement, betalinger og Profit Intelligence: økonomi, bemanning, utstyr, kontrakter, kalkyler, partnerprofil og partnerforespørsler).
- **Trekke samtykke (partnerprofil):** «Skjul profilen» på partnersiden. Profilen blir straks usynlig for andre (håndheves i databasen).
- **Sletting:** Brukeren kan slette kontoen (krever passord). Organisasjoner der brukeren er eneste medlem slettes samtidig, inkludert dokumenter i lagringen. Eier kan slette hele organisasjonen.
- **Retting:** Profil og kontoinfo kan endres i appen.

## Databehandlere (ved anbefalt oppsett)

| Leverandør | Rolle | Data |
| --- | --- | --- |
| Supabase | Database og fillagring (EU-region) | Alt over |
| Render (eller annen vert) | Kjører appen | Data i minnet under behandling, logger |
| Resend | E-postutsending | E-postadresse, e-postinnhold |
| Stripe | Betaling | Organisasjonsnavn, e-post, betalingsinfo (behandles av Stripe) |
| Anthropic eller OpenAI | AI-analyse | Kunngjøringstekst, opplastede dokumenter, bedriftsprofil ved egnethetsvurdering og tilbudsutkast. Lønnsomhetsanalysen sender **ikke** bedriftens kostnader, marginer eller bemanning |

Merk: AI-leverandørene behandler data i USA. Kontroller deres databehandleravtale, standard personvernbestemmelser og innstillinger for at API-data ikke brukes til trening, og opplys kundene om dette før de laster opp dokumenter.

## Sikkerhetstiltak

- Radnivåsikkerhet (RLS) i Postgres: webappen kobler til med en rolle som bare ser rader for organisasjonen brukeren er medlem av – også om applikasjonskoden skulle ha en feil.
- CSRF-token og opprinnelseskontroll på alle skjemaer, `SameSite=Lax` og `HttpOnly` på informasjonskapsler, streng innholdssikkerhetspolicy (CSP med nonce).
- Passord med scrypt, utestengelse etter gjentatte feil, begrensning av forsøk per IP og e-post.
- Hemmeligheter bare i servermiljøet. Ingen nøkler i nettleserkoden.
