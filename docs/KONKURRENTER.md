# Konkurrentene – hva de viser utad, og hva som er AnbudRadars eget

Internt notat. Brukes til å prioritere – **ikke** som markedsføring. Ingenting herfra skal gjengis på nettsiden
som påstander om konkurrenter.

## Slik er dette laget (og hva det ikke er)

- Hentet fra konkurrentenes **åpne nettsider** 14. november 2026 (forside, prisside og én produktside der den fantes).
- Ingen av tjenestene er testet fra innsiden. «Ikke funnet» betyr bare at det **ikke sto beskrevet** på sidene som
  ble lest – ikke at funksjonen mangler.
- Tall om kunder og resultater er konkurrentenes **egne påstander**. De er ikke kontrollert.
- Priser og innhold endres. Sjekk kilden på nytt før noe brukes i en beslutning.

## Hva de viser

| Tjeneste | Hva de selger seg på | Pris (egen prisside) | Uten konto |
| --- | --- | --- | --- |
| **Cobrief** (cobrief.com/no) | «KI-agenten» for anbud: varsler, rangering mot bedriftsprofil, «full brief» av anbudet, go/no-go, konkurrentanalyse, utkast. «Hallusinasjoner? Ikke hos oss» – hver påstand lenker til stedet i dokumentet. Egen påstand: «Brukt av 3 000+ selskaper» | Gratis (enkle anbudsvarsler), Pro, Max 3 000 kr/mnd (5 brukere), Ultra, Enterprise. 14 dagers prøve | Ikke funnet noe som kan prøves uten konto |
| **Anbudsregisteret** (anbudsregisteret.no) | Gratis søk i alle anbud fra Doffin og TED. Side per anbud med AI-sammendrag og «Sist vant». Gratis varsel hver lørdag | Standard 249 kr/mnd (daglig varsling). Tilbudsutkast med AI 49 kr og anbudsanalyse som PDF 199 kr per stykk | Søk og anbudssider er åpne. «Logg inn for å se om anbudet passer firmaet deres» |
| **Anbudsradar** (anbudsradar.no, levert av FOA) | Finn, vurder, skriv, følg opp. Rangerer anbudene som passer bedriften | 1 450 kr/mnd eller 14 500 kr/år (se NAVNERISIKO.md) | «Bestill en demo» og film |
| **Mercell** (mercell.com) | Stor plattform for både oppdragsgivere og leverandører. «AI Bid Assistance» | Ikke oppgitt – «Kontakt salg» | «Søk etter anbud» |
| **Tendium** (tendium.ai, svensk) | AI-assistenten «Louie», «Bid Studio» | Egen prisside (se PRISER.md) | «Calculate your ROI» og demo |

Kilder (lest 14.11.2026): cobrief.com/no, cobrief.com/no/priser, cobrief.com/no/anbudsvarsling,
cobrief.com/no (vurder anbud), anbudsregisteret.no, anbudsregisteret.no/priser, én anbudsside hos Anbudsregisteret,
anbudsradar.no, mercell.com/nb-no, tendium.ai.

## Hva dette betyr for AnbudRadar

**Der vi ikke bør prøve å være best nå**

- *Bredde og AI.* Cobrief, Mercell og Tendium selger AI-agenter og har (etter eget utsagn) store kundebaser.
  AnbudRadar har AI slått av i produksjon. Å love det samme ville være usant og tapt på forhånd.
- *«Kilde på alt».* Cobrief sier det samme. Det er et krav for å være med, ikke noe som skiller oss ut.
- *Gratis varsler.* Både Cobrief og Anbudsregisteret gir bort varsler. Varsler alene er ikke lenger noe å ta betalt for.

**Det som ikke sto beskrevet hos noen av dem**

1. **Lønnsomhet med bedriftens egne kostnader** – selvkost, minstepris, målpris, følsomhet, og kontraktsvilkår
   (dagbøter, betalingsfrist, garantier) regnet om til kroner. Ordene kalkyle, selvkost, margin og lønnsomhet fantes
   ikke på Cobriefs prisside eller vurderingsside.
2. **Rangering mot egen bransje uten konto.** Anbudsregisteret har åpent søk, men krever innlogging for å se om
   anbudet passer. Cobrief og Anbudsradar ber om registrering eller demo.
3. **En kalkulator som kan brukes uten konto**, knyttet til et ekte anbud og ekte tidligere tildelinger. Tendium har
   en ROI-kalkulator for selve abonnementet – ikke for anbudet.

Derfor er posisjonen: **«Er dette anbudet verdt å vinne?»** – ikke «finn flere anbud». Det er her AnbudRadar
allerede har mest ferdig (Profit Intelligence), og der konkurrentene sier minst.

## Det som er bygd på grunnlag av dette (14.–15. november 2026)

| Tiltak | Hva | Hvorfor |
| --- | --- | --- |
| **Prøv uten konto** (`/prov` og skjemaet på forsiden) | Velg bransje og fylke, skriv hva dere leverer. De åpne anbudene rangeres med appens treffmotor, med begrunnelse. Bare de fem beste vises. Valgene følger med til registreringen. Ingenting lagres | Besøkende ser sin egen nytte før de gir fra seg e-postadressen. Ingen av konkurrentene viste dette åpent |
| **Lønnsomhetssjekk uten konto** (`/kalkulator`, og fra hvert åpent anbud) | Timer, timekost, materialer, annet, påslag og ønsket margin inn – selvkost, målpris, margin ved kontraktsverdien og følsomhet ut, med appens formler og utregningen vist. Knyttet til et anbud: oppdragsgivers anslag (merket) og målprisen plassert blant ekte tidligere tildelinger | Viser det som er AnbudRadars eget, på ett minutt. En enkel utgave – kostnadslinjer, risikopåslag, vilkår i kroner, kapasitet og lagring finnes bare i appen |
| Bryter | `PUBLIC_TOOLS=false` fjerner begge (forsiden peker da til eksempelet som før) | Eier bestemmer |

| **Kontrakter som snart utløper** på bransjesidene (15.11.2026) | De nærmeste tildelte kontraktene som trolig utløper, med grunnlaget for anslaget – uten leverandørnavn | Gir besøkende noe å forberede seg på før anbudet kommer. Ikke funnet åpent hos konkurrentene |
| **«Slik regner vi»** (`/metode`, 15.11.2026) | Hele metoden åpent: treffpoeng del for del, tak, merking, markedspris, kalkyle, hva vi ikke vet | Konkurrentene sier «ingen hallusinasjoner». Vi viser reglene |
| **Oppdragsgiversider** (`/oppdragsgiver/…`, 15.11.2026) | Åpne anbud, hva de kjøper mest og kontrakter som snart utløper per oppdragsgiver – uten leverandørnavn | Folk søker på «anbud <kommune>». Anbudsregisteret har lister per oppdragsgiver; dette legger til utløp og hva de kjøper |

Alt bruker bare eksisterende data og funksjoner. Ingen AI, ingen nye tjenester, ingen sporing, ingen kostnad.

## Forslag som krever eiers beslutning (ikke gjort)

| Forslag | Hvorfor | Hva det krever |
| --- | --- | --- |
| Gjør daglige varsler gratis, og ta betalt for vurdering og lønnsomhet | Konkurrentene gir bort varsler. Betalingsviljen ligger i «bør vi by, og til hvilken pris» | Endrer hva planene inneholder – eiers valg |
| Slå på AI (eller la den stå av og si det tydelig, som nå) | Alle AI-konkurrentene leder med det. Uten AI må vi vinne på lønnsomhet og ærlighet | Nøkkel og utgiftsgrense – koster penger per bruk |
| Vis hvem som vant sist på de offentlige anbudssidene | Anbudsregisteret gjør det. Det er offentlige opplysninger, og det gir sidene mer verdi i søk | Leverandørnavn vises i dag bare i appen. Enkeltpersonforetak kan være personnavn – bør vurderes mot personvern først |
| Server som alltid er på | Gratis-serveren sovner. Første besøk kan ta lang tid – dårlig førsteinntrykk for nettopp «prøv uten konto» | Koster penger hver måned |
| Firmaopplysninger og juridisk gjennomgang | Uten organisasjonsnummer og adresse på siden stoler ingen innkjøpsansvarlig på tjenesten | Eier fyller inn; advokat ser over vilkårene |
| Ekte kundehistorier når de finnes | Cobrief og Mercell viser kunder. Vi har ingen å vise ennå – og skal ikke finne på noen | Første betalende kunder, og samtykke fra dem |

## Det vi ikke skal gjøre

- Skrive noe om konkurrentene på nettsiden som ikke kan dokumenteres – heller ikke sammenligningstabeller med navn.
- Finne på kundetall, besparelser eller omtaler for å matche påstandene deres.
- Markedsføre AI som aktiv før den er slått på og virker i produksjon.
