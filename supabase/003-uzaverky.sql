-- SAUNIČKA · uzávěrky: zápis do 18:30, los saunamistra do 19:00 v den sauny
-- Spusť celé v Supabase → SQL Editor → New query → Run (jednou, po 002-hra.sql).
-- Časy jdou měnit v appce: Admin → Uzávěrky v den sauny.

alter table public.settings
  add column signup_deadline time not null default '18:30',
  add column draw_deadline time not null default '19:00';

-- Je po uzávěrce pro dané úterý? (čas se bere podle Prahy)
create or replace function public.deadline_passed(p_date date, p_which text)
returns boolean language sql stable security definer set search_path = public as $$
  select now() > ((p_date + case p_which when 'signup' then signup_deadline else draw_deadline end)
                  at time zone 'Europe/Prague')
  from settings where id = 1
$$;
revoke all on function public.deadline_passed(date, text) from public, anon, authenticated;

-- Zápis a odepsání: po uzávěrce jen admin
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
  if not v_admin and deadline_passed(p_date, 'signup') then
    raise exception 'Zápis skončil v %. Změnit to může už jen admin.',
      (select to_char(signup_deadline, 'HH24:MI') from settings where id = 1);
  end if;

  v_session := ensure_session(p_date);
  select s.closed_at into v_closed from sessions x join seasons s on s.id = x.season_id where x.id = v_session;
  if v_closed is not null and not v_admin then raise exception 'Sezóna je uzavřená'; end if;

  delete from attendance where session_id = v_session and member_id = p_member;
  if found then
    update rituals set host_id = null where session_id = v_session and host_id = p_member;
    delete from ritual_votes where session_id = v_session and member_id = p_member;
    delete from ritual_fires where session_id = v_session and member_id = p_member;
    return false;
  end if;

  insert into attendance (session_id, member_id, charged_to) values (v_session, p_member, p_member);
  return true;
end $$;

-- Losování saunamistra: po uzávěrce jen admin
create or replace function public.draw_ritual(p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  v_session uuid := session_on(p_date);
  v_host uuid;
  v_existing rituals;
begin
  if v_session is null then raise exception 'Na tohle úterý se ještě nikdo nezapsal'; end if;
  if not is_admin() and not attends(v_session, v_me) then raise exception 'Losovat můžou jen ti, kdo jdou'; end if;

  select * into v_existing from rituals where session_id = v_session;
  if v_existing.host_id is not null and not is_admin() then return v_existing.host_id; end if;

  if not is_admin() and deadline_passed(p_date, 'draw') then
    raise exception 'Los skončil v %. Saunamistra teď může určit už jen admin.',
      (select to_char(draw_deadline, 'HH24:MI') from settings where id = 1);
  end if;

  v_host := pick_host(v_session, coalesce(v_existing.passed, '{}'));
  if v_host is null then raise exception 'Není z koho losovat'; end if;

  insert into rituals (session_id, host_id, drawn_at) values (v_session, v_host, now())
  on conflict (session_id) do update set host_id = excluded.host_id, drawn_at = now();
  return v_host;
end $$;

-- Předání naběračky: po uzávěrce jen admin
create or replace function public.pass_ritual(p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  v_session uuid := session_on(p_date);
  v_passed uuid[];
  v_host uuid;
begin
  if not is_admin() and deadline_passed(p_date, 'draw') then
    raise exception 'Los skončil v %. Naběračku už předat nejde.',
      (select to_char(draw_deadline, 'HH24:MI') from settings where id = 1);
  end if;
  select passed into v_passed from rituals where session_id = v_session and host_id = v_me;
  if not found then raise exception 'Naběračku teď nemáš'; end if;
  v_passed := array_append(v_passed, v_me);
  v_host := pick_host(v_session, v_passed);
  update rituals set host_id = v_host, passed = v_passed, drawn_at = now() where session_id = v_session;
  return v_host;
end $$;
