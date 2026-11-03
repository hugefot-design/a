# Drift og produksjonssetting

Anbefalt oppsett for lansering i Norge, med lav startkostnad:

| Del | Tjeneste (eksempel) | Merknad |
| --- | --- | --- |
| Database | Supabase Pro (EU-region, f.eks. Frankfurt/Stockholm) | Gratisplanen pauser prosjekter etter en uke uten aktivitet – ikke egnet for produksjon |
| Webapp | Render web service (Node) | 1 CPU / 2 GB anbefales (PDF-lesing bruker minne) |
| Arbeider | Render background worker | Henting, varsler, e-post, opprydding |
| Filer | Supabase Storage, privat bøtte | Lokal disk forsvinner ved ny deploy hos Render |
| E-post | Resend med eget domene | SPF/DKIM settes opp hos Resend |
| Betaling | Stripe (norsk konto) | Webhook til `/api/webhooks/stripe` |

Alt kan byttes: appen er en vanlig Node-prosess + en arbeiderprosess + PostgreSQL. Fly.io, Railway, en VPS eller Docker fungerer like godt.

## 0. Gratis testoppsett (for å se og prøve appen – ikke for betalende kunder)

Render Free + Supabase Free, 0 kr per måned. Én webtjeneste, ingen egen arbeider:

| Render-felt | Verdi |
| --- | --- |
| Branch | grenen med koden |
| Build Command | `npm ci --include=dev && npm run build && node dist/migrate.js` (gratisplanen har ikke Pre-Deploy) |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

Miljøvariabler (legges direkte på tjenesten, eller i en miljøgruppe som **kobles** til tjenesten): `NODE_ENV=production`, `APP_URL=https://<navn>.onrender.com` (nøyaktig adressen Render viser, eller eget domene når det er lagt inn – se punkt 3.5), `TRUST_PROXY=true`, `DATABASE_SSL=require`, `DATABASE_ADMIN_URL` (Supabase → Connect → Direct → **Session pooler**, adressen som den står, gjerne med `[YOUR-PASSWORD]`), `DATABASE_ADMIN_PASSWORD` (databasepassordet, limt inn som det er – spesialtegn håndteres automatisk), `DATABASE_APP_PASSWORD`, `SESSION_SECRET` og `CRON_SECRET` (de tre siste med «Generate»), og **`RUN_WORKER_IN_WEB=true`** så nettsiden selv henter anbud, beregner treff og sender varsler.

`DATABASE_URL` trengs ikke i dette oppsettet: den lages fra `DATABASE_ADMIN_URL` og `DATABASE_APP_PASSWORD`, og migreringen oppretter rollen `anbudradar_app` selv første gang (SQL-steget i avsnitt 1 kan hoppes over). Byggeloggen bekrefter med «App-brukeren kan logge inn i databasen». Node-versjonen er låst til 22 i `package.json`.

E-post i testperioden: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` (helst en nøkkel med bare «Sending access»), `EMAIL_FROM=onboarding@resend.dev` til et eget domene er verifisert i Resend, og **`EMAIL_ALLOWED_RECIPIENTS`** med egne testadresser. Da stoppes e-post til alle andre før Resend kalles (vises som «failed» med forklaring i utboksen). Fjern listen først ved lansering.

Eget e-postdomene (`anbudradar.com`, lagt inn i Resend med EU-region): DNS ligger hos Namecheap (Domain List → Manage → Advanced DNS). Under **Host Records** legges `TXT resend._domainkey` (DKIM-verdien Resend viser), `TXT send` (`v=spf1 include:amazonses.com ~all`) og `CNAME rsend` (`send.forge.rmta.net`) inn, og anbefalt `TXT _dmarc` (`v=DMARC1; p=none;`). Under **Mail Settings** må «Custom MX» velges for å legge inn `MX send` → `feedback-smtp.eu-west-1.amazonses.com` (prioritet 10). Det fjerner Namecheaps MX-poster for e-postvideresending, så de legges inn igjen for `@`: `eforward1`, `eforward2` og `eforward3.registrar-servers.com` (10), `eforward4…` (15) og `eforward5…` (20), og `TXT @ v=spf1 include:spf.efwd.registrar-servers.com ~all` – den forsvinner når «Custom MX» velges (sett 3.11.2026). Sjekk postene mot en offentlig DNS-tjeneste; et oppslag gjort før postene fantes, kan bli husket en stund (Googles DNS viste `TXT send` som manglende, Cloudflare viste den). Når Resend viser domenet som verifisert: `EMAIL_FROM="AnbudRadar <varsler@anbudradar.com>"` og ny deploy.

Admin-tilgang uten databasetilgang: registrer deg i appen, sett `PLATFORM_ADMIN_EMAILS` til e-postadressen og deploy. Byggeloggen viser «Plattform-admin gitt til …» (maskert), og endringen revisjonslogges. Listen gir bare tilgang – fjerning gjøres med `npm run make-admin -- <e-post> --remove`.

Begrensninger: tjenesten sover etter en stund uten besøk (første besøk tar 30–60 s, og jobbene står stille mens den sover), 0,1 CPU, Supabase Free pauser etter en uke uten bruk og har ingen sikkerhetskopi. Ingen e-post uten Resend (`EMAIL_PROVIDER=log` skriver dem til loggen). Bytt til oppsettet under før første betalende kunde, og fjern da `RUN_WORKER_IN_WEB`.

## 1. Database (Supabase)

1. Opprett prosjekt i EU-region. Noter databasepassordet.
2. Åpne **SQL Editor** og kjør `db/supabase-app-role.sql` – bytt passordet i filen med et langt tilfeldig passord først. (Alternativ: sett `DATABASE_APP_PASSWORD` i stedet for `DATABASE_URL`, så oppretter migreringen rollen selv.)
3. Koblingsstrenger (Project Settings → Database):
   - `DATABASE_ADMIN_URL` = rollen `postgres` (direkte tilkobling eller *Session pooler*, port 5432).
   - `DATABASE_URL` = samme vert og port, men brukeren `anbudradar_app` og passordet fra steg 2.
     Med Supabase-pooleren har brukernavnet formen `anbudradar_app.<prosjekt-ref>`.
   - Sett `DATABASE_SSL=require`.
   - Bruker du *Transaction pooler* (port 6543), sett også `DATABASE_PREPARE=false`.
4. Kjør migreringer fra din maskin eller som deploy-steg: `npm run db:migrate` (bruker `DATABASE_ADMIN_URL`).
   Migreringen stopper med en tydelig feil hvis rollen `anbudradar_app` mangler. Den fjerner også Supabase-rollene `anon`/`authenticated` sin tilgang til tabellene, så databasen ikke kan leses via Supabase sitt auto-API.
5. Slå på daglig sikkerhetskopi (inkludert i Pro). Vurder PITR når dere har betalende kunder.

## 2. Fillagring (Supabase Storage)

1. Lag en **privat** bøtte `anbudradar` (Storage → New bucket, ikke «public»).
2. Sett `STORAGE_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` og `SUPABASE_STORAGE_BUCKET`.
   Service role-nøkkelen gir full tilgang – den skal bare ligge i servermiljøet.

## 3. Webapp og arbeider (Render)

**Enklest: Blueprint.** Repoet har `render.yaml` med webapp og arbeider i Frankfurt. Filen oppretter ingenting av seg selv – i Render velger du *New → Blueprint*, kobler til repoet, ser over tjenestene og prisen, og limer inn hemmelighetene Render ber om (`sync: false`). `SESSION_SECRET` og `CRON_SECRET` genereres av Render og deles mellom webapp og arbeider (avmeldingslenker i e-post signeres med `SESSION_SECRET`, så verdien må være lik). *Blueprint-filen er ikke prøvd mot Render ennå – kontroller forhåndsvisningen før du bekrefter.*

**Manuelt:**

1. Legg koden i et Git-repo (`package-lock.json` er med).
2. **Web service:** Build `npm ci --include=dev && npm run build`, Pre-deploy `node dist/migrate.js`, Start `npm start`, helsesjekk `/api/health`.
   (`--include=dev` trengs fordi byggeverktøyene er utviklingsavhengigheter og `NODE_ENV=production` ellers hopper over dem.)
3. **Background worker:** samme repo og bygg, Start `npm run worker`.
4. Miljøvariabler på begge (se `.env.example`): `NODE_ENV=production`, `APP_URL=https://…`, `TRUST_PROXY=true`, database, `SESSION_SECRET` (samme på begge), `CRON_SECRET`, AI, e-post, Stripe og lagring.
   Appen nekter å starte i produksjon med `AI_PROVIDER=mock`, http-adresse, utviklingshemmelighet eller uten `CRON_SECRET`.
5. Eget domene: legg det til hos Render (Settings → Custom Domains, med `www` som videresender til hovedadressen), og sett
   `APP_URL` til hovedadressen, f.eks. `https://anbudradar.com`. **Begge deler trengs:** skjemaer godtas bare fra `APP_URL`
   (CSRF), så innlogging feiler på en adresse som ikke er `APP_URL`. I produksjon sender appen sider som åpnes på en annen
   adresse (som `<navn>.onrender.com`) videre til samme side på `APP_URL` (301), mens `/api/…` (helsesjekk, webhooks) svarer
   direkte. La «Render Subdomain» stå på, så gamle lenker fortsatt virker. Innloggede brukere må logge inn på nytt etter
   byttet (innloggingskapselen gjelder bare én adresse).

**Hemmeligheter** legges bare inn i Render-dashbordet (Environment) eller i Supabase/Stripe/Resend sine egne kontrollpaneler – aldri i koden, i `render.yaml` eller i chat. `.env` er utelatt fra Git (`.gitignore`).

**Uten arbeiderprosess** (f.eks. på en plattform med bare webprosesser): kall oppgavene fra en ekstern cron med `Authorization: Bearer $CRON_SECRET`:

```
POST /api/cron/ingest-ted         hver 2. time
POST /api/cron/ingest-doffin      hver 2. time
POST /api/cron/enrich-doffin      hvert 10. minutt (gjør ingenting før DOFFIN_ENRICH_XML=true)
POST /api/cron/notifications      hvert 15. minutt
POST /api/cron/emails             hvert 5. minutt
POST /api/cron/weekly             hver time (sender bare mandag morgen)
POST /api/cron/refresh-matches    daglig
POST /api/cron/retention          daglig
POST /api/cron/reconcile-stripe   hver 6. time (sammenligner abonnementer med Stripe)
```

Oppgavene tar en lås i databasen (med utløpstid), så to samtidige kall – eller en arbeider og en ekstern cron – aldri kjører samme oppgave samtidig. Låsen fungerer også bak Supabase-pooleren.

## 4. Første oppstart

```bash
npm run db:migrate
npm run ingest -- --source ted --dry-run --limit 20      # viser hva som ville blitt lagret
npm run ingest -- --source ted                           # første ekte henting
npm run make-admin -- deg@firma.no                       # etter at du har registrert deg i appen
```

Sjekk deretter **Admin → Kilder**: en kilde markeres «verifisert» først når en ekte henting har gått uten feil. Frem til da vises den som «ikke verifisert», også for brukerne.

## 5. Sjekkliste før lansering

- [ ] Personvernerklæring og vilkår gjennomgått av jurist → `LEGAL_PAGES_REVIEWED=true` (ellers vises «Utkast»)
- [ ] `COMPANY_*` fylt ut (vises i vilkår, personvern og e-post)
- [ ] Databehandleravtaler (DPA) med Supabase, Render, Resend, Stripe og AI-leverandøren
- [ ] TED-henting verifisert i Admin → Kilder; Doffin-nøkkel og feltoppsett verifisert (se INTEGRASJONER.md)
- [ ] Stripe i live-modus: produkter, priser, webhook, kundeportal, MVA/faktura-oppsett
- [ ] E-post: domenet verifisert hos Resend, test registrering og glemt passord
- [ ] AI: modell valgt, priser satt i `AI_*_PRICE_PER_MTOK_USD`, utgiftsgrense satt hos leverandøren
- [ ] Sikkerhetskopi av databasen slått på, og gjenoppretting testet én gang
- [ ] Overvåking: oppetidssjekk mot `/api/health`, varsling ved feil i logg (Render log streams eller tilsvarende)
- [ ] Fjern eventuelle eksempeldata (`db:seed-dev` kjører uansett ikke i produksjon)
- [ ] Profit Intelligence: samtykketeksten for partnerprofiler og den konkurranserettslige veiledningen gjennomgått av advokat
- [ ] CI grønn på `main` før første produksjonsdeploy

## 6. Sikkerhetskopi og gjenoppretting

- **Daglig sikkerhetskopi** er inkludert i Supabase Pro (7 dager). Slå på **PITR** (gjenoppretting til et tidspunkt) når dere har betalende kunder.
- **Egen kopi utenfor Supabase** (anbefalt ukentlig, lagres kryptert et annet sted):
  ```bash
  pg_dump "$DATABASE_ADMIN_URL" --format=custom --no-owner --file=anbudradar-$(date +%F).dump
  ```
- **Test gjenoppretting minst én gang før lansering**, til en ny tom database:
  ```bash
  createdb anbudradar_restore_test
  pg_restore --no-owner --dbname=anbudradar_restore_test anbudradar-ÅÅÅÅ-MM-DD.dump
  ```
  Kontroller at `schema_migrations` har alle migreringene, og at antall rader i `organizations`, `subscriptions` og `tenders` stemmer.
- **Opplastede filer** ligger i Supabase Storage og er ikke med i databasekopien. Dokumentene kan lastes opp på nytt av kundene, men vurder periodisk kopi av bøtta.

## 7. Utrulling og tilbakerulling

- **Migreringer er bare fremover og kjøres før ny kode tar trafikk** (`preDeployCommand`). Migreringene 0006–0010 legger til kolonner, tabeller, indekser og tilgangsregler, retter referansedata (NUTS-koder for fylker og frister på eksisterende kunngjøringer) og strammer inn rettighetene til webapp-rollen. Ingen tabeller eller kolonner slettes, så forrige versjon av koden på denne grenen fungerer mot det nye skjemaet. Å gå helt tilbake til den opprinnelige koden fra zip-filen etter 0007 er ikke støttet – tilgangsmodellen er strengere nå.
- **Tilbakerulling av kode:** Render → tjenesten → *Events* → velg forrige vellykkede deploy → *Rollback*. Gjør det samme for arbeideren.
- **Tilbakerulling av database** (sjelden – bare hvis en migrering har ødelagt data): stopp arbeideren, gjenopprett med PITR til tidspunktet før deploy, rull tilbake koden, start arbeideren. Skriv ned hva som skjedde.
- **Før hver deploy med ny migrering:** ta en manuell sikkerhetskopi (Supabase → Database → Backups), kjør migreringen mot en kopi eller staging først hvis den endrer eksisterende data.
- Hold `autoDeploy: false` til dere har CI som må være grønn før deploy.

## 8. Kontinuerlig integrasjon (CI)

`.github/workflows/ci.yml` kjører typesjekk, enhetstester, integrasjonstester mot PostgreSQL 16, produksjonsbygg og ende-til-ende i Chromium ved pull request og push til `main`. Ingen hemmeligheter trengs (AI, e-post og Stripe er simulert i `.env.test`). GitHub Actions er gratis for offentlige repoer; for private repoer bruker kjøringene av kontoens inkluderte minutter (ca. 6–10 minutter per kjøring).

## 9. Overvåking

- Oppetidssjekk mot `/api/health` hvert minutt (f.eks. Better Stack eller UptimeRobot). Svarer `503` når databasen ikke svarer.
- **Admin → Helse**: arbeiderens siste livstegn, jobbkø, siste henting per kilde, e-postkø og feilede jobber.
- Varsle på loggmeldingene `worker_tick_failed`, `stripe_webhook_failed`, `email_send_failed` og `ai_cost_limit_reached`.

## Logger og feilsøking

- Logger skrives som én linje JSON per hendelse til stdout (ingen personopplysninger utover bruker-ID).
- **Admin → Helse** viser databasestatus, arbeiderens siste livstegn, jobbkø og integrasjonsstatus.
- **Admin → Importer** viser hver kjøring med antall nye/oppdaterte/duplikater og feil per kunngjøring.
