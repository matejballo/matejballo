-- SAUNIČKA · kapacita sauny a "dnes nemůžu"
-- Spusť celé v Supabase → SQL Editor → New query → Run (jednou, po 003-uzaverky.sql).
-- Kapacitu jde měnit v appce: Admin → Zápis a uzávěrky.

alter table public.settings
  add column capacity int not null default 7 check (capacity between 1 and 50);

-- Kdo to na daný úterek nestíhá (ať se ví, jestli pozvat hosta)
create table public.absences (
  session_id uuid not null references public.sessions on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, member_id)
);

alter table public.absences enable row level security;
create policy absences_read  on public.absences for select to authenticated using (true);
create policy absences_admin on public.absences for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Vyřadí člověka z úterka včetně hlasů, 🔥 a naběračky
create or replace function public.unattend(p_session uuid, p_member uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from attendance where session_id = p_session and member_id = p_member;
  if not found then return false; end if;
  update rituals set host_id = null where session_id = p_session and host_id = p_member;
  delete from ritual_votes where session_id = p_session and member_id = p_member;
  delete from ritual_fires where session_id = p_session and member_id = p_member;
  return true;
end $$;
revoke all on function public.unattend(uuid, uuid) from public, anon, authenticated;

-- Zápis / odepsání. Přidává se jen do kapacity a ruší případné "nemůžu".
create or replace function public.toggle_attendance(p_date date, p_member uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  v_admin boolean := is_admin();
  v_session uuid;
  v_closed timestamptz;
  v_cap int;
begin
  if v_me is null then raise exception 'Nejsi přihlášený'; end if;
  if not v_admin and p_member <> v_me then raise exception 'Zapisovat můžeš jen sebe'; end if;
  if not v_admin and p_date > current_date + 7 then raise exception 'Tak daleko dopředu ne'; end if;
  if not v_admin and deadline_passed(p_date, 'signup') then
    raise exception 'Zápis skončil v %. Změnit to může už jen admin.',
      (select to_char(signup_deadline, 'HH24:MI') from settings where id = 1);
  end if;

  v_session := ensure_session(p_date);
  select s.closed_at into v_closed from sessions x join seasons s on s.id = x.season_id where x.id = v_session;
  if v_closed is not null and not v_admin then raise exception 'Sezóna je uzavřená'; end if;

  if unattend(v_session, p_member) then return false; end if;

  select capacity into v_cap from settings where id = 1;
  if (select count(*) from attendance where session_id = v_session) >= v_cap then
    raise exception 'Sauna je plná (% lidí). Zkus to u někoho, kdo to ruší.', v_cap;
  end if;

  delete from absences where session_id = v_session and member_id = p_member;
  insert into attendance (session_id, member_id, charged_to) values (v_session, p_member, p_member);
  return true;
end $$;

-- "Dnes nemůžu" (znovu = vzít zpět). Zároveň odepíše z účasti.
create or replace function public.toggle_absence(p_date date, p_member uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  v_admin boolean := is_admin();
  v_session uuid;
  v_closed timestamptz;
begin
  if v_me is null then raise exception 'Nejsi přihlášený'; end if;
  if not v_admin and p_member <> v_me then raise exception 'Jen za sebe'; end if;
  if not v_admin and p_date > current_date + 7 then raise exception 'Tak daleko dopředu ne'; end if;
  if not v_admin and deadline_passed(p_date, 'signup') then
    raise exception 'Zápis skončil v %. Změnit to může už jen admin.',
      (select to_char(signup_deadline, 'HH24:MI') from settings where id = 1);
  end if;

  v_session := ensure_session(p_date);
  select s.closed_at into v_closed from sessions x join seasons s on s.id = x.season_id where x.id = v_session;
  if v_closed is not null and not v_admin then raise exception 'Sezóna je uzavřená'; end if;

  delete from absences where session_id = v_session and member_id = p_member;
  if found then return false; end if;

  perform unattend(v_session, p_member);
  insert into absences (session_id, member_id) values (v_session, p_member);
  return true;
end $$;

-- Host (jen admin) taky zabírá místo
create or replace function public.add_guest(p_date date, p_name text, p_charged_to uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_guest uuid;
  v_session uuid;
  v_cap int;
begin
  if not is_admin() then raise exception 'Jen pro admina'; end if;
  v_session := ensure_session(p_date);
  select capacity into v_cap from settings where id = 1;
  if (select count(*) from attendance where session_id = v_session) >= v_cap then
    raise exception 'Sauna je plná (% lidí). Hosta už nikam nenatlačíš.', v_cap;
  end if;
  insert into members (slug, name, is_guest, sort)
  values ('host-' || substr(gen_random_uuid()::text, 1, 8), trim(p_name), true, 1000)
  returning id into v_guest;
  insert into attendance (session_id, member_id, charged_to)
  values (v_session, v_guest, coalesce(p_charged_to, v_guest));
  return v_guest;
end $$;

revoke all on function public.toggle_absence(date, uuid) from public, anon;
grant execute on function public.toggle_absence(date, uuid) to authenticated;
revoke all on function public.add_guest(date, text, uuid) from public, anon;
grant execute on function public.add_guest(date, text, uuid) to authenticated;
revoke all on function public.toggle_attendance(date, uuid) from public, anon;
grant execute on function public.toggle_attendance(date, uuid) to authenticated;
