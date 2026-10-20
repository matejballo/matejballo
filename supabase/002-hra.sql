-- ŽÁR · hra: ceny, rituály, hlasování a 🔥
-- Spusť celé v Supabase → SQL Editor → New query → Run (jednou, po schema.sql).

-- ============================================================
-- Ceny sezóny (1., 2., 3. místo) – platí je ostatní
-- ============================================================

alter table public.seasons
  add column prizes text[] not null default array['🧢 Saunová čepice', '🌿 Březová metlička', '🍺 Pivo'];

-- ============================================================
-- Rituály
-- ============================================================

-- Kdo vede rituál na daný úterek (saunamistr) a jaký
create table public.rituals (
  session_id uuid primary key references public.sessions on delete cascade,
  host_id uuid references public.members on delete set null,
  kind text,
  passed uuid[] not null default '{}',   -- kdo naběračku předal dál
  drawn_at timestamptz not null default now()
);

-- Hlasování o typu rituálu (jeden hlas na člověka a úterek)
create table public.ritual_votes (
  session_id uuid not null references public.sessions on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  kind text not null,
  primary key (session_id, member_id)
);

-- 🔥 za povedený rituál (každý účastník kromě saunamistra jednou)
create table public.ritual_fires (
  session_id uuid not null references public.sessions on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  primary key (session_id, member_id)
);

alter table public.rituals      enable row level security;
alter table public.ritual_votes enable row level security;
alter table public.ritual_fires enable row level security;

create policy rituals_read on public.rituals      for select to authenticated using (true);
create policy votes_read   on public.ritual_votes for select to authenticated using (true);
create policy fires_read   on public.ritual_fires for select to authenticated using (true);
create policy rituals_admin on public.rituals      for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy votes_admin   on public.ritual_votes for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy fires_admin   on public.ritual_fires for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- Pomocné funkce
-- ============================================================

create or replace function public.session_on(p_date date)
returns uuid language sql stable security definer set search_path = public as $$
  select id from sessions where date = p_date
$$;

create or replace function public.attends(p_session uuid, p_member uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from attendance where session_id = p_session and member_id = p_member)
$$;

-- Vylosuje saunamistra z přihlášených členů (bez hostů a bez těch, kdo předali).
-- Váha = 1 + počet účastí v sezóně od posledního vedeného rituálu.
create or replace function public.pick_host(p_session uuid, p_excluded uuid[])
returns uuid language sql volatile security definer set search_path = public as $$
  with s as (select id, season_id, date from sessions where id = p_session),
  candidates as (
    select a.member_id
    from attendance a join members m on m.id = a.member_id
    where a.session_id = p_session and not m.is_guest and not (a.member_id = any (p_excluded))
  ),
  last_hosted as (
    select r.host_id, max(x.date) as d
    from rituals r join sessions x on x.id = r.session_id, s
    where x.season_id = s.season_id and x.date < s.date and r.host_id is not null
    group by r.host_id
  ),
  weights as (
    select c.member_id,
      1 + (select count(*) from attendance a2 join sessions x2 on x2.id = a2.session_id, s
           where a2.member_id = c.member_id and x2.season_id = s.season_id and x2.date < s.date
             and x2.date > coalesce(l.d, '1900-01-01')) as w
    from candidates c left join last_hosted l on l.host_id = c.member_id
  )
  select member_id from weights order by -ln(1 - random()) / w limit 1
$$;

revoke all on function public.session_on(date) from public, anon, authenticated;
revoke all on function public.attends(uuid, uuid) from public, anon, authenticated;
revoke all on function public.pick_host(uuid, uuid[]) from public, anon, authenticated;

-- ============================================================
-- Akce pro appku
-- ============================================================

-- Losování saunamistra. Jednou vylosovaného mění jen předání dál (nebo admin).
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

  v_host := pick_host(v_session, coalesce(v_existing.passed, '{}'));
  if v_host is null then raise exception 'Není z koho losovat'; end if;

  insert into rituals (session_id, host_id, drawn_at) values (v_session, v_host, now())
  on conflict (session_id) do update set host_id = excluded.host_id, drawn_at = now();
  return v_host;
end $$;

-- Saunamistr předá naběračku dál: los proběhne znovu bez něj.
create or replace function public.pass_ritual(p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  v_session uuid := session_on(p_date);
  v_passed uuid[];
  v_host uuid;
begin
  select passed into v_passed from rituals where session_id = v_session and host_id = v_me;
  if not found then raise exception 'Naběračku teď nemáš'; end if;
  v_passed := array_append(v_passed, v_me);
  v_host := pick_host(v_session, v_passed);
  update rituals set host_id = v_host, passed = v_passed, drawn_at = now() where session_id = v_session;
  return v_host;
end $$;

-- Saunamistr (nebo admin) určí typ rituálu
create or replace function public.set_ritual_kind(p_date date, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_session uuid := session_on(p_date);
begin
  update rituals set kind = nullif(p_kind, '')
  where session_id = v_session and (host_id = current_member_id() or is_admin());
  if not found then raise exception 'Typ rituálu volí saunamistr'; end if;
end $$;

-- Hlas pro typ rituálu (stejný hlas znovu = zrušit)
create or replace function public.vote_ritual(p_date date, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  v_session uuid := session_on(p_date);
begin
  if v_session is null or not attends(v_session, v_me) then raise exception 'Hlasovat můžou jen ti, kdo jdou'; end if;
  delete from ritual_votes where session_id = v_session and member_id = v_me and kind = p_kind;
  if found then return; end if;
  insert into ritual_votes (session_id, member_id, kind) values (v_session, v_me, p_kind)
  on conflict (session_id, member_id) do update set kind = excluded.kind;
end $$;

-- 🔥 pro saunamistra po sauně (znovu = vzít zpět)
create or replace function public.fire_ritual(p_date date)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  v_session uuid := session_on(p_date);
begin
  if p_date > current_date then raise exception '🔥 až po sauně'; end if;
  if v_session is null or not attends(v_session, v_me) then raise exception '🔥 dávají jen ti, kdo tam byli'; end if;
  if not exists (select 1 from rituals where session_id = v_session and host_id is not null) then
    raise exception 'Tenhle úterek nikdo rituál nevedl';
  end if;
  if exists (select 1 from rituals where session_id = v_session and host_id = v_me) then
    raise exception 'Sám sobě 🔥 nedáš';
  end if;
  delete from ritual_fires where session_id = v_session and member_id = v_me;
  if found then return false; end if;
  insert into ritual_fires (session_id, member_id) values (v_session, v_me);
  return true;
end $$;

-- Odhlášení z úterka uvolní naběračku a smaže hlas (jinak stejné jako dřív)
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
  if found then
    update rituals set host_id = null where session_id = v_session and host_id = p_member;
    delete from ritual_votes where session_id = v_session and member_id = p_member;
    delete from ritual_fires where session_id = v_session and member_id = p_member;
    return false;
  end if;

  insert into attendance (session_id, member_id, charged_to) values (v_session, p_member, p_member);
  return true;
end $$;

revoke all on function public.draw_ritual(date) from public, anon;
revoke all on function public.pass_ritual(date) from public, anon;
revoke all on function public.set_ritual_kind(date, text) from public, anon;
revoke all on function public.vote_ritual(date, text) from public, anon;
revoke all on function public.fire_ritual(date) from public, anon;
grant execute on function public.draw_ritual(date) to authenticated;
grant execute on function public.pass_ritual(date) to authenticated;
grant execute on function public.set_ritual_kind(date, text) to authenticated;
grant execute on function public.vote_ritual(date, text) to authenticated;
grant execute on function public.fire_ritual(date) to authenticated;
