-- Følg en oppdragsgiver uten konto (byggeplanen, pakke 3): samme liste og samme regler som ukesbrevet –
-- dobbel bekreftelse, avmelding sletter raden, ubekreftede påmeldinger slettes etter 7 dager – med en
-- oppdragsgiver i stedet for bransje og fylke.
--
-- Bare tillegg: ingen rader endres eller slettes. Bransje kan stå tom for rader som gjelder en oppdragsgiver,
-- og hver rad gjelder enten en bransje eller en oppdragsgiver (aldri begge, aldri ingen) – alle eksisterende
-- rader har bransje og oppfyller det. Forsvinner oppdragsgiveren, forsvinner påmeldingen med den.
alter table newsletter_subscribers add column if not exists authority_id uuid references authorities (id) on delete cascade;
alter table newsletter_subscribers alter column industry drop not null;
alter table newsletter_subscribers drop constraint if exists newsletter_subscribers_topic_check;
alter table newsletter_subscribers add constraint newsletter_subscribers_topic_check check ((industry is null) <> (authority_id is null));
create unique index if not exists newsletter_subscribers_buyer_uq on newsletter_subscribers (email, authority_id) where authority_id is not null;
create index if not exists newsletter_subscribers_authority_idx on newsletter_subscribers (authority_id) where authority_id is not null;
