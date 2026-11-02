# Profit Intelligence

Sist oppdatert 2. november 2026.

Profit Intelligence hjelper små og mellomstore bedrifter å svare på spørsmålet *«tjener vi penger på dette oppdraget – og tåler vi vilkårene?»* før de bruker tid på et tilbud. Funksjonen kobler sammen fire ting som i dag ligger i hvert sitt regneark, hode eller dokument:

1. **Bedriftens egne kostnader** (timekost, påslag, marginer, mengder) → selvkost, minstepris og prisintervall.
2. **Kontraktsvilkårene i dokumentene** (dagbøter, betalingsfrist, prisregulering, garantier, ansvar …) → risiko med dokument, side og sitat.
3. **Kapasitet og kvalifikasjoner** (bemanning, eksisterende kontrakter, utstyr, sertifiseringer) → om dere faktisk kan levere.
4. **Anbudspartnere** → hvem som kan dekke det dere mangler, med samtykke og konkurranserettslige sperrer.

Resultatet er en begrunnet anbefaling: **Vurder å by**, **Undersøk nærmere**, **Høy risiko** eller **For lite grunnlag**.

> Profit Intelligence er en *økonomisk* vurdering. Den sier ingenting om hvilken pris som vinner, hva konkurrentene byr eller sannsynligheten for å vinne – og det står tydelig på hver side.

---

## 1. Konkurrentundersøkelse (november 2026)

Undersøkelsen bygger på offentlig produktinformasjon. Vi har **ikke** testet konkurrentenes produkter innenfra, så fravær av en funksjon betyr bare at vi ikke fant den beskrevet.

| Aktør | Hva de beskriver | Kilde |
| --- | --- | --- |
| Mercell | «AI Bid Assistance» med blant annet sammendrag av konkurransegrunnlag og en Go/No Go-sjekkliste; AI-funksjoner lansert i Norge, Sverige, Finland og Nederland | [AI Bid Assistance](https://info.mercell.com/en/for-suppliers/ai-bid-assistance/), [Mercell AI i Norge](https://community.mercell.com/product-updates/mercell-ai-is-now-available-in-norway-sweden-finland-and-the-netherlands-159), [Tender summarisation](https://info.mercell.com/en/tender-summarisation-ai/) |
| Tendium | Sammendrag, kvalifikasjonsverktøy og kravuthenting | [Qualification tool](https://tendium.ai/en/qualification-tool/), [Tjenester](https://tendium.ai/services) |
| Tendios | BidAI-analyse med risikoflagg og Go/No-Go | [BidAI analysis](https://public.tendios.com/product/bid/feature/analysis) |
| BidFix, Tendrio, BidScout | Anbudsvarsling og tilbudsstøtte | [BidFix](https://www.getapp.co.uk/software/2096749/bidfix), [Tendrio](https://www.g2.com/sellers/tendrio), [BidScout](https://www.capterra.com/p/10043890/BidScout/) |
| Blackridge, Forgent | Generiske bid/no-bid-kalkulatorer og rammeverk (poeng på skjønn) | [Blackridge](https://www.blackridgeresearch.com/tools/bid-no-bid-decision-calculator), [Forgent](https://www.forgent.ai/blog/bid-no-bid-entscheidung-framework) |

**Gapet vi fant:** Ingen av produktene beskriver at de regner på *bedriftens egne kostnader* opp mot *vilkårene i dokumentene* og *bedriftens kapasitet* – med sporbare formler og kildehenvisning – og kobler manglene til konkrete partnere. Go/No-Go-sjekklister og risikoflagg finnes, men uten kroner, marginer og minstepris.

**Slik er AnbudRadar annerledes:**

- **Tall i stedet for magefølelse:** minstepris, målpris og margin regnes ut med åpne formler, og følsomhet viser hva som skjer hvis kostnadene blir 5, 10 eller 20 % høyere.
- **Vilkår blir kroner:** en dagbot med tak blir «maks samlet dagbot: 120 000 kr»; en betalingsfrist blir «kapital bundet: ca. 65 000 kr» – men bare når tallet står i et kontrollert sitat.
- **Sporbarhet:** hvert tall er merket *Dokument*, *Deres tall*, *AI-estimat*, *Beregnet* eller *Mangler*. AI-en setter aldri priser eller kostnader.
- **Kapasitet og partnere i samme bilde:** mangler i timer, utstyr eller sertifiseringer gir forslag til publiserte partnere, med begrunnelse.
- **Ærlig om usikkerhet:** mangler kontraktsvilkårene, blir anbefalingen aldri «Vurder å by».

---

## 2. Slik virker det

```
Kunngjøring + opplastede dokumenter ──► Ordsøk etter vilkår (uten AI) ─────────────┐
                                    └─► AI: beløp, mengder, vilkår (med sitater) ──┤
                                         └─ sitat- og tallkontroll                │
Bedriftens tall (økonomi, bemanning, utstyr, kontrakter, profil) ─────────────────┤
Kalkylelinjer (deres tall + importerte mengder) ──► Kalkulator (deterministisk) ──┤
                                                                                  ▼
                                    Risiko · Kvalifikasjoner · Kapasitet · Partnerforslag
                                                                                  ▼
                                                                Anbefaling med begrunnelse
```

| Side | Adresse | Plan |
| --- | --- | --- |
| Lønnsomhet for ett anbud | `/app/anbud/:id/lonnsomhet` | Profesjonell og Bedrift |
| Portefølje (alle kalkyler) | `/app/lonnsomhet` | Profesjonell og Bedrift |
| Kapasitet og økonomi | `/app/kapasitet` | Profesjonell og Bedrift |
| AI-analyse av lønnsomhet og risiko | knapp på lønnsomhetssiden | Bedrift |
| Anbudspartnere – profil og svar | `/app/partnere` | Alle betalte planer |
| Anbudspartnere – søk og forespørsler | `/app/partnere` | Bedrift |

Plansperrene håndheves på serveren (rutene har `feature`), ikke bare i grensesnittet.

---

## 3. Opphav for hvert tall

| Merke | Betyr | Eksempel |
| --- | --- | --- |
| **Dokument** | Står i kunngjøringen eller i et opplastet dokument | Estimert verdi i kunngjøringen; «800 timer per år» i et kontrollert sitat |
| **Deres tall** | Bedriftens egne tall og forutsetninger | Timekost, marginer, endrede mengder |
| **AI-estimat** | Mengde utledet av AI (med utregning) eller sitat som ikke kunne kontrolleres | «2 vektere × 8 760 timer» |
| **Beregnet** | Regnet ut av kalkulatoren | Selvkost, minstepris, maks dagbot |
| **Mangler** | Finnes ikke – og er ikke gjettet | Kontraktsverdi ikke oppgitt |

Regler:

- Enhetskosten er **alltid** bedriftens egen. AI-importerte timelinjer får bedriftens timekost; andre linjer får tom enhetskost som brukeren fyller inn.
- En linje fra dokument/AI beholder opphavet så lenge mengden, enheten og perioden er uendret. Endrer brukeren mengden, blir det *Deres tall*.
- Kontraktsverdi og varighet merkes *Dokument* bare når de er lik verdien i kunngjøringen (eller et AI-funn der beløpet står i et kontrollert sitat).
- Verdier i annen valuta enn NOK regnes ikke om.

---

## 4. Formler

Kalkulatoren (`src/domain/profit/calculator.ts`) er deterministisk: samme tall gir alltid samme svar.

| Størrelse | Formel |
| --- | --- |
| Linjesum | mengde × enhetskost × perioder (totalt = 1; per måned = varighet i måneder; per år = måneder ÷ 12) |
| Direkte kostnader | sum av linjer med alle tall (linjer som mangler noe, holdes utenfor og varsles) |
| Indirekte kostnader | direkte × påslag % |
| **Selvkost** (pris uten tap) | direkte + indirekte |
| Risikopåslag | selvkost × risikopåslag % |
| **Pris for margin m** | (selvkost + risikopåslag) ÷ (1 − m) |
| Minstepris / målpris | pris for minstemargin / ønsket margin |
| Fortjeneste ved pris P | P − selvkost |
| Margin ved pris P | fortjeneste ÷ P |
| Følsomhet | selvkost når direkte kostnader øker 5/10/20 % (påslaget følger med) |
| Maks samlet dagbot | tak % × referansepris (målpris, ellers kontraktsverdi) |
| Kapital i utestående | (selvkost ÷ måneder) × betalingsfrist (dager) ÷ 30 |
| Tilbudskostnad | timer brukt på tilbudet × timekost |

Rammeavtaler merkes: oppgitt verdi er ofte et anslag eller tak, ikke garantert omsetning.

---

## 5. Anbefalingsregler

Fra `src/domain/profit/recommendation.ts`:

1. **For lite grunnlag** – ingen kostnadslinjer med alle tall.
2. **Høy risiko** – fristen er ute, *eller* tap ved kontraktsverdien, *eller* minst én kontraktsrisiko vurdert som høy, *eller* manglende kvalifikasjoner, *eller* timebehovet overstiger ledig kapasitet med mer enn 25 %.
3. **Vurder å by** – bare når *alle* er oppfylt: margin ved kontraktsverdien ≥ ønsket margin, kontraktsvilkårene er analysert (AI med dokumenter, eller brukeren har krysset av for at de er lest), risikonivået er kjent, kapasiteten er ok/stram uten timemangel, og ingen linjer mangler tall.
4. **Undersøk nærmere** – alt annet.

Hver anbefaling viser begrunnelser og en sjekkliste (oppfylt / ikke oppfylt / ukjent).

---

## 6. Risiko og kontraktsvilkår

**Ordsøk uten AI** (`terms-scan.ts`) finner dagbøter, betalingsvilkår, prisregulering (inkl. «prisene er faste»), garantier, ansvar, leveringsfrister, forsikring, volum/opsjoner og standardkontrakter (NS 84xx, SSA) i kunngjøringen og dokumentene, med dokument, side og utdrag. Brukes for alle planer med kalkulator.

**AI-analysen** (`ai.ts`, Bedrift) henter ut:

- beløp som står i kildene, varighet, hvordan pris skal oppgis og vektes,
- kostnadsdrivere med mengder (`kilde`, `utledet` med utregning, eller `ukjent` = ingen mengde),
- kontraktsrisiko med alvorlighet, økonomisk effekt, og prosent/dager/beløp bare når de står i sitatet,
- økonomiske usikkerheter, hva som mangler for å regne, og dokumenter som ikke er lest.

**Kontroll etter svaret:**

- Hvert sitat sjekkes mot kildeteksten. Sidetall vises bare når siden finnes i dokumentet.
- Hvert tall AI-en sier står i kildene, må finnes i det kontrollerte sitatet (`numberInText` forstår «1 500 000», «1,5 mill.», «2 MNOK», «1 promille», «45 dager», «tre»).
- Tall som ikke kan kontrolleres, vises med advarsel og brukes **ikke** i beregninger.
- En mengde merket «ukjent» fjernes alltid, selv om modellen har satt et tall.
- Instruksjoner i dokumenttekst ignoreres (samme kildeblokk og regler som resten av AI-analysen).

**Risikonivå:** brukerens egen vurdering hvis satt; ellers høy hvis AI fant en høy risiko, middels/lav bare når dokumenter er analysert; ellers «ikke vurdert».

---

## 7. Kapasitet og kvalifikasjoner

- **Bemanning registreres som roller med antall** («Maskinfører × 2, 1 500 t per person per år») – aldri navn. Tilgjengelige timer = sum av antall × timer.
- **Eksisterende kontrakter** binder timer i den delen av perioden de overlapper anbudet.
- **Periode:** oppgitt start/slutt; ellers fra tilbudsfristen og varigheten (dette står på siden). Uten varighet vurderes de første 12 månedene.
- **Utstyr** som AI-en finner i dokumentene, sammenlignes med registrert utstyr.
- **Kvalifikasjoner:** kjente sertifiseringer/godkjenninger i kildene sammenlignes med profilen og bemanningens sertifikater; lovpålagte godkjenninger (f.eks. vaktvirksomhet, renholdsregister) markeres som mulig absolutt krav; omsetningskrav sammenlignes med profilen; «ikke oppfylt» fra egnethetsvurderingen tas med.
- Ingen standardtall gjettes: mangler timer eller varighet, står det at kapasiteten er ukjent.

---

## 8. Anbudspartnere

**Samtykke og synlighet**

- Profilen er usynlig til eier/administrator publiserer den med samtykke. Tidspunkt og tekstversjon (`partner-v1`) lagres, og databasen nekter publisering uten samtykke.
- Profilen inneholder bare felt laget for deling (navn, kort tekst, hva dere leverer, områder, bransjer, sertifiseringer, roller, antall ansatte). Kalkyler, priser, kunder og dokumenter deles aldri.
- Skjult profil kan ikke leses av andre (RLS), heller ikke via direkte lenke.

**Forespørsler**

- Bare eier/administrator kan sende og svare. Avsenderen må selv ha publisert profil.
- Avsenderen deler sin kontaktinfo i forespørselen. **Mottakerens kontaktinfo deles bare ved godkjenning.**
- Databasen håndhever overgangene: bare mottakeren kan godta/avslå, bare avsenderen kan trekke tilbake, bare fra «venter», og appen kan bare endre svarfeltene (kolonnerettigheter + trigger).
- Høyst 20 forespørsler per organisasjon per døgn, og ingen doble ubesvarte forespørsler.
- Varsler går til eiere/administratorer og følger brukernes e-postinnstillinger (kan meldes av).
- Alle handlinger revisjonslogges.

**Konkurranserett**

Samarbeid om anbud mellom bedrifter som hver for seg kunne levert, kan være ulovlig etter konkurranseloven § 10. Konkurransetilsynet beskriver at samarbeid normalt er lovlig når partene ikke kan levere alene, men at det må vurderes konkret ([prosjektveilederen](https://konkurransetilsynet.no/wp-content/uploads/2018/09/prosjektveileder_-2014.pdf), [EBAs veileder](https://eba.no/siteassets/dokumenter/dokumenter-til-lukkede-sider-innlogging/del-8-veileder-om-konkurranserettslige-skranker-for-prosjektsamarbeid.pdf); se også sakene [Ski Taxi](https://konkurransetilsynet.no/wp-content/uploads/2018/09/Ski-Taxi-saken.pdf) og [Taxi Midt-Norge](https://konkurransetilsynet.no/wp-content/uploads/2018/08/v2009-7-taxi-midt-norge-as-palegg-om-opphor-og-ileggelse-av-overtredelsesgebyr.pdf)). Derfor:

- Avsenderen må oppgi om partene kan levere alene. Svarer de **«begge kan levere hele oppdraget alene»**, sendes ikke forespørselen.
- Avsenderen må bekrefte at de ikke deler priser, marginer eller tilbudsstrategi.
- Veiledningen vises på partnersiden, med lenke. Den er **ikke juridisk rådgivning** – teksten bør gjennomgås av advokat før lansering.

**Forslag:** regelbasert og forklart – sertifisering som mangler (+3), utstyr nevnt i profilen (+2), samme område (+1), samme bransje (+1), ekstra kapasitet i samme bransje og område (+2). Bare bransje eller område alene er ikke nok.

---

## 9. Datamodell og sikkerhet

Migrering `db/migrations/0010_profit_intelligence.sql`:

| Tabell | Innhold | Tilgang (RLS) |
| --- | --- | --- |
| `org_economics` | timekost, påslag, marginer, risikopåslag, tilbudstimer | alle medlemmer leser; eier/admin endrer |
| `org_staff` | roller, antall, timer per person, sertifikater (ingen navn) | som over |
| `org_equipment` | maskiner og utstyr | som over |
| `org_contracts` | eksisterende kontrakter med timer per måned | som over |
| `tender_calculations` | kalkylens input (med opphav) og beregnet øyeblikksbilde | alle medlemmer i organisasjonen |
| `partner_profiles` | partnerprofil med samtykke | egen alltid; andres bare når publisert; eier/admin endrer |
| `partner_requests` | forespørsler | bare de to partene; innsending og svar krever eier/admin; trigger styrer status |

AI-analysen lagres i `ai_analyses` (`kind = 'profit_analysis'`) og alltid privat for organisasjonen. Bruken telles som `ai_profit_analysis` i AI-kvoten.

---

## 10. Tester

| Test | Hva den beviser |
| --- | --- |
| `tests/unit/profit.test.ts` (8) | formler, perioder, manglende tall holdes utenfor, følsomhet, rammeavtale, testpris, dagbot/kapitalbinding, ordsøk med side, kapasitet med overlapp, anbefalingsregler |
| `tests/unit/profit-ai.test.ts` (8) | tallkontroll (diktede beløp og sitater avvises), feil sidetall vises ikke, «ukjent» mengde fjernes, norsk tallformat, opphavsregler i skjemaet, risikonivå, partnerrangering |
| `tests/integration/profit.test.ts` (7) | hele flyten via HTTP og ekte database: lagring med opphav, formler, testpris, valideringsfeil, plansperrer, AI-analyse i testmodus med import, kapasitet og rollerettigheter, partnere med samtykke/sperre/kontaktdeling, RLS for alle nye tabeller |

Mutasjonssjekk: når sperren for «begge kan levere alene» eller tallkontrollen fjernes, feiler testene.

**Ikke verifisert:** AI-analysen er kjørt med den simulerte leverandøren (`AI_PROVIDER=mock`). Den ekte modellens kvalitet på norske kontraktsvilkår er **IKKE VERIFISERT** – se `docs/INTEGRASJONER.md` for hvordan den testes med en ekte nøkkel. Kontrollene (sitat, tall, «ukjent», plansperrer) gjelder uansett leverandør.

---

## 11. Begrensninger og videre arbeid

- Ordsøket finner ord, ikke betydning: «ingen dagbot» gir også treff. Utdraget vises alltid, så brukeren kan lese selv.
- Sertifiseringer gjenkjennes bare fra en kjent liste (ISO 9001/14001/27001/45001, StartBANK, sentral godkjenning, renholdsregister, vaktvirksomhet m.fl.).
- Kapasitet regnes i timer per år for hele bedriften, ikke per rolle eller per uke (sesongtopper som vinterdrift fanges ikke).
- Dokumenter må lastes opp av brukeren; automatisk henting av konkurransegrunnlag er ikke bygget.
- Partnernettverket er tomt ved lansering og blir verdifullt først når kunder publiserer profiler.
- Juridiske tekster (samtykke, konkurranserettslig veiledning) er utkast og bør gjennomgås av advokat.
