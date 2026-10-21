-- SAUNIČKA · historie: podzim 2023 až podzim 2025 z excelu
-- Spusť celé v Supabase → SQL Editor → New query → Run (jednou).
--
-- Sezóny jsou uzavřené a vedené jako zaplacené (jako u jara 2026).
-- Lidé, kteří nemají účet (Anička, Vojta, Erik, Míša S., Hanka N.), jsou jen
-- v žebříčcích minulých sezón: nejdou se přihlásit a nezobrazují se v seznamu jmen.
-- Pozor: u podzimu 2023 v excelu nejsou data úterků. Předpokládám 11 úterků od 3. 10. 2023.

insert into public.members (slug, name, is_guest, active, sort) values
  ('anicka',  'Anička',  false, false, 20),
  ('vojta',   'Vojta',   false, false, 21),
  ('erik',    'Erik',    false, false, 22),
  ('misa-s',  'Míša S.', false, false, 23),
  ('hanka-n', 'Hanka N.', false, false, 24);

-- ============================================================
-- Podzim 2023: 11 úterků, 54 účastí, 150 Kč/os, pronájem 700 Kč
-- ============================================================

with s as (
  insert into public.seasons (name, starts_on, ends_on, price_per_person, rental_price, closed_at)
  values ('Podzim 2023', '2023-10-03', '2023-12-12', 150, 700, '2023-12-12')
  returning id
)
insert into public.sessions (season_id, date)
select s.id, d::date from s, unnest(array['2023-10-03', '2023-10-10', '2023-10-17', '2023-10-24', '2023-10-31', '2023-11-07', '2023-11-14', '2023-11-21', '2023-11-28', '2023-12-05', '2023-12-12']) d;

insert into public.attendance (session_id, member_id, charged_to)
select x.id, m.id, m.id
from (values
  ('matej', array['2023-10-03', '2023-10-10', '2023-10-17', '2023-10-24', '2023-10-31', '2023-11-07', '2023-11-14', '2023-11-21', '2023-11-28', '2023-12-05', '2023-12-12']),
  ('simka', array['2023-10-03', '2023-10-10', '2023-10-17', '2023-10-31', '2023-11-07', '2023-11-21', '2023-11-28', '2023-12-05', '2023-12-12']),
  ('cermi', array['2023-10-10', '2023-10-24', '2023-10-31', '2023-11-07', '2023-11-14', '2023-11-21', '2023-12-05', '2023-12-12']),
  ('kaja', array['2023-10-10', '2023-10-24', '2023-11-07', '2023-11-14', '2023-11-21', '2023-12-05', '2023-12-12']),
  ('anicka', array['2023-10-10', '2023-10-17', '2023-10-24', '2023-11-07', '2023-11-14', '2023-11-21', '2023-12-05', '2023-12-12']),
  ('vojta', array['2023-10-03']),
  ('beda', array['2023-10-24', '2023-11-14']),
  ('zuza', array['2023-10-24', '2023-11-14', '2023-11-21', '2023-12-05', '2023-12-12']),
  ('misa-s', array['2023-10-17']),
  ('hanka-n', array['2023-10-17']),
  ('erik', array['2023-11-28'])
) as v(slug, dates)
join public.members m on m.slug = v.slug
cross join lateral unnest(v.dates) d
join public.sessions x on x.date = d::date;

insert into public.payments (season_id, member_id, amount, paid_on, note)
select se.id, a.charged_to, count(*) * se.price_per_person, '2023-12-12', 'Import z excelu'
from public.attendance a
join public.sessions x on x.id = a.session_id
join public.seasons se on se.id = x.season_id
where se.name = 'Podzim 2023'
group by se.id, a.charged_to, se.price_per_person;

-- ============================================================
-- Jaro 2024: 15 úterků, 68 účastí, 150 Kč/os, pronájem 700 Kč
-- ============================================================

with s as (
  insert into public.seasons (name, starts_on, ends_on, price_per_person, rental_price, closed_at)
  values ('Jaro 2024', '2024-01-02', '2024-04-09', 150, 700, '2024-04-09')
  returning id
)
insert into public.sessions (season_id, date)
select s.id, d::date from s, unnest(array['2024-01-02', '2024-01-09', '2024-01-16', '2024-01-23', '2024-01-30', '2024-02-06', '2024-02-13', '2024-02-20', '2024-02-27', '2024-03-05', '2024-03-12', '2024-03-19', '2024-03-26', '2024-04-02', '2024-04-09']) d;

insert into public.attendance (session_id, member_id, charged_to)
select x.id, m.id, m.id
from (values
  ('cermi', array['2024-01-02', '2024-01-09', '2024-01-16', '2024-01-23', '2024-01-30', '2024-02-06', '2024-02-20', '2024-02-27', '2024-03-05', '2024-03-12', '2024-03-19', '2024-04-02', '2024-04-09']),
  ('kaja', array['2024-01-02', '2024-01-16', '2024-01-23', '2024-01-30', '2024-02-06', '2024-02-20', '2024-03-05', '2024-03-12', '2024-03-19', '2024-04-02', '2024-04-09']),
  ('anicka', array['2024-01-02', '2024-01-16', '2024-01-23', '2024-02-13', '2024-02-20', '2024-02-27', '2024-03-12', '2024-03-19', '2024-04-02', '2024-04-09']),
  ('simka', array['2024-01-02', '2024-01-23', '2024-02-13', '2024-02-20', '2024-03-05', '2024-03-19']),
  ('zuza', array['2024-01-16', '2024-01-23']),
  ('matej', array['2024-01-02', '2024-02-20', '2024-03-05', '2024-03-12', '2024-03-19', '2024-03-26', '2024-04-02', '2024-04-09']),
  ('david', array['2024-01-09', '2024-01-30', '2024-02-06', '2024-02-13', '2024-02-20', '2024-02-27', '2024-03-05', '2024-04-02']),
  ('terka', array['2024-01-23', '2024-01-30', '2024-02-06', '2024-02-13', '2024-02-20', '2024-02-27', '2024-03-05', '2024-03-26', '2024-04-02']),
  ('erik', array['2024-03-26'])
) as v(slug, dates)
join public.members m on m.slug = v.slug
cross join lateral unnest(v.dates) d
join public.sessions x on x.date = d::date;

insert into public.payments (season_id, member_id, amount, paid_on, note)
select se.id, a.charged_to, count(*) * se.price_per_person, '2024-04-09', 'Import z excelu'
from public.attendance a
join public.sessions x on x.id = a.session_id
join public.seasons se on se.id = x.season_id
where se.name = 'Jaro 2024'
group by se.id, a.charged_to, se.price_per_person;

-- ============================================================
-- Podzim 2024: 12 úterků, 55 účastí, 165 Kč/os, pronájem 750 Kč
-- ============================================================

with s as (
  insert into public.seasons (name, starts_on, ends_on, price_per_person, rental_price, closed_at)
  values ('Podzim 2024', '2024-10-01', '2024-12-17', 165, 750, '2024-12-17')
  returning id
)
insert into public.sessions (season_id, date)
select s.id, d::date from s, unnest(array['2024-10-01', '2024-10-08', '2024-10-15', '2024-10-22', '2024-10-29', '2024-11-05', '2024-11-12', '2024-11-19', '2024-11-26', '2024-12-03', '2024-12-10', '2024-12-17']) d;

insert into public.attendance (session_id, member_id, charged_to)
select x.id, m.id, m.id
from (values
  ('cermi', array['2024-10-01', '2024-10-08', '2024-10-15', '2024-10-22', '2024-10-29', '2024-11-05', '2024-11-19', '2024-11-26', '2024-12-03', '2024-12-10']),
  ('kaja', array['2024-10-15', '2024-10-22', '2024-11-19', '2024-11-26', '2024-12-10']),
  ('anicka', array['2024-10-29']),
  ('simka', array['2024-11-05', '2024-11-12', '2024-11-26', '2024-12-03', '2024-12-10', '2024-12-17']),
  ('zuza', array['2024-11-05', '2024-11-12', '2024-11-19', '2024-12-03', '2024-12-17']),
  ('matej', array['2024-10-01', '2024-10-15', '2024-10-22', '2024-10-29', '2024-11-05', '2024-11-12', '2024-11-19', '2024-11-26', '2024-12-03', '2024-12-10', '2024-12-17']),
  ('beda', array['2024-11-05']),
  ('david', array['2024-10-01', '2024-10-15', '2024-10-29', '2024-11-05', '2024-11-19', '2024-11-26', '2024-12-17']),
  ('terka', array['2024-10-01', '2024-10-29', '2024-11-05', '2024-11-12', '2024-11-19', '2024-11-26', '2024-12-03', '2024-12-17']),
  ('vojta', array['2024-12-10'])
) as v(slug, dates)
join public.members m on m.slug = v.slug
cross join lateral unnest(v.dates) d
join public.sessions x on x.date = d::date;

insert into public.payments (season_id, member_id, amount, paid_on, note)
select se.id, a.charged_to, count(*) * se.price_per_person, '2024-12-17', 'Import z excelu'
from public.attendance a
join public.sessions x on x.id = a.session_id
join public.seasons se on se.id = x.season_id
where se.name = 'Podzim 2024'
group by se.id, a.charged_to, se.price_per_person;

-- ============================================================
-- Jaro 2025: 14 úterků, 72 účastí, 165 Kč/os, pronájem 750 Kč
-- ============================================================

with s as (
  insert into public.seasons (name, starts_on, ends_on, price_per_person, rental_price, closed_at)
  values ('Jaro 2025', '2025-01-07', '2025-04-08', 165, 750, '2025-04-08')
  returning id
)
insert into public.sessions (season_id, date)
select s.id, d::date from s, unnest(array['2025-01-07', '2025-01-14', '2025-01-21', '2025-01-28', '2025-02-04', '2025-02-11', '2025-02-18', '2025-02-25', '2025-03-04', '2025-03-11', '2025-03-18', '2025-03-25', '2025-04-01', '2025-04-08']) d;

insert into public.attendance (session_id, member_id, charged_to)
select x.id, m.id, m.id
from (values
  ('cermi', array['2025-01-07', '2025-01-14', '2025-01-21', '2025-01-28', '2025-02-04', '2025-02-11', '2025-02-18', '2025-02-25', '2025-03-04', '2025-03-11', '2025-03-18', '2025-03-25', '2025-04-01', '2025-04-08']),
  ('kaja', array['2025-01-14', '2025-01-21', '2025-01-28', '2025-02-11', '2025-02-18', '2025-02-25', '2025-03-25', '2025-04-01', '2025-04-08']),
  ('simka', array['2025-01-07', '2025-01-21', '2025-02-18', '2025-02-25', '2025-03-04', '2025-03-25', '2025-04-01', '2025-04-08']),
  ('zuza', array['2025-01-14', '2025-01-28', '2025-02-11', '2025-02-18', '2025-03-11', '2025-03-18', '2025-04-01', '2025-04-08']),
  ('matej', array['2025-01-07', '2025-01-14', '2025-01-21', '2025-02-18', '2025-03-04', '2025-03-25', '2025-04-08']),
  ('beda', array['2025-04-01']),
  ('david', array['2025-01-07', '2025-01-14', '2025-01-21', '2025-01-28', '2025-02-04', '2025-02-25', '2025-03-04', '2025-03-11', '2025-03-18', '2025-03-25', '2025-04-01', '2025-04-08']),
  ('terka', array['2025-01-07', '2025-01-14', '2025-01-21', '2025-01-28', '2025-02-04', '2025-02-18', '2025-02-25', '2025-03-04', '2025-03-11', '2025-03-18', '2025-03-25', '2025-04-01', '2025-04-08'])
) as v(slug, dates)
join public.members m on m.slug = v.slug
cross join lateral unnest(v.dates) d
join public.sessions x on x.date = d::date;

insert into public.payments (season_id, member_id, amount, paid_on, note)
select se.id, a.charged_to, count(*) * se.price_per_person, '2025-04-08', 'Import z excelu'
from public.attendance a
join public.sessions x on x.id = a.session_id
join public.seasons se on se.id = x.season_id
where se.name = 'Jaro 2025'
group by se.id, a.charged_to, se.price_per_person;

-- ============================================================
-- Podzim 2025: 12 úterků, 67 účastí, 135 Kč/os, pronájem 750 Kč
-- ============================================================

with s as (
  insert into public.seasons (name, starts_on, ends_on, price_per_person, rental_price, closed_at)
  values ('Podzim 2025', '2025-09-30', '2025-12-16', 135, 750, '2025-12-16')
  returning id
)
insert into public.sessions (season_id, date)
select s.id, d::date from s, unnest(array['2025-09-30', '2025-10-07', '2025-10-14', '2025-10-21', '2025-10-28', '2025-11-04', '2025-11-11', '2025-11-18', '2025-11-25', '2025-12-02', '2025-12-09', '2025-12-16']) d;

insert into public.attendance (session_id, member_id, charged_to)
select x.id, m.id, m.id
from (values
  ('cermi', array['2025-10-07', '2025-10-14', '2025-10-21', '2025-10-28', '2025-11-04', '2025-11-11', '2025-11-18', '2025-11-25', '2025-12-02', '2025-12-09', '2025-12-16']),
  ('kaja', array['2025-10-14', '2025-10-28', '2025-11-11', '2025-11-18', '2025-12-02', '2025-12-16']),
  ('adela', array['2025-09-30', '2025-10-21', '2025-11-18', '2025-11-25']),
  ('simka', array['2025-09-30', '2025-10-07', '2025-10-14']),
  ('zuza', array['2025-10-07', '2025-10-14', '2025-10-21', '2025-10-28', '2025-11-04', '2025-11-11', '2025-11-18', '2025-12-02', '2025-12-09', '2025-12-16']),
  ('matej', array['2025-10-07', '2025-10-21', '2025-10-28', '2025-11-11', '2025-11-25', '2025-12-02', '2025-12-09', '2025-12-16']),
  ('beda', array['2025-10-14', '2025-10-21', '2025-10-28', '2025-11-04', '2025-11-25', '2025-12-02', '2025-12-16']),
  ('david', array['2025-09-30', '2025-10-28', '2025-11-04', '2025-11-11', '2025-11-18', '2025-11-25', '2025-12-02', '2025-12-09']),
  ('terka', array['2025-09-30', '2025-10-07', '2025-10-14', '2025-10-28', '2025-11-04', '2025-11-11', '2025-11-18', '2025-11-25', '2025-12-02', '2025-12-09'])
) as v(slug, dates)
join public.members m on m.slug = v.slug
cross join lateral unnest(v.dates) d
join public.sessions x on x.date = d::date;

insert into public.payments (season_id, member_id, amount, paid_on, note)
select se.id, a.charged_to, count(*) * se.price_per_person, '2025-12-16', 'Import z excelu'
from public.attendance a
join public.sessions x on x.id = a.session_id
join public.seasons se on se.id = x.season_id
where se.name = 'Podzim 2025'
group by se.id, a.charged_to, se.price_per_person;

-- Kontrola: počet účastí a částka po sezónách
select se.name, count(*) as ucasti, count(*) * max(se.price_per_person) as vybrano
from public.attendance a
join public.sessions x on x.id = a.session_id
join public.seasons se on se.id = x.season_id
group by se.name, se.starts_on order by se.starts_on;
