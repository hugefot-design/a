# Forslag som trenger eiers godkjenning

7. november 2026. Disse punktene i [VEIKART.md](VEIKART.md) (12–15) er **ikke** bygget, fordi de enten endrer
TED-integrasjonen (som eier har bedt om at ikke endres), krever nye leverandører eller koster penger. Priser er hentet
fra leverandørenes prissider og omtaler i november 2026 (kilder nederst) – sjekk dem før kjøp, de endres.

## Anbefalt rekkefølge

1. **Sikkerhetskopi (Supabase Pro)** – største risiko i dag: det finnes ingen sikkerhetskopi av kundedataene.
2. **Render Starter** for nettsiden – så henting og varsler går døgnet rundt.
3. **Gratis overvåking** (oppetid og feil).
4. Flere land via TED – først en prøvekjøring som bare måler.
5. OCR og automatisk dokumentinnhenting – når kunder etterspør det.

Minimum for 1–3: ca. **32 USD per måned** (25 + 7), overvåking på gratisplaner.

---

## 15. Sikkerhetskopi, overvåking og staging

**Hvorfor:** Gratisplanen hos Supabase har ingen automatisk sikkerhetskopi. Går databasen tapt, er kontoer, kalkyler,
resultater og tilbudsarbeid borte. Gratisplanen hos Render sover etter 15 minutter uten trafikk, så henting av
anbud og varsler stopper om natten.

| Tiltak | Kostnad | Konsekvens |
| --- | --- | --- |
| Supabase Pro | 25 USD/mnd per organisasjon | Daglige sikkerhetskopier, 7 dager tilbake. Ingen kodeendring. |
| Supabase «Point-in-Time Recovery» (valgfritt) | 100 USD/mnd per 7 dagers historikk | Gjenoppretting til et bestemt tidspunkt. Ikke nødvendig nå. |
| Render Starter for nettsiden | 7 USD/mnd | Sover ikke – henting og varsler går hele døgnet. Ingen kodeendring. |
| Oppetidsovervåking (f.eks. UptimeRobot gratis) | 0 | E-post når siden er nede. Sjekk vilkårene for kommersiell bruk (kildene er uenige). |
| Feilovervåking (f.eks. Sentry gratis: 5 000 feil/mnd, 1 bruker) | 0 | Ny underleverandør: må stå i listen over underleverandører, og personopplysninger må fjernes fra feilrapportene. Krever en liten kodeendring. |
| Staging (egen Render-tjeneste + eget Supabase-prosjekt på gratisplan) | 0 | Prøve endringer før produksjon. Oppsett tar et par timer. |

**Det jeg trenger fra deg:** ja/nei til Supabase Pro og Render Starter (du må selv legge inn betalingskort hos dem –
jeg skal ikke opprette betalte tjenester). For overvåking: hvilken tjeneste du vil bruke.

## 12. Flere land (Sverige, Danmark, Finland, Tyskland) via TED

**Hvorfor:** TED dekker hele EØS og er allerede i bruk for Norge – gratis og uten nøkkel. Koden er langt på vei klar:
søket tar landkode som parameter, og tolkningen kjenner SWE/DNK/FIN/DEU.

**Hva som må endres:** hentingen må gå gjennom en liste med land fra en innstilling (av som standard). Det er en endring
i TED-integrasjonen, som du har bedt om at ikke endres – derfor venter jeg.

**Konsekvenser og kostnad:**
- Ingen ny leverandør og ingen pris. Men **mer data**: særlig Tyskland har svært mange kunngjøringer. Gratisplanen hos
  Supabase har begrenset lagringsplass, så første steg bør være en prøvekjøring (`--dry-run`) som bare måler volumet.
- TED har bare kunngjøringer **over EUs terskelverdier**. Nasjonale kunngjøringer under terskel krever nye kilder
  (f.eks. nasjonale portaler i hvert land) – nye leverandører, egen godkjenning.
- Appen er på norsk, fylkene er norske, og prisene i Stripe er i NOK. Markedspris sammenligner bare samme valuta.
  Å selge i andre land krever egne regionlister, språk og eventuelt priser i andre valutaer (prisendringer krever din
  godkjenning).

**Forslag:** godkjenn en bryter for land i TED-hentingen (av som standard) og en prøvekjøring for Sverige som bare
måler antall og størrelse. Så bestemmer vi om og når.

## 14. OCR for skannede PDF-er

**Hvorfor:** Noen konkurransegrunnlag er skannede bilder. Da får kunden beskjed om at teksten ikke kan leses, og
kravsjekk, vilkårssøk og AI får ikke med innholdet.

| Alternativ | Kostnad | Konsekvens |
| --- | --- | --- |
| Tesseract (åpen kildekode) på egen server | 0 i lisens | Krever mer CPU enn gratisplanen hos Render gir; trolig egen bakgrunnstjeneste. Varierende kvalitet. |
| Google Cloud Vision OCR | 1,50 USD per 1 000 sider (første 1 000 sider per måned gratis) | Ny underleverandør: dokumentene sendes til Google (må stå i databehandleravtale og underleverandørliste, EU-region må velges). |

**Forslag:** vent. Mål først hvor mange opplastede dokumenter som ikke kan leses (Admin viser lesestatus per dokument).

## 13. Automatisk innhenting av konkurransedokumenter

**Hvorfor:** Full analyse uten at kunden må laste ned og opp dokumentene.

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
