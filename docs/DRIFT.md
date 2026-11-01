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

## 1. Database (Supabase)

1. Opprett prosjekt i EU-region. Noter databasepassordet.
2. Åpne **SQL Editor** og kjør `db/supabase-app-role.sql` – bytt passordet i filen med et langt tilfeldig passord først.
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

1. Legg koden i et Git-repo (husk `package-lock.json` etter første `npm install`).
2. **Web service:** Build `npm install && npm run build`, Start `npm start`, helsesjekk `/api/health`.
3. **Background worker:** samme repo, Build `npm install && npm run build`, Start `npm run worker`.
4. Miljøvariabler på begge (se `.env.example`): `NODE_ENV=production`, `APP_URL=https://…`, `TRUST_PROXY=true`, database, `SESSION_SECRET`, `CRON_SECRET`, AI, e-post, Stripe og lagring.
   Appen nekter å starte i produksjon med `AI_PROVIDER=mock`, http-adresse, utviklingshemmelighet eller uten `CRON_SECRET`.
5. Eget domene: legg det til hos Render, og oppdater `APP_URL`.

**Uten arbeiderprosess** (f.eks. på en plattform med bare webprosesser): kall oppgavene fra en ekstern cron med `Authorization: Bearer $CRON_SECRET`:

```
POST /api/cron/ingest-ted        hver 2. time
POST /api/cron/ingest-doffin     hver 2. time
POST /api/cron/notifications     hvert 15. minutt
POST /api/cron/emails            hvert 5. minutt
POST /api/cron/weekly            hver time (sender bare mandag morgen)
POST /api/cron/refresh-matches   daglig
POST /api/cron/retention         daglig
```

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

## Logger og feilsøking

- Logger skrives som én linje JSON per hendelse til stdout (ingen personopplysninger utover bruker-ID).
- **Admin → Helse** viser databasestatus, arbeiderens siste livstegn, jobbkø og integrasjonsstatus.
- **Admin → Importer** viser hver kjøring med antall nye/oppdaterte/duplikater og feil per kunngjøring.
