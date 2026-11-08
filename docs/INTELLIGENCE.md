# AnbudRadar Intelligence – beslutningsmotor per anbud

Oppdatert 7. november 2026. Mål: én side per anbud som svarer på «Bør vi bruke tid på dette anbudet?» – med
grunner, risiko, lønnsomhet, konkurranse, handlingsplan og læring, og med kilde på alt. **Ingen nye
beregningsmotorer:** Intelligence setter sammen det som allerede finnes, og legger bare til det som manglet.

## 1. Hva som fantes før (kartlagt i koden)

| Område | Finnes og virker | Hvor | Plan |
| --- | --- | --- | --- |
| Treff mot bedriften | Poeng 0–100 med begrunnelse, mangler, utelukkelser, sertifiseringer, usikkerhet | `matching/engine.ts` (`scoreTender`) | Profesjonell+ |
| Kvalifikasjoner | Sertifiseringer i teksten mot profil og bemanning, omsetningskrav | `profit/service.ts` (`assessQualifications`) | Profesjonell+ |
| Kapasitet | Måned for måned, timer som mangler, utstyr | `profit/capacity.ts` (`analyzeCapacity`) | Profesjonell+ |
| AI-egnethet | «Kan vi delta?» – krav oppfylt/ikke/uklart med kontrollerte sitater | `ai/analysis.ts` (`runFitAssessment`) | AI (av i produksjon) |
| Krav og avvisning | Avvisning, minstekrav, befaring/frister, kvalifikasjon, tildeling, innlevering – med dokument og side | `documents/requirements.ts` | Alle (kunngjøring), dokumenter fra Profesjonell |
| Kontraktsvilkår | 13 typer kostbare vilkår, nektelser holdes utenfor | `profit/terms-scan.ts` | Alle |
| Forhåndsvurdering | «Verdt å se på / Sjekk først / Passer trolig ikke» fra frist, profil og kunngjøring | `matching/screening.ts` | Alle |
| Kontraktsrisiko (AI) | Risikofunn med kontrollerte sitater og utregnede konsekvenser (maks dagbot, bundet kapital, garanti) | `profit/service.ts` (`buildRiskView`) | Bedrift (AI) |
| Kalkyle | Selvkost, minstepris, målpris, margin, følsomhet, opphav per linje | `profit/calculator.ts` | Profesjonell+ |
| Anbefaling | «Vurder å by / Undersøk nærmere / Høy risiko / For lite grunnlag» | `profit/recommendation.ts` | Profesjonell+ |
| Markedspris | Sammenlignbare tildelinger, kvartiler, per år, egen pris i markedet | `profit/market.ts` | Profesjonell+ |
| Konkurrenter | Vinnere per bransje, per oppdragsgiver, leverandørsider, kontrakter som utløper | `competitors/*` | Bedrift+ |
| Resultater og læring | Vinnerandel, årsaker, egen pris mot vinner, kalkyle mot resultat, hvem som slo dere | `tenders/results.ts` | Alle |
| Tilbudsarbeid | Sjekkliste med kildehenvisning, seksjoner, godkjenning, eksport (Word, tekst) | `bids/*` | Bedrift+ |
| Til handling | Frister, spørsmålsfrist, befaring, godkjenning – for hele organisasjonen | `actions.ts` | Alle |

**Delvis:** to ulike vurderinger (forhåndsvurdering på anbudssiden, anbefaling i Lønnsomhet) og ingen samlet
beslutning; ingen samlet risikoscore; konkurranse og læring finnes, men ikke for akkurat dette anbudet; handlingslisten
gjelder hele organisasjonen, ikke ett anbud; kildemerkingen er ulik fra modul til modul; ingen PDF.

**Simulert eller av:** all AI er av i produksjon (ingen AI-leverandør er satt opp). Administratorer ser simulerte
AI-svar, tydelig merket. Intelligence må derfor virke fullt ut uten AI.

## 2. Hva Intelligence legger til

Én side per anbud (`/app/anbud/:id/intelligence`) og PDF (`/app/anbud/:id/intelligence/pdf`).

1. **Passer det for oss?** Treffet, kvalifikasjoner, kapasitet, geografi og AI-egnethet samlet.
2. **Risiko:** risikoscore 0–100 med forklaring per faktor, krav, frister, dokumentasjon, avvisningsgrunner og
   kontraktsvilkår – med dokument og side.
3. **Lønnsomhet:** kalkylen (hvis den finnes), markedsprisen og hvor målprisen ligger, følsomhet.
4. **Konkurranse:** hvem som har vunnet hos oppdragsgiveren i samme bransje, hvem som vinner lignende kontrakter,
   hvor mange tilbud lignende konkurranser får – bare publiserte tildelinger, alltid med antall.
5. **Beslutning (Go/No-Go):** «Gå videre / Avklar først / Ikke gå videre / For lite grunnlag», med grunner,
   hindringer og hva som mangler. Bygger på forhåndsvurderingen og anbefalingen i Lønnsomhet – ikke en tredje motor.
6. **Handlingsplan:** konkrete steg med dato (spørsmålsfrist, befaring, intern godkjenning, levering) og lenke til
   verktøyet som løser steget.
7. **Læring:** egne resultater for lignende anbud (samme oppdragsgiver eller bransje). Brukes først når minst tre er
   avgjort, og det står hvordan det påvirket vurderingen.

Alt merkes som **Fakta** (kunngjøring, dokument, tildeling eller deres egne data), **Beregning** (regnet ut av
AnbudRadar) eller **AI-vurdering** (med om sitatet ble funnet i kilden). Manglende data vises som «mangler», aldri som
null eller et anslag. Ingen vinnersannsynlighet, ingen oppdiktede priser eller konkurrenter.

## 3. Plan

1. `src/domain/intelligence/`: samler eksisterende moduler til én rapport (ingen nye regnemotorer).
2. Ren logikk som kan testes uten database: risikoscore, beslutning, handlingsplan, læring for lignende anbud.
3. Konkurranse for ett anbud: nye spørringer i `competitors/competitors.ts` (samme datagrunnlag som konkurrentsidene).
4. Siden, med de samme planreglene som resten av appen (seksjoner som krever høyere plan, sier det).
5. PDF fra den samme rapporten.
6. Tester (enhet, integrasjon med flere planer og datasett, PDF-innhold, tilgang), og prøve med ekte anbud.

## 4. Status – rullet ut 8. november 2026 (versjon `c106ce0`)

**Ferdig og testet**

- Siden `/app/anbud/:id/intelligence` (lenket fra anbudssiden: «Samlet vurdering») og PDF `/app/anbud/:id/intelligence/pdf`.
- Beslutning med grunner, hindringer, det som må avklares, det som mangler og datagrunnlag (`decision.ts`).
- Risikoscore 0–100 som sum av navngitte faktorer med kilde (`risk.ts`). Hindringer: frist ute eller under to døgn,
  utelukket av profilen, lovpålagt godkjenning mangler, tap ved kontraktsverdien.
- Lønnsomhet fra kalkylen (samme arbeidsflate som Lønnsomhet), markedspris med egen pris i markedet, følsomhet,
  treffsikkerhet for tidligere kalkyler.
- Konkurranse: vinnere hos oppdragsgiveren i samme bransje, vinnere av lignende kontrakter, antall tilbud i lignende
  konkurranser (`competitors.ts` → `tenderCompetition`), og hvem som har slått dere.
- Handlingsplan med frister (fakta) og intern godkjenning (forslag), lenket til verktøyene (`plan.ts`).
- Læring fra egne resultater for samme oppdragsgiver og lignende arbeid, brukt først fra tre avgjorte (`learning.ts`).
- Merking Fakta / Beregning / AI-vurdering på alt, med dokument og side.
- Planreglene er de samme som ellers: låste deler sier hvilken plan som trengs. Ingen priser eller planer er endret.
- Små, bakoverkompatible endringer i eksisterende moduler: forhåndsvurderingen har nøkler på punktene; kravsjekken og
  Lønnsomhet kan ta imot dokumenter som allerede er lest (så de leses én gang); felles navn på CPV-prefiks.
- Tester: `tests/unit/intelligence.test.ts` (10), `tests/integration/intelligence.test.ts` (6, med et realistisk
  skoleanbud, privat konkurransegrunnlag, tildelinger og resultater; PDF-teksten leses ut og kontrolleres).

**Delvis**

- Kapasitet regnes bare når timene er lagt inn i Lønnsomhet (som før).
- Konkurranse og markedspris er bare så gode som de publiserte tildelingene; mange anskaffelser publiseres uten
  tildeling eller verdi. Antall vises alltid.
- Språk: alle nye tekster er samlet i Intelligence-modulene og formatering bruker valuta fra anbudet, men appen er
  norsk. Tekster fra eldre moduler (forhåndsvurdering, anbefaling i Lønnsomhet) er norske.
- PDF-en bruker standardskrift (vesteuropeiske tegn). Andre tegnsett krever innebygd skrifttype.

**Simulert / av**

- AI er av i produksjon. Intelligence virker uten AI; AI-funn vises bare når en analyse finnes, merket «AI-vurdering»
  og med om sitatet er funnet i kilden. Administratorer ser simulerte AI-svar, merket «Simulert – testmodus».

**Utrulling (8.11.2026, eiers ja)**

- Rullet ut med `pdfkit` (MIT, åpen kildekode, kjører lokalt – ingen tjeneste eller kostnad; `npm audit`: 0 sårbarheter).
  Ingen databaseendringer.
- Kontrollert i produksjon: helsesjekk, innloggingskrav på side og PDF, offentlige sider, 0 feil i loggen.
  **IKKE VERIFISERT i produksjon:** siden og PDF-en med en innlogget kunde (dekket av tester og lokal prøve med ekte data).

**Krever fortsatt eiers godkjenning**

- Om Intelligence skal nevnes på nettsiden og i planbeskrivelsene (ikke gjort – markedsføring endres ikke uten ja).
