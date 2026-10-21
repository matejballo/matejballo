-- SAUNIČKA · okno zápisu (otevření + uzávěrka), "chci rituál", mínusové body
-- Spusť celé v Supabase → SQL Editor → New query → Run (jednou, po 006-hoste-hlasovani.sql).
-- Všechno jde měnit v appce: Admin → Zápis a uzávěrky.

alter table public.settings
  add column signup_open_time time not null default '12:00',
  add column signup_open_days int not null default 1 check (signup_open_days between 0 and 6),
  add column penalty_from date default '2026-10-27';

-- Zápis se zavírá v 18:30 (tak jsme se domluvili)
update public.settings set signup_deadline = '18:30' where id = 1;

-- Je zápis na dané úterý už otevřený? (default: pondělí 12:00, čas podle Prahy)
create or replace function public.signup_opened(p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select now() >= (((p_date - signup_open_days) + signup_open_time) at time zone 'Europe/Prague')
  from settings where id = 1
$$;
revoke all on function public.signup_opened(date) from public, anon, authenticated;

-- Zápis / odepsání: otevřeno od pondělí 12:00, zavřeno v úterý 18:30, kapacita
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
  if not v_admin and not signup_opened(p_date) then raise exception 'Zápis na tohle úterý se ještě neotevřel'; end if;
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

-- "Dnes nemůžu": stejné okno jako zápis
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
  if not v_admin and not signup_opened(p_date) then raise exception 'Zápis na tohle úterý se ještě neotevřel'; end if;
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

-- Pozvání hosta: stejné okno jako zápis
create or replace function public.request_guest(p_date date, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  v_id uuid;
begin
  if v_me is null then raise exception 'Nejsi přihlášený'; end if;
  if char_length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Napiš jméno hosta'; end if;
  if p_date < current_date or p_date > current_date + 7 then raise exception 'Hosta jde pozvat jen na nejbližší úterek'; end if;
  if not is_admin() and not signup_opened(p_date) then raise exception 'Zápis na tohle úterý se ještě neotevřel'; end if;
  if not is_admin() and deadline_passed(p_date, 'signup') then
    raise exception 'Zápis skončil v %. Hosta už může přidat jen admin.',
      (select to_char(signup_deadline, 'HH24:MI') from settings where id = 1);
  end if;
  if (select count(*) from guest_requests where requested_by = v_me and session_date = p_date and status = 'pending') >= 2 then
    raise exception 'Máš už dvě žádosti čekající na schválení';
  end if;
  insert into guest_requests (session_date, requested_by, name) values (p_date, v_me, trim(p_name))
  returning id into v_id;
  return v_id;
end $$;

-- "Chci rituál": kdo jde, může si naběračku vzít, pokud ji ještě nikdo nemá.
-- Kdo ji už jednou předal, ji znovu nechce.
create or replace function public.claim_ritual(p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  v_session uuid := session_on(p_date);
  n int;
begin
  if v_me is null then raise exception 'Nejsi přihlášený'; end if;
  if v_session is null or not attends(v_session, v_me) then raise exception 'Rituál může chtít jen ten, kdo jde'; end if;
  if not is_admin() and deadline_passed(p_date, 'draw') then
    raise exception 'Los skončil v %. Naběračku už si vzít nejde.',
      (select to_char(draw_deadline, 'HH24:MI') from settings where id = 1);
  end if;
  if exists (select 1 from rituals where session_id = v_session and v_me = any (passed)) then
    raise exception 'Naběračku jsi už předal(a)';
  end if;

  insert into rituals (session_id, host_id) values (v_session, v_me)
  on conflict (session_id) do update set host_id = excluded.host_id, drawn_at = now()
    where rituals.host_id is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Naběračku už někdo má'; end if;
  return v_me;
end $$;

revoke all on function public.claim_ritual(date) from public, anon;
grant execute on function public.claim_ritual(date) to authenticated;
revoke all on function public.toggle_attendance(date, uuid) from public, anon;
grant execute on function public.toggle_attendance(date, uuid) to authenticated;
revoke all on function public.toggle_absence(date, uuid) from public, anon;
grant execute on function public.toggle_absence(date, uuid) to authenticated;
revoke all on function public.request_guest(date, text) from public, anon;
grant execute on function public.request_guest(date, text) to authenticated;
