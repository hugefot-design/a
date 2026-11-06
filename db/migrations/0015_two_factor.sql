-- Totrinnsinnlogging (TOTP, f.eks. Google Authenticator). Påkrevd for plattform-administratorer,
-- valgfritt for alle andre.
--
-- Hemmeligheten lagres kryptert (AES-256-GCM, nøkkel avledet fra SESSION_SECRET) og endres bare av
-- eier-rollen (systemSql) – webapp-rollen har ingen skriverettighet til disse kolonnene.
-- Reservekoder lagres bare som hash. Innloggingsutfordringer (passord ok, venter på kode) er korte,
-- engangs og har grense for antall forsøk.

alter table users add column if not exists totp_secret_enc text;
alter table users add column if not exists totp_pending_enc text;
alter table users add column if not exists totp_pending_at timestamptz;
alter table users add column if not exists totp_enabled_at timestamptz;
-- Siste brukte 30-sekunders steg: samme kode kan ikke brukes to ganger.
alter table users add column if not exists totp_last_step bigint;
alter table users add constraint users_totp_enabled_has_secret check (totp_enabled_at is null or totp_secret_enc is not null);

create table if not exists user_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists user_recovery_codes_user_idx on user_recovery_codes (user_id);
-- Bare systemet (eier-rollen) leser og skriver reservekoder.
alter table user_recovery_codes enable row level security;

create table if not exists login_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  next_path text check (next_path is null or char_length(next_path) <= 500),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists login_challenges_expires_idx on login_challenges (expires_at);
alter table login_challenges enable row level security;
