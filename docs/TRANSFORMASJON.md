# Produktløft november 2026: gjennomgang, prioritering og status

Startet 13. november 2026 etter eiers oppdrag «Full product transformation». Målet er flere besøkende som blir
registrerte, flere som kommer i gang, og flere som blir – ikke en ny fasade.

> **Ingenting her er rullet ut.** Produksjonen (anbudradar.com) står på versjon `2d3e8ab` fra 8. november.
> «Push ut» er gjort som `git push` til arbeidsgrenen – ikke utrulling til produksjon.
> Arbeidet ligger på grenen `claude/anbudradar-saas-launch-eje0gv` (samme gren som Render ruller ut fra), og alle
> endringer har `[skip render]`, så ingenting går ut av seg selv. Utrulling skjer først når eier sier fra.

## 1. Hva som finnes: i koden, testet og i produksjon

Kontrollert 13.11.2026 mot koden, testene og oppsettet hos Render (bare navn på innstillinger – ingen verdier lest).

| Område | I koden | Testet | I produksjon (13.11.) |
| --- | --- | --- | --- |
| Henting fra Doffin og TED | Ja | Ja, også mot ekte tjenester | **Virker.** Gratis-serveren sover etter 15 min uten besøk og vekkes hver time, så henting og varsler kan bli forsinket. |
| Søk, lagrede anbud, lagrede søk, varsler | Ja | Ja | Virker. E-post sendes fra `varsler@anbudradar.com`. |
| Matching (treff 0–100) og forhåndsvurdering | Ja | Ja | Virker (Profesjonell og prøveperioden). |
| Krav- og avvisningssjekk, kostbare vilkår | Ja | Ja | Virker. Opplastede filer **forsvinner** ved ny versjon/dvale (teksten som er lest, beholdes) – fillagring er ikke satt opp. |
| Samlet vurdering (Go/No-Go) og PDF | Ja | Ja | Rullet ut 8.11. Ikke prøvd med innlogget kunde i produksjon. |
| Lønnsomhet, markedspris, kapasitet | Ja | Ja | Virker. Markedspris avhenger av hvor mange tildelinger som har verdi. |
| Konkurrenter, kontrakter som utløper | Ja | Ja | Virker (Bedrift). |
| Resultater og læring | Ja | Ja | Virker. |
| Tilbudsarbeid, sjekkliste, eksport | Ja | Ja | Virker (Bedrift). AI-utkast er av. |
| **AI** (sammendrag, analyse, «Spør om anbudet», utkast) | Ja | Bare med simulert AI | **Av.** Ingen AI-nøkkel er lagt inn. |
| **Betaling (Stripe)** | Ja | Bare med simulert Stripe | **Ikke satt opp.** Ingen kan betale; «Velg plan» er grået ut. |
| Ukesbrevet «Ukens anbud» | Ja | Ja | Påmelding virker. Første ordinære utsending er ikke bekreftet. |
| Sikkerhetskopi | Ja (GitHub-jobb) | Ja (generalprøve) | **Ikke slått på** – jobben hopper over fordi nøklene mangler. Databasen har ingen kopi. |
| Juridiske sider | Ja | Ja | Merket «Utkast», med «[selskapsnavn]», «[org.nr.]» og «[adresse]» i stedet for ekte opplysninger. |

## 2. Dokumentasjon som motsa seg selv (rettet i dette arbeidet)

- **README** sa (2.11.) at Doffin, e-post, database og drift ikke var prøvd mot ekte tjenester, og oppga 85 tester og
  gamle skrifttyper.
- **VEIKART** og flere avsnitt i **STATUS** sa «Ikke rullet ut» om det som ble rullet ut 7.–8. november.
- **INTEGRASJONER** sa at Render, Supabase og e-post ikke var verifisert; **STATUS** sa at de var det.
- **LANSERING** og sjekklisten i **DRIFT** hadde åpne punkter som er gjort (oppetidsvarsel, e-post, Doffin).
- **DRIFT** sa at små oppdateringer rulles ut automatisk. Nyeste beskjed (13.11.) er: ikke rull ut.

## 3. Lovet på nettsiden eller i appen, men ikke tilgjengelig for kunder

| Hva | Hvor det sto | Hva som er gjort |
| --- | --- | --- |
| AI-sammendrag, AI-analyse og AI-utkast i planene | Plankortene (pris- og abonnementssiden), sammenligningstabellen, spørsmål og svar | Når ekte AI ikke er slått på, merkes hver AI-linje «ikke slått på ennå» rett ved påstanden (plankort, sammenligningstabell, abonnementssiden), og spørsmål og svar nevner ikke AI-analyse. Priser og grenser er ikke endret. |
| «Betal med kort via Stripe» | Spørsmål og svar på prissiden | Svaret følger oppsettet: så lenge kortbetaling ikke er satt opp, står det det – og at kunden kan melde interesse i appen. |
| Tomme AI-paneler («AI er ikke slått på ennå») og AI-kvoter | Anbudssiden, Oversikt, Abonnement | Skjules for kunder når AI er av (administratorens organisasjon ser dem i testmodus). |
| «AI-analyser … stopper» og «Velg plan» i e-posten før prøveperioden slutter | E-post | Nevner bare det som faktisk stopper, viser ekte tall fra kontoen (åpne anbud som passer, lagrede anbud), og ber om «Meld interesse» når kortbetaling ikke er åpnet. |
| «Velg plan» som ikke kan trykkes | Abonnement | Kunden kan melde interesse for en plan (havner i Admin → Henvendelser). |

## 4. De 15 viktigste forbedringene

Rangert etter effekt på kundetiltrekning, registrering, aktivering, kundeverdi, lojalitet og inntekter.
Status oppdateres nederst i dokumentet etter hvert som arbeidet blir ferdig.

| # | Hva som mangler | Hvorfor det betyr noe | Hvordan det løses | Forretningsverdi | Risiko og kompleksitet |
| --- | --- | --- | --- | --- | --- |
| 1 | **Oppstarten er for tung.** Ny kunde må gjennom to steg og et skjema med over 40 felt før første anbud vises. | Hvert ekstra felt koster kunder. De som faller fra her, ser aldri verdien. | Ett kort skjema: firmanavn, bransje, område og hva dere leverer. Resten flyttes til Bedriftsprofil og foreslås senere. Bransje, fylke og anbudet kunden kom fra, følger med. | Størst effekt på aktivering. | Lav risiko: samme profil og matching, færre påkrevde felt. Middels arbeid (tester må følge med). |
| 2 | **Ingen ekte demo.** Forsiden viser små utsnitt, men ingen kan se en hel vurdering uten konto. | Kunden må forstå hvorfor produktet trengs før registrering. | Offentlig side med et ekte, åpent anbud: treff, grunner, avvisningsrisiko, kostbare vilkår, markedspris, Go/No-Go og eksempelrapport (PDF) – for en merket eksempelprofil. «Regn med egne tall» med den ekte kalkulatoren. | Flere registreringer fra samme trafikk. | Middels: gjenbruker motoren og sidene fra appen. Ingen oppdiktede tall; eksempelprofilen er merket. |
| 3 | **Registreringsmur på alle anbud.** Trykk på et anbud på bransje- og fylkessidene sender rett til registrering. Ukesbrevet lenker til Doffin, ikke til oss. | Google og besøkende møter en stengt dør. Trafikk vi har skaffet, sendes ut igjen. | Offentlig, delbar anbudsside: nøkkeltall, frist, krav og risiko fra kunngjøringen (ordrett, med lenke til originalen), lignende anbud og «se om det passer for dere». Bare åpne anbud med nok innhold kan indekseres. | Kundetiltrekning (søk, deling, ukesbrev) og registrering. | Middels. Viser bare offentlige data; e-post og telefon i teksten maskeres; kan slås av med en bryter. Vilkårene for Doffins API bør bekreftes (står fra før i JURIDISK 4.9). |
| 4 | **Planene lover AI og betaling som ikke virker,** og nevner ikke det som faktisk skiller oss ut (Go/No-Go, kravsjekk, markedspris). | Brutte løfter gir mistillit og klager. Det som virker, selges ikke. | Planbeskrivelser som følger det som er slått på. Egne rader for Go/No-Go, kravsjekk og markedspris. | Tillit og betalingsvilje. | Lav. Bare tekst; priser og grenser urørt. |
| 5 | **Ingen vei videre etter første treff.** Oversikten sier «Profilen er klar», men ikke hva kunden bør gjøre. Listene sier ikke hvorfor et anbud passer. | Kunden må oppleve verdien (første vurdering) i første økt. | «Kom i gang» med tre steg på Oversikt (se beste treff → samlet vurdering → lagre/regn), «Passer fordi …» i listene og lenke rett til vurderingen. | Aktivering og kundeverdi. | Lav. |
| 6 | **Forsiden sier ikke de tre tingene tydelig nok,** og har ingen spørsmål og svar eller lenke til et eksempel. | Besøkende bestemmer seg på sekunder. | Tre budskap øverst (finn riktige anbud, oppdag krav og risiko, sjekk lønnsomheten), «Se et ekte eksempel» som andre knapp, spørsmål og svar, «Eksempel» i menyen. | Registrering. | Lav. Fire språk må følge med. |
| 7 | **Grunnlaget i vurderingen er for grovt merket** (Fakta/Beregning/AI). | Kunden må vite hva som er sikkert, hva som står i kunngjøringen, og hva som er anslag. | Merking: Bekreftet, Fra kunngjøringen, Fra dokumentene, Fra tildelinger, Deres data, Beregning, Anslag, AI – og en egen liste over det som er usikkert. | Kundeverdi og tillit. | Lav–middels. Samme motor. |
| 8 | **Vi måler ikke hele reisen.** Vi vet ikke hvilken side som gir registreringer, hvem som gjør første vurdering, eller hvem som er aktive etter 7 og 30 dager. | Uten tall gjetter vi. | Registreringen husker siden og kilden den kom fra. Første gang en funksjon brukes, og dager med aktivitet, lagres uten andre opplysninger. Admin → Kundereise viser hele trakten. | Styring av alt annet. | Middels. Ny tabell og to kolonner (ingen eksisterende data endres). Personvernteksten oppdateres. |
| 9 | **Ingen kan kjøpe.** Betaling er ikke satt opp, og knappen er død. | Interesserte kunder forsvinner uten spor. | «Meld interesse» for en plan → Admin → Henvendelser, til Stripe er på plass. | Inntekter (og tall på betalingsvilje). | Lav. Endrer ikke betalingssystemet. |
| 10 | **Ukesbrevet gir ikke kunder.** Lenkene går til Doffin, og oppfordringen står nederst. | Ukesbrevet er den billigste veien til gjentatt kontakt. | Hver sak lenker til vår anbudsside med «se krav og risiko», og tydelig «få bare anbudene som passer dere». | Registrering og lojalitet. | Lav (bygger på 3). |
| 11 | **Søkesidene kan gi mer.** Prissiden og funksjonssiden har standardbeskrivelse; få sider har strukturerte data. | Bedre treff og klikk fra Google uten annonser. | Egen beskrivelse per side, strukturerte data (spørsmål og svar, lister, brødsmuler), lenker mellom bransjer, fylker og anbud. | Kundetiltrekning. | Lav. Ingen tynne sider: uendret regel om minst 3 åpne anbud. |
| 12 | **AI vises som tomme paneler i appen.** | Ser uferdig ut og lover noe som ikke finnes. | Skjul AI-paneler, AI-kvoter og AI-oppsalg for kunder når AI er av. | Tillit. | Lav. |
| 13 | **Produksjonen er ikke klar for betalende kunder:** ingen sikkerhetskopi, filer forsvinner, firmaopplysninger og juridisk gjennomgang mangler, serveren sover. | Tap av kundedata eller et avvist krav kan stoppe hele satsingen. | Krever eier: nøkler og valg i Render, Supabase og GitHub (se punkt 6). | Forutsetning for inntekter. | Ikke kode – beslutninger og oppsett. |
| 14 | **Dokumentasjonen motsier seg selv.** | Neste person (eller AI) tar feil beslutninger. | README, VEIKART, STATUS, INTEGRASJONER, LANSERING og DRIFT rettes. | Kvalitet. | Lav. |
| 15 | **Firmaopplysninger må skrives inn for hånd,** og prøveperioden slutter uten oppsummering av verdien kunden fikk. | Færre felt og en god grunn til å bli. | Forslag: hent firmanavn, bransje og adresse fra Brønnøysundregistrene (gratis, åpent API) – **krever godkjenning** (ny ekstern tjeneste). E-posten før prøveperioden slutter kan vise treff og lagrede anbud. | Aktivering og lojalitet. | Lav–middels. Ikke gjort uten ja. |

## 5. Vekst uten annonser – strategien

1. **Søk:** bransje- og fylkessidene (finnes) + offentlige anbudssider (nytt) gir Google noe ekte å vise for
   «anbud renhold Trøndelag» og for navnet på et enkelt anbud. Bare sider med nok innhold indekseres.
2. **Deling:** hver anbudsside kan deles med en kollega eller partner (lenke, e-post, LinkedIn). Demoen kan deles.
3. **Ukesbrevet:** uten konto, per bransje og fylke. Hver sak peker inn til oss. Målet er påmelding → besøk → konto.
4. **LinkedIn:** Admin → LinkedIn lager ukens tekst. Lenkene går til anbudssidene og måles per kilde.
5. **Fra besøk til konto:** «Se om det passer for dere» fra anbudssiden tar med seg anbudet gjennom registreringen, så
   kunden lander på vurderingen av akkurat det anbudet.
6. **Måling:** Admin → Besøk og Kundereise viser hvilke sider og kilder som gir registreringer og aktive kunder.

## 6. Det som fortsatt blokkerer lansering (krever eier)

| Blokkering | Hva som mangler | Hvem |
| --- | --- | --- |
| Betaling | Stripe-konto i testmodus, tre priser, webhook, nøkler i Render (`STRIPE_*`) | Eier |
| Sikkerhetskopi | Fire nøkler i GitHub og ja til GitHub som underleverandør | Eier |
| Fillagring | Privat bøtte i Supabase og fire innstillinger i Render (`STORAGE_DRIVER` m.fl.) | Eier |
| Firmaopplysninger og jus | `COMPANY_LEGAL_NAME`, `COMPANY_ORG_NUMBER`, `COMPANY_ADDRESS`; advokatgjennomgang; databehandleravtaler | Eier |
| AI | Nøkkel og utgiftsgrense – eller la AI stå av (planene sier nå det som er sant) | Eier |
| Navn | Anbudsradar (anbudsradar.no) finnes i samme marked – se NAVNERISIKO.md | Eier |
| Drift | Gratis-serveren sover. For betalende kunder bør den alltid være på (koster penger) | Eier |

## 7. Status for arbeidet (oppdateres fortløpende)

| Del | Status | Commit |
| --- | --- | --- |
| Fase 1 – gjennomgang og 15 forbedringer | Ferdig (dette dokumentet) | `70d0e17` |
| Fase 3 – enklere start (punkt 1 og 5) | Ferdig og testet: ett kort oppstartsskjema (firma, bransjer, område, godkjenninger, hva dere leverer) som tar med seg anbudet kunden kom fra; «Kom i gang» med fem steg på Oversikt; «Passer fordi …» og lenke til vurderingen i listene | `49f75c7` |
| Fase 6 – ærlighet om AI og betaling (punkt 4, 9, 12, 14, del av 15) | Ferdig og testet: «Meld interesse» for planer (Admin → Henvendelser + e-post til eier), AI-linjer merket, tomme AI-paneler skjult for kunder, spørsmål og svar og påminnelses-e-posten følger oppsettet, dokumentasjonen rettet (README, VEIKART, STATUS, INTEGRASJONER, LANSERING, DRIFT) | se git-loggen |
| Fase 2 – forside, demo, spørsmål og svar (punkt 2 og 6) | Ferdig og testet: offentlig eksempel `/eksempel` (et ekte, åpent anbud vurdert med appens egne regler og en tydelig merket eksempelbedrift – uten AI, kostnader eller leverandørnavn; PDF til nedlasting), tre budskap øverst på forsiden som lenker til hver sin del av eksempelet, «Se et ekte eksempel» som andre knapp, «Eksempel» i menyen, spørsmål og svar på forsiden, og strukturerte data (FAQPage) på forsiden og prissiden | se git-loggen |
| Fase 4 – tydeligere grunnlag i vurderingen (punkt 7) | Ferdig og testet: hvert punkt merkes etter hva det bygger på – «Fra kunngjøringen», «Fra dokumentene», «Fra tildelinger», «Deres data», «Beregning» eller «AI-vurdering» – på siden og i PDF-en. Ny samlet liste «Det vi ikke vet sikkert» (bare kunngjøringen lest, dokumenter som ikke kunne leses, ordsøk uten AI eller AI i testmodus, frist uten klokkeslett, verdi ikke oppgitt, profil/omsetning/kostnader som mangler, få tildelinger, for få egne resultater, AI-sitater som ikke ble funnet ordrett). Ingen nye anslag | se git-loggen |
| Fase 5 – offentlige anbudssider, ukesbrev, søk (punkt 3, 10 og 11) | Ferdig og testet: offentlig side per anbud `/anbud/<id>` (kunngjøringen, ordsøket merket som fakta, hva lignende kontrakter ble tildelt for, e-post og telefon skjult, «Se om anbudet passer dere» som tar anbudet med gjennom registreringen, deling og ukesbrev). Bare åpne anbud med minst 300 tegn tekst indekseres og står i nettstedskartet – resten har noindex. Bransje- og fylkessidene og ukesbrevet lenker hit i stedet for til registrering eller Doffin. Egen beskrivelse for prissiden og funksjonssiden. Kan slås av med `PUBLIC_TENDER_PAGES=false` | se git-loggen |
| Fase 7 – måling av hele reisen (punkt 8) | Ferdig og testet: registreringen husker siden som lenket dit og kilden (søk, ukesbrev, LinkedIn, intern …) uten informasjonskapsler; kilden fra ukesbrevet følger med fra anbudssiden. Admin → Kundereise viser nå også «Åpnet et anbud» og «Så en samlet vurdering», sidevisninger mot registreringer, hvem som kom tilbake etter 7 og 30 dager, fra prøveperiode til betalende (inkl. «Meld interesse») og oppsigelser, og hvor registreringene kom fra. Ingen tredjepartsanalyse | se git-loggen |

| Kvalitetssikring | Ferdig: typesjekk, 229 enhetstester (1 hoppet over), 213 integrasjonstester, 10 nettlesertester, produksjonsbygg, `npm audit` (0 sårbarheter), CI grønn, og kontroll av tilgjengelighet, kontrast og bredde på 390/768/1440 px i lys og mørk modus | `944e501` |

**Krever eiers godkjenning (ikke gjort):**
- Henvendelser (kontaktskjema, «Meld interesse», feilrapporter) har ingen slettefrist i dag. Forslag: løste henvendelser
  slettes etter 24 måneder. Det er sletting av produksjonsdata, så det venter på ja.
- Brønnøysundregistrene for å fylle ut firmaopplysninger (ny ekstern tjeneste, gratis).

