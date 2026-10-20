-- SAUNIČKA · hosta schvalují všichni, kdo jdou
-- Spusť celé v Supabase → SQL Editor → New query → Run (jednou, po 005-hoste.sql).
--
-- Pravidlo: host se zapíše sám, jakmile s ním souhlasí KAŽDÝ zapsaný člen
-- (kromě toho, kdo ho zve) a nikdo nenamítá. Admin může žádost rozhodnout
-- natvrdo v Adminu.

create table public.guest_votes (
  request_id uuid not null references public.guest_requests on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  approve boolean not null,
  created_at timestamptz not null default now(),
  primary key (request_id, member_id)
);

alter table public.guest_votes enable row level security;
create policy guest_votes_read  on public.guest_votes for select to authenticated using (true);
create policy guest_votes_admin on public.guest_votes for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Zapíše hosta (volá se po schválení). Hlídá kapacitu.
create or replace function public.finalize_guest(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r guest_requests;
  v_session uuid;
  v_guest uuid;
  v_cap int;
begin
  select * into r from guest_requests where id = p_request and status = 'pending' for update;
  if not found then raise exception 'Žádost už je vyřízená'; end if;

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
revoke all on function public.finalize_guest(uuid) from public, anon, authenticated;

-- Admin rozhodne natvrdo (přebíjí hlasování)
create or replace function public.decide_guest(p_request uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Jen pro admina'; end if;
  if not exists (select 1 from guest_requests where id = p_request and status = 'pending') then
    raise exception 'Žádost už je vyřízená';
  end if;
  if p_approve then
    perform finalize_guest(p_request);
  else
    update guest_requests set status = 'rejected', decided_at = now() where id = p_request;
  end if;
end $$;

-- Hlas člena. Stejný hlas znovu = vzít zpět. Vrací 'approved' | 'full' | 'pending'.
create or replace function public.vote_guest(p_request uuid, p_approve boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := current_member_id();
  r guest_requests;
  v_session uuid;
  v_cap int;
begin
  if v_me is null then raise exception 'Nejsi přihlášený'; end if;
  select * into r from guest_requests where id = p_request and status = 'pending' for update;
  if not found then raise exception 'Žádost už je vyřízená'; end if;
  if r.requested_by = v_me then raise exception 'Svého hosta schvalovat nemusíš'; end if;

  v_session := session_on(r.session_date);
  if v_session is null or not attends(v_session, v_me) then
    raise exception 'Hlasovat můžou jen ti, kdo jdou';
  end if;
  if not is_admin() and deadline_passed(r.session_date, 'signup') then
    raise exception 'Zápis skončil v %. Rozhodnout už může jen admin.',
      (select to_char(signup_deadline, 'HH24:MI') from settings where id = 1);
  end if;

  if exists (select 1 from guest_votes where request_id = p_request and member_id = v_me and approve = p_approve) then
    delete from guest_votes where request_id = p_request and member_id = v_me;
    return 'pending';
  end if;
  insert into guest_votes (request_id, member_id, approve) values (p_request, v_me, p_approve)
  on conflict (request_id, member_id) do update set approve = excluded.approve, created_at = now();

  -- jeden nesouhlas blokuje, počká se na dohodu nebo admina
  if exists (select 1 from guest_votes where request_id = p_request and not approve) then return 'pending'; end if;

  -- musí souhlasit každý zapsaný člen kromě zvoucího
  if exists (
    select 1 from attendance a join members m on m.id = a.member_id
    where a.session_id = v_session and not m.is_guest and a.member_id <> r.requested_by
      and not exists (select 1 from guest_votes v where v.request_id = p_request and v.member_id = a.member_id and v.approve)
  ) then return 'pending'; end if;

  select capacity into v_cap from settings where id = 1;
  if (select count(*) from attendance where session_id = v_session) >= v_cap then return 'full'; end if;

  perform finalize_guest(p_request);
  return 'approved';
end $$;

revoke all on function public.vote_guest(uuid, boolean) from public, anon;
grant execute on function public.vote_guest(uuid, boolean) to authenticated;
revoke all on function public.decide_guest(uuid, boolean) from public, anon;
grant execute on function public.decide_guest(uuid, boolean) to authenticated;
