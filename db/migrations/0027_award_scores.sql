-- Poeng fra tildelingsbrevet (byggeplanen, pakke 4): egne og vinnerens poeng, samlet og per kriterium. Frivillig –
-- bedriften skriver tallene inn selv; ingen AI leser brevet. Ligger på det lagrede anbudet (bookmarks), som har
-- radnivåsikkerhet per organisasjon (0002_security), så en annen organisasjon ser aldri tallene.
-- Bare tillegg: ingen rader endres eller slettes.
alter table bookmarks
  add column if not exists score_details jsonb
    check (score_details is null or (jsonb_typeof(score_details) = 'object' and pg_column_size(score_details) <= 8000));
