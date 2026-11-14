-- «Meld interesse» for en plan mens kortbetaling ikke er åpnet: egen type henvendelse, så eieren ser
-- salgsønskene for seg selv i Admin → Henvendelser. Utvider bare listen over lovlige verdier –
-- ingen rader endres eller slettes.
alter table reports drop constraint if exists reports_kind_check;
alter table reports add constraint reports_kind_check check (kind in ('data_error', 'contact', 'plan_interest'));
