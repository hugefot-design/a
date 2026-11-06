-- Strengere admin-innlogging og passkeys (Face ID, fingeravtrykk eller sikkerhetsnøkkel).
--
-- 1. Hver økt husker når totrinn sist ble bekreftet (mfa_verified_at). Admin-panelet krever at det er
--    under 12 timer siden, og viktige endringer at det er under 15 minutter siden. Settes bare av
--    eier-rollen (systemSql) etter en riktig kode eller passkey.
-- 2. Passkeys som andre steg i stedet for koden fra appen. Bare den offentlige nøkkelen lagres;
--    den private nøkkelen forlater aldri enheten. Bare eier-rollen leser og skriver.
-- 3. Engangsutfordringer for passkeys (5 minutter), knyttet til en økt eller en innloggingsutfordring.

alter table sessions add column if not exists mfa_verified_at timestamptz;

create table if not exists webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  credential_id text not null unique check (char_length(credential_id) between 1 and 1400),
  public_key bytea not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_type text,
  backed_up boolean not null default false,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists webauthn_credentials_user_idx on webauthn_credentials (user_id);
alter table webauthn_credentials enable row level security;

create table if not exists webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  purpose text not null check (purpose in ('register', 'authenticate')),
  session_id uuid references sessions (id) on delete cascade,
  login_challenge_id uuid references login_challenges (id) on delete cascade,
  challenge text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint webauthn_challenges_one_binding check ((session_id is null) <> (login_challenge_id is null))
);
create index if not exists webauthn_challenges_session_idx on webauthn_challenges (session_id);
create index if not exists webauthn_challenges_login_idx on webauthn_challenges (login_challenge_id);
create index if not exists webauthn_challenges_expires_idx on webauthn_challenges (expires_at);
alter table webauthn_challenges enable row level security;
