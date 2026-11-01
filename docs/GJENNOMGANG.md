# Gjennomgang av AnbudRadar (1. november 2026)

Utført før endringer ble gjort, på prosjektet slik det ble levert i `anbudradar.zip`
(første commit i repoet). Alt under «verifisert» er kjørt i dette miljøet; alt annet er
lest i koden og merket deretter.

## Utgangspunkt – kjørt på nytt

| Kontroll | Resultat |
| --- | --- |
| Typesjekk (`tsc --noEmit`) | 0 feil |
| Enhetstester | 47 av 47 bestått |
| Integrasjonstester (PostgreSQL 16) | 24 av 24 bestått |
| Nettlesertester (Chromium) | 2 av 2 bestått |
| TED live (`ingest --source ted --dry-run`) | Svarer, men **data blir feil** (se under) |
| Doffin live | 401 uten nøkkel (forventet). Koden ville feilet med nøkkel (se under) |

Testene var grønne, men de bruker konstruerte data. Kjøring mot ekte TED-data viste feil
som testene ikke fanget.

## 1. Hva som fungerer

- Arkitekturen er solid og verdt å beholde: Node + React server-rendering, PostgreSQL med
  radnivåsikkerhet (RLS), jobbkø i Postgres, ingen unødvendige tjenester.
- Innlogging: scrypt-passord, sesjoner med hash i databasen, glidende utløp, utestengelse,
  rate limiting, e-postbekreftelse, tilbakestilling som logger ut alle sesjoner.
- CSRF-token + opprinnelseskontroll, sikkerhetshoder og CSP med nonce, `__Host-`-cookie i produksjon.
- Kundeadskillelse: `app_current_org_id()` gjelder bare når brukeren faktisk er medlem; testet
  med to kunder side om side og med forfalsket organisasjonskontekst.
- Stripe-webhooks: signaturkontroll, idempotens via `stripe_events`, eldre hendelser kan ikke
  overskrive nyere. Retur fra Checkout aktiverer ingenting.
- AI-laget: strukturerte svar, kildeblokk som ikke kan brytes ut av, sitatkontroll mot kilden,
  hurtigbuffer, kvoter per plan, kostnadslogg.
- TED-API-et nås, og paginering med `iterationNextToken` fungerer (verifisert live).

## 2. Hva som bare er simulert

| Del | Status før endring |
| --- | --- |
| AI | Kun `AI_PROVIDER=mock` er kjørt. Ingen ekte modell er testet. |
| Stripe | Kun simulert API og selvsignerte testhendelser. |
| E-post | `EMAIL_PROVIDER=log` – ingenting er sendt. |
| Fillagring | Lokal disk. Supabase Storage er aldri kjørt. |
| Doffin | Aldri kjørt. Feltnavn var antatt. |
| Render/Supabase | Ingen deploy-konfigurasjon i repoet. |

## 3. Kritiske datafeil (funnet ved kjøring mot ekte data)

1. **TED: feil tilbudsfrist.** Koden leste `deadline-date-lot`, som i TED er
   *spørsmålsfristen* (BT-13), og satte den sammen med klokkeslettet for *tilbudsfristen*.
   Eksempel 718790-2026: publisert 19.10, lagret frist «18.10 kl. 11:00:58», riktig frist er
   26.10 kl. 12:00. Riktig felt er `deadline-receipt-tender-date-lot` (BT-131).
2. **TED: «ANYW» (hele landet) ble lagret som NUTS-kode**, og koder ble duplisert.
3. **Fylker: TED bruker NUTS 2024.** Sju av 15 fylkeskoder (NO083/084/085, NO093/094,
   NO072/073) var ukjente og falt tilbake til hele landsdelen – et anbud i Moss (Østfold) ble
   også vist under Oslo, Akershus og Buskerud. Riktig kobling er verifisert mot by-navn i
   1 800 ekte TED-kunngjøringer.
4. **Doffin: `page` starter på 1.** Koden startet på 0, som Doffin avviser med HTTP 400
   (dokumentert av uavhengige prosjekter som har testet API-et live i oktober 2026).
5. **Doffin: maks 1 000 treff per søk** (10 sider à 100). Koden hentet 14 dager i ett søk og
   ville i stillhet miste kunngjøringer.
6. **Doffin: 30 søk per minutt** (offisiell grense i API-portalen). Koden ventet 0,4 s mellom kall.
7. **Doffin: feil typeverdi** (`INTENTION_ANNOUNCEMENT` finnes ikke; riktig er
   `ANNOUNCEMENT_OF_INTENT`), og sju typer manglet i livssyklus-tabellen.
8. **Doffin: `deadline` på resultatkunngjøringer er ikke en tilbudsfrist**, men ble lagret som det.
9. **Duplikater TED/Doffin:** samme anskaffelse har engelsk tittel i TED og norsk i Doffin, så
   tittellikhet slo dem ikke sammen.
10. **Dry-run skrev til databasen** (`import_errors`) hvis en kunngjøring ikke kunne oversettes.

## 4. Uferdig

- Lenke til konkurransedokumentene hentes ikke (TED har den i `document-url-lot`).
- Kontraktens varighet, spørsmålsfrist, delkontrakter, kvalifikasjons- og tildelingskriterier
  hentes ikke, selv om TED leverer dem.
- Firmaprofilen mangler produkter, kompetanse, antall ansatte (bare intervall), omsetning og
  referanseprosjekter.
- Matchscoren viser grunner og mangler, men ikke tydelig *oppfylte krav*, *ikke oppfylte krav*,
  *manglende opplysninger* og *usikkerhet*. Mange søkeord + bred CPV-gruppe kunne gi ~65.
- AI-analysen skiller ikke eksplisitt mellom det som står i anbudet og AI-ens tolkning, og
  mangler «hva må vi gjøre for å delta» og «krav som kan føre til avvisning».
- Stripe: refusjoner og tvister ignoreres; ingen sjekk av at prisene i Stripe stemmer med planene;
  ingen avstemming hvis webhooks uteblir; nedgradering kan gi flere brukere enn planen tillater.
- E-post: ingen avmeldingslenke/`List-Unsubscribe`, ingen beskyttelse mot dobbel utsending.
- Ingen deploy-oppsett (render.yaml), ingen CI, ingen bransjesider for søkemotorer.

## 5. Sikkerhetsrisikoer (forsvar i dybden)

| Risiko | Alvor |
| --- | --- |
| Webapp-rollen kan oppdatere `users.is_platform_admin` – én feil i appkoden kan gi admin | Høy |
| Alle medlemmer kan på databasenivå endre roller og medlemskap i egen organisasjon | Middels |
| Webapp-rollen kan slette `usage_records` (AI-kvoten kan nullstilles ved feil i appkoden) | Middels |
| Et avsluttet Stripe-abonnement kan overskrive et nytt, aktivt abonnement for samme org | Middels |
| Samme Stripe-hendelse levert samtidig to ganger kan gi dobbel e-post | Lav |
| Planlagte oppgaver (varsler/e-post) har ingen lås – samtidig kjøring kan gi dobbel e-post | Middels |
| DOCX-opplasting har ingen grense for utpakket størrelse (zip-bombe) | Middels |
| Ugyldig `Referer`-header gir 500-feil på bokmerke-ruten | Lav |

Ingen hemmeligheter er funnet i prosjektet. `.env.test` inneholder bare tydelige testverdier.

## 6. Må gjøres før ekte kunder

1. Rette datafeilene over og verifisere TED live (gjort i dette arbeidet).
2. Doffin-nøkkel og én verifisert kjøring.
3. Ekte AI-nøkkel, Stripe testmodus og Resend-domene – kjøre hele kjøps- og varselflyten.
4. Supabase (EU) og Render med sikkerhetskopi og overvåking.
5. Juridisk gjennomgang av personvernerklæring, vilkår og databehandleravtaler.
