# Språk på nettsiden

De offentlige sidene finnes på **norsk (bokmål), engelsk, svensk og dansk**. Norsk ligger på rotadressene
(`/priser`); de andre har prefiks og engelske adresser (`/en/pricing`, `/sv/pricing`, `/da/industries/it`).

Oversatt: forsiden, funksjoner, priser, bransjer (også én side per bransje), om oss, kontakt, innlogging,
registrering og glemt passord. **Ikke oversatt:** appen etter innlogging, e-poster og de juridiske dokumentene
(norsk gjelder). Sidene sier dette selv der det betyr noe (registrering, spørsmål og svar, bunnteksten).

## Slik er det bygd

- `src/i18n/locales.ts` – hvilke språk som er med, adressene og nettleserens foretrukne språk.
- `src/i18n/messages/nb.ts` – norsk er kilden. Planer og bransjer hentes fra domenet.
- `src/i18n/messages/{en,sv,da}.ts` – oversettelsene, med samme nøkler.
- Siden får `lang`, `hreflang`-lenker til alle språkversjonene og kanonisk adresse; nettstedskartet har alle.
- Når nettleseren foretrekker et språk vi har og siden vises på norsk, står det en diskret lenke øverst.

`tests/unit/i18n.test.ts` feiler hvis et språk mangler en tekst, har en annen liste-lengde, andre
`{plassholdere}` eller mangler en bøyningsform for tall (for eksempel polsk «few/many»).

## Legge til et språk

1. Kopier `en.ts` til `xx.ts`, oversett, og legg språket i `LOCALES` og `LOCALE_INFO` (`locales.ts`) og i `MESSAGES` (`index.ts`).
2. Kjør `npm run test:unit`. Testen sier nøyaktig hva som mangler.
3. Oversettelsene er laget med hjelp av AI og bør leses av noen som har språket som morsmål før betalt markedsføring.
   Svensk og dansk er skrevet ferdig; flere språk ble satt på vent 6. november 2026 etter ønske fra eier.

## Enkelt å forstå (regler for de offentlige sidene, 16.11.2026)

Eier: «alt for komplisert med så mange tekster». Reglene:

1. **Én side, én oppgave.** Siden svarer på ett spørsmål (Hva er det? Hva koster det? Passer anbudet?).
2. **Svaret først:** overskrift, én kort setning og én hovedknapp øverst.
3. **Korte setninger og vanlige ord.** Helst under 15 ord per setning. Fagord forklares eller unngås.
4. **Ikke gjenta.** Det samme står ett sted: funksjonene på Funksjoner, prisene på Priser, reglene på Slik regner vi.
5. **Detaljer bak «Vis mer»** (`More` i `src/ui/site.tsx`). Ingenting fjernes – det foldes sammen, ligger fortsatt i
   siden (også for søkemotorer), og en lenke til innholdet åpner det.
6. **Vis heller enn å forklare:** ekte tall og eksempler i stedet for avsnitt.
7. **Målt:** forsiden har under 450 synlige ord (`tests/integration/public-pages.test.ts`), og de andre sidene har
   egne grenser i `tests/integration/simple-pages.test.ts`. «Synlige» betyr det som vises uten å åpne «Vis mer».
