-- SAUNIČKA · pozvání hosta se schválením adminem
-- Spusť celé v Supabase → SQL Editor → New query → Run (jednou, po 004-kapacita.sql).

create table public.guest_requests (
  id uuid primary key default gen_random_uuid(),
  session_date date not null,
  requested_by uuid not null references public.members on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index on public.guest_requests (status, session_date);

alter table public.guest_requests enable row level security;
create policy guest_requests_read  on public.guest_requests for select to authenticated using (true);
create policy guest_requests_admin on public.guest_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Kdokoliv pozve hosta; platí ten, kdo ho pozval. Čeká na schválení.
create or replace function public.request_guest(p_date date, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  v_id uuid;
begin
  if v_me is null then raise exception 'Nejsi přihlášený'; end if;
  if char_length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Napiš jméno hosta'; end if;
  if p_date < current_date or p_date > current_date + 7 then raise exception 'Hosta jde pozvat jen na nejbližší úterek'; end if;
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

-- Zrušit žádost (autor nebo admin), jen dokud čeká
create or replace function public.cancel_guest_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from guest_requests
  where id = p_request and status = 'pending' and (requested_by = current_member_id() or is_admin());
  if not found then raise exception 'Žádost nejde zrušit'; end if;
end $$;

-- Admin schválí (host se zapíše a platí ho ten, kdo ho pozval) nebo zamítne
create or replace function public.decide_guest(p_request uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  r guest_requests;
  v_session uuid;
  v_guest uuid;
  v_cap int;
begin
  if not is_admin() then raise exception 'Jen pro admina'; end if;
  select * into r from guest_requests where id = p_request and status = 'pending' for update;
  if not found then raise exception 'Žádost už je vyřízená'; end if;

  if not p_approve then
    update guest_requests set status = 'rejected', decided_at = now() where id = p_request;
    return;
  end if;

  v_session := ensure_session(r.session_date);
  select capacity into v_cap from settings where id = 1;
  if (select count(*) from attendance where session_id = v_session) >= v_cap then
    raise exception 'Sauna je plná (% lidí). Nejdřív někoho odepiš.', v_cap;
  end if;

  insert into members (slug, name, is_guest, sort)
  values ('host-' || substr(gen_random_uuid()::text, 1, 8), r.name, true, 1000)
  returning id into v_guest;
  insert into attendance (session_id, member_id, charged_to) values (v_session, v_guest, r.requested_by);
  update guest_requests set status = 'approved', decided_at = now() where id = p_request;
end $$;

revoke all on function public.request_guest(date, text) from public, anon;
revoke all on function public.cancel_guest_request(uuid) from public, anon;
revoke all on function public.decide_guest(uuid, boolean) from public, anon;
grant execute on function public.request_guest(date, text) to authenticated;
grant execute on function public.cancel_guest_request(uuid) to authenticated;
grant execute on function public.decide_guest(uuid, boolean) to authenticated;
