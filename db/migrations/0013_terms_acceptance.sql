-- Bevis for godtatte vilkår: hvilken versjon av vilkårene og databehandleravtalen brukeren godtok,
-- og når (src/domain/legal/legal.ts LEGAL_VERSION). Settes ved registrering i
-- src/domain/auth/auth.ts. Kontoer opprettet før denne migreringen har null: de godtok vilkårene
-- med avkrysning, men versjonen ble ikke lagret.
alter table users add column terms_version text check (terms_version is null or char_length(terms_version) between 1 and 40);
alter table users add column terms_accepted_at timestamptz;
alter table users add constraint users_terms_pair check ((terms_version is null) = (terms_accepted_at is null));

-- Appen får bare sette feltene ved registrering, ikke endre dem senere.
grant insert (terms_version, terms_accepted_at) on users to anbudradar_app;
