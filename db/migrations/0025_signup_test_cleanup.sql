-- Engangsopprydding (15.11.2026): testbrukeren fra registreringstesten i produksjon, godkjent av eier
-- («test registrering»). Testen brukte Resends testmottaker (delivered+anbudradar-test-…@resend.dev) – ingen
-- ekte person har en slik adresse. Første forsøk stoppet i oppstartsskjemaet, så brukeren fikk aldri en
-- organisasjon og kunne ikke slettes fra appen. Treffer bare slike testadresser uten organisasjon; det samme
-- som «Slett kontoen» gjør for en bruker uten organisasjon (raden i users slettes, resten følger med).
delete from users u
where u.email like 'delivered+anbudradar-test-%@resend.dev'
  and not exists (select 1 from organization_members m where m.user_id = u.id);
