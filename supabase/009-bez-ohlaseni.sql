-- SAUNIČKA · "byl, ale nedal vědět" (−10 bodů, označí admin v Docházce)
-- Spusť celé v Supabase → SQL Editor → New query → Run (jednou).

alter table public.attendance
  add column no_notice boolean not null default false;

-- Měnit to smí jen admin (politika attendance_admin už existuje, ostatní zapisují jen přes funkce).
