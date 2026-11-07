# Forslag som trenger eiers godkjenning

Oppdatert 7. november 2026 etter «gjør alt som er gratis eller finn alternativer». Punktene er fra
[VEIKART.md](VEIKART.md) (12–15). Priser er hentet fra leverandørenes prissider og omtaler i november 2026 (kilder
nederst) – sjekk dem før kjøp, de endres.

## Kort oppsummert

| Behov | Betalt løsning | Gratis alternativ – status |
| --- | --- | --- |
| Sikkerhetskopi | Supabase Pro, 25 USD/mnd | **Bygget:** kryptert kopi hver natt til privat bøtte + generalprøve. Trenger fire hemmeligheter fra deg og ja til GitHub som underleverandør ([DRIFT.md](DRIFT.md#6-sikkerhetskopi-og-gjenoppretting-gratis-automatisk)). |
| Henting og varsler hele døgnet | Render Starter, 7 USD/mnd | **Bygget:** helsesjekk hver time vekker tjenesten, så alt forfalt tas igjen minst én gang i timen. Ikke døgnkontinuerlig. |
| Oppetidsvarsel | UptimeRobot (gratis, vilkår uklare) | **Bygget og prøvd mot produksjon:** GitHub-sak + e-post når siden ikke svarer. |
| Feilovervåking | Sentry (ny underleverandør) | **Bygget:** Admin → Feil + én e-post i timen, uten personopplysninger, uten ny leverandør. |
| Fillagring som ikke forsvinner | – | **Klar i koden** – du må lage bøtta og legge inn tre miljøvariabler ([DRIFT.md](DRIFT.md#2-fillagring-supabase-storage--gjør-dette-før-kundene-laster-opp-dokumenter)). Viktigst av alt her. |
| Staging | Egen tjeneste | **Delvis:** generalprøven kjører migreringene mot en kopi av produksjonsdataene hver natt. Egen prøveside er ikke laget. |
| Flere land | – | **Målt** for Sverige (og Danmark, Finland, Tyskland). Lagring av andre land er sperret til appen er klar – se under. |
| OCR | Google Vision | **Ikke bygget** – gratis vei finnes (i nettleseren), men vi mangler tall som viser behovet. Tellingen er lagt inn. |
| Dokumentinnhenting | – | **Ingen lovlig gratis vei** – uendret anbefaling. |

## Det jeg trenger fra deg

1. **Fillagring** (viktigst): lag den private bøtta og legg inn `STORAGE_DRIVER`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` og `SUPABASE_STORAGE_BUCKET` i Render. Til det er gjort, forsvinner opplastede dokumenter
   ved hver ny versjon og når tjenesten sover.
2. **Sikkerhetskopi:** ja/nei til GitHub som underleverandør, deretter fire hemmeligheter i GitHub.
3. **Gjør repoet privat** (GitHub → Settings → General → Danger Zone → Change visibility). I dag kan alle lese koden og
   loggene fra GitHub Actions. Ingen hemmeligheter ligger der, men privat er tryggere. Kostnad: jobbene bruker da av
   gratisminuttene (ca. 900 av 2 000 i måneden, se DRIFT.md §8).
4. **Rullet ut 7.11.2026** (versjon `5fe650c`) etter ditt ja: feilovervåkingen og veikartpunkt 1–11 er i produksjon.

---

## 15. Sikkerhetskopi, overvåking og staging

**Gjort gratis** (detaljer og oppsett i [DRIFT.md](DRIFT.md)):

- **Sikkerhetskopi hver natt:** `pg_dump` → AES-256 → privat bøtte i Supabase Storage (30 dager) → gjenoppretting i en
  tom database + migreringene i koden kjørt mot kopien. Prøvd lokalt: 68 tabeller, 22 migreringer, radnivåsikkerhet på
  alle tabeller, feil passordfrase avvises, ikke-tom måldatabase avvises. **IKKE VERIFISERT mot produksjon** (venter på
  hemmelighetene).
- **Helsesjekk hver time** (GitHub Actions): prøvd mot produksjon 7.11.2026 – svarte `{"ok":true,"db":"ok"}`.
- **Feilovervåking i appen** (Admin → Feil): alt som logges som feil, gruppert, renset for e-post, lange tall og nøkler;
  én e-post i timen ved nye feil.

**Fortsatt betalt, hvis du vil ha mer:** Supabase Pro (25 USD/mnd) gir Supabases egne kopier og større database;
Render Starter (7 USD/mnd) gir henting og varsler hele døgnet i stedet for minst én gang i timen.

| Tiltak | Kostnad | Konsekvens |
| --- | --- | --- |
| Supabase Pro | 25 USD/mnd per organisasjon | Daglige kopier hos Supabase (7 dager), 8 GB database. Ingen kodeendring. |
| Supabase «Point-in-Time Recovery» (valgfritt) | 100 USD/mnd per 7 dagers historikk | Gjenoppretting til et bestemt tidspunkt. Ikke nødvendig nå. |
| Render Starter for nettsiden | 7 USD/mnd | Sover ikke. Ingen kodeendring. |

## 12. Flere land via TED – målt, ikke slått på

**Gjort:** `npm run ingest -- --source ted --country SWE --dry-run --since … --until …` måler et land uten å lagre noe
(antall per måned, åpne konkurranser, andel som passer bransjene i AnbudRadar, plass i databasen). Den vanlige hentingen
spør fortsatt bare etter Norge (test: `tests/integration/ted-country.test.ts`). Andre land kan **ikke** lagres – appen
er bygget for Norge (fylker, norsk tekst, NOK), og uten egne filtre ville svenske anbud dukket opp i søk, varsler,
ukesbrev og de offentlige sidene.

**Måling mot TED 7.11.2026** (ekte data, ingenting lagret; Danmark, Finland og Tyskland er regnet opp fra 7 og 3 dager):

| Land | Kunngjøringer per måned | Åpne konkurranser per måned | Passer bransjene | Anslått plass per måned |
| --- | --- | --- | --- | --- |
| Norge (TED) | 1 144 | 676 | 86 % | ca. 29 MB |
| Sverige | 2 341 | 1 445 | 86 % | ca. 48 MB |
| Danmark | ca. 930 | ca. 370 | 85 % | ca. 27 MB |
| Finland | ca. 1 420 | ca. 740 | 84 % | ca. 38 MB |
| Tyskland | ca. 19 600 | ca. 10 750 | 92 % | ca. 600 MB |

Sverige: 95 % i SEK, 97 % på svensk, ingen tolkningsfeil. Plassen er et anslag (original + tolket tekst × 2 for
indekser).

**Konsekvens:** Sverige alene dobler datamengden fra TED. Gratisplanen hos Supabase har 500 MB database – med Sverige
blir den trolig full i løpet av ett år, med Tyskland i løpet av én måned. Å selge i Sverige krever i tillegg:
landfilter i alle visninger (ca. 90 spørringer i 25 filer), svenske regioner (län), svensk språk, priser i SEK
(prisendringer krever din godkjenning) og trolig Supabase Pro eller sletting av originaldata etter en tid.

**Forslag:** vent med salg i andre land. Hvis du vil teste etterspørselen: en svensk landingsside med påmelding til
venteliste (gratis, ingen data fra TED lagres) før vi bygger filtrene.

## 14. OCR for skannede PDF-er – gratis vei finnes, behovet er ikke målt

**Gratis alternativ (ikke bygget):** tekstgjenkjenning i kundens nettleser med Tesseract (åpen kildekode, Apache-2.0).
Ingen ny leverandør og ingen serverkostnad: dokumentet leses på kundens maskin, og bare teksten sendes til oss.
Ulemper: ca. 10 MB nedlasting første gang, 5–20 sekunder per side, varierende kvalitet (sitater må merkes «lest med
OCR»), og en smal endring i sikkerhetsreglene (CSP) for at gjenkjenningen skal kunne kjøre. Anslått 1–2 dagers arbeid
med tester.

**Hvorfor ikke nå:** de fleste konkurransegrunnlag er digitale PDF-er fra Mercell/TendSign og kan allerede leses. Vi vet
ikke hvor mange kunder som laster opp skannede dokumenter. **Admin → Systemhelse** viser nå «Opplastede dokumenter
siste 90 dager – kunne ikke leses». Forslag: bygg OCR i nettleseren når mer enn ca. 10 % ikke kan leses, eller når en
kunde ber om det.

| Alternativ | Kostnad | Konsekvens |
| --- | --- | --- |
| Tesseract i nettleseren (anbefalt når behovet er der) | 0 | Se over. |
| Tesseract på egen server | 0 i lisens | For tungt for gratisplanen hos Render (deler CPU med nettsiden). |
| Google Cloud Vision OCR | 1,50 USD per 1 000 sider (første 1 000 sider per måned gratis) | Ny underleverandør: dokumentene sendes til Google. |

## 13. Automatisk innhenting av konkurransedokumenter

**Virkelighet:** Dokumentene ligger hos oppdragsgivers konkurransegjennomføringsverktøy (f.eks. Mercell, EU-Supply/Visma
TendSign), ofte bak innlogging og med egne bruksvilkår. Å hente dem automatisk uten avtale bryter trolig vilkårene.

**Forslag:** ikke skrape. Hvis det er ønsket: ta kontakt med de største leverandørene om avtale/API. Kostnad ukjent
til det er avklart. Til da: opplasting (finnes) og lenke til dokumentene (finnes).

---

## Kilder

- Supabase: [supabase.com/pricing](https://supabase.com/pricing), [Database Backups](https://supabase.com/docs/guides/platform/backups.md)
- Render: [render.com/pricing](https://render.com/pricing), [Render pricing 2026 (Activepieces)](https://www.activepieces.com/blog/render-pricing-2026-free-tier-workers-total-cost)
- Google Cloud Vision: [cloud.google.com/vision/pricing](https://cloud.google.com/vision/pricing?hl=uk), [Document AI pricing](https://cloud.google.com/document-ai/pricing)
- Sentry: [sentry.io/pricing](https://sentry.io/pricing/?utm_category=ai), [Sentry pricing 2026 (Activepieces)](https://www.activepieces.com/blog/sentry-pricing-2026-developer-team-business-plans)
- UptimeRobot: [UptimeRobot pricing 2026 (Notifier)](https://notifier.so/guides/uptimerobot-pricing-2026/), [Hyperping](https://hyperping.com/blog/uptimerobot-pricing)
- TED-målingen: `npm run ingest -- --source ted --country <SWE|DNK|FIN|DEU> --dry-run` mot `api.ted.europa.eu`, 7.11.2026.
