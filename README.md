# AnbudRadar

Finner offentlige anbud som passer bedriften, forklarer kravene med kildehenvisning og hjelper teamet å forberede tilbud. Norge først (Doffin + TED), bygget for å utvides til Sverige, Danmark, Finland og Tyskland.

> **Status (14. november 2026):** Kjører i produksjon på [anbudradar.com](https://anbudradar.com) (Render og Supabase, gratisplaner).
> Ekte anbud fra **TED** og **Doffin** (begge verifisert mot live API) og e-post via **Resend** (verifisert).
> **Ikke slått på i produksjon** (mangler nøkler eller valg fra eier): AI, kortbetaling (Stripe – kundene kan melde
> interesse for en plan), fillagring i Supabase Storage (opplastede filer ligger på serverens disk og forsvinner ved ny
> utrulling) og automatisk sikkerhetskopi. Sidene og e-postene lover ikke det som er av (produktløftet rullet ut 14.11.2026 – se STATUS).
> Testresultater og verifisering: [docs/STATUS.md](docs/STATUS.md). Hva som blokkerer lansering:
> [docs/TRANSFORMASJON.md](docs/TRANSFORMASJON.md#6-det-som-fortsatt-blokkerer-lansering-krever-eier).

## Innhold

| Modul | Hva den gjør |
| --- | --- |
| Søk og oppdagelse | Fritekst, naturlig språk («renhold i Trøndelag over 1 million») tolket uten AI, filtre for bransje, fylke, sted, verdi, frist, status, CPV, oppdragsgiver og ekskluderinger. Lagrede søk og lagrede anbud. |
| AI-analyse | Sammendrag, krav, kvalifikasjoner, sertifiseringer, tildelingskriterier, risiko og åpne spørsmål – hver påstand med kilde, sidetall og sitat som kontrolleres mot teksten. Opplastede PDF/DOCX-dokumenter tas med. |
| Relevans | Deterministisk poengsum (0–100) mot bedriftsprofilen med begrunnelse, mangler, mulige absolutte krav og neste steg. Ikke en vinnersannsynlighet. |
| Varsler | Nye treff, lagrede søk, fristpåminnelser (7/3/1 dag), endringer, avlysninger, konkurrenttildelinger, ukesoversikt. E-post samlet etter valgt frekvens, uten duplikater. |
| Konkurrentinnsikt | Tildelinger fra kunngjøringene, med tydelig dekningsgrad. Ingen anslag. |
| Tilbudsarbeid | Sjekkliste, tekstseksjoner med AI-utkast (bare fakta fra profilen, ellers `[FYLL INN: …]`), sammenligning mot krav, vedlegg, godkjenningsflyt og eksport (Word, Markdown, utskrift/PDF). |
| Profit Intelligence | Lønnsomhet per anbud med bedriftens egne kostnader: selvkost, minstepris, prisintervall, følsomhet og formler. Kontraktsrisiko (dagbøter, betalingsfrist, prisregulering, garantier) med side og sitat. Kapasitet, kvalifikasjoner og anbefaling (Vurder å by / Undersøk nærmere / Høy risiko). Se [docs/PROFIT_INTELLIGENCE.md](docs/PROFIT_INTELLIGENCE.md). |
| Anbudspartnere | Partnerprofil med samtykke, søk og forklarte forslag ut fra manglene, forespørsler med konkurranserettslig sperre og kontaktdeling bare ved godkjenning. |
| Konto og sikkerhet | Registrering, e-postbekreftelse, glemt passord, organisasjoner, roller, invitasjoner, revisjonslogg, dataeksport, sletting. Radnivåsikkerhet i databasen. |
| Abonnement | Gratis, Start 299 / Profesjonell 699 / Bedrift 1 490 kr per måned via Stripe, Enterprise fra 4 990 kr (manuelt). Tilgang styres kun av signerte webhooks; gamle hendelser kan ikke gjenopplive et avsluttet abonnement. Så lenge Stripe ikke er satt opp, kan kunden «Meld interesse» for en plan (havner i Admin → Henvendelser), og administrator kan sette planen manuelt. |
| Admin | Brukere, organisasjoner, manuelle avtaler, importkjøringer, kilder, AI-forbruk, e-postlogg, feilrapporter, revisjonslogg, systemhelse. |

## Kom i gang lokalt

Krav: Node.js 22.12+ og PostgreSQL 16 (15 fungerer trolig også).

```bash
npm install                                   # første gang (lager også package-lock.json – commit den)
npm run db:setup-local                        # roller og databaser (krever superbruker; på Linux: sudo -u postgres bash scripts/setup-local-db.sh)
cp .env.example .env                          # fyll inn – utviklingsverdiene i filen fungerer lokalt
npm run db:reset-dev                          # migreringer + tydelig merkede eksempeldata
npm run dev                                   # http://localhost:3000
npm run worker:dev                            # i et eget vindu: henting, varsler og e-post
```

Innlogging med eksempeldata (bare utvikling – `db:seed-dev` nekter å kjøre i produksjon):

| Rolle | E-post | Passord |
| --- | --- | --- |
| Bedrift-plan | demo@example.com | demo-passord-2026 |
| Plattform-admin | admin@example.com | admin-passord-2026 |
| Prøveperiode (Profesjonell) | bygg@example.com | bygg-passord-2026 |

Alle eksempelkunngjøringer heter «… (eksempel)», er merket «Eksempeldata» i grensesnittet og har ingen kildelenke.

## Kommandoer

| Kommando | Formål |
| --- | --- |
| `npm run dev` / `npm run worker:dev` | Utvikling med automatisk omstart |
| `npm run build` → `npm start` + `npm run worker` | Produksjonsbygg (`dist/`) og drift |
| `npm run db:migrate` | Kjør nye migreringer |
| `npm run ingest -- --source ted --dry-run` | Test en kilde uten å lagre (gjør dette først i nytt miljø) |
| `npm run ingest -- --source doffin --since 2026-10-01` | Hent fra en dato |
| `npm run import:file -- fil.json` | Manuell import (format: [docs/IMPORTFORMAT.md](docs/IMPORTFORMAT.md)) |
| `npm run import:cpv -- cpv.csv` | Full CPV-liste med norske tekster |
| `npm run make-admin -- deg@firma.no` | Gjør en registrert bruker til plattform-admin |
| `npm test` | Enhetstester + integrasjonstester (krever testdatabasen) |
| `npm run test:e2e` | Nettlesertester med Playwright (`npx playwright install chromium` første gang) |
| `npm run test:all` | Typesjekk + alle tester |

## Arkitektur i korte trekk

- **Server:** TypeScript, Node `http`, React 19 server-rendering (ingen klient-rammeverk; ca. 3 kB JavaScript for små forbedringer). Skjemaer fungerer uten JavaScript.
- **Database:** PostgreSQL. To roller: `anbudradar_app` (webappen, underlagt RLS) og eier-rollen (migreringer, jobber). Organisasjonskonteksten settes per transaksjon og gjelder bare hvis brukeren er medlem.
- **Jobber:** Køen ligger i Postgres (`jobs`), ingen Redis. Én arbeiderprosess (`npm run worker`) – eller `POST /api/cron/:oppgave` fra en ekstern cron.
- **AI:** OpenAI eller Anthropic via egen tynn klient, strukturerte svar (JSON-skjema), kildekontroll, hurtigbuffer, kvoter og kostnadslogg. `AI_PROVIDER=mock` gir merkede, simulerte svar i utvikling.
- **Stil:** Tailwind CSS v4, egne komponenter, lokale fonter (Instrument Sans, IBM Plex Serif – OFL).

```
src/
  connectors/   TED, Doffin, manuell import, eksempeldata
  domain/       forretningslogikk (søk, matching, AI, varsler, tilbud, betaling, …)
  routes/       HTTP-ruter
  server/       HTTP-rammeverk, sikkerhetshoder, CSRF, sesjoner
  ui/           React-komponenter og sider
db/migrations/  SQL-migreringer (skjema, RLS, referansedata)
scripts/        bygg, arbeider, import, admin
tests/          enhet, integrasjon (mot testdatabase), e2e (Playwright)
docs/           drift, integrasjoner, importformat, personvern, status
```

## Videre lesing

- [docs/STATUS.md](docs/STATUS.md) – testresultater, verifiseringsstatus, kjente begrensninger, kostnadsestimat og neste steg
- [docs/LANSERING.md](docs/LANSERING.md) – lanseringssjekkliste og plan for de første 10/50/100 kundene
- [docs/PROFIT_INTELLIGENCE.md](docs/PROFIT_INTELLIGENCE.md) – lønnsomhet, kontraktsrisiko, kapasitet og anbudspartnere
- [docs/GJENNOMGANG.md](docs/GJENNOMGANG.md) – gjennomgangen av utgangspunktet (hva som var simulert, feil og risikoer)
- [docs/DRIFT.md](docs/DRIFT.md) – produksjonssetting (Supabase + Render eller tilsvarende)
- [docs/INTEGRASJONER.md](docs/INTEGRASJONER.md) – hva du må skaffe av nøkler og kontoer
- [docs/PERSONVERN.md](docs/PERSONVERN.md) – hvilke data som lagres og hvor lenge
- [docs/IMPORTFORMAT.md](docs/IMPORTFORMAT.md) – manuell import
