# Priser

Endret 6. november 2026 etter ønske fra eier: «bra pris for kunden, samtidig som det lønner seg».
Alle priser er per organisasjon per måned, eks. mva. Prisene står ett sted: `src/domain/billing/plans.ts`.

| Plan | Pris | AI per måned | Brukere |
| --- | --- | --- | --- |
| Gratis | 0 kr | 1 kort sammendrag | 1 |
| Start | 299 kr | 10 korte sammendrag | 1 |
| Profesjonell | 699 kr | 60 analyser | 2 |
| Bedrift | 1 490 kr | 150 analyser + 50 utkast | 10 |
| Enterprise | fra 4 990 kr | 500 analyser + 200 utkast | 25 |

Tidligere: Start 199, Profesjonell 499, Bedrift 999 (250 analyser + 100 utkast), Enterprise etter avtale (2 000 analyser, 100 brukere).

## Hvorfor disse prisene

**Markedet (sjekket 6. november 2026):**
- Tendium (svensk, AI og anbud) starter på 125 euro i måneden for bare anbudsovervåking ifølge egen prisside, omtrent 1 450 kr.
  Profesjonell hos oss koster under halvparten og har mer (full AI-analyse, rangering, lønnsomhetskalkulator).
- Mercell oppgir ingen priser offentlig. Doffin har gratis søk og varsler, så Start må gi mer enn Doffin: filtre,
  lagrede søk, fristpåminnelser og AI-sammendrag.

**Kostnaden per kunde:** den store variable kostnaden er AI. Én full analyse sender inntil ca. 120 000 tegn
(`AI_MAX_INPUT_CHARS`, ca. 30–40 000 tokens) og får tilbake inntil 16 000 tokens. Med listeprisene til Anthropic
(oktober 2026) blir det omtrent:

| Modell | Typisk analyse | Verst tenkelig |
| --- | --- | --- |
| Claude Opus 5.5 ($4/$20 per million tokens) | ca. 2,40 kr | ca. 5,30 kr |
| Claude Sonnet 5.5 ($2/$10 per million tokens) | ca. 1,20 kr | ca. 2,60 kr |

(Regnet med 11 kr per dollar, en forsiktig kurs.) Korte sammendrag bruker den billige modellen og koster øre.

Selv om en kunde bruker **hele** kvoten med den dyreste modellen, går ingen plan i minus:

| Plan | Pris | AI-kostnad, hele kvoten (Opus) | Igjen |
| --- | --- | --- | --- |
| Profesjonell | 699 | ca. 320 kr | ca. 55 % |
| Bedrift | 1 490 | ca. 1 000 kr | ca. 33 % |
| Enterprise | 4 990 | ca. 3 450 kr | ca. 31 % |

De fleste bruker en brøkdel av kvoten; ved en fjerdedel er det igjen 85–90 %. Med Sonnet som standardmodell
(`ANTHROPIC_MODEL`) halveres AI-kostnaden. Med de gamle grensene kunne Bedrift (999 kr, 250 analyser + 100 utkast)
koste mer enn kunden betalte.

**IKKE VERIFISERT:** faktisk tokenbruk per analyse i produksjon (AI er ikke slått på ennå). Mål det med
AI-bruken i admin når nøkkelen er lagt inn, og juster grensene om nødvendig.

## Når prisene endres

1. Endre `priceNok` (og eventuelt grensene) i `src/domain/billing/plans.ts`.
2. Lag nye priser i Stripe (en pris kan ikke endres der) og oppdater `STRIPE_PRICE_*` på Render.
3. **Admin → Helse → Priser i Stripe** viser rødt til beløpene stemmer.
4. Eksisterende kunder skal varsles minst 30 dager før en prisøkning (vilkårene, punkt om prisendringer).
   Det finnes ingen betalende kunder per 6. november 2026.
