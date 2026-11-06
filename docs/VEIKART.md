# Veikart: de 15 viktigste forbedringene

Sist oppdatert 6. november 2026. Rangert etter forretningsverdi, brukeropplevelse, sikkerhet og teknisk risiko.
Status skiller mellom **implementert** (koden finnes), **testet** (automatiske tester), **verifisert** (prøvd mot ekte
tjenester/produksjon) og **forslag** (krever eiers godkjenning: nye leverandører, kostnader eller endring i produksjon).

> Produksjon: ingenting her er rullet ut før eier sier fra. Commits har `[skip render]`, så Render ikke rullet ut
> automatisk. Utrulling: Render → tjenesten → *Manual Deploy* → *Deploy latest commit* (migreringene kjøres da).

| # | Forbedring | Hvorfor | Status |
| --- | --- | --- | --- |
| 1 | **Sikkerhetsgjennomgang med tester** – autorisasjon på alle ruter, RLS, opplasting, SSRF, rate limiting, webhooks, hemmeligheter | Kundenes økonomi og tilbud er forretningshemmeligheter; må være på plass før vekst | **Implementert og testet** – 5 funn rettet, se [SIKKERHETSGJENNOMGANG.md](SIKKERHETSGJENNOMGANG.md). Ikke rullet ut. |
| 2 | **Krav- og avvisningssjekk** – «skal»-krav, minstekrav og avvisningsgrunner fra kunngjøring og dokumenter, med side og sitat, uten AI | Avvisning er den dyreste feilen i tilbudsarbeid; virker også når AI er av | Planlagt |
| 3 | **Tilbudsresultat og læring** – vunnet/tapt, vinner og vinnerpris hentet fra tildelingene, avvik mot egen kalkyle | Gjør bedriften bedre for hvert tilbud; gir grunnlag for bedre anbefalinger | Planlagt |
| 4 | **Markedspris fra tidligere tildelinger** og prissimulering i Profit Intelligence | Prising er det vanskeligste; ekte tildelte verdier for lignende kontrakter | Planlagt |
| 5 | **Kontraktsutløp-radar** – kontrakter som trolig utløper, fra tildeling + varighet | Fremtidige anbud før de blir konkurranser – tid til å forberede seg | Planlagt |
| 6 | **Automatisk forhåndsvurdering av nye treff** – frist, krav, vilkår, sertifiseringer og kapasitet uten AI | Sparer tid hver dag; brukeren ser straks hva som er verdt å se på | Planlagt |
| 7 | **AI-chat om hele anbudet** med kontrollerte kildehenvisninger | Forventet funksjon i 2026; svar med side og sitat, skille fakta/vurdering | Planlagt (AI er av i produksjon – eiers valg) |
| 8 | **Flere skjulte kostnader i vilkårssøket** – lønns- og arbeidsvilkår, miljøkrav, rapportering, oppstart | Kostnader som ofte glemmes i kalkylen | Planlagt |
| 9 | **Kapasitet per måned og sesong** | Sesongarbeid (vinterdrift, renhold i ferier) regnes feil per år | Planlagt |
| 10 | **«Til handling»-oversikt** – frister denne uken, spørsmålsfrister, godkjenninger, sterke nye treff | Arbeidsflyt i stedet for lister | Planlagt |
| 11 | **Mobil og navigasjon i appen** – gjennomgang og rettinger | Mange vurderer anbud på telefonen | Planlagt |
| 12 | **Flerlands-struktur** – land, regioner og valuta per land; TED for Sverige, Danmark, Finland og Tyskland bak en bryter (av) | Vekst utenfor Norge uten nye leverandører; TED dekker hele EØS | Planlagt |
| 13 | **Automatisk innhenting av konkurransedokumenter** | Full analyse uten opplasting | Forslag – krever nye eksterne kilder (godkjenning) |
| 14 | **OCR for skannede PDF-er** | Noen dokumenter er bilder | Forslag – kostnad/ytelse må avklares |
| 15 | **Sikkerhetskopi, overvåking og staging** | Gratisplanen hos Supabase har ingen sikkerhetskopi | Forslag – betalt plan / nytt oppsett krever godkjenning |
