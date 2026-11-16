# Kundesimulering – ville de brukt og betalt? (16. november 2026)

**Dette er en simulering, ikke kundedata.** Ingen ekte kunder er spurt. Vurderingene under er laget ved å gå gjennom
den ekte nettsiden og appen som åtte typiske kunder og spørre «hva ville denne bedriften gjort?». Bruk det til å finne
hindringer – ikke som bevis på etterspørsel, og aldri i markedsføring.

## Slik er det gjort

- **Åtte kundetyper** som byr på offentlige anbud i Norge (tabellen under), med det de selv ville skrevet om hva de
  leverer.
- **«Prøv uten konto» på anbudradar.com** for hver av dem, 16.11.2026 kl. ca. 17 UTC – ekte, åpne anbud. Vanlige
  besøk med curl og Chromium uten skjerm, som ikke telles som besøk.
- **Appen fra registrering til abonnement** for fem av dem, lokalt (utviklingsdatabasen, AI av som i produksjon,
  ingen ekte kontoer eller e-poster). Kontoene ble slettet etterpå.
- **Pris og alternativer** fra [PRISER.md](PRISER.md) og [KONKURRENTER.md](KONKURRENTER.md) (internt notat, lest
  14.11.2026 – ikke kontrollert fra innsiden).

## Svaret kort

| | Antall av 8 |
| --- | --- |
| Ville trolig brukt gratisversjonen og kommet tilbake | 3 (renhold, IT, medisinsk forbruksmateriell) |
| Kunne betalt – hvis det gikk an | 1–2 (renhold; kanskje medisinsk eller IT) |
| Kan betale i dag | 0 – kortbetaling er ikke åpnet |
| Ville trolig gått etter første besøk | 5 – de fikk ikke relevante anbud øverst |

Det som avgjør mest, er **første treff**. Der treffene var riktige (renhold, IT, medisinsk), var resten av produktet
godt nok til å prøve. Der de bommet (elektro, vakt, transport, rådgivende ingeniør, brøyting), kom kunden aldri så
langt som til lønnsomhet og vurdering.

## Per kundetype

| Kundetype | Hva de så øverst i dag | Bruker? | Betaler? | Hvorfor |
| --- | --- | --- | --- | --- |
| **Renhold, Oslo** (ca. 15 ansatte) – «daglig renhold av kontorer og skoler» | 23 åpne; de tre øverste er renhold i Oslo (SSB, Kulturtanken, Pilar) | Ja | Kanskje (Start eller Profesjonell) | Treffene stemmer, og minstepris og lønnsomhet er nyttig i en bransje med små marginer. Varsler alene får de gratis andre steder. |
| **Elektro, Rogaland** – «elektroinstallasjon og rehabilitering av bygg» | 330 åpne i Bygg og anlegg; øverst uteareal, kunstgress og uværsskur. Anbudet om elektriske fordelinger kom som nr. 5 | Nei | Nei | Ser ut som tjenesten ikke forstår hva de gjør. Med ordet «elektr» kommer el-anbudet øverst – men det skriver ingen. |
| **IT, Trøndelag** – «utvikling av webløsninger og drift av skytjenester» | 101 åpne; 4 av 5 relevante (Nettalliansen, Norsk Helsenett, Skatteetaten, Kystverket), 1 bom (skolebøker) | Ja | Kanskje (Profesjonell) | Treffene er gode, men IT-kjøpere forventer AI-analyse av lange dokumenter, og AI er av. Konkurrentene selger nettopp AI. |
| **Vakt, Vestland** – «vakthold, resepsjon og alarmrespons» | 12 åpne; øverst slokkeutstyr, sikkerhetsutstyr og skilting. Ingen vaktanbud | Nei | Nei | Tre ekte vaktanbud finnes («Vakttjenester», «Rammeavtale vektertjenester» …), men kom ikke opp. |
| **Transport, Innlandet** – «skoleskyss og varetransport» | 80 åpne; øverst leasing av biler, reisebyrå og avfallsesker | Nei (nå) | Nei | Få relevante anbud akkurat nå. På hele landet kommer «Transport til og fra svømmeundervisning» – men bare med andre ord. |
| **Rådgivende ingeniør, Agder** – velger «Rådgivning» | 55 åpne; øverst startlån, evaluering og tolketjenester | Nei | Nei | Prosjektering og byggeledelse ligger under Bygg og anlegg. Der, med korte ord, får de 5 gode treff – men en ingeniør velger Rådgivning. |
| **Medisinsk forbruksmateriell, hele landet** | 73 åpne; 4 gode treff (Sykehusinnkjøp, Forsvarsbygg, kommuner) | Ja | Kanskje | Treffene stemmer. Store rammeavtaler med lange dokumenter – de vil ha dokumentanalyse (AI er av). |
| **Brøyting og grøntvedlikehold, Vestfold** | 93 åpne i Drift og vedlikehold, 48 i Miljø; ingen brøyting eller grøntanlegg – heller ikke på hele landet | Nei (nå) | Nei | Sesong: ingen slike anbud ute nå. Tjenesten sier ærlig «ingen gode treff», men viser ikke når de neste kommer. |

## I appen (fem kundetyper, lokalt)

- **Registrering:** 4 felt. Fra forsiden til første treff: 13 handlinger. Ingen feil i nettleseren.
- **Oversikten etter oppstart** har en god «slik kommer dere i gang»-liste (1 av 5), men er lang: 770–840 ord.
- **Det beste treffet var feil** for elektro (kloakkoverføring), vakt (kontroll av slokkeutstyr, merket «Verdt å se på»)
  og ingeniør (reklame- og kommunikasjonstjenester) – samme mønster som på nettsiden.
- **Vurderingen («Gå videre / Avklar først / Ikke gå videre») sa «Avklar først» for alle fem**, med datagrunnlag
  «Lav (2–3 av 9)». Det er ærlig – kostnader og konkurransegrunnlag mangler – men løftet «finn ut om det er verdt å
  vinne» blir ikke besvart før kunden har lagt inn mer. Siden er også lang: 770–840 ord.
- **Feil beskjed:** «Profilen har verken CPV-koder eller nøkkelord» for tre av fem, selv om de nettopp skrev hva de
  leverer. Årsak: én setning uten komma gir ingen nøkkelord (`keywordsFromServices` dropper fraser over fire ord).
- **Abonnement:** prøveperiode i Profesjonell vises tydelig. Vil de betale: «Kortbetaling er ikke åpnet ennå … trykk
  «Meld interesse»». Ærlig, men ingen kan kjøpe.

## Hindringene, rangert

| # | Hindring | Bevis | Hvem retter |
| --- | --- | --- | --- |
| 1 | **Ingen kan betale** | Stripe er ikke satt opp; bare «Meld interesse» | Eier |
| 2 | **Leverandøren er anonym** | Vilkårene på anbudradar.com/vilkar viser «[selskapsnavn], org.nr. [org.nr.], [adresse]» og en gmail-adresse. Om oss viser verken firmanavn eller organisasjonsnummer. En bedrift som skal betale, sjekker dette | Eier (firmaopplysninger) |
| 3 | **Første treff bommer for håndverk og spesialiserte tjenester** (5 av 8) | Søket krever at ordet begynner likt: «vakthold» finner ikke «vakttjenester», «elektroinstallasjon» finner ikke «elektriske». Brede bransjer (Bygg og anlegg rommer alle fag). Anbud for «hele landet» havner foran relevante anbud i et annet fylke. Ingeniørtjenester ligger under Bygg og anlegg, ikke Rådgivning | **Rettet i koden 16.11 – ikke rullet ut** (se under). Ingeniør under Rådgivning: din beslutning |
| 4 | **Vurderingen sier alltid «Avklar først» for en ny kunde** | Datagrunnlag 2–3 av 9 for alle fem | Jeg kan korte ned veien: be om noen få tall (timepris, kostnad) i oppstarten |
| 5 | **AI er av** | IT og store leverandører forventer dokumentanalyse; konkurrentene selger AI | Eier (nøkkel og utgiftsgrense) |
| 6 | **Mye tekst i appen** | Oversikt og vurdering 770–840 ord hver | Jeg kan rette (samme regler som nettsiden) |
| 7 | **Feil beskjed om manglende nøkkelord** | 3 av 5 fikk «verken CPV-koder eller nøkkelord» | **Rettet i koden 16.11 – ikke rullet ut** |
| 8 | **Tynt marked i perioder** (brøyting, skoleskyss) | Ingen åpne anbud nå | Jeg kan vise «kontrakter som snart utløper» når det ikke finnes gode treff (finnes allerede på bransjesidene) |
| 9 | **Opplastede filer forsvinner** | Fillagring er ikke satt opp (teksten som er lest, blir lagret) | Eier |

## Pris

Prisen er ikke den største hindringen i simuleringen. Profesjonell (699 kr) er ikke dyr sammenlignet med tjenester som
selger vurdering og AI (Anbudsradar 1 450 kr og Cobrief Max 3 000 kr ifølge egne prissider 14.11.2026; prisen på
Cobrief Pro står ikke i notatet). Men **Start (299 kr) konkurrerer
med gratis varsler** (Doffin, Cobrief) og Anbudsregisteret (249 kr). For at noen skal betale for Start, må den gi mer enn
varsler – for eksempel at treffene faktisk stemmer (hindring 3). Ingen priser er endret.

## Det som virker

- «Prøv uten konto» lar kunden se ekte, rangerte anbud før registrering. Det sto ikke beskrevet på de åpne sidene til
  konkurrentene vi så på (KONKURRENTER.md – «ikke beskrevet» betyr ikke at det mangler).
- Der treffene stemmer, er grunnene tydelige og ærlige («Samme bransje», «I området du dekker», «ISO 9001 er ikke
  registrert i profilen»).
- Registreringen er kort, og appen sier ærlig fra om AI og betaling.

## Slik tester dere med ekte kunder (gratis)

1. Rett hindring 1–3 først. Uten dem stopper de fleste før de ser resten.
2. Snakk med 5 bedrifter i hver av de tre sterke gruppene (renhold i Oslo og Akershus, IT, medisinsk
   forbruksmateriell): vis «Prøv uten konto» med deres egne ord og lønnsomhetssjekken, og spør hva de ville betalt.
   Ingen annonser – dere tar kontakt selv.
3. Følg med i Admin → Kundereise (hvor folk faller fra) og på «Meld interesse».

## Rettet etter simuleringen (16. november 2026) – IKKE rullet ut

Eier: «jeg vil ikke sette opp betaling ennå». Det som kunne rettes gratis og uten eiers ja, er rettet i treffmotoren
(`src/domain/matching/terms.ts` og `engine.ts`). Samme motor brukes i «Prøv uten konto», appen, varsler og eksemplene.

1. **Ordene kunden skriver:** et langt ord (minst 7 bokstaver) teller også inne i sammensatte ord («brøyting» i
   «snøbrøyting»), og vanlige fagord kjennes igjen i flere former (13 små grupper, f.eks. «vakthold» → «vakttjenester»,
   «vektertjenester»; «elektroinstallasjon» → «elektriske»). Gruppene er snevre: «vaktmester» er ikke vakt, og
   «elektronisk» (som i «tilbudet leveres elektronisk») er ikke elektroarbeid.
2. **Et ord i tittelen gir 10 poeng** (var 8). Samme bransje, eget fylke og ordet i tittelen blir da et godt treff (60+).
3. **Nytt tak:** har bedriften sagt hva den leverer, og ingen av ordene står i kunngjøringen, er treffet høyst 45 –
   så et anbud som faktisk nevner det de gjør, går foran (også i et annet fylke). Lik eller nær CPV-kode unntas.
4. **Riktig beskjed:** «Profilen har verken CPV-koder eller ord for det dere leverer» vises bare når det stemmer.

Metodesiden (/metode#treff) viser de nye reglene automatisk.

**Målt lokalt** (utviklingsdatabasen, samme åtte kundetyper, de fem øverste i «Prøv uten konto»):

| Kundetype | Øverst før | Øverst etter |
| --- | --- | --- |
| Vakt, Vestland | Kontroll av slokkeutstyr; vaktanbud på 5. plass | Tre vaktanbud øverst |
| Elektro, Rogaland | Kloakk, lommepark, kunstgress | Elektrofaglige tjenester og elektriske arbeider |
| Transport (skoleskyss), Innlandet | Reisebyrå, leasing av biler | Skoleskyss øverst |
| Rådgivende ingeniør, Agder (Bygg og anlegg) | Totalentreprise, stillas | Byggeledelse og ingeniørtjenester (2 gode treff) |
| Renhold, Oslo | Renhold øverst | Renhold øverst (1 godt treff, var 0) |

Den lokale databasen har mest engelske titler fra TED, så tallene er ikke de samme som i produksjon (der nesten
alle titler er norske – 1 av 190 sjekket var engelsk). **Effekten i produksjon er IKKE MÅLT**; det gjøres med de
samme åtte kundetypene etter utrulling.

**Ikke rettet (krever eier):** ingeniør- og arkitekttjenester ligger under Bygg og anlegg. En rådgivende ingeniør
som velger «Rådgivning», får fortsatt ingen treff. Å vise dem også under Rådgivning endrer bransjesidene og krever
enten en endring i produksjonsdata eller at det virker gradvis for nye anbud – din beslutning.

## Begrensninger

- Vurderingene av hva kundene «ville gjort», er skjønn, ikke målinger.
- Treffene endrer seg hver dag med nye anbud.
- Appen ble kjørt lokalt med data som er ti dager eldre enn produksjon. Der viste mange anbud engelsk tittel (fra TED);
  i produksjon viser «Prøv uten konto» norsk tittel for de samme anbudene. Innloggede sider i produksjon er
  **IKKE VERIFISERT**.
- Skript og rådata: `scratchpad/qa/sim/` i økten (ikke i Git).
