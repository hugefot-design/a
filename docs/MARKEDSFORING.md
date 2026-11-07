# Markedsføring: påstander og hva de bygger på

Oppdatert 7. november 2026 (ny forside). Hver påstand på nettsiden skal kunne spores til en funksjon som finnes, og
til en test eller kontroll. Endrer du markedsteksten, oppdater tabellen.

## Posisjonering

**«Ikke bare finn anbudet. Finn ut om det er verdt å vinne.»** AnbudRadar er en plattform for bedre beslutninger i
offentlige anskaffelser – ikke bare en søkemotor: matching, risiko før tilbud, lønnsomhet, markedsinnsikt, resultater,
kapasitet og tilbudsarbeid.

## Påstandene på forsiden

| Påstand | Hvor i appen | Plan (regnes ut fra planene) | I produksjon 7.11.2026 | Kontrollert av |
| --- | --- | --- | --- | --- |
| Ekte kunngjøringer fra Doffin og TED, flere ganger i døgnet, med lenke til originalen | Henting (`src/connectors`), anbudssiden | Alle | Aktiv (Doffin-nøkkel finnes; henting hver 2. time når tjenesten er våken, vekkes hver time) | `tests/unit/connectors.test.ts`, `tests/integration/ingest-notifications.test.ts`, drift-sjekken |
| Intelligent matching: score 0–100 med begrunnelse | `src/domain/matching/engine.ts` | Profesjonell og høyere | Aktiv | `tests/unit/matching.test.ts`, `tests/integration/screening.test.ts` |
| Risiko før tilbud: krav, avvisningsgrunner, frister, kostbare vilkår, med henvisning | `requirements.ts`, `terms-scan.ts` (ordsøk, ikke AI) | Alle (kunngjøringen); dokumenter fra Profesjonell | Aktiv. Opplastede filer forsvinner til fillagring er satt opp, men teksten som er lest, blir lagret | `tests/unit/requirements.test.ts`, `tests/unit/terms-costs.test.ts` |
| Selvkost, minstepris og målpris; sammenligning med tidligere tildelinger | `src/domain/profit/` | Profesjonell og høyere | Aktiv | `tests/integration/profit.test.ts`, `tests/integration/market.test.ts` |
| Hvem vinner, hvem kjøper, kontrakter som utløper | `src/domain/competitors/` | Bedrift og høyere | Aktiv | `tests/integration/expiry.test.ts`, `tests/unit/expiry.test.ts` |
| Resultater og læring | `src/domain/tenders/results.ts` | Alle | Aktiv | `tests/integration/results.test.ts` |
| Kapasitet måned for måned, også sesong | `src/domain/profit/capacity.ts` | Profesjonell og høyere | Aktiv | `tests/unit/capacity-season.test.ts`, `tests/integration/capacity-season.test.ts` |
| Krav, sjekklister og tilbudsarbeid for teamet | `src/domain/bids/` | Bedrift og høyere | Aktiv (AI-utkast er av) | `tests/integration/requirements.test.ts`, `tests/unit/bid-export.test.ts` |
| Gratisplan uten tidsgrense, prøveperiode i Profesjonell uten kort, ingen binding | Planer og prøveperiode | – | Aktiv. Betaling (Stripe) er ikke satt opp ennå | `tests/integration/public-pages.test.ts` (prøvetid følger `TRIAL_DAYS`) |
| Data lagres i EU (Frankfurt og Irland), deles ikke uten at kunden velger det, selges aldri | Render Frankfurt, Supabase Irland, RLS, partnerprofil er frivillig | – | Aktiv. **Slås sikkerhetskopien via GitHub på, behandles databasen også på GitHubs maskiner (kan være i USA) – oppdater da teksten og underleverandørlisten** | Underleverandørlisten, `tests/integration/tenancy.test.ts` |

## Kundereisen på forsiden – ekte data

De seks stegene vises med ekte, offentlige data (`src/domain/tenders/showcase.ts`, `src/ui/showcase.tsx`):
treff for en **eksempelprofil** (bransje og fylke fra et ekte anbud – merket som eksempel), krav og vilkår ordrett fra en
åpen kunngjøring med lenke til originalen, markedspris fra lagrede tildelinger, kravene som sjekkliste, en nylig
tildeling og kontrakter som snart utløper. **Leverandørnavn vises aldri.** Finnes ikke nok data, utelates
eksemplet. Norske kunngjøringer foretrekkes (TED publiserer norske kunngjøringer på engelsk).
Test: `tests/integration/showcase.test.ts`.

**Hvilket eksempel som vises (endret 7.11.2026 etter kontroll i produksjon).** Ordsøket er det samme som i appen, men
forsiden viser bare setninger som er gode eksempler. Produksjonen viste en standardsetning om eBevis merket «Avvisning»
og SSA-R som «kostbart vilkår». Reglene nå:

- «Avvisning» bare når setningen sier at noe avvises (ikke når ordet «avvisningsgrunner» bare nevnes).
- Ingen henvisninger eller standardtekst («følger under …», «fremgår av …», eBevis).
- Krav må være konkrete (tall, sertifisering, godkjenning, «skal/må»); befaring og frister med dato, tall eller
  «obligatorisk».
- «Kostbart vilkår» bare for dagbøter, garantier, ansvar, forsikring, betaling og prisregulering. En standardkontrakt,
  volum og leveringsfrist vises ikke som kostnad.
- Et norsk anbud med minst to gode krav går alltid foran et engelsk. Blant de beste velges helst ett der også
  markedspris og kontrakter som utløper finnes, så alle seks stegene kan vises.
- Titler som mest er koder vises sist.

Tester: `tests/unit/showcase.test.ts`, `tests/integration/showcase.test.ts`.

## Det vi bevisst ikke lover

- **AI:** AI er ikke slått på i produksjon. Forsiden, funksjonssiden og prissiden nevner AI bare som «ikke slått på
  ennå» til en ekte AI-leverandør er satt opp (simulert AI i test og admin teller ikke). Planene (som ikke er endret)
  nevner AI-analyser – prissiden sier at de ikke er slått på. **Før dere tar betalt: slå på AI eller endre
  planbeskrivelsene (din beslutning).**
- **OCR:** skannede PDF-er kan ikke leses – står på forsiden.
- **Andre land:** bare offentlige anbud i Norge. De engelske, svenske og danske sidene sier i tillegg at appen er på norsk.
- **Integrasjoner** med konkurransegjennomføringsverktøy: ingen.
- **Kundetall, omtaler, besparelser, «vinn flere anbud»:** ingen slike påstander. Testen avviser stjerner og
  «fornøyde kunder».
- **Konkurrenter:** sammenligningen gjelder søk og varsling som *funksjon*, ikke en bestemt tjeneste, og sier det.

## Navn

Se [NAVNERISIKO.md](NAVNERISIKO.md): det finnes en tjeneste som heter Anbudsradar (anbudsradar.no) i samme marked.
