-- SAUNIČKA · Saunový klub Lužánky
-- Spusť celé v Supabase → SQL Editor → New query → Run.
-- Skript je určený pro prázdný projekt (spouští se jednou).

create extension if not exists pgcrypto;

-- ============================================================
-- Tabulky
-- ============================================================

create table public.members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users on delete set null,
  slug text unique not null,
  name text not null,
  is_admin boolean not null default false,
  is_guest boolean not null default false,
  active boolean not null default true,
  sort int not null default 100,
  created_at timestamptz not null default now()
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  price_per_person int not null default 160,
  rental_price int not null default 750,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons on delete cascade,
  date date not null unique,
  note text
);

-- member_id = kdo byl v sauně, charged_to = komu se účast počítá do kasy
-- (u hosta typicky ten, kdo ho přivedl)
create table public.attendance (
  session_id uuid not null references public.sessions on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  charged_to uuid not null references public.members on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, member_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  amount int not null check (amount > 0),
  paid_on date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

-- Jeden řádek: kam se platí
create table public.settings (
  id int primary key default 1 check (id = 1),
  account text,      -- IBAN nebo české číslo účtu (123456789/0800)
  recipient text     -- jméno příjemce v QR platbě
);
insert into public.settings (id) values (1);

create index on public.attendance (charged_to);
create index on public.sessions (season_id);
create index on public.payments (season_id, member_id);

-- ============================================================
-- Pomocné funkce
-- ============================================================

create or replace function public.current_member_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from members where user_id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from members where user_id = auth.uid()), false)
$$;

-- Najde/založí úterek v sezóně, do které datum patří
create or replace function public.ensure_session(p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_season uuid;
  v_closed timestamptz;
  v_session uuid;
begin
  select id into v_session from sessions where date = p_date;
  if v_session is not null then return v_session; end if;

  select id, closed_at into v_season, v_closed
  from seasons where p_date between starts_on and ends_on
  order by starts_on desc limit 1;
  if v_season is null then raise exception 'Na % není žádná sezóna', p_date; end if;

  insert into sessions (season_id, date) values (v_season, p_date) returning id into v_session;
  return v_session;
end $$;

-- Zapíše / odepíše účast. Člen jen sebe, admin kohokoliv.
create or replace function public.toggle_attendance(p_date date, p_member uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  v_admin boolean := is_admin();
  v_session uuid;
  v_closed timestamptz;
begin
  if v_me is null then raise exception 'Nejsi přihlášený'; end if;
  if not v_admin and p_member <> v_me then raise exception 'Zapisovat můžeš jen sebe'; end if;
  if not v_admin and p_date > current_date + 7 then raise exception 'Tak daleko dopředu ne'; end if;

  v_session := ensure_session(p_date);
  select s.closed_at into v_closed from sessions x join seasons s on s.id = x.season_id where x.id = v_session;
  if v_closed is not null and not v_admin then raise exception 'Sezóna je uzavřená'; end if;

  delete from attendance where session_id = v_session and member_id = p_member;
  if found then return false; end if;

  insert into attendance (session_id, member_id, charged_to) values (v_session, p_member, p_member);
  return true;
end $$;

-- Admin: přidá hosta na úterek. Bez p_charged_to platí host sám.
create or replace function public.add_guest(p_date date, p_name text, p_charged_to uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_guest uuid;
  v_session uuid;
begin
  if not is_admin() then raise exception 'Jen pro admina'; end if;
  insert into members (slug, name, is_guest, sort)
  values ('host-' || substr(gen_random_uuid()::text, 1, 8), trim(p_name), true, 1000)
  returning id into v_guest;
  v_session := ensure_session(p_date);
  insert into attendance (session_id, member_id, charged_to)
  values (v_session, v_guest, coalesce(p_charged_to, v_guest));
  return v_guest;
end $$;

revoke all on function public.ensure_session(date) from public, anon, authenticated;
revoke all on function public.toggle_attendance(date, uuid) from public, anon;
revoke all on function public.add_guest(date, text, uuid) from public, anon;
grant execute on function public.toggle_attendance(date, uuid) to authenticated;
grant execute on function public.add_guest(date, text, uuid) to authenticated;

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.members    enable row level security;
alter table public.seasons    enable row level security;
alter table public.sessions   enable row level security;
alter table public.attendance enable row level security;
alter table public.payments   enable row level security;
alter table public.settings   enable row level security;

-- Přihlašovací obrazovka potřebuje jména ještě před loginem
create policy members_login_list on public.members for select to anon
  using (active and not is_guest and user_id is not null);

create policy members_read   on public.members    for select to authenticated using (true);
create policy seasons_read   on public.seasons    for select to authenticated using (true);
create policy sessions_read  on public.sessions   for select to authenticated using (true);
create policy attendance_read on public.attendance for select to authenticated using (true);
create policy settings_read  on public.settings   for select to authenticated using (true);
create policy payments_read  on public.payments   for select to authenticated
  using (member_id = public.current_member_id() or public.is_admin());

create policy members_admin    on public.members    for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy seasons_admin    on public.seasons    for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy sessions_admin   on public.sessions   for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy attendance_admin on public.attendance for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy payments_admin   on public.payments   for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy settings_admin   on public.settings   for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Anon smí číst jen to, co login potřebuje
revoke select on public.members from anon;
grant select (id, slug, name, sort, is_guest, active, user_id) on public.members to anon;

-- ============================================================
-- Data: parta
-- ============================================================

insert into public.members (slug, name, is_admin, sort) values
  ('cermi', 'Čermi', false, 1),
  ('kaja',  'Kája',  false, 2),
  ('adela', 'Adéla', false, 3),
  ('simka', 'Símka', false, 4),
  ('zuza',  'Zůza',  false, 5),
  ('matej', 'Matěj', true,  6),
  ('beda',  'Béďa',  false, 7),
  ('david', 'David', false, 8),
  ('terka', 'Terka', false, 9);

-- ============================================================
-- Data: Jaro 2026 (import z Google Sheets, 67 účastí = 10 720 Kč)
-- Sezóna je uzavřená a vedená jako zaplacená. Pokud někdo ještě
-- dluží, smaž jeho platbu v adminu appky.
-- ============================================================

with s as (
  insert into public.seasons (name, starts_on, ends_on, price_per_person, rental_price, closed_at)
  values ('Jaro 2026', '2026-01-01', '2026-04-30', 160, 750, '2026-04-30')
  returning id
)
insert into public.sessions (season_id, date)
select s.id, d::date from s, unnest(array[
  '2026-01-06','2026-01-13','2026-01-20','2026-01-27','2026-02-03','2026-02-10','2026-02-17',
  '2026-02-24','2026-03-03','2026-03-10','2026-03-17','2026-03-24','2026-03-31','2026-04-07'
]) d;

insert into public.attendance (session_id, member_id, charged_to)
select x.id, m.id, m.id
from (values
  ('cermi', array['2026-01-06','2026-01-20','2026-01-27','2026-02-03','2026-02-10','2026-02-24','2026-03-03','2026-04-07']),
  ('kaja',  array['2026-01-06','2026-01-27','2026-02-03','2026-02-10','2026-03-03']),
  ('adela', array['2026-02-03','2026-02-10','2026-02-17','2026-02-24','2026-03-03','2026-03-10','2026-03-17','2026-03-24']),
  ('simka', array['2026-02-17','2026-03-03']),
  ('zuza',  array['2026-01-20','2026-01-27','2026-02-03','2026-03-10','2026-03-17','2026-03-24','2026-04-07']),
  ('matej', array['2026-01-06','2026-01-13','2026-01-20','2026-01-27','2026-02-10','2026-02-17','2026-02-24','2026-03-03','2026-03-31','2026-04-07']),
  ('beda',  array['2026-01-06','2026-01-13','2026-01-20','2026-04-07']),
  ('david', array['2026-01-06','2026-01-13','2026-01-20','2026-01-27','2026-02-17','2026-02-24','2026-03-10','2026-03-17','2026-03-24','2026-04-07']),
  ('terka', array['2026-01-06','2026-01-13','2026-01-20','2026-01-27','2026-02-03','2026-02-10','2026-02-17','2026-02-24','2026-03-03','2026-03-10','2026-03-17','2026-03-24','2026-04-07'])
) as v(slug, dates)
join public.members m on m.slug = v.slug
cross join lateral unnest(v.dates) d
join public.sessions x on x.date = d::date;

insert into public.payments (season_id, member_id, amount, paid_on, note)
select se.id, a.charged_to, count(*) * se.price_per_person, '2026-04-30', 'Import z excelu'
from public.attendance a
join public.sessions x on x.id = a.session_id
join public.seasons se on se.id = x.season_id
where se.name = 'Jaro 2026'
group by se.id, a.charged_to, se.price_per_person;

-- ============================================================
-- Aktuální sezóna (data uprav v adminu, pokud sedí jinak)
-- ============================================================

insert into public.seasons (name, starts_on, ends_on, price_per_person, rental_price)
values ('Podzim 2026', '2026-09-01', '2026-12-31', 160, 750);
