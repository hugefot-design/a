# Sikkerhetsgjennomgang 6. november 2026

Gjennomgått mot faktisk kode og testet med automatiske tester (`tests/integration/security-hardening.test.ts` og de
eksisterende sikkerhetstestene). Ikke en ekstern penetrasjonstest.

## Hva som ble sjekket

| Område | Hvordan | Resultat |
| --- | --- | --- |
| Kundeadskillelse (RLS) | Spørring mot `pg_class`/`pg_policies`: alle 60+ tabeller | RLS er på for alle tabeller. Tabeller uten rettigheter for webapp-rollen (2FA, passkeys, ukesbrev, besøk) er bare tilgjengelige for systemet. Isolasjonstesten (`tenancy.test.ts`) dekker sider, eksport, dokumenter og endringer på tvers av organisasjoner. |
| Spørringer som går utenom RLS (`systemSql`) i kunderuter | Gjennomgått hver bruk | Organisasjons-ID kommer alltid fra innloggingen, aldri fra brukeren. |
| SSRF | Alle utgående `fetch` | Bare faste adresser (Doffin, TED, eInnsyn, Resend, Stripe, AI-leverandør, lagring). Ingen bruker-styrte adresser. |
| XSS | `dangerouslySetInnerHTML`, e-postmaler, JSON-LD | Ingen rå HTML i sidene; e-post escapes; JSON-LD escaper `<`. CSP med nonce. |
| CSRF | Alle POST-ruter | Token + opprinnelse kreves, unntatt Stripe-webhook (signatur), cron (nøkkel) og ettklikks-avmelding (signert lenke). |
| Filopplasting | Type, størrelse, utpakking, nedlasting | Type fra innholdet (konkurransedokumenter), zip-bombe-vern for Word, maks sider for PDF, grense per organisasjon. **Rettet:** tilbudsdokumenter brukte filtypen nettleseren oppga – nå fra filendelsen, og nedlasting er alltid `attachment` + `nosniff`. |
| Misbruk av e-post | Alle steder brukere kan få oss til å sende e-post | **Rettet:** invitasjoner hadde ingen grense (inviter – trekk tilbake – inviter ga ubegrenset e-post med valgfri tekst fra vårt domene). Nå: 3 per mottaker per døgn, 10 per bruker per time, 20 per organisasjon per døgn. Øvrige (registrering, glemt passord, kontakt, ukesbrev, partnere) hadde grenser fra før. |
| Kontohandlinger | Passord, sletting, eksport, team | **Rettet:** ingen forsøksgrense på passordsjekk i innstillingene (en stjålet økt kunne prøve passord fritt) – nå 10 per time. **Rettet:** brukere med totrinn må ha bekreftet de siste 15 minuttene før passordbytte, sletting, eksport av alle data og endringer i hvem som har tilgang. |
| Planlagte jobber (`/api/cron`) | Nøkkelsjekk | Konstant-tid-sammenligning fra før. **Rettet:** 20 feil nøkler per time per adresse, deretter stopp. |
| Betaling | Planvalg, Stripe-økter, webhooks | Plan valideres mot faste planer, pris-ID fra serveren, planer aktiveres bare av signerte webhooks (5 min toleranse), samme hendelse behandles én gang. |
| Innlogging | Økter, 2FA, passkeys | `__Host-`-kapsel, HttpOnly, Secure, SameSite=Lax; ny økt ved innlogging; totrinn og passkeys med egne tester. |
| Logger | `src/lib/logger.ts` | Nøkler som `password`, `token`, `secret`, `authorization`, `cookie` skjules; adresser logges uten spørrestreng. |
| Avhengigheter | `npm audit` | 0 kjente sårbarheter. |

## Gjenstående risiko (ikke rettet – krever valg eller penger)

- **Ingen sikkerhetskopi i produksjon.** Supabase gratisplan har ikke automatiske sikkerhetskopier. Forslag med pris
  (Supabase Pro, 25 USD/mnd) i [FORSLAG.md](FORSLAG.md#15-sikkerhetskopi-overvåking-og-staging).
- **Ingen ekstern overvåking/varsling av feil** utover helsesjekk og admin-oversikten.
- **PDF-tolking kan bruke mye CPU** på en ondsinnet fil (begrenset av filstørrelse og sideantall, men ikke tid).
- **AI og ondsinnede dokumenter:** tekst fra opplastede dokumenter sendes til AI-en. Kildeblokken er isolert og svar
  kontrolleres mot kildene, men en AI kan likevel påvirkes av tekst i et dokument. AI er av i produksjon i dag.
- **`CRON_SECRET` har ingen minstelengde i koden.** Ikke endret, fordi et nytt krav kan stoppe neste utrulling hvis dagens
  nøkkel er kort. Anbefaling: sjekk at den er minst 32 tilfeldige tegn.
- **Ingen WAF/DDoS-vern utover Render/Cloudflare** foran tjenesten.
