-- OCR i kundens nettleser for skannede PDF-er (kostnadsgjennomgangen): hvor mange sider av dokumentet som ble lest med
-- OCR (0 = ingen), så siden kan si at teksten kan inneholde lesefeil. Bare tillegg: ingen rader endres eller slettes.
alter table tender_documents
  add column if not exists ocr_pages integer not null default 0 check (ocr_pages >= 0);
