# Status, begrensninger og kostnader

Sist oppdatert 1. november 2026.

## Testresultater

Kjørt med `npm run test:all` mot PostgreSQL 16 og Chromium (Playwright):

| Del | Resultat |
| --- | --- |
| Typesjekk (TypeScript strict) | Ingen feil |
| Enhetstester | 47 av 47 bestått |
| Integrasjonstester (ekte database, ekte HTTP) | 24 av 24 bestått |
| Ende-til-ende i nettleser | 2 av 2 bestått |

Det som dekkes:

- **Sikkerhet:** registrering, e-postbekreftelse, innlogging/utlogging, glemt passord (gamle sesjoner ugyldige), svake passord, CSRF og fremmed opprinnelse, sikkerhetshoder/CSP, ingen hemmeligheter i HTML, admin skjult for vanlige brukere.
- **Organisasjonsisolasjon:** to kunder side om side – den ene ser verken lagrede anbud, søk, dokumenter, analyser eller tilbudsarbeid fra den andre, verken via nettsidene eller direkte i databasen. Også med forfalsket organisasjonskontekst. Webapp-rollen kan ikke endre abonnement eller lese e-postkø/Stripe-hendelser.
- **Betaling:** retur fra Checkout aktiverer ingenting; falske webhooks avvises; signerte webhooks aktiverer plan; samme hendelse to ganger behandles én gang; en forsinket eldre hendelse kan ikke gjenopplive et kansellert abonnement; mislykket betaling registreres og varsler eieren. Checkout-kallet til Stripe kontrolleres med simulert Stripe-API.
- **Data:** ny/uendret/oppdatert kunngjøring, samme anskaffelse fra to kilder slås sammen, ugyldige data avvises og logges, status går aldri «baklengs», fristendring og avlysning oppdages.
- **Varsler:** lagret søk, nye treff, avlysning, fristpåminnelse, ingen duplikater, e-post samlet og sendt én gang, gratisplan får ingen varsler.
- **AI:** kildeblokken kan ikke brytes ut av (testet med skjulte instruksjoner og falske markører i dokumenttekst, og en PDF med innebygd instruksjon), sitater kontrolleres mot kilden, hurtigbuffer gir ingen ny kostnad, kvoter håndheves, funksjoner låses etter plan på serveren.
- **Personvern:** dataeksport uten passord-hasher eller tokens, sletting av konto med organisasjon og filer.
- **Nettleser:** hele kundereisen fra forsiden til analyse og låst Bedrift-funksjon, uten JavaScript-feil; alle offentlige sider på mobilbredde uten horisontal rulling.

## Ikke testet mot ekte tjenester

Utviklingsmiljøet hadde ikke nettverkstilgang til eksterne tjenester. Følgende er bygget og testet med simulerte svar, men **må verifiseres** før lansering (fremgangsmåte i [INTEGRASJONER.md](INTEGRASJONER.md)):

- TED-henting (kjørt én gang: feilet på nettverk som forventet, og kilden ble korrekt stående som «ikke verifisert»)
- Doffin-henting (krever nøkkel; felt og typeverdier er ikke bekreftet)
- Stripe Checkout, kundeportal og ekte webhooks
- E-post via Resend
- AI via Anthropic/OpenAI (all AI i utvikling er simulert og tydelig merket)
- Supabase Storage

## Kjente begrensninger

- **Konkurransedokumenter hentes ikke automatisk.** Kunngjøringen og lenken til kilden importeres; vedlegg må lastes opp av brukeren for full analyse. Automatisk nedlasting bør bare bygges via kildenes egne API-er og etter at vilkårene er sjekket.
- **Skannede PDF-er** (bilder uten tekst) kan ikke leses – brukeren får beskjed. OCR er ikke bygget.
- **Kommune** filtreres på stedstekst i kunngjøringen, ikke på kommunenummer. Fylke utledes fra NUTS-koder (fylkesinndelingen fra 2024).
- **CPV-listen** inneholder hovedgruppene og et utvalg koder. Full liste lastes inn med `npm run import:cpv`.
- **Naturlig språk-søket** er regelbasert. Det forstår vanlige formuleringer om bransje, sted, beløp, frist og status; resten blir søkeord. Tolkningen vises alltid.
- **Konkurrentinnsikt** er bare så god som tildelingskunngjøringene. Mange anskaffelser under terskelverdi publiseres uten tildeling – dette står tydelig i appen.
- **Relevansscoren** er regelbasert samsvar med profilen, ikke sannsynlighet for å vinne.
- **Sitatkontrollen** bekrefter at sitatet står i kilden (ordrett, eller de første 60 tegnene for lange sitater) – ikke at tolkningen er riktig.
- **Kun norsk (bokmål).** Datamodellen har land og regioner for SE/DK/FI/DE, men grensesnitt og søkeord er norske.
- **Ingen tofaktorinnlogging eller SSO** ennå.
- **Juridiske sider er utkast** og merket slik til `LEGAL_PAGES_REVIEWED=true`.
- **Priser er eks. mva.** Mva./Stripe Tax er ikke satt opp.
- `package-lock.json` følger ikke med (pakkene ble satt sammen uten tilgang til npm). Første `npm install` lager den – commit den.

## Kostnadsestimat per måned

Priser hentet 1. november 2026, omregnet med 9,32 kr per USD (kurs 27.10.2026). Uten mva. Sjekk prisene på nytt før du bestiller.

**Faste kostnader ved lansering (0–50 kunder):**

| Tjeneste | Valg | USD | ca. NOK |
| --- | --- | --- | --- |
| Supabase | Pro (database, lagring, sikkerhetskopi) | 25 | 233 |
| Render | Webapp 1 CPU / 2 GB | 25 | 233 |
| Render | Arbeider 0,5 CPU / 512 MB | 7 | 65 |
| Render | Hobby-arbeidsområde (5 GB trafikk inkl.) | 0 | 0 |
| Resend | Gratis (3 000 e-poster/mnd, maks 100/dag) | 0 | 0 |
| TED / Doffin | Åpne API-er | 0 | 0 |
| **Sum faste** | | **57** | **ca. 530 kr** |

Resend Pro (20 USD, ca. 190 kr) trengs når dere passerer ca. 100 e-poster per dag – typisk rundt 50–100 aktive brukere med daglige varsler. Domene kommer i tillegg.

**Variable kostnader:**

| Hva | Grunnlag | Kostnad |
| --- | --- | --- |
| AI-analyse uten dokumenter (Claude Sonnet 5.5) | ca. 6 000 tokens inn, 1 500 ut | ca. 0,25 kr |
| AI-analyse med dokumenter (Claude Sonnet 5.5) | ca. 40 000 tokens inn, 2 500 ut | ca. 1 kr |
| Samme analyse med Claude Haiku 5.5 | | under 0,05 kr |
| Stripe per betaling av 499 kr | 2,4 % + 2 kr (norske/EØS-kort) + 0,7 % Billing | ca. 17,50 kr (3,5 %) |

Eksempel: 50 kunder × 20 analyser = 1 000 analyser per måned ≈ 250–1 000 kr med Sonnet 5.5, avhengig av hvor mange som har dokumenter. Analyser av samme kunngjøring deles mellom kunder (når ingen private dokumenter er med) og koster bare én gang.

**Lønnsomhet:** De faste kostnadene dekkes av to kunder på Profesjonell.

Kilder: [Render](https://render.com/pricing), [Supabase via MakerKit](https://makerkit.dev/blog/saas/supabase-pricing), [Resend](https://resend.com/pricing), [Stripe Norge](https://support.stripe.com/questions/pricing-updates-for-businesses-in-norway), [Stripe Billing](https://stripe.com/no/billing/pricing), [Claude API](https://platform.claude.com/docs/en/about-claude/pricing), [USD/NOK](https://www.poundsterlinglive.com/history/USD-NOK-2026).

## Neste steg

1. **Koble til dataene:** Skaff Doffin-nøkkel. Kjør `--dry-run` for TED og Doffin, rett eventuelle feltavvik, la arbeideren gå en uke og sammenlign antall åpne kunngjøringer med doffin.no.
2. **Sett opp betaling, e-post og AI i testmodus:** Stripe-produkter og webhook, Resend-domene, valgt AI-modell med utgiftsgrense. Kjør gjennom kjøp, oppsigelse og feilende kort.
3. **Juridisk:** Jurist på personvernerklæring og vilkår, databehandleravtaler (særlig AI-leverandøren, som behandler data i USA), selskapsinfo i `COMPANY_*`.
4. **Pilot:** 3–5 bedrifter i én bransje i noen uker. Mål: finner de anbud de ellers ville gått glipp av, og stoler de på analysene?
5. **Produkt etter pilot:** automatisk henting av konkurransedokumenter der kildene tillater det, kommunefilter på kommunenummer, full CPV-liste, tofaktorinnlogging, feilovervåking (f.eks. Sentry).
6. **Norden:** TED-koblingen tar allerede landkode – Sverige/Danmark/Finland krever i hovedsak oversatte søkeord, regioner og grensesnitt.
