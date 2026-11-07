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

E-post i testperioden: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` (helst en nøkkel med bare «Sending access»), `EMAIL_FROM=onboarding@resend.dev` til et eget domene er verifisert i Resend, og **`EMAIL_ALLOWED_RECIPIENTS`** med egne testadresser. Da stoppes e-post til alle andre før Resend kalles (vises som «failed» med forklaring i utboksen). Fjern listen først ved lansering. **Fjernet 6. november 2026 etter godkjenning fra eier** – nå får alle mottakere e-post. Adresser på reserverte testdomener (`example.com`, `.test`, `.invalid` osv.) får aldri e-post fra Resend, så testkontoer ikke gir tilbakesendinger.

Eget e-postdomene (`anbudradar.com`, lagt inn i Resend med EU-region): DNS ligger hos Namecheap (Domain List → Manage → Advanced DNS). Under **Host Records** legges `TXT resend._domainkey` (DKIM-verdien Resend viser), `TXT send` (`v=spf1 include:amazonses.com ~all`) og `CNAME rsend` (`send.forge.rmta.net`) inn, og anbefalt `TXT _dmarc` (`v=DMARC1; p=none;`). Under **Mail Settings** må «Custom MX» velges for å legge inn `MX send` → `feedback-smtp.eu-west-1.amazonses.com` (prioritet 10). Det fjerner Namecheaps MX-poster for e-postvideresending, så de legges inn igjen for `@`: `eforward1`, `eforward2` og `eforward3.registrar-servers.com` (10), `eforward4…` (15) og `eforward5…` (20), og `TXT @ v=spf1 include:spf.efwd.registrar-servers.com ~all` – den forsvinner når «Custom MX» velges (sett 3.11.2026). Sjekk postene mot en offentlig DNS-tjeneste; et oppslag gjort før postene fantes, kan bli husket en stund (Googles DNS viste `TXT send` som manglende, Cloudflare viste den). Når Resend viser domenet som verifisert: `EMAIL_FROM="AnbudRadar <varsler@anbudradar.com>"` og ny deploy.

Admin-tilgang uten databasetilgang: registrer deg i appen, sett `PLATFORM_ADMIN_EMAILS` til e-postadressen og deploy. Byggeloggen viser «Plattform-admin gitt til …» (maskert), og endringen revisjonslogges. Listen gir bare tilgang – fjerning gjøres med `npm run make-admin -- <e-post> --remove`.

Plattform-administratorer havner i admin-panelet (`/admin`) når de logger inn (en `neste`-lenke går foran). Forsiden **Oversikt** viser nøkkeltall med trend, det som trenger oppmerksomhet (feilet henting, kilder som ikke er hentet nylig, bakgrunnsjobber, e-post som ikke gikk eller ble stoppet av testlisten, ubesvarte henvendelser, prøveperioder som slutter), en lanseringssjekk beregnet fra oppsettet, datakildene med «Hent nå», nye anbud og brukere per dag (med tabell) og siste hendelser. Oversikten viser ingen navn eller e-postadresser til brukere.

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

## 2. Fillagring (Supabase Storage) – gjør dette før kundene laster opp dokumenter

Uten dette lagres opplastede filer (konkurransegrunnlag, tilbudsvedlegg) på serverdisken hos Render. Den tømmes ved
hver ny versjon og når gratistjenesten sover – filene forsvinner. **Admin → Oversikt → Klar for lansering** viser hvor
filene lagres nå («Filer»). Gratisplanen hos Supabase har 1 GB fillagring; ingen ny leverandør.

1. Supabase → **Storage** → **New bucket** → navn `anbudradar` → la **Public bucket** være **av** → *Create bucket*.
2. Supabase → **Project Settings** → **Data API** (eldre visning: **API**): kopier *Project URL*. Under **API Keys**
   (fanen «Legacy API keys» hvis du ser to faner): kopier **service_role** (hemmelig – den gir full tilgang og skal bare
   ligge i servermiljøet, aldri i koden eller i chat).
3. Render → **Environment Groups** → gruppen tjenesten bruker → legg til:
   `STORAGE_DRIVER=supabase`, `SUPABASE_URL=<Project URL>`, `SUPABASE_SERVICE_ROLE_KEY=<service_role>`,
   `SUPABASE_STORAGE_BUCKET=anbudradar`. Lagre. Endringen tar effekt ved neste utrulling (du bestemmer når).
4. Kontroll: Admin → Oversikt skal vise «Filer: Klar» (appen sjekker at bøtta finnes og at den er privat; en offentlig
   bøtte gir rød advarsel).

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

## 6. Sikkerhetskopi og gjenoppretting (gratis, automatisk)

Gratisplanen hos Supabase har ingen sikkerhetskopi. Jobben `.github/workflows/sikkerhetskopi.yml` lager derfor en selv,
hver natt kl. 02:23 UTC:

1. `pg_dump` av databasen, kryptert med AES-256 (gpg) og en passordfrase bare du har (`scripts/backup/backup.sh`).
2. Opplasting til den **private** bøtta `sikkerhetskopier` i Supabase Storage; kopier eldre enn 30 dager slettes
   (`scripts/backup/upload.sh`). Jobben nekter å bruke en offentlig bøtte.
3. **Generalprøve hver natt:** kopien legges inn i en tom PostgreSQL på GitHub sin maskin, tabellene, migreringene og
   radnivåsikkerheten kontrolleres, og migreringene i koden kjøres mot kopien (`scripts/backup/restore-check.sh`).
   Feiler noe, åpnes GitHub-saken «Driftsvarsel: sikkerhetskopi feilet» (GitHub sender e-post); den lukkes av seg selv
   neste gang kopien går bra.

Til hemmelighetene er lagt inn, hopper jobben over med en advarsel. Repoet er offentlig, derfor legges kopien aldri som
GitHub-artefakt, og loggen viser bare filnavn, størrelse og antall tabeller/migreringer – ikke antall kunder eller brukere.

**Før du slår den på – personvern:** kopien lages og prøves på GitHub sine maskiner (GitHub/Microsoft, kan være i USA).
Databasen behandles der i noen minutter hver natt (kryptert før lagring, men lesbar i minnet under kopiering og
generalprøve). GitHub blir dermed **underleverandør (databehandler)** og må stå i listen på `/underleverandorer` før du
legger inn hemmelighetene. Si fra, så legger jeg den inn.

**Oppsett (ca. 10 minutter):**

1. Supabase → Storage: du trenger ikke lage bøtta – jobben lager `sikkerhetskopier` som privat første gang.
2. Lag en passordfrase på minst 24 tegn (f.eks. fem tilfeldige ord). **Skriv den ned og oppbevar den trygt utenfor
   GitHub og Supabase** (passordbehandler eller papir i safe). Uten den kan ingen – heller ikke du – åpne kopiene.
3. GitHub → repoet → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, fire ganger:
   - `BACKUP_DATABASE_URL` = samme verdi som `DATABASE_ADMIN_URL` i Render (Session pooler, port 5432).
   - `BACKUP_PASSPHRASE` = passordfrasen fra steg 2.
   - `SUPABASE_URL` = *Project URL*.
   - `SUPABASE_SERVICE_ROLE_KEY` = nøkkelen *service_role*.
4. GitHub → **Actions** → **Sikkerhetskopi** → **Run workflow**. Etter 3–5 minutter skal kjøringen være grønn, og
   bøtta `sikkerhetskopier` i Supabase skal ha en fil `db/anbudradar-ÅÅÅÅ-MM-DDTHHMMZ.dump.gpg`.

**Gjenoppretting (når uhellet er ute):**

1. Last ned siste kopi fra Supabase → Storage → `sikkerhetskopier` → `db/`.
2. Lag et nytt, tomt Supabase-prosjekt (eller en tom database) og kjør
   `BACKUP_PASSPHRASE=… SHOW_COUNTS=1 scripts/backup/restore-check.sh kopi.dump.gpg "<tilkobling til TOM database>"`.
   Skriptet nekter å skrive til en database som ikke er tom, og viser antall organisasjoner, brukere og anbud.
3. Kjør `db/supabase-app-role.sql` i det nye prosjektet (passord for `anbudradar_app`), sett nye `DATABASE_URL` og
   `DATABASE_ADMIN_URL` i Render, og rull ut.

**Begrensninger:** kopien tas én gang i døgnet (inntil ett døgns arbeid kan gå tapt), og filene i bøtta `anbudradar` er
ikke med. Supabase Pro (25 USD/mnd) gir i tillegg Supabases egne daglige kopier, og PITR gir gjenoppretting til et
bestemt tidspunkt. GitHub skrur av planlagte jobber i offentlige repoer etter 60 dager uten aktivitet i repoet – da
kommer det en e-post fra GitHub, og jobben slås på igjen under **Actions**.

## 6b. Totrinnsinnlogging, passkeys og sikkerhetsvarsler

- **Påkrevd for administratorer.** Første gang en administrator går til `/admin` etter innlogging, sendes hen til
  `/konto/totrinn` for å skanne QR-koden med en kode-app (Google Authenticator, Microsoft Authenticator, 1Password).
  Deretter kreves koden ved hver innlogging. Vanlige brukere kan slå det på under **Innstillinger**.
- **Admin er usynlig for andre.** `/admin` svarer «Siden finnes ikke» for alle som ikke er logget inn som administrator
  – det finnes ingen egen innloggingsside for admin, og `robots.txt` nevner ikke admin. Logg inn på den vanlige
  innloggingssiden; administratorer havner i admin-panelet derfra.
- **Ny bekreftelse i admin.** Hver økt husker når totrinn sist ble bekreftet (`sessions.mfa_verified_at`). Admin-panelet
  ber om ny kode (eller passkey) etter **12 timer**, og viktige endringer – admin-tilgang, plan, datakilder, filimport,
  legge til/fjerne passkey – krever bekreftelse de siste **15 minuttene** (`/konto/bekreft`). Rutene er merket
  `sensitive: true`; grensene står i `src/domain/auth/mfa.ts`.
- **Passkeys (Face ID / fingeravtrykk / sikkerhetsnøkkel)** kan legges til under **Min innlogging** (`/konto/totrinn`)
  og brukes i stedet for koden. Krever at kode-appen er satt opp (reserve). Bare den offentlige nøkkelen lagres
  (`webauthn_credentials`). Passkeys er knyttet til domenet i `APP_URL`: **bytter dere domene, slutter passkeys å
  virke** (koden fra appen virker fortsatt) – be administratorene legge dem til på nytt.
- **Feil koder:** 10 feil på 15 minutter (eller 30 på et døgn) gir pause for koden på kontoen, og eieren får e-post.
  Passkey virker fortsatt i pausen.
- **Sikkerhetsvarsler på e-post:** hver innlogging på en administratorkonto, mange feil koder, totrinn slått på/av,
  passkey lagt til/fjernet. Hver e-post har en lenke (gyldig i 7 dager, signert med `SESSION_SECRET`) som logger ut
  alle enheter etter et ekstra klikk. Så lenge `EMAIL_ALLOWED_RECIPIENTS` er satt, må administratorens e-post stå på
  listen for at varslene skal komme fram (stoppede e-poster vises under **Admin → E-post**).
- **Reservekoder:** 10 engangskoder vises én gang ved oppsett. Lagre dem i passordbehandleren.
- **Mistet telefonen og reservekodene?** Logg inn i Supabase (SQL-editoren) og slå av totrinn for kontoen, så kan
  den settes opp på nytt ved neste innlogging:
  ```sql
  update users set totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null where email = 'din@epost.no';
  delete from user_recovery_codes where user_id = (select id from users where email = 'din@epost.no');
  delete from webauthn_credentials where user_id = (select id from users where email = 'din@epost.no');
  ```
- **SESSION_SECRET** brukes også til å kryptere hemmelighetene og signere «logg ut alle»-lenkene. Byttes den, må alle
  med totrinnsinnlogging sette det opp på nytt (kjør SQL-en over for dem, eller for alle), og gamle lenker slutter å virke.

## 6c. Synlig i Google (søkeresultat og ikon)

Nettsiden har alt Google trenger: ikon i flere størrelser (`/favicon.ico` 16–48 px, `/favicon-96x96.png`, `/icon-192.png`,
`/favicon.svg`), `sitemap.xml`, `robots.txt` og én fast adresse (www, http og onrender.com sendes til
`https://anbudradar.com`). Ikonet og nye sider vises i Google først når Google har lest forsiden på nytt – Google sier
selv at det kan ta fra noen dager til noen uker, og at ikonet ikke er garantert. Slik går det raskere:

1. Gå til [Google Search Console](https://search.google.com/search-console) → **Legg til eiendom** →
   **Nettadresseprefiks** → `https://anbudradar.com`.
2. Velg bekreftelsesmåten **HTML-tag** og kopier bare koden mellom `content="` og `"` (den er ikke hemmelig).
3. Render → webapp-tjenesten → **Environment** → legg til `GOOGLE_SITE_VERIFICATION` = koden → lagre og oppdater.
   Når siden er oppdatert, står koden i forsiden som `<meta name="google-site-verification">`.
4. Tilbake i Search Console → **Bekreft**.
5. **Nettstedskart** → send inn `sitemap.xml`.
6. **Inspeksjon av nettadresse** → `https://anbudradar.com/` → **Be om indeksering**.

(Alternativ: eiendomstypen **Domene** med en `TXT`-post for `@` hos Namecheap, slik e-postpostene i del 0 ble lagt inn.)

**Status 6. november 2026:** `https://anbudradar.com` er bekreftet i Search Console med metoden **HTML-fil**
(filen `google89c7bd88….html` serveres av `src/server/static.ts`). **Ikke fjern den** – da mister eieren
bekreftelsen. Forsiden er indeksert, og ny indeksering er bedt om.

## 6d. Vekst: Google-sider, ukesbrev, besøkstelling og LinkedIn

- **Norske adresser og fylkessider.** Bransjesidene ligger på `/bransjer/renhold`, `/bransjer/vakthold` osv. (gamle
  `/bransjer/cleaning` sendes videre med 301). Hvert fylke har `/fylker/<fylke>`, og hver bransje i hvert fylke
  `/bransjer/<bransje>/<fylke>`. Sider med færre enn 3 åpne anbud har `noindex` og står ikke i `sitemap.xml`
  (`MIN_OPEN_FOR_INDEXING` i `src/domain/slugs.ts`). De engelske, svenske og danske sidene er uendret.
- **Ukesbrevet «Ukens anbud».** Påmelding uten konto på bransje- og fylkessidene, dobbel bekreftelse, sendes mandag fra
  kl. 07 med nye anbud siste uke (oppgaven `weekly`), ettklikks-avmelding som sletter adressen. Resend gratis tillater
  et begrenset antall e-poster per dag; med mange påmeldte må planen hos Resend vurderes (koster penger – avklar med eier).
- **Besøk (Admin → Besøk).** Teller sidevisninger på offentlige sider uten informasjonskapsler og uten IP: dato, side og
  kilde. Innloggede brukere og roboter telles ikke. Lenker med `utm_source=…` vises med det navnet.
- **LinkedIn (Admin → LinkedIn).** Ferdig tekst med ukens største nye anbud for valgt bransje/fylke, med lenke
  `utm_source=linkedin`. Les gjennom og post selv.

## 7. Utrulling og tilbakerulling

- **Migreringer er bare fremover og kjøres før ny kode tar trafikk** (`preDeployCommand`). Migreringene 0006–0010 legger til kolonner, tabeller, indekser og tilgangsregler, retter referansedata (NUTS-koder for fylker og frister på eksisterende kunngjøringer) og strammer inn rettighetene til webapp-rollen. Ingen tabeller eller kolonner slettes, så forrige versjon av koden på denne grenen fungerer mot det nye skjemaet. Å gå helt tilbake til den opprinnelige koden fra zip-filen etter 0007 er ikke støttet – tilgangsmodellen er strengere nå.
- **Tilbakerulling av kode:** Render → tjenesten → *Events* → velg forrige vellykkede deploy → *Rollback*. Gjør det samme for arbeideren.
- **Tilbakerulling av database** (sjelden – bare hvis en migrering har ødelagt data): stopp arbeideren, gjenopprett med PITR til tidspunktet før deploy, rull tilbake koden, start arbeideren. Skriv ned hva som skjedde.
- **Før hver deploy med ny migrering:** ta en manuell sikkerhetskopi (Supabase → Database → Backups), kjør migreringen mot en kopi eller staging først hvis den endrer eksisterende data.
- Hold `autoDeploy: false` til dere har CI som må være grønn før deploy.
- **Rutine fra 7. november 2026 (eiers beslutning: «rull ut hver oppdatering uten at jeg sier noe»):** hver
  kodeendring rulles ut uten egen godkjenning, men først når testene på GitHub er grønne for akkurat den versjonen.
  Endringene sendes med `[skip render]`, så Render ikke ruller ut av seg selv før testene er ferdige; utrullingen
  startes deretter med versjonsnummeret (Render API, `POST /v1/services/{id}/deploys` med `commitId`). Etterpå sjekkes
  helsesjekken, loggen og de offentlige sidene. Endringer bare i dokumentasjonen rulles ikke ut (nettsiden er lik).
  Gjelder ikke det som fortsatt krever eiers ja: priser og abonnementer, nye betalte tjenester eller leverandører,
  endringer i oppsettet hos Render/Supabase, produksjonsdata og hemmeligheter, og migreringer som endrer eksisterende data.
- **Endret samme dag (oppdraget om AnbudRadar Intelligence):** eier skrev «Ikke … deploy produksjon uten min godkjenning».
  Den nyeste beskjeden gjelder: utrulling venter igjen på eiers ja, til eier sier noe annet.

## 8. Kontinuerlig integrasjon (CI)

`.github/workflows/ci.yml` kjører typesjekk, sårbarhetssjekk, enhetstester, integrasjonstester mot PostgreSQL 16, produksjonsbygg og ende-til-ende i Chromium ved hver endring på arbeidsgrenen (den Render ruller ut fra), ved push til `main` og ved pull request. Endringer bare i dokumentasjonen hoppes over. Feiler testene, sender GitHub e-post til den som sendte endringen – sjekk at kjøringen er grønn før utrulling. Ingen hemmeligheter trengs (AI, e-post og Stripe er simulert i `.env.test`). GitHub Actions er gratis for offentlige repoer; for private repoer bruker kjøringene av kontoens inkluderte minutter (ca. 6–10 minutter per kjøring).

To jobber til går av seg selv: **Drift** (hver time, se under) og **Sikkerhetskopi** (hver natt, se avsnitt 6). Blir
repoet privat, bruker de av gratisminuttene (2 000 per måned): Drift ca. 1 minutt per kjøring (ca. 750 i måneden) og
Sikkerhetskopi 3–5 minutter per natt (ca. 150) – til sammen innenfor gratiskvoten, men CI-kjøringer kommer i tillegg.

## 9. Overvåking (gratis)

- **Oppetid – `.github/workflows/drift.yml`:** hver time (sju minutter over) kalles `/api/health`. Svarer den ikke med
  200 etter seks forsøk (ca. 2 minutter, siden en kald start på gratisplanen tar tid), åpnes GitHub-saken
  «Driftsvarsel: AnbudRadar svarer ikke», og GitHub sender e-post til deg. Saken lukkes av seg selv når siden svarer
  igjen. Kallet vekker også tjenesten, så henting av anbud, varsler og e-post tar igjen det som er forfalt minst én gang i
  timen (ca. 200 av 750 gratistimer i måneden hos Render). Annen adresse: sett repo-variabelen `APP_URL`.
- **Feil i appen – Admin → Feil:** alt som logges som feil (sider som krasjer, bakgrunnsjobber som gir opp, henting,
  Stripe, e-post) samles i databasen, gruppert per type med teller. E-postadresser, lange tall og nøkler fjernes før
  lagring, og ingen bruker-ID lagres. Du får **én e-post i timen** når nye feil oppstår (til `ADMIN_NOTIFICATION_EMAIL`),
  og høyst én gang i døgnet for feil som fortsetter. «Merk som løst» når feilen er rettet; kommer den tilbake, varsles
  den igjen. Løste feil slettes etter 90 dager. Ingen ny leverandør.
- **Admin → Systemhelse**: arbeiderens siste livstegn, jobbkø, e-postkø, feilede jobber, databasestørrelse og hvor mange
  opplastede dokumenter som ikke kunne leses (grunnlag for å vurdere OCR).

## Logger og feilsøking

- Logger skrives som én linje JSON per hendelse til stdout (ingen personopplysninger utover bruker-ID).
- **Admin → Helse** viser databasestatus, arbeiderens siste livstegn, jobbkø og integrasjonsstatus.
- **Admin → Importer** viser hver kjøring med antall nye/oppdaterte/duplikater og feil per kunngjøring.
