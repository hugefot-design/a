# Byggeplan: best for små bedrifter som vil vinne anbud

Skrevet 15. november 2026 etter en idérunde med eier. Filen forteller Claude hva som skal bygges, i hvilken
rekkefølge, og hva eier må si ja til først. Alle ideene fra runden står her: de som bygges (del A), de som venter på
eier (del B) og de som er lagt bort (del C).

## Til eier: slik bruker du filen

Start en ny økt med Claude og skriv for eksempel:

> Les docs/BYGGEPLAN.md og bygg første runde (pakke 1–5). Følg reglene i filen. Ikke rull ut.

Du kan også be om én pakke («Bygg pakke 2 fra docs/BYGGEPLAN.md») eller si ja til noe i del B
(«Ja til B2 med prisene som er foreslått»). Ingenting i del B bygges før du har sagt ja.

---

## Til Claude: les dette først

### Målet

AnbudRadar skal bli det beste verktøyet for **små bedrifter uten egen anbudsavdeling** som lurer på to ting:
bør vi by, og til hvilken pris? Vi konkurrerer ikke med Mercell og Cobrief på flest funksjoner eller mest AI. Vi vinner
på lønnsomhet regnet med bedriftens egne tall, på ærlighet om hva vi vet og ikke vet, og på at det er enkelt.

Hver pakke skal gjøre minst én av tre ting. Bruk dem når du må velge mellom løsninger:

1. Gjøre beslutningen «by eller ikke, og til hvilken pris» bedre.
2. Gi kunden en grunn til å komme tilbake mellom anbudene.
3. Skaffe flere besøkende uten annonser.

### Slik står det nå (15.11.2026)

- Nettsiden er anbudradar.com. Versjonen i produksjon er `bf8a2d6`. All kode ligger på grenen
  `claude/anbudradar-saas-launch-eje0gv`, som er den eneste grenen.
- Ingen betalende kunder. Kortbetaling er ikke åpnet (Stripe mangler nøkler). AI er ikke slått på.
  Firmaopplysningene er ikke lagt inn. Serveren er gratisplanen hos Render, og den sovner.
- Testene er grønne: 238 enhetstester (1 hoppet over), 243 integrasjonstester og 10 nettlesertester.
- Les før du begynner: `README.md`, `docs/STATUS.md` (hva som er testet og rullet ut), `docs/TRANSFORMASJON.md`
  (hva som er bygd og hva som blokkerer), `docs/KONKURRENTER.md`, `docs/PRISER.md`, `docs/DRIFT.md` og
  `docs/PERSONVERN.md`.
- Strider noe i denne filen mot koden, er det koden som gjelder. Si fra om avviket i rapporten.

### Faste regler fra eier

Disse gjelder alt arbeid. De i anførselstegn er eiers egne ord.

- «Ikke fjern eksisterende funksjonalitet. Ikke bygg dupliserte funksjoner. Ikke skriv om hele arkitekturen uten en
  svært god grunn.»
- «Ikke finn opp kunder, kundeomtaler, statistikk eller resultater.» «Bruk eksisterende data og funksjoner.»
- «Ikke legg til betalte leverandører, nye eksterne tjenester eller API-er uten godkjenning.» «Ikke bruk penger eller
  start annonser.» «Behold den lave driftskostnaden som en viktig del av strategien.»
- «Ikke endre domenet eller produktnavnet uten godkjenning. Ikke endre priser eller abonnementsgrenser.»
- «Ikke endre produksjonshemmeligheter eller produksjonsdata. Ikke gjør destruktive databaseendringer uten godkjenning.»
- «Ikke deploy til produksjon.» Ingenting rulles ut før eier skriver «rull ut». Hver commit har `[skip render]` i
  tittelen. Ikke lag pull request uten at eier ber om det.
- «Ikke svekk sikkerhet, personvern eller dataseparasjon for å forbedre brukeropplevelsen.» «Ikke legg til unødvendig
  sporing eller tredjepartsanalyse.»
- «AI må ikke markedsføres som aktiv dersom produksjonsintegrasjonen ikke fungerer. Ikke bruk simulert AI som om den
  var ekte.» «AI skal aldri finne på krav, beløp, frister eller sertifiseringer.»
- «Dersom miljøvariabler, nøkler eller eksterne konfigurasjoner mangler, dokumenter dette som en blokkering. Ikke finn
  på at det er løst.»
- «Ikke lag tynne SEO-sider bare for å fylle Google med URL-er.» «Ikke kom med udokumenterte påstander om konkurrenter.»
  «Ikke lov OCR, internasjonal datadekning eller integrasjoner som ikke fungerer.»
- «Bruk Stripe test mode til testing. Ikke gjennomfør ekte betalinger.» «Ikke send ekte e-poster til kunder under
  testing uten at dette er uttrykkelig godkjent. Bruk testmottakere.»
- «Ikke skriv ut API-nøkler, passord eller hemmeligheter i rapporter eller logger.» «Ikke be meg sende API-nøkler eller
  passord i vanlig chat.» «Sørg for at .env og andre hemmelige filer ikke blir lastet opp til Git.»
- Doffin: «Ikke overskrid 10 forespørsler per minutt per abonnement.» TED: «Ikke endre eksisterende TED-integrasjon.»
- «Ikke avslutt med bare anbefalinger. Gjennomfør arbeidet som faktisk kan gjøres i kode.»

**Kvalitetskrav for hver pakke:** `npm run test:all`, `npm audit` og `npm run build` uten feil. Nye og endrede sider
sjekkes på 390, 768 og 1440 px i lys og mørk modus: én h1, etiketter på alle felt, nok kontrast, ingen sidelengs
rulling, ingen JavaScript-feil. Ingen hemmeligheter i koden. Alle knapper og lenker virker.

### Det som finnes fra før – ikke bygg det på nytt

| Dette finnes | Her |
| --- | --- |
| Treffpoeng 0–100 med faste regler | `src/domain/matching/engine.ts` (`scoreTender`, `SCORE_PARTS`, `SCORE_CAPS`) |
| «Prøv uten konto» (`/prov`) | `src/domain/matching/quick.ts`, `src/ui/pages/tools.tsx` |
| Lønnsomhetskalkulator og den åpne sjekken (`/kalkulator`) | `src/domain/profit/calculator.ts`, `quick-calc.ts`, `service.ts` |
| Markedspris fra tidligere tildelinger | `src/domain/profit/market.ts` |
| Søk etter krav, avvisningsgrunner og kostbare vilkår | `src/domain/documents/requirements.ts`, `src/domain/profit/terms-scan.ts` |
| Samlet vurdering med PDF, og merking av hva hvert punkt bygger på | `src/domain/intelligence/` |
| Resultater (pris, utfall, årsak) og vinnerandel | `src/domain/tenders/results.ts`, `src/domain/intelligence/learning.ts` |
| Utløpsradar i appen, og utløpsliste på offentlige sider | `src/domain/competitors/expiry.ts`, `src/domain/tenders/expiring.ts` |
| Offentlige sider: anbud, oppdragsgiver, bransje, fylke, eksempel, metode | `src/domain/tenders/public-page.ts`, `buyer-page.ts`, `market.ts`, `src/ui/pages/` |
| Ukesbrev uten konto (bransje og fylke) | `src/domain/newsletter/newsletter.ts`, `src/ui/newsletter.tsx` |
| Varsler og fristpåminnelser | `src/domain/notifications/engine.ts` |
| Opplasting av dokumenter (PDF og Word) | `src/domain/documents/documents.ts`, `extract.ts` |
| Tilbudsarbeid, anbudspartnere, kapasitet | `src/domain/bids/`, `src/domain/profit/`, `src/routes/app/` |
| Fremtidige prosjekter (Enterprise) og planlagte kunngjøringer | `src/domain/opportunities/`, livssyklus `planned` i `tenders` |
| Planer, priser og Stripe | `src/domain/billing/plans.ts`, `stripe.ts` |
| Måling uten informasjonskapsler, kundereise i admin | `src/domain/activation.ts`, `src/domain/admin/` |
| Brytere for offentlige funksjoner | `PUBLIC_TENDER_PAGES`, `PUBLIC_TOOLS`, `PUBLIC_BUYER_PAGES` i `src/lib/env.ts` |

### Fakta fra sjekken 15.11.2026

Tallene er fra utviklingsdataene. Sjekk dem på nytt før du bygger på dem.

- 119 av 521 åpne anbud har tildelingskriterier med vekter i `tenders.award_criteria`. Formen er
  `[{"name": "Price", "type": "price", "weight": "30 %"}]`. De fleste kommer fra TED.
- 22 av 1 038 tildelinger har antall mottatte tilbud. 364 har varighet.
- Dokumentlenkene går til Mercell, TendSign, EU-Supply og Ivalua, som krever innlogging (se `docs/FORSLAG.md` punkt 13).
- Opplasting tar bare PDF og Word. Ikke ZIP eller Excel.
- Resultater lagrer egen pris, utfall, årsak og kilde. Ikke poeng.
- Ukesbrevet kan følge bransje og fylke, ikke oppdragsgiver.
- Menyen i appen har 15 valg (`AppNav` i `src/ui/layouts.tsx`) og er lengre enn en telefonskjerm.
- Det finnes ingen kalenderfil, ingen sammenligning av anbud, ingen årsbetaling og ingen enkeltkjøp.
  Stripe-koden lager bare abonnement.
- Full henting fra Doffin (XML-berikelse) er bygd, men `DOFFIN_ENRICH_XML` står på `false`.
- 9 av 544 norske oppdragsgivere har norsk navn fra Doffin. Resten har navnet slik TED skriver det, ofte på engelsk.

---

## Del A – bygg dette

Ingen av pakkene krever ja fra eier for å bygges. Utrulling krever alltid «rull ut». Bygg i rekkefølge.
Første runde er pakke 1–5.

### Pakke 1: Forenkle appen

**Hvorfor:** Små bedrifter uten anbudsavdeling møter 15 menyvalg. Det ser vanskelig ut før de har begynt.

**Bygg:** Grupper menyen etter reisen kunden går. Forslag (juster etter å ha sett sidene):
Oversikt · **Finn** (Finn anbud, Lagrede søk, Varsler, Fremtidige prosjekter) · **Vurder** (Lagrede anbud) ·
**Regn** (Lønnsomhet, Kapasitet og økonomi) · **Lever** (Tilbudsarbeid, Anbudspartnere) ·
**Lær** (Resultater, Konkurrenter) · Konto (Bedriftsprofil, Abonnement, Innstillinger).

**Regler:** Ingen adresser endres, og ingenting fjernes. Merket «Enterprise» og tallet for uleste varsler beholdes.
Menyen skal virke uten JavaScript, slik den gjør i dag.

**Ferdig når:**
- Alle sider som kan nås i dag, kan nås med høyst to trykk.
- På iPhone 13 vises alle hovedvalgene uten rulling, og riktig gruppe er åpen for siden kunden står på.
- Nettlesertestene (`tests/e2e/`) er oppdatert og grønne, også testen for mobilmenyen.
- Eier har fått skjermbilder av menyen på telefon og PC.

### Pakke 2: Tildelingssimulator

**Hvorfor:** Kunngjøringen sier ofte «pris 30 %, kvalitet 70 %». Kunden trenger svaret i kroner: hvor mye dyrere kan
vi være hvis vi er bedre på kvalitet?

**Bygg:**
- En ren funksjon i `src/domain/profit/` som regner poeng for to tilbud ut fra vekter, priser og kvalitetspoeng, og
  som finner prisen der kunden og konkurrenten står likt.
- To prismodeller. Forholdsmessig: prispoeng = maks × laveste pris ÷ tilbudets pris. Lineær: maks poeng for laveste
  pris og null poeng ved en pris kunden oppgir. Kontroller navn og forklaring mot DFØs veiledning (anskaffelser.no)
  og oppgi kilden på siden. Får du ikke sjekket kilden, bygg bare den forholdsmessige og si det i rapporten.
- En åpen side `/tildeling` etter samme mønster som `/kalkulator`: bare norsk, bak `PUBLIC_TOOLS`, ingenting lagres,
  hastighetsgrense per besøkende, `noindex` når adressen har valg i seg. Vis utregningen («Slik er det regnet»).
- Lenke fra anbudssiden i appen (der tildelingskriteriene vises), fra den offentlige anbudssiden når vektene finnes,
  fra `/kalkulator` og fra `/metode`. Vektene fylles inn fra kunngjøringen og merkes «Fra kunngjøringen».

**Regler:** Konkurrentens pris og poeng er kundens egne antakelser og merkes slik. Siden sier at prismodellen står i
konkurransegrunnlaget, og at simulatoren ikke vet hva andre byr.

**Ferdig når:** Enhetstester med tall regnet for hånd. Integrasjonstester for visning, utregning, feil per felt,
forhåndsutfylling fra et anbud, at ingenting lagres, og 404 når bryteren er av. `/metode` har fått et avsnitt.

### Pakke 3: Følg en oppdragsgiver uten konto

**Hvorfor:** Det finnes en side per oppdragsgiver, men besøkende kan ikke abonnere på den. En kommune som deler lenken
med lokale bedrifter, gir oss besøkende gratis.

**Bygg:**
- Påmelding på oppdragsgiversiden med samme løsning som ukesbrevet: dobbel bekreftelse og avmelding med ett klikk som
  sletter adressen. Det krever en ny kolonne for oppdragsgiver i `newsletter_subscribers` (bare å legge til).
- Ukentlig e-post med nye anbud fra oppdragsgiveren og kontrakter som snart utløper. Gjør som ukesbrevet gjør når det
  ikke er noe nytt.
- En oversiktsside `/oppdragsgivere` med dem som har nok innhold til å stå i nettstedskartet, og lenke dit fra
  bunnteksten. Oppdragsgivernavn i de offentlige anbudslistene lenker til oppdragsgiversiden når den finnes.

**Regler:** Ingen leverandørnavn i e-posten. Oppdater `docs/PERSONVERN.md`, og vurder om samtykketeksten trenger ny
versjon. Resend sin gratisplan har et tak på e-poster per dag. Si fra til eier hvis påmeldingene nærmer seg det.

**Ferdig når:** Tester for påmelding, bekreftelse, innholdet i e-posten, avmelding som sletter, hastighetsgrense, og
at alt forsvinner når `PUBLIC_BUYER_PAGES` er av.

### Pakke 4: Poeng fra tildelingsbrevet

**Hvorfor:** Alle som leverer tilbud, får et brev med begrunnelse, som regel med poeng. I dag lagrer appen bare pris,
utfall og årsak. Med poengene kan vi si om kunden tapte på pris eller kvalitet.

**Bygg:** Frivillige felt under Resultater: egne og vinnerens poeng, samlet og per kriterium. Kriterier og vekter
fylles inn fra kunngjøringen når de finnes. Vis «Dere tapte på …» regnet ut fra tallene, og ta det med i læringsdelen
av den samlede vurderingen.

**Regler:** Kunden skriver inn tallene selv. Ingen AI leser brevet nå. Dataene tilhører organisasjonen og deles ikke
med andre kunder (det er punkt B12).

**Ferdig når:** Ikke-destruktiv migrering med radnivåsikkerhet. Enhetstest for utregningen. Integrasjonstest som også
viser at en annen organisasjon ikke ser tallene.

### Pakke 5: Last opp hele pakken (ZIP og Excel)

**Hvorfor:** Vi kan ikke hente konkurransegrunnlaget selv. Da må opplasting være så lett som mulig: slipp ZIP-filen
fra portalen.

**Bygg:** ZIP pakkes ut på serveren, og hver PDF, Word- og Excel-fil blir ett dokument. Filer som hoppes over, vises
med grunn. Excel leses som tekst, så krav og vilkår i regneark blir med i søket. Se først hvordan `extract.ts` leser
Word i dag, og gjenbruk det.

**Regler:** Opplastede filer er ikke til å stole på. Sett grenser for antall filer og samlet størrelse etter
utpakking, avvis filnavn som peker ut av mappen, og pakk ikke ut ZIP i ZIP. Bruk helst det Node har innebygd. En ny
avhengighet må være liten og vedlikeholdt, og `npm audit` skal være ren.

**Ferdig når:** Tester for en vanlig ZIP, en ZIP som er for stor utpakket, farlige filnavn, kryptert ZIP og tom ZIP.

### Pakke 6: Frister i kalenderen

**Bygg:** «Legg i kalender» på anbudssiden (én hendelse), og en personlig kalenderadresse med fristene for lagrede
anbud. Adressen har et hemmelig nøkkelord som lagres som hash og kan byttes under Innstillinger.

**Regler:** Kalenderen viser bare tittel, frist og lenke tilbake. Ingen notater eller priser. Frister uten klokkeslett
blir heldagshendelser. Tidssonen er Europe/Oslo.

**Ferdig når:** Tester for gyldig kalenderformat, at et byttet nøkkelord gir 404, og at andre organisasjoner ikke ser
fristene.

### Pakke 7: Dokumentskuff med utløpsdato

**Hvorfor:** Små bedrifter blir avvist fordi en attest er for gammel. En påminnelse gir dem også en grunn til å bli.

**Bygg:** En liste per organisasjon over attester og bevis (skatteattest, firmaattest, HMS-egenerklæring,
forsikringsbevis, sertifikater) med dato. Varsel før noe utløper, og advarsel på anbudet når noe blir for gammelt ved
fristen.

**Regler:** Begynn med datoer uten filer. Fillagring er ikke satt opp i produksjon (se del B14). Regelen om hvor
gammel en skatteattest kan være, kontrolleres mot Lovdata før teksten brukes, og kilden oppgis.

**Ferdig når:** Tester for påminnelsene og for advarselen på anbudet. `docs/PERSONVERN.md` er oppdatert.

### Pakke 8: Dekningsbevis og åpen statusside

**Hvorfor:** Alle sier de har alle anbud. Vi viser det med et tall som måles hver dag.

**Bygg:** En side `/status` med når hver kilde sist ble hentet, og hvor stor andel av Doffins kunngjøringer de siste
30 dagene som finnes hos oss. Målingen kjøres én gang i døgnet. Se i `src/connectors/doffin.ts` hva søket gir av
totaler.

**Regler:** Høyst 10 forespørsler per minutt mot Doffin. Mangler en måling, står det «ikke målt». Oppetid vises bare
hvis det finnes et ekte, målt tall.

**Ferdig når:** Tester med en etterlignet kilde, også for «ikke målt».

### Pakke 9: Sammenlign to anbud

**Bygg:** Velg to lagrede anbud og se dem side om side: frist, verdi, treff med begrunnelse, krav og
avvisningsgrunner, kostbare vilkår, lønnsomhet og anbefaling. Bruk den samlede vurderingen som finnes, for hvert anbud.

**Ferdig når:** Virker på telefon uten sidelengs rulling. Samme plan-krav som den samlede vurderingen.

### Pakke 10: Svarbibliotek

**Bygg:** Se først hva Tilbudsarbeid har (`src/domain/bids/`). Legg til tekstblokker som kan brukes om igjen
(referanser, kompetanse, kvalitetssystem, miljø, HMS). En blokk kan settes inn i et tilbud, og en seksjon kan lagres
som blokk.

**Ferdig når:** Samme plan og roller som Tilbudsarbeid. Test for at andre organisasjoner ikke ser blokkene.

### Pakke 11: Mindre ting

Bygg disse når pakkene over er ferdige. Hver er liten.

- **Utløp i ukesbrevet:** et avsnitt med kontrakter som snart utløper, uten leverandørnavn.
- **Planlagte anskaffelser** på oppdragsgiver- og bransjesidene, fra kunngjøringer med livssyklus `planned`.
- **Månedlig anbudsbarometer:** antall nye anbud per bransje og fylke, og typiske verdier. Sjekk først at historikken
  er lang nok. Vis bare serier med nok data, og forklar metoden på `/metode`.
- **Guider fra egne data**, for eksempel de vanligste avvisningsgrunnene i en bransje, med ekte antall og sitater.
  Bare der det er nok data til en side som er verdt å lese.
- **Små gratisverktøy** (terskelverdi-sjekk, sjekkliste for egenerklæring). Alt som handler om regler, kontrolleres
  mot Lovdata eller DFØ og får dato og kilde. Terskelverdier finnes allerede i `src/domain/tenders/eforms-facts.ts`.
  Bruk dem derfra.

---

## Del B – venter på ja fra eier

Bygg ikke disse før eier har sagt ja. Forbered gjerne, og skriv i rapporten hva som mangler.

| Nr. | Hva | Hva eier må bestemme eller gjøre | Hva Claude gjør etter et ja |
| --- | --- | --- | --- |
| B1 | **Åpne betaling.** Uten dette er inntekten null | Lage Stripe-konto i testmodus, tre priser og webhook, og legge nøklene i Render (`docs/INTEGRASJONER.md`) | Tester kjøp, bytte og oppsigelse i testmodus. Aldri ekte betalinger |
| B2 | **Årsbetaling.** Penger på forskudd og færre oppsigelser | Prisen. Forslag: ti måneder for tolv (Start 2 990 kr, Profesjonell 6 990 kr, Bedrift 14 900 kr per år) | Årspriser i `plans.ts` og Stripe, valg på prissiden, oppdaterer `docs/PRISER.md` |
| B3 | **Ukentlig varsel gratis, daglig i Start.** Konkurrentene gir bort varsler | Endrer hva planene inneholder | Endrer varslene i gratisplanen og tekstene |
| B4 | **Enkeltkjøp:** én full vurdering av ett anbud, uten abonnement | Pris og hva kjøpet åpner. Anbudsregisteret tar 199 kr for en analyse | Engangsbetaling i Stripe og tilgang til ett anbud |
| B5 | **Rådgivere og foreninger:** egen plan for rådgivere, medlemsrabatt, «hjelp fra et menneske», boks med åpne anbud som foreninger kan legge på sin side | Om og med hvem. Pris og avtaler | Bygger det avtalen trenger. Appen støtter allerede flere bedrifter per bruker |
| B6 | **Organisasjonsnummer inn, ferdig profil ut.** Også norske navn på oppdragsgivere | Ja til Brønnøysundregistrene (gratis, men ny ekstern tjeneste) | Oppslag i oppstartsskjemaet. Godkjenninger vises bare som bekreftet når et register sier det, med kilde og dato |
| B7 | **Full henting fra Doffin.** Kan gi vekter, varighet og antall tilbydere | Ja til å endre innstillingen i Render | Tester først mot ett anbud og måler hva det gir. Høyst 10 forespørsler per minutt |
| B8 | **Slå på AI** | Nøkkel og utgiftsgrense. Koster per bruk (`docs/PRISER.md`) | Måler ekte forbruk og justerer grensene |
| B9 | **Vis hvem som vant** på offentlige sider | Personvern: enkeltpersonforetak kan være personnavn | Viser bare det som er avklart |
| B10 | **Innsyn med ett klikk** | Få jussen sjekket | Lager begjæringen som kunden sender selv |
| B11 | **Klagesaker (KOFA)** per oppdragsgiver | Ja til ny kilde | Sjekker vilkårene og henter |
| B12 | **Lær på tvers av kunder** | Krever kunder og samtykke. Deling av pristall mellom konkurrenter må vurderes juridisk | Ingenting før dette er avklart |
| B13 | **Server som alltid er på** | Koster hver måned (anslag i `docs/STATUS.md`) | Endrer oppsettet sammen med eier |
| B14 | **Det som blokkerer lansering** | Firmaopplysninger, fillagring, nøkler til sikkerhetskopi, advokat, navnerisiko, nettstedskartet i Search Console | Se `docs/TRANSFORMASJON.md` punkt 6 |
| B15 | **Dekningsgaranti:** en gratis måned hvis vi ikke fant et anbud | Et løfte i vilkårene. Vent til pakke 8 har målt dekningen en stund | Tekst og vilkår |
| B16 | **Varsler på telefonen** | Ja til en ny avhengighet. Vent til kunder spør | Bygger varsling i nettleseren |
| B17 | **Publisert treffsikkerhet og kundehistorier** | Krever ekte kunder og deres samtykke | Finner aldri på tall eller sitater |
| B18 | **«Start mellom anbudene, Profesjonell når dere byr»** | Et løfte om fritt bytte. Krever at B1 er på plass | Tekst på prissiden og under Abonnement |

---

## Del C – vurdert og lagt bort

Ikke bygg disse uten at eier tar dem opp igjen.

- **Hente konkurransegrunnlaget automatisk.** Dokumentene ligger bak innlogging hos andre portaler. Pakke 5 er svaret.
- **«Hvor er konkurransen svakest?»** Bare 2 % av tildelingene har antall tilbydere. Ta det opp igjen etter B7.
- **Varsler i Teams og Slack.** Lite verdi for små bedrifter nå.
- **Norden.** Forberedt bak en bryter, men ikke nå.
- **Raskere varsling.** Frister er uker unna.
- **Lavere priser, store rabatter og livstidsavtaler.**
- **Sammenligninger med navngitte konkurrenter på nettsiden.**

---

## Slik jobber du

1. Ta én pakke om gangen. Les koden for området først, og gjenbruk det som finnes.
2. Skriv tester sammen med koden: enhetstester for rene funksjoner, integrasjonstester mot ekte database og HTTP, og
   nettlesertest når noe synes på telefon.
3. Kjør kvalitetskravene over. Ta skjermbilder av det som er nytt.
4. Oppdater `docs/STATUS.md` og statuslisten nederst i denne filen.
5. Commit med `[skip render]` i tittelen og push til grenen. Ikke rull ut.
6. Rapporter kort på enkel norsk: hva som er bygd, hva som er testet, hva som er IKKE VERIFISERT, og hva eier må
   bestemme.

**Utrulling** skjer bare når eier skriver «rull ut». Da: sjekk at testene på GitHub er grønne for akkurat den
versjonen, start utrullingen slik `docs/DRIFT.md` avsnitt 7 beskriver, og kontroller helsesjekken, loggen og sidene
etterpå. Nøkkelen til Render må eier gi på en trygg måte, ikke i chatten.

### Mønstre i koden som skal følges

- Offentlige sider som bare finnes på norsk, gir 404 på andre språk (se `/metode` og `/prov`).
- Nye offentlige funksjoner får en bryter i `src/lib/env.ts` som er på som standard, og en test for at alt forsvinner
  når den er av.
- Offentlige sider viser aldri leverandørnavn eller tildelte verdier. E-postadresser og telefonnumre skjules.
- Sider med lite innhold får `noindex` og står ikke i nettstedskartet.
- Verktøy uten konto lagrer ingenting og har hastighetsgrense per besøkende.
- Tekster på markedssidene finnes på fire språk med like nøkler (`tests/unit/i18n.test.ts`).
- Tall som vises som regler, hentes fra konstanter i koden, og en test passer på at de stemmer.
- Alt som tilhører en organisasjon, har radnivåsikkerhet og en test for at andre ikke ser det.
- Databaseendringer er nye filer i `db/migrations`, bare fremover og ikke-destruktive.

### Fallgruver fra tidligere arbeid

- Integrasjonstestene deler database gjennom hele kjøringen. Bruk en bransje eller CPV-kode ingen andre tester bruker,
  og kjør `NODE_ENV=test npx tsx scripts/prepare-test-db.ts` før du kjører én fil om igjen.
- Organisasjonsnumre i tester må være gyldige (MOD11). Ugyldige numre lagres ikke.
- En test begrenser forsiden til 1 300 lesbare ord.
- React setter `<!-- -->` mellom tekstbiter. Fjern dem før tekst sammenlignes i tester.
- Kjør `npm run build` før skjermbilder, ellers mangler nye stiler.
- Databasen gir kolonnenavn i camelCase.
- Databasen i utviklingsmiljøet kan ha stoppet. Start den med `sudo service postgresql start`.
- Valgbrikkene i oppstartsskjemaet har skjult avkrysningsboks. Klikk på etiketten i nettlesertester.
- Hele testpakken tar omtrent tolv minutter. Ikke endre filer serveren bruker mens den kjører.

---

## Status

Oppdater denne når en pakke er ferdig.

| Pakke | Status | Versjon |
| --- | --- | --- |
| 1 Forenkle appen | Ikke startet | |
| 2 Tildelingssimulator | Ikke startet | |
| 3 Følg en oppdragsgiver | Ikke startet | |
| 4 Poeng fra tildelingsbrevet | Ikke startet | |
| 5 ZIP og Excel | Ikke startet | |
| 6 Kalender | Ikke startet | |
| 7 Dokumentskuff | Ikke startet | |
| 8 Dekningsbevis og statusside | Ikke startet | |
| 9 Sammenlign to anbud | Ikke startet | |
| 10 Svarbibliotek | Ikke startet | |
| 11 Mindre ting | Ikke startet | |
