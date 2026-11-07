# Veikart: de 15 viktigste forbedringene

Sist oppdatert 7. november 2026. Rangert etter forretningsverdi, brukeropplevelse, sikkerhet og teknisk risiko.
Status skiller mellom **implementert** (koden finnes), **testet** (automatiske tester), **verifisert** (prøvd mot ekte
tjenester/produksjon) og **forslag** (krever eiers godkjenning: nye leverandører, kostnader eller endring i produksjon).

> Produksjon: ingenting her er rullet ut før eier sier fra. Commits har `[skip render]`, så Render ikke rullet ut
> automatisk. Utrulling: Render → tjenesten → *Manual Deploy* → *Deploy latest commit* (migreringene kjøres da).

| # | Forbedring | Hvorfor | Status |
| --- | --- | --- | --- |
| 1 | **Sikkerhetsgjennomgang med tester** – autorisasjon på alle ruter, RLS, opplasting, SSRF, rate limiting, webhooks, hemmeligheter | Kundenes økonomi og tilbud er forretningshemmeligheter; må være på plass før vekst | **Implementert og testet** – 5 funn rettet, se [SIKKERHETSGJENNOMGANG.md](SIKKERHETSGJENNOMGANG.md). Ikke rullet ut. |
| 2 | **Krav- og avvisningssjekk** – «skal»-krav, minstekrav og avvisningsgrunner fra kunngjøring og dokumenter, med side og sitat, uten AI | Avvisning er den dyreste feilen i tilbudsarbeid; virker også når AI er av | **Implementert og testet** – panel på anbudssiden + sjekkliste i tilbudsarbeidet, se [STATUS.md](STATUS.md#krav--og-avvisningssjekk-6-november-2026). Ikke rullet ut. |
| 3 | **Tilbudsresultat og læring** – vunnet/tapt, vinner og vinnerpris hentet fra tildelingene, avvik mot egen kalkyle | Gjør bedriften bedre for hvert tilbud; gir grunnlag for bedre anbefalinger | **Implementert og testet** – resultatfelt på anbudssiden, ny side «Resultater», «vi vant» fra tildelingen ved riktig org.nr., se [STATUS.md](STATUS.md#tilbudsresultat-og-læring-6-november-2026). Ikke rullet ut. |
| 4 | **Markedspris fra tidligere tildelinger** og prissimulering i Profit Intelligence | Prising er det vanskeligste; ekte tildelte verdier for lignende kontrakter | **Implementert og testet** – panel under Lønnsomhet med fordeling per år, egne priser og testpris plassert i markedet, se [STATUS.md](STATUS.md#markedspris-fra-tidligere-tildelinger-6-november-2026). Ikke rullet ut. |
| 5 | **Kontraktsutløp-radar** – kontrakter som trolig utløper, fra tildeling + varighet | Fremtidige anbud før de blir konkurranser – tid til å forberede seg | **Implementert og testet** – «Kontrakter som utløper» under Konkurrenter og anslått utløp på anbudssiden, se [STATUS.md](STATUS.md#kontraktsutløp-radar-6-november-2026). Varsel gjenstår. Ikke rullet ut. |
| 6 | **Automatisk forhåndsvurdering av nye treff** – frist, krav, vilkår, sertifiseringer og kapasitet uten AI | Sparer tid hver dag; brukeren ser straks hva som er verdt å se på | **Implementert og testet** – vurdering med grunner i søk, på Oversikt og på anbudssiden, se [STATUS.md](STATUS.md#forhåndsvurdering-av-treff-6-november-2026). Ikke rullet ut. |
| 7 | **AI-chat om hele anbudet** med kontrollerte kildehenvisninger | Forventet funksjon i 2026; svar med side og sitat, skille fakta/vurdering | Planlagt (AI er av i produksjon – eiers valg) |
| 8 | **Flere skjulte kostnader i vilkårssøket** – lønns- og arbeidsvilkår, miljøkrav, rapportering, oppstart | Kostnader som ofte glemmes i kalkylen | **Implementert og testet** – fire nye kategorier med kilde og tips til kalkylen, se [STATUS.md](STATUS.md#flere-skjulte-kostnader-i-vilkårssøket-7-november-2026). Ikke rullet ut. |
| 9 | **Kapasitet per måned og sesong** | Sesongarbeid (vinterdrift, renhold i ferier) regnes feil per år | **Implementert og testet** – måneder med arbeid på kontrakter og kalkyle, belastning måned for måned, se [STATUS.md](STATUS.md#kapasitet-per-måned-og-sesong-7-november-2026). Ikke rullet ut. |
| 10 | **«Til handling»-oversikt** – frister denne uken, spørsmålsfrister, godkjenninger, sterke nye treff | Arbeidsflyt i stedet for lister | **Implementert og testet** – arbeidsliste øverst på Oversikt, se [STATUS.md](STATUS.md#til-handling-på-oversikt-7-november-2026). Ikke rullet ut. |
| 11 | **Mobil og navigasjon i appen** – gjennomgang og rettinger | Mange vurderer anbud på telefonen | **Implementert og testet** – frist og vurdering øverst på telefon, større trykkflater, egen telefontest, se [STATUS.md](STATUS.md#mobil-og-navigasjon-i-appen-7-november-2026). Ikke rullet ut. |
| 12 | **Flerlands-struktur** – land, regioner og valuta per land; TED for Sverige, Danmark, Finland og Tyskland bak en bryter (av) | Vekst utenfor Norge uten nye leverandører; TED dekker hele EØS | Planlagt |
| 13 | **Automatisk innhenting av konkurransedokumenter** | Full analyse uten opplasting | Forslag – krever nye eksterne kilder (godkjenning) |
| 14 | **OCR for skannede PDF-er** | Noen dokumenter er bilder | Forslag – kostnad/ytelse må avklares |
| 15 | **Sikkerhetskopi, overvåking og staging** | Gratisplanen hos Supabase har ingen sikkerhetskopi | Forslag – betalt plan / nytt oppsett krever godkjenning |
