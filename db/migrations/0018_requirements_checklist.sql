-- Krav- og avvisningssjekk: punkter i sjekklisten kan komme fra ordsøket i kunngjøringen og dokumentene ('krav').
-- Bare en utvidet liste med tillatte verdier – ingen data endres.
alter table bid_checklist_items drop constraint if exists bid_checklist_items_source_check;
alter table bid_checklist_items add constraint bid_checklist_items_source_check
  check (source in ('manual', 'standard', 'ai', 'notice', 'krav'));
