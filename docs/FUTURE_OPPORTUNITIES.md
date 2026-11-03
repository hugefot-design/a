# Future Opportunities (Enterprise)

Offentlige prosjekter før de blir vanlige anbud. Bare for Enterprise – håndhevet i ruteren
(`feature: futureOpportunities`), så andre planer får oppgraderingssiden også ved direkte lenker og POST.

## Kilder (offisielle og gratis, Norge først)

| Kilde | Hva | Status |
|---|---|---|
| Doffin og TED | Forhåndskunngjøringer (planlagte anskaffelser), hentet av de vanlige kunngjøringsjobbene (`lifecycle = 'planned'`) | I drift |
| eInnsyn (Digdir), `api.einnsyn.no` | Politiske møtesaker (type «politisk») fra kommuner, fylker og stat | I drift – verifisert live 3.11.2026 (16 kall, 154 saker sett, 10 lagret, alle med fylke) |
| Brønnøysundregistrene, `data.brreg.no` | Kommunenummer for organet når eInnsyn mangler det (gir fylke) | I drift |
| Kommunebudsjetter, økonomiplaner, investeringsplaner (PDF) | Ingen samlet, maskinlesbar kilde funnet | Ikke med – krever PDF-lesing per kommune |
| Nasjonal transportplan, Nye Veier, Bane NOR | Prosjektlister på nettsider, ikke API | Ikke med |

Ingen nøkler, ingen kostnader. eInnsyn hentes to ganger i døgnet (maks 40 kall per kjøring, pause mellom
kallene). Alt har landkode (`country_code`), og kilder registreres i `opportunity_sources`, så flere land kan legges til.

## Presisjon (testet mot ekte data)

- Saksmapper i eInnsyn er utelatt: nesten bare personal-, tilskudds- og klagesaker.
- En møtesak tas med når tittelen tyder på et prosjekt/anskaffelse (`classifyTitle` i `src/connectors/einnsyn.ts`):
  sterke ord (konkurranseutsetting, anskaffelse, forprosjekt, totalentreprise …) eller handling + objekt
  («nytt sykehjem», «rehabilitering av svømmehall»). Omtale og avslutning holdes ute (høring, orientering,
  navnsetting, sluttrapport, forskrift …). Brukeren ser hvilke ord som traff.
- Samme sak behandles i flere utvalg – lagres én gang per organ og tittel.

## Fakta og vurdering

- «Fra kilden»: dato, organ/oppdragsgiver, anslått verdi og CPV – bare når kilden har dem. Utlysningsdato vises
  som «kilden oppgir ikke dato»; vi anslår ingen datoer, verdier eller sannsynligheter. Ingen AI brukes.
- «Vår vurdering»: regelbasert samsvar med profilen (bransje og fylke; for kunngjøringer den vanlige matchingen).
- «Utlyst» vises bare når samme anskaffelse er utlyst ifølge kunngjøringene (samme rad går fra planlagt til
  konkurranse). Tittellikhet er ikke nok: testet mot ekte data og ga feiltreff (f.eks. «NGS-sekvensering» mot
  «pipetteringsrobot» hos samme oppdragsgiver og CPV). Nye konkurranser fra samme oppdragsgiver i samme
  CPV-klasse vises og varsles som «Kan gjelde – sjekk selv».

## Varsler (Enterprise)

Fulgt prosjekt utlyst (fakta), ny konkurranse som kan gjelde et fulgt prosjekt (vurdering), og én daglig
oppsummering av nye politiske saker som passer profilen. Følger varselinnstillingene.

## Datadekning

Vises på siden. Vi finner ikke alle fremtidige prosjekter: mange anskaffelser forhåndskunngjøres ikke, og ikke
alle kommuner publiserer møtesaker i eInnsyn.
