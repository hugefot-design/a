# Lansering – sjekkliste og plan for de første kundene

Sist oppdatert 2. november 2026. Ingenting her krever annonsekjøp eller andre utgifter enn driften i [STATUS.md](STATUS.md).

## 1. Rekkefølge – én oppgave om gangen

Hver oppgave gjøres i leverandørens kontrollpanel. Nøkler og passord legges **bare** inn som miljøvariabler hos verten (lokalt i `.env`, i produksjon i Render → Environment) – aldri i koden, i Git eller i chat.

| # | Oppgave | Hvorfor | Ferdig når |
| --- | --- | --- | --- |
| 1 | **Doffin-nøkkel:** registrer deg i Doffins API-portal, abonner på det offentlige API-et, legg nøkkelen i `DOFFIN_API_KEY` | Norske anbud under EØS-terskel finnes bare i Doffin | `npm run ingest -- --source doffin --dry-run --limit 20` viser kunngjøringer som stemmer med doffin.no |
| 2 | **Stripe i testmodus:** ett produkt med tre månedlige NOK-priser (299/699/1490), webhook til `/api/webhooks/stripe`, kundeportal på | Betaling | Admin → Helse → «Priser i Stripe» viser OK; testkjøp med `4242 4242 4242 4242` aktiverer planen først når webhooken kommer; oppsigelse og feilende kort testet |
| 3 | **Resend:** verifiser avsenderdomenet (SPF/DKIM), API-nøkkel i `RESEND_API_KEY`. **Gjort 3.11.2026:** `anbudradar.com` bekreftet i EU-region, avsender `varsler@anbudradar.com`, e-post levert ende-til-ende (se [DRIFT.md](DRIFT.md) §0) | E-post | Registrering og glemt passord fungerer – **bare til egne testadresser** |
| 4 | **Anthropic:** API-nøkkel med månedlig utgiftsgrense, `ANTHROPIC_MODEL` og `ANTHROPIC_MODEL_FAST` | AI | Analyse, egnethet og lønnsomhet på én ekte kunngjøring; sitater merket «Sitat kontrollert»; kostnad synlig i Admin → AI-bruk |
| 5 | **Supabase:** prosjekt i EU-region, `db/supabase-app-role.sql`, privat bøtte | Database og filer | `node dist/migrate.js` kjører; RLS-testen fra `tests/integration/tenancy.test.ts` er gjentatt manuelt med to testkontoer |
| 6 | **Render:** Blueprint fra `render.yaml` (staging først) | Drift | `/api/health` svarer `ok`, arbeideren vises i Admin → Helse |
| 7 | **Jurist:** personvernerklæring, vilkår, samtykketekst for partnerprofiler, konkurranserettslig veiledning, databehandleravtaler | Lovlighet | `LEGAL_PAGES_REVIEWED=true`, `COMPANY_*` fylt ut |
| 8 | **Sikkerhetskopi:** ta en kopi og gjenopprett den til en tom database én gang | Driftssikkerhet | Fremgangsmåten i [DRIFT.md](DRIFT.md) §6 er fulgt og antall rader stemmer |

## 2. Lanseringssjekkliste

**Teknisk**

- [ ] CI grønn på `main`
- [ ] Alle integrasjoner over er verifisert i testmodus, og [INTEGRASJONER.md](INTEGRASJONER.md) er oppdatert fra «IKKE VERIFISERT»
- [ ] TED og Doffin har gått i én uke uten feil i Admin → Importer, og antall åpne kunngjøringer er sammenlignet med doffin.no
- [ ] Oppetidsovervåking på `/api/health` og varsel på feil i loggen
- [ ] AI-utgiftsgrense hos leverandøren og `AI_MONTHLY_COST_LIMIT_USD_PER_ORG`
- [ ] Stripe byttet fra test- til live-nøkler **først etter** at alt over er grønt (egen beslutning)

**Juridisk og økonomisk**

- [ ] Juridiske tekster gjennomgått og `LEGAL_PAGES_REVIEWED=true` (notat til advokat: [JURIDISK.md](JURIDISK.md))
- [ ] Databehandleravtaler med Supabase, Render, Resend, Stripe og Anthropic
- [ ] Protokoll over behandlingsaktiviteter (art. 30) og intern rutine for brudd på personopplysningssikkerheten
- [ ] Kontaktadresse med databehandleravtale (Google Workspace eller e-post på eget domene) i stedet for gratis Gmail
- [x] Google Search Console: nettstedet bekreftet og indeksering av forsiden forespurt 6. november 2026 (se DRIFT.md del 6c)
- [ ] Google Search Console: send inn `sitemap.xml`
- [ ] MVA-oppsett avklart med regnskapsfører (fast sats eller Stripe Tax)
- [ ] Selskapsinformasjon i `COMPANY_*`

**Produkt**

- [ ] Gå gjennom kundereisen selv på mobil og PC: registrering → profil → søk → analyse → lønnsomhet → tilbudsarbeid → abonnement
- [ ] Eksempeldata finnes ikke i produksjonsdatabasen
- [ ] Kontaktadresse for support besvares

## 3. De første kundene – uten annonser

Målgruppe: små og mellomstore leverandører som lever av offentlige kontrakter og regner pris selv – renhold, vakthold, vinterdrift og maskin, bygg og anlegg, transport, IT-konsulenter.

**Hovedbudskap (bare det som er bygget og testet):** «Se hvilke anbud som passer – og om de lønner seg – før dere bruker tid på tilbudet.» Vis selvkost, minstepris og vilkår med side og sitat. Aldri påstå at AnbudRadar øker vinnersjansen eller sparer et bestemt antall timer før det er målt hos ekte kunder.

### De første 10 (pilot, 4–6 uker)

1. **Velg én bransje og én landsdel** (f.eks. vinterdrift i Trøndelag). Smalere gir bedre treff og bedre referanser.
2. **Finn bedriftene i offentlige data:** tildelingskunngjøringer viser hvem som faktisk leverer i bransjen (Konkurrenter-siden i appen).
3. **Personlig kontakt** – telefon eller LinkedIn til daglig leder. Vis 2–3 åpne anbud som passer dem, og regn på ett av dem sammen med deres egne tall i et kort møte.
4. **Pilotavtale:** 14 dagers prøve (finnes allerede), ukentlig oppfølging, og spør konkret: Fant dere anbud dere ellers ville gått glipp av? Stemte kalkylen med deres egen?
5. **Mål:** aktivering (profil ferdig, første lagrede anbud, første kalkyle), ukentlig bruk, konvertering etter prøveperioden.

### 10 → 50

- **Bransjeforeninger og leverandørnettverk:** tilby et gratis foredrag eller webinar, f.eks. «Lønner det seg å by? Slik regner dere på dagbøter, betalingsfrist og prisregulering». Hold det faglig, ikke et salgsmøte.
- **Ukentlig «Ukens anbud i bransjen»** på LinkedIn og e-post, laget fra appens egne data (offentlige kunngjøringer). Tydelig avmelding.
- **Henvisninger:** be fornøyde pilotkunder om én introduksjon. Kundesitater bare med skriftlig samtykke og ordrett gjengitt – ingen oppdiktede omtaler eller tall.
- **Anbudspartnere som vekstmotor:** når kunder ber om underleverandører, inviter underleverandørene til å publisere profil. Vurder selv om partnerprofil skal være gratis for å bygge nettverket raskere (i dag krever den Start).

### 50 → 100

- **Søkesider per bransje og fylke** (bygget på `/bransjer`) med ekte, oppdaterte tall fra databasen.
- **Samarbeid med regnskapsbyråer og anbudsrådgivere** som anbefaler verktøyet til egne kunder.
- **Kundecaser** med samtykke: før/etter med kundens egne tall.
- **Måling:** kostnad per ny kunde (bare tid), konvertering, frafall per plan, og hvilke funksjoner som brukes før oppgradering til Bedrift.

**Regler for markedsføring:** e-post til navngitte personer krever som hovedregel samtykke (markedsføringsloven § 15) – bruk telefon, LinkedIn eller bedriftens generelle adresse, og la juristen bekrefte opplegget. Ingen falske omtaler, statistikker eller udokumenterte påstander.
