-- Kapasitet per måned og sesong: hvilke måneder en eksisterende kontrakt har arbeid (f.eks. vinterdrift nov–mar).
-- Null = hele året (som før). Ingen eksisterende data endres.
alter table org_contracts add column if not exists active_months smallint[]
  check (active_months is null or (cardinality(active_months) between 1 and 12 and active_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]));
