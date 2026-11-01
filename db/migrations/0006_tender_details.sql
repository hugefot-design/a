-- Flere detaljer fra kildene (feltene er verifisert mot TEDs live API 1.11.2026),
-- NUTS 2024-koder for fylkene og opprydding i NUTS-koder som ikke er steder.

alter table tenders
  add column if not exists questions_deadline_at timestamptz,
  add column if not exists participation_deadline_at timestamptz,
  add column if not exists deadline_kind text check (deadline_kind in ('tender', 'participation')),
  add column if not exists lot_deadlines_differ boolean not null default false,
  add column if not exists duration_months numeric(8, 2),
  add column if not exists duration_text text,
  add column if not exists contract_start timestamptz,
  add column if not exists contract_end timestamptz,
  add column if not exists submission_url text,
  add column if not exists lots jsonb not null default '[]',
  add column if not exists selection_criteria jsonb not null default '[]',
  add column if not exists award_criteria jsonb not null default '[]',
  add column if not exists is_framework boolean,
  add column if not exists text_language text;

alter table tender_sources
  add column if not exists notice_identifier text,
  add column if not exists notice_version int,
  add column if not exists normalize_version int not null default 1,
  add column if not exists change_description text;

create index if not exists tender_sources_notice_identifier_idx on tender_sources (notice_identifier) where notice_identifier is not null;
create index if not exists tenders_buyer_deadline_idx on tenders (buyer_org_number, deadline_at) where buyer_org_number is not null;

-- NUTS 2024 (verifisert mot bynavn i ekte TED-kunngjøringer). Eldre 2021-koder beholdes.
update regions set nuts_codes = '{NO084,NO082}' where code = '32';
update regions set nuts_codes = '{NO083,NO082}' where code = '31';
update regions set nuts_codes = '{NO085,NO082}' where code = '33';
update regions set nuts_codes = '{NO093,NO091}' where code = '39';
update regions set nuts_codes = '{NO094,NO091}' where code = '40';
update regions set nuts_codes = '{NO072,NO074}' where code = '55';
update regions set nuts_codes = '{NO073,NO074}' where code = '56';

-- «ANYW» (ikke angitt) og extra-regio-koder (…ZZ/…ZZZ) er ikke steder.
update tenders
set nuts_codes = coalesce((
  select array_agg(distinct n order by n) from unnest(nuts_codes) n where n !~ '^ANYW' and n !~ 'ZZZ?$'
), '{}')
where exists (select 1 from unnest(nuts_codes) n where n ~ '^ANYW' or n ~ 'ZZZ?$');

-- Beregn fylker på nytt (samme regler som regionsFromNuts i src/domain/reference.ts).
with fallback(prefix, codes) as (
  values ('NO02', '{34}'::text[]), ('NO06', '{50}'), ('NO07', '{18,55,56}'), ('NO08', '{03,32,31,33}'),
         ('NO09', '{39,40,42}'), ('NO0A', '{11,46,15}')
)
update tenders t
set region_codes = coalesce((
  select array_agg(distinct x order by x) from (
    select r.code as x from regions r where r.nuts_codes && t.nuts_codes
    union
    select unnest(f.codes) from fallback f, unnest(t.nuts_codes) n
    where length(n) >= 4 and left(n, 4) = f.prefix
      and not exists (select 1 from regions r2 where n = any (r2.nuts_codes))
  ) s
), '{}')
where t.country_code = 'NO';
