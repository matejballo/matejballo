import { html, render, useState, useEffect, useMemo, useCallback } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import { api, configured } from './api.js?v=20261020i';

const VERSION = '20261020i';

// ---------- pomocníci ----------

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => new Date(s + 'T12:00:00');
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
const today = () => addDays(new Date(), 0);
const nextTuesday = (from = today()) => addDays(from, (2 - from.getDay() + 7) % 7);
const DAYS = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];
const short = (s) => { const d = parse(s); return `${d.getDate()}. ${d.getMonth() + 1}.`; };
const long = (s) => `${DAYS[parse(s).getDay()]} ${short(s)}`;
const kc = (n) => `${Math.round(n).toLocaleString('cs-CZ')} Kč`;
const inSeason = (s, date) => date >= s.starts_on && date <= s.ends_on;

// Uzávěrky v den sauny (server je hlídá taky, tohle jen vypíná tlačítka)
const hhmm = (t, fallback) => (t || fallback).slice(0, 5);
const signupTime = (settings) => hhmm(settings?.signup_deadline, '18:30');
const drawTime = (settings) => hhmm(settings?.draw_deadline, '19:00');
const capacityOf = (settings) => settings?.capacity ?? 7;
const cz = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
// Kdo musí hosta odsouhlasit: každý zapsaný člen kromě toho, kdo ho zve
function guestVoting(r, data, members) {
  const sess = data.sessions.find((s) => s.date === r.session_date);
  const needed = sess
    ? data.attendance.filter((a) => a.session_id === sess.id).map((a) => members.find((m) => m.id === a.member_id)).filter((m) => m && !m.is_guest && m.id !== r.requested_by)
    : [];
  const votes = (data.guestVotes || []).filter((v) => v.request_id === r.id);
  const said = (id) => votes.find((v) => v.member_id === id);
  return {
    needed,
    yes: needed.filter((m) => said(m.id)?.approve),
    no: votes.filter((v) => !v.approve).map((v) => members.find((m) => m.id === v.member_id)).filter(Boolean),
    waiting: needed.filter((m) => !said(m.id)),
    mine: said,
  };
}
const afterDeadline = (date, time) => new Date() > new Date(`${date}T${time}:00`);
const signupClosed = (settings, date) => afterDeadline(date, signupTime(settings));
const drawClosed = (settings, date) => afterDeadline(date, drawTime(settings));

function untilLabel(dateStr) {
  const days = Math.round((parse(dateStr) - today()) / 864e5);
  if (days === 0) return 'Dnes ve 21:00';
  if (days === 1) return 'Zítra ve 21:00';
  return `Za ${days} ${days < 5 ? 'dny' : 'dní'}`;
}

const avaClass = (m, members) => `a${(members.findIndex((x) => x.id === m?.id) % 9 + 9) % 9 + 1}`;
const initial = (m) => (m?.name || '?').trim()[0].toUpperCase();

// Člen nebo jeho host: přehled návštěv a dluhů v sezóně
function ledger(season, data, members) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) rows.set(id, { member: byId.get(id), visits: 0, charges: 0, paid: 0, payments: [] });
    return rows.get(id);
  };
  for (const a of data.attendance) { row(a.member_id).visits++; row(a.charged_to).charges++; }
  for (const p of data.payments) { const r = row(p.member_id); r.paid += p.amount; r.payments.push(p); }
  for (const r of rows.values()) { r.due = r.charges * season.price_per_person; r.left = r.due - r.paid; }
  return rows;
}

// České číslo účtu → IBAN (IBAN projde beze změny)
function toIban(account) {
  const a = (account || '').replace(/\s/g, '').toUpperCase();
  if (/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(a)) return a;
  const m = a.match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/);
  if (!m) return null;
  const bban = m[3] + (m[1] || '').padStart(6, '0') + m[2].padStart(10, '0');
  let r = 0;
  for (const ch of bban + '123500') r = (r * 10 + Number(ch)) % 97;
  return `CZ${pad(98 - r)}${bban}`;
}

const ascii = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\*/g, '');

function spayd(settings, amount, message) {
  const iban = toIban(settings.account);
  if (!iban) return null;
  const parts = ['SPD', '1.0', `ACC:${iban}`, `AM:${amount.toFixed(2)}`, 'CC:CZK', `MSG:${ascii(message).slice(0, 60)}`];
  if (settings.recipient) parts.push(`RN:${ascii(settings.recipient).slice(0, 35)}`);
  return parts.join('*');
}

// Pára stoupá z tlačítka po zápisu do sauny
function steam(el) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = el.getBoundingClientRect();
  for (let i = 0; i < 7; i++) {
    const p = document.createElement('span');
    p.className = 'puff';
    p.style.left = `${r.left + r.width * (0.15 + Math.random() * 0.7)}px`;
    p.style.top = `${r.top + 8}px`;
    p.style.setProperty('--dx', `${Math.round(Math.random() * 40 - 20)}px`);
    p.style.animationDelay = `${i * 70}ms`;
    p.addEventListener('animationend', () => p.remove());
    document.body.appendChild(p);
  }
}

// ---------- hra ----------

const RITUALS = [
  ['eukalyptus', '🌿', 'Eukalyptus'], ['citrus', '🍋', 'Citrus & med'], ['sul', '🧂', 'Solný peeling'],
  ['led', '🧊', 'Ledová koule'], ['metla', '🌳', 'Březová metla'], ['med', '🍯', 'Medová maska'],
  ['pivo', '🍺', 'Pivní aufguss'], ['prekvapeni', '🎲', 'Překvapení'],
];
const ritualLabel = (k) => { const r = RITUALS.find((x) => x[0] === k); return r ? `${r[1]} ${r[2]}` : k; };

// [od kapek, °C, název, emoji]
const LEVELS = [[0, 40, 'Vlažňák', '🫧'], [50, 60, 'Zahřátý', '🌤'], [120, 80, 'Rozpálený', '☀️'], [200, 90, 'Žhavý', '🔥'], [300, 100, 'Vroucí', '♨️'], [420, 110, 'Lávový', '🌋']];
const levelOf = (k) => LEVELS.filter((l) => k >= l[0]).pop();
const nextLevelOf = (k) => LEVELS.find((l) => l[0] > k);

const POINTS = { visit: 10, streakStep: 2, streakMax: 20, host: 15, fire: 1, guest: 5, fullSeason: 50 };
const PRIZES = ['🧢 Saunová čepice', '🌿 Březová metlička', '🍺 Pivo'];

// Kapky, série a pořadí v sezóně. Počítají se jen úterky, které už proběhly.
function game(season, data, members) {
  const now = iso(today());
  const held = data.sessions.filter((s) => s.date <= now && data.attendance.some((a) => a.session_id === s.id));
  const heldIds = new Set(held.map((s) => s.id));
  const att = new Set(data.attendance.map((a) => `${a.session_id}|${a.member_id}`));
  const hostOf = new Map(data.rituals.filter((r) => r.host_id).map((r) => [r.session_id, r.host_id]));

  const rows = members.filter((m) => !m.is_guest && m.active).map((m) => {
    const p = { member: m, kapky: 0, visits: 0, streak: 0, best: 0, hosted: 0, fires: 0, guests: 0, full: false };
    let run = 0;
    for (const s of held) {
      if (att.has(`${s.id}|${m.id}`)) {
        run++;
        p.visits++;
        p.kapky += POINTS.visit + Math.min(POINTS.streakStep * (run - 1), POINTS.streakMax);
        p.best = Math.max(p.best, run);
      } else run = 0;
      if (hostOf.get(s.id) === m.id) { p.hosted++; p.kapky += POINTS.host; }
    }
    p.streak = run;
    p.fires = data.fires.filter((f) => heldIds.has(f.session_id) && hostOf.get(f.session_id) === m.id).length;
    p.guests = data.attendance.filter((a) => heldIds.has(a.session_id) && a.charged_to === m.id && a.member_id !== m.id).length;
    p.kapky += p.fires * POINTS.fire + p.guests * POINTS.guest;
    if (season.closed_at && held.length && p.visits === held.length) { p.full = true; p.kapky += POINTS.fullSeason; }
    return p;
  });

  rows.sort((a, b) => b.kapky - a.kapky || b.visits - a.visits || a.member.sort - b.member.sort);
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.kapky === r.kapky && prev.visits === r.visits ? prev.rank : i + 1;
  });
  return rows;
}

// Šance na naběračku – stejná váha jako losování v databázi (pick_host)
function hostChances(session, data, members) {
  const ritual = data.rituals.find((r) => r.session_id === session.id);
  const passed = new Set(ritual?.passed || []);
  const earlier = data.sessions.filter((x) => x.date < session.date);
  const list = data.attendance
    .filter((a) => a.session_id === session.id)
    .map((a) => members.find((m) => m.id === a.member_id))
    .filter((m) => m && !m.is_guest && !passed.has(m.id))
    .map((m) => {
      const last = earlier.filter((x) => data.rituals.some((r) => r.session_id === x.id && r.host_id === m.id)).map((x) => x.date).sort().pop() || '';
      const since = earlier.filter((x) => x.date > last && data.attendance.some((a) => a.session_id === x.id && a.member_id === m.id)).length;
      return { member: m, w: 1 + since, never: !last };
    });
  const total = list.reduce((t, x) => t + x.w, 0);
  return list.map((x) => ({ ...x, pct: Math.round((100 * x.w) / total) })).sort((a, b) => b.w - a.w);
}

function tuesdaysLeft(season) {
  let n = 0;
  for (let d = nextTuesday(); iso(d) <= season.ends_on; d = addDays(d, 7)) n++;
  return n;
}

// ---------- drobné komponenty ----------

const Ava = ({ m, members, size = 40, ring, off }) => html`
  <div class=${`ava ${avaClass(m, members)} ${ring ? 'ring' : ''} ${off ? 'off' : ''}`} style=${`--s:${size}px`}>${initial(m)}</div>`;

function Qr({ text }) {
  const svg = useMemo(() => {
    const q = window.qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
  }, [text]);
  return html`<div class="qr" dangerouslySetInnerHTML=${{ __html: svg }}></div>`;
}

const Mark = ({ size = 28 }) => html`
  <svg width=${size} height=${size} viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFB627"/><stop offset=".55" stop-color="#FF5A1F"/><stop offset="1" stop-color="#D7261E"/></linearGradient></defs>
    <rect width="64" height="64" rx="16" fill="url(#g)"/>
    <path d="M32 11C24 23 17 31 17 40a15 15 0 0 0 30 0c0-9-7-17-15-29z" fill="#FFF3E6"/>
    <path d="M25 41c2.4-2.6 4.8-2.6 7 0s4.6 2.6 7 0" fill="none" stroke="#FF5A1F" stroke-width="3.2" stroke-linecap="round"/>
  </svg>`;

// ---------- login ----------

function Login({ toast }) {
  const [members, setMembers] = useState(null);
  const [who, setWho] = useState(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (configured) api.loginMembers().then(setMembers).catch((e) => toast(e.message));
  }, []);

  const submit = async (value) => {
    setBusy(true);
    try { await api.signIn(who.slug, value); }
    catch (e) { toast(e.message); setPin(''); }
    finally { setBusy(false); }
  };

  const onPin = (e) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
    setPin(v);
    if (v.length === 6) submit(v);
  };

  if (!configured) return html`
    <main class="login"><${Mark} size=${56} /><h1>SAUNIČKA</h1>
      <div class="card">Appka zatím není napojená na databázi. Doplň <code>sauna/config.js</code>.</div></main>`;

  return html`
    <main class="login">
      <${Mark} size=${56} />
      <h1>SAUNIČKA</h1>
      <p class="muted">Saunový klub Lužánky · úterý 21:00</p>
      ${!who ? html`
        <h2>Kdo jsi?</h2>
        <div class="who">
          ${(members || []).map((m) => html`
            <button class="who-btn" onClick=${() => setWho(m)}>
              <${Ava} m=${m} members=${members} size=${48} /><span>${m.name}</span>
            </button>`)}
        </div>
        ${members && !members.length && html`<p class="muted">Zatím tu nikdo nemá účet.</p>`}
      ` : html`
        <form class="pin" onSubmit=${(e) => { e.preventDefault(); if (pin.length === 6) submit(pin); }}>
          <${Ava} m=${who} members=${members} size=${72} ring />
          <h2>${who.name}, tvůj PIN</h2>
          <input type="text" name="username" autocomplete="username" value=${who.slug} hidden />
          <input class="pin-input" type="password" inputmode="numeric" autocomplete="current-password"
            maxlength="6" value=${pin} onInput=${onPin} disabled=${busy} autofocus placeholder="••••••" />
          <button type="button" class="btn btn-ghost btn-sm" onClick=${() => { setWho(null); setPin(''); }}>← Nejsem ${who.name}</button>
        </form>
      `}
    </main>`;
}

// ---------- Dnes ----------

function Today({ ctx }) {
  const { me, members, seasons, data, season, act, go, settings } = ctx;
  const [inviting, setInviting] = useState(false);
  const [guestName, setGuestName] = useState('');
  const next = iso(nextTuesday());
  const prev = iso(addDays(nextTuesday(), -7));
  const nextSeason = seasons.find((s) => inSeason(s, next) && !s.closed_at);
  const prevSeason = seasons.find((s) => inSeason(s, prev) && !s.closed_at);

  const going = (date) => {
    const sess = data?.sessions.find((s) => s.date === date);
    if (!sess) return [];
    return data.attendance.filter((a) => a.session_id === sess.id).map((a) => members.find((m) => m.id === a.member_id)).filter(Boolean);
  };
  const nextGoing = season && inSeason(season, next) ? going(next) : [];
  const prevGoing = season && inSeason(season, prev) ? going(prev) : [];
  const iGo = nextGoing.some((m) => m.id === me.id);
  const iWent = prevGoing.some((m) => m.id === me.id);
  const mine = season && data ? ledger(season, data, members).get(me.id) : null;
  const score = season && data ? game(season, data, members).find((r) => r.member.id === me.id) : null;
  const lvl = score && levelOf(score.kapky);
  const nextSess = data?.sessions.find((s) => s.date === next);
  const ritual = nextSess && data.rituals.find((r) => r.session_id === nextSess.id);
  const host = ritual?.host_id && members.find((m) => m.id === ritual.host_id);
  const cap = capacityOf(settings);
  const nextAbsent = nextSess ? data.absences.filter((a) => a.session_id === nextSess.id).map((a) => members.find((m) => m.id === a.member_id)).filter(Boolean) : [];
  const iOut = nextAbsent.some((m) => m.id === me.id);
  const guestReqs = (data?.guestRequests || []).filter((r) => r.session_date === next);
  const free = Math.max(cap - nextGoing.length, 0);
  const full = free === 0;
  const pending = members.filter((m) => !m.is_guest && m.active && !nextGoing.some((g) => g.id === m.id) && !nextAbsent.some((a) => a.id === m.id));
  const closedNext = !me.is_admin && signupClosed(settings, next);
  const closedPrev = !me.is_admin && signupClosed(settings, prev);
  const adminName = members.find((m) => m.is_admin)?.name || 'admin';
  const hour = new Date().getHours();
  const live = next === iso(today()) && hour >= 21 && hour < 23 && nextGoing.length > 0;

  return html`
    <section class="page">
      <div><div class="sub">${long(next)} · Lužánky</div><h1>${iGo ? 'Vidíme se v páře 🔥' : 'Jdeš se potit?'}</h1></div>
      ${!nextSeason ? html`<div class="card muted">Na tohle úterý není otevřená sezóna. ${me.is_admin ? 'Založ ji v Adminu.' : 'Matěj ji brzo založí.'}</div>` : html`
        <div class=${`heat ${live ? 'live' : ''}`}>
          <div class="row between"><span class="mono-s">${live ? '● ŽIVĚ' : untilLabel(next).toUpperCase()}</span><span class="mono-s">${nextGoing.length}/${cap} míst</span></div>
          <div class="big">${!nextGoing.length ? 'Zatím nikdo' : `${nextGoing.length} ${nextGoing.length === 1 ? 'člověk' : nextGoing.length <= 4 ? 'lidi' : 'lidí'}`}</div>
          <div class="row between">
            <div class="stack">${nextGoing.map((m) => html`<${Ava} m=${m} members=${members} size=${32} />`)}</div>
            <span class="heat-note">${iGo ? 'jdeš taky ✓' : iOut ? 'nemůžeš' : full ? 'plno' : nextGoing.length ? '+ ty?' : 'buď první'}</span>
          </div>
        </div>
        ${closedNext ? html`<div class="card muted small">🔒 Zápis skončil v ${signupTime(settings)}. ${iGo ? 'Jsi zapsaný, změnit to může už jen ' : iOut ? 'Máš zapsáno, že nemůžeš. Změnit to může už jen ' : 'Dopsat tě může už jen '}${adminName}.</div>`
        : iGo
          ? html`<button class="btn btn-ghost" onClick=${() => act(() => api.toggleAbsence(next, me.id), 'Škoda, dáme vědět dál.')}>Nakonec nemůžu 😰</button>`
          : html`
            <div class="btn-row">
              <button class=${`btn btn-ghost ${iOut ? 'on' : ''}`} aria-pressed=${iOut} onClick=${() => act(() => api.toggleAbsence(next, me.id), iOut ? 'Dobře, zase s tebou počítáme.' : 'Dobře, dáme vědět dál.')}>Dnes nemůžu 😰</button>
              <button class="btn btn-fire" disabled=${full} onClick=${(e) => { steam(e.currentTarget); act(() => api.toggle(next, me.id), next === iso(today()) ? 'Zapsáno. +10 💧 a ručník s sebou 🧖' : 'Zapsáno. Ručník s sebou. 🧖'); }}>${full ? `Plno (${cap}/${cap})` : iOut ? 'Jdu přece 🔥' : 'Jdu se potit 🔥'}</button>
            </div>`}
        ${!closedNext && html`<p class="muted small" style="margin:-6px 0 0">Zápis a odepsání do ${signupTime(settings)} v den sauny.</p>`}
        ${(!closedNext || guestReqs.length > 0) && html`
          <div class="card">
            <div class="row between">
              <div><div class="sub">Host</div><b>${guestReqs.length ? 'Hlasujeme o hostovi' : 'Vezmeš někoho s sebou?'}</b></div>
              ${!closedNext && !inviting && html`<button class="btn btn-ghost btn-sm" disabled=${full} onClick=${() => setInviting(true)}>🎟 Pozvat hosta</button>`}
            </div>
            ${inviting && !closedNext && html`
              <form class="form" style="margin-top:10px" onSubmit=${(e) => { e.preventDefault(); if (!guestName.trim()) return; act(() => api.requestGuest(next, guestName), 'Žádost odeslaná. Teď to musí odsouhlasit ostatní.').then((ok) => { if (ok) { setGuestName(''); setInviting(false); } }); }}>
                <label>Jméno hosta <input value=${guestName} placeholder="Pepa" autofocus onInput=${(e) => setGuestName(e.target.value)} /></label>
                <p class="muted small" style="margin:0">Host platí za tebe stejnou částku jako ty. Zapíše se, až s ním souhlasí všichni, kdo jdou.</p>
                <div class="row"><button class="btn btn-fire btn-sm">Poslat žádost</button><button type="button" class="btn btn-ghost btn-sm" onClick=${() => setInviting(false)}>Zrušit</button></div>
              </form>`}
            ${guestReqs.map((r) => {
              const g = guestVoting(r, data, members);
              const mineVote = g.mine(me.id);
              const canVote = r.requested_by !== me.id && g.needed.some((m) => m.id === me.id) && !closedNext;
              const by = members.find((m) => m.id === r.requested_by)?.name || '?';
              return html`
              <div class="guest-req">
                <div class="row between">
                  <span><b>${r.name}</b> <span class="muted small">· pozval(a): ${by}</span></span>
                  ${r.requested_by === me.id && html`<button class="btn btn-ghost btn-sm" onClick=${() => act(() => api.cancelGuestRequest(r.id), 'Žádost zrušená')}>Zrušit</button>`}
                </div>
                <div class="muted small" style="margin-top:6px">Souhlasí ${g.yes.length} z ${g.needed.length}${g.no.length ? html` · <span class="due">nesouhlasí: ${g.no.map((m) => m.name).join(', ')}</span>` : ''}${g.waiting.length ? ` · čekáme na: ${g.waiting.map((m) => m.name).join(', ')}` : ''}</div>
                ${canVote && html`<div class="btn-row" style="margin-top:10px">
                  <button class=${`btn btn-ghost btn-sm ${mineVote && !mineVote.approve ? 'on' : ''}`} onClick=${() => act(() => api.voteGuest(r.id, false), 'Hlas zapsán', true)}>👎 Nesouhlasím</button>
                  <button class=${`btn btn-fire btn-sm ${mineVote?.approve ? 'voted' : ''}`} onClick=${() => act(() => api.voteGuest(r.id, true), 'Hlas zapsán 👍', true)}>${mineVote?.approve ? '👍 Souhlasím ✓' : '👍 Souhlasím'}</button>
                </div>`}
              </div>`;
            })}
          </div>`}
        ${(nextAbsent.length > 0 || (free > 0 && pending.length > 0)) && html`
          <div class="card avail">
            <div class="row between"><div class="sub">Obsazenost · ${short(next)}</div><b class="mono">${nextGoing.length}/${cap}</b></div>
            <div class="pbar"><div style=${`width:${Math.min(100, (100 * nextGoing.length) / cap)}%`}></div></div>
            ${nextAbsent.length > 0 && html`<div class="row" style="flex-wrap:wrap;gap:6px 10px;margin-top:10px"><span class="muted small">Nemůžou:</span>
              ${nextAbsent.map((m) => html`<span class="row" style="gap:6px"><${Ava} m=${m} members=${members} size=${22} off /><b class="small">${m.name}</b></span>`)}</div>`}
            ${pending.length > 0 && html`<div class="muted small" style="margin-top:8px">Bez odpovědi: ${pending.map((m) => m.name).join(', ')}</div>`}
            ${free > 0 && nextAbsent.length > 0 && html`<div class="avail-hint">🎟 ${cz(free, 'Volné je', 'Volná jsou', 'Volných je')} ${free} ${cz(free, 'místo', 'místa', 'míst')}. Můžeš pozvat hosta, musí ho odsouhlasit všichni, kdo jdou.</div>`}
            ${full && html`<div class="avail-hint">Plno. Kdo se uvolní, dá vědět tady.</div>`}
          </div>`}
        ${nextGoing.length > 0 && html`
          <button class="card row between link-card" onClick=${() => go('ritualy')}>
            <div><div class="sub">Rituál · ${short(next)}</div>
              <b>${host ? `${host.id === me.id ? 'Naběračka je tvoje 🪣' : `Vede ${host.name}`}` : 'Saunamistr zatím nevylosovaný'}</b>
              ${ritual?.kind && html`<div class="muted small">${ritualLabel(ritual.kind)}</div>`}</div>
            ${host ? html`<${Ava} m=${host} members=${members} size=${38} ring />` : html`<span class="big-num">🎲</span>`}
          </button>`}
      `}
      ${score && html`
        <button class="card link-card me-score" onClick=${() => go('sezona')}>
          <div class="row between">
            <div><div class="sub">${season.name} · ${score.rank}. místo</div><b>${lvl[1]}° ${lvl[2]} ${lvl[3]}</b></div>
            <span class="mono big-num shimmer">💧 ${score.kapky}</span>
          </div>
          <div class="row" style="gap:8px;margin-top:10px">
            <span class="streak">🔥 ${score.streak} ${score.streak === 1 ? 'týden' : score.streak >= 2 && score.streak <= 4 ? 'týdny' : 'týdnů'}</span>
            ${score.hosted > 0 && html`<span class="drops">🪣 ${score.hosted}×</span>`}
            ${nextLevelOf(score.kapky) && html`<span class="muted small">do ${nextLevelOf(score.kapky)[1]}° chybí ${nextLevelOf(score.kapky)[0] - score.kapky} 💧</span>`}
          </div>
        </button>`}
      ${prevSeason && html`
        <div class="card row between">
          <div><div class="sub">Minulé úterý · ${short(prev)}</div><b>${iWent ? 'Účast zapsaná ✓' : 'Nezapsáno'}</b>
            ${!iWent && closedPrev && html`<div class="muted small">Zápis je uzavřený, dopsat může ${adminName}.</div>`}</div>
          ${!closedPrev && html`<button class=${`btn btn-sm ${iWent ? 'btn-ghost' : 'btn-fire'}`} onClick=${() => act(() => api.toggle(prev, me.id))}>${iWent ? 'Odepsat' : 'Zapsat'}</button>`}
        </div>`}
      ${mine && html`
        <button class="card row between link-card" onClick=${() => go('kasa')}>
          <div><div class="sub">${season.name} · kasa</div><b>${mine.left > 0 ? 'Zatím visíš kase' : 'Kasa'}</b></div>
          <span class="mono big-num ${mine.left > 0 ? 'due' : ''}">${mine.left > 0 ? kc(mine.left) : '✓'}</span>
        </button>`}
    </section>`;
}

// ---------- Sezóna ----------

function SeasonPicker({ ctx }) {
  const { seasons, season, setSeasonId } = ctx;
  return html`<div class="chips">${seasons.map((s) => html`
    <button class=${`chip ${s.id === season?.id ? 'on' : ''}`} onClick=${() => setSeasonId(s.id)}>${s.name}${s.closed_at ? '' : ' •'}</button>`)}</div>`;
}

function Season({ ctx }) {
  const { me, members, season, data, act, settings } = ctx;
  if (!season) return html`<section class="page"><h1>Sezóna</h1><p class="muted">Zatím žádná sezóna.</p></section>`;
  if (!data) return html`<section class="page"><${SeasonPicker} ctx=${ctx} /><p class="muted">Načítám…</p></section>`;

  const lg = ledger(season, data, members);
  const present = new Set(data.attendance.map((a) => `${a.session_id}|${a.member_id}`));
  const guestIds = new Set(data.attendance.map((a) => a.member_id));
  const rows = members.filter((m) => (!m.is_guest && m.active) || guestIds.has(m.id));
  const limit = iso(addDays(today(), 7));
  const canEdit = (m, date) => me.is_admin || (m.id === me.id && !season.closed_at && date <= limit && !signupClosed(settings, date));

  const board = game(season, data, members);
  const prizes = season.prizes?.length ? season.prizes : PRIZES;
  const holders = (place) => board.filter((r) => r.visits > 0 && r.rank === place);
  const left = season.closed_at ? 0 : tuesdaysLeft(season);

  const collected = data.attendance.length * season.price_per_person;
  const rental = data.sessions.filter((s) => data.attendance.some((a) => a.session_id === s.id)).length * season.rental_price;

  return html`
    <section class="page wide">
      <${SeasonPicker} ctx=${ctx} />
      <div><div class="sub">${season.closed_at ? 'Konečné pořadí' : left ? `Do konce ${left} ${left === 1 ? 'úterý' : left <= 4 ? 'úterky' : 'úterků'}` : 'Poslední úterek'}</div>
        <h1>Žebříček · ${season.name}</h1></div>

      <div class="prizes">
        ${prizes.slice(0, 3).map((p, i) => html`
          <div class=${`prize p${i + 1}`}>
            <span class="medal">${['🥇', '🥈', '🥉'][i]}</span>
            <div class="grow"><b>${p}</b>
              <div class="small">${holders(i + 1).map((r) => r.member.name).join(', ') || '—'}</div></div>
          </div>`)}
      </div>
      <p class="muted small" style="margin:-4px 0 0">Ceny platí ostatní. ${season.closed_at ? '' : 'Ještě je čas to otočit. 😈'}</p>

      <div class="card lb">
        ${board.map((r) => {
          const l = levelOf(r.kapky);
          return html`
            <div class=${`lb-row ${r.member.id === me.id ? 'me' : ''} ${r.visits ? '' : 'zero'}`}>
              <span class="pos">${r.visits ? `${r.rank}.` : '–'}</span>
              <${Ava} m=${r.member} members=${members} size=${36} ring=${r.streak >= 3} />
              <div class="grow"><b>${r.member.name}${r.rank === 1 && r.visits ? ' 👑' : ''}</b>
                <small>${l[1]}° ${l[2]}${r.streak >= 2 ? ` · 🔥 ${r.streak}` : ''}${r.hosted ? ` · 🪣 ${r.hosted}` : ''}${r.full ? ' · 🏅 celá sezóna' : ''}</small></div>
              <span class=${`pts ${r.rank === 1 && r.visits ? 'shimmer' : ''}`}>💧 ${r.kapky}</span>
            </div>`;
        })}
      </div>

      <details class="card rules">
        <summary>Jak se sbírají kapky 💧</summary>
        <table>
          <tr><td>Účast v sauně</td><td>+${POINTS.visit}</td></tr>
          <tr><td>Série (každý další úterek v řadě)</td><td>+${POINTS.streakStep}× série, max +${POINTS.streakMax}</td></tr>
          <tr><td>Vedení rituálu</td><td>+${POINTS.host}</td></tr>
          <tr><td>Každý 🔥 za tvůj rituál</td><td>+${POINTS.fire}</td></tr>
          <tr><td>Přivedený host</td><td>+${POINTS.guest}</td></tr>
          <tr><td>Celá sezóna bez absence</td><td>+${POINTS.fullSeason}</td></tr>
        </table>
        <p class="muted small">Teploměr: ${LEVELS.map((l) => `${l[1]}° ${l[2]} (${l[0]}+)`).join(' · ')}</p>
      </details>

      <h2 class="h2">Docházka</h2>
      <div class="grid-wrap">
        <table class="grid">
          <thead><tr><th></th>${data.sessions.map((s) => html`<th>${short(s.date)}</th>`)}<th>Σ</th></tr></thead>
          <tbody>
            ${rows.map((m) => html`
              <tr class=${m.id === me.id ? 'me' : ''}>
                <th><span class="row"><${Ava} m=${m} members=${members} size=${24} /> ${m.name}${m.is_guest ? html` <span class="tag">host</span>` : ''}</span></th>
                ${data.sessions.map((s) => {
                  const on = present.has(`${s.id}|${m.id}`);
                  const edit = canEdit(m, s.date);
                  return html`<td><button class=${`cell ${on ? 'on' : ''}`} disabled=${!edit}
                    aria-label=${`${m.name} ${short(s.date)}`} onClick=${() => act(() => api.toggle(s.date, m.id))}>${on ? '✓' : ''}</button></td>`;
                })}
                <td class="mono">${lg.get(m.id)?.visits || 0}</td>
              </tr>`)}
            <tr class="foot"><th>Lidí</th>${data.sessions.map((s) => html`<td class="mono">${data.attendance.filter((a) => a.session_id === s.id).length}</td>`)}<td class="mono">${data.attendance.length}</td></tr>
          </tbody>
        </table>
      </div>
      ${!data.sessions.length && html`<p class="muted">Zatím žádné úterky. První se založí, jakmile se někdo zapíše.</p>`}
      <div class="stats">
        <div class="card"><div class="sub">Vybráno</div><b class="mono">${kc(collected)}</b></div>
        <div class="card"><div class="sub">Pronájem</div><b class="mono">${kc(rental)}</b></div>
        <div class="card"><div class="sub">${collected >= rental ? 'Přebytek' : 'Chybí na pronájem'}</div><b class=${`mono ${collected >= rental ? 'fire-txt' : 'due'}`}>${kc(Math.abs(collected - rental))}</b></div>
      </div>
    </section>`;
}

// ---------- Rituály ----------

function Rituals({ ctx }) {
  const { me, members, season, data, act, settings } = ctx;
  if (!season || !data) return html`<section class="page"><${SeasonPicker} ctx=${ctx} /><p class="muted">Načítám…</p></section>`;

  const next = iso(nextTuesday());
  const open = inSeason(season, next) && !season.closed_at;
  const drawLocked = !me.is_admin && drawClosed(settings, next);
  const adminName = members.find((m) => m.is_admin)?.name || 'admin';
  const sess = data.sessions.find((s) => s.date === next);
  const goingIds = sess ? data.attendance.filter((a) => a.session_id === sess.id).map((a) => a.member_id) : [];
  const iGo = goingIds.includes(me.id);
  const ritual = sess && data.rituals.find((r) => r.session_id === sess.id);
  const host = ritual?.host_id && members.find((m) => m.id === ritual.host_id);
  const passed = (ritual?.passed || []).map((id) => members.find((m) => m.id === id)?.name).filter(Boolean);
  const votes = sess ? data.votes.filter((v) => v.session_id === sess.id) : [];
  const myVote = votes.find((v) => v.member_id === me.id)?.kind;
  const tally = RITUALS.map(([k, i, l]) => ({ k, i, l, n: votes.filter((v) => v.kind === k).length }));
  const maxVotes = Math.max(0, ...tally.map((t) => t.n));
  const chances = sess && !host ? hostChances(sess, data, members) : [];
  const fireCount = (sid) => data.fires.filter((f) => f.session_id === sid).length;

  // proběhlé rituály (před nadcházejícím úterkem), nejnovější nahoře
  const past = data.sessions
    .filter((s) => s.date < next)
    .map((s) => ({ s, r: data.rituals.find((r) => r.session_id === s.id && r.host_id) }))
    .filter((x) => x.r)
    .reverse();
  const last = past[0];
  const lastHost = last && members.find((m) => m.id === last.r.host_id);
  const iWasThere = last && data.attendance.some((a) => a.session_id === last.s.id && a.member_id === me.id);
  const iFired = last && data.fires.some((f) => f.session_id === last.s.id && f.member_id === me.id);

  return html`
    <section class="page">
      <${SeasonPicker} ctx=${ctx} />
      <div><div class="sub">Rituál · ${long(next)}</div>
        <h1>${host ? (host.id === me.id ? 'Naběračka je tvoje 🪣' : `Naběračka: ${host.name}`) : 'Kdo povede rituál?'}</h1></div>

      ${!open && html`<div class="card muted">Na příští úterý není otevřená sezóna.</div>`}

      ${open && !goingIds.length && html`<div class="card muted">Zatím se nikdo nezapsal. Saunamistr se losuje mezi těmi, kdo jdou.</div>`}

      ${open && host && html`
        <div class="card host-card">
          <${Ava} m=${host} members=${members} size=${72} ring />
          <b class="host-name">${host.name}</b>
          <div class="muted">${ritual.kind ? ritualLabel(ritual.kind) : maxVotes ? `Parta chce: ${tally.filter((t) => t.n === maxVotes).map((t) => `${t.i} ${t.l}`).join(', ')}` : 'Typ rituálu zatím nevybraný'}</div>
          ${passed.length > 0 && html`<div class="muted small">Předali: ${passed.join(', ')}</div>`}
          ${host.id === me.id && !drawLocked && html`
            <div class="row wrap" style="justify-content:center">
              <button class="btn btn-ghost btn-sm" onClick=${() => confirm('Předat naběračku dál? Los proběhne znovu bez tebe.') && act(() => api.passRitual(next), 'Naběračka putuje dál 🪣')}>Předat dál</button>
            </div>`}
        </div>`}

      ${open && !host && goingIds.length > 0 && html`
        <div class="card">
          <div class="sub">Šance na naběračku</div>
          ${chances.map((c) => html`
            <div class="chance">
              <${Ava} m=${c.member} members=${members} size=${30} />
              <span class="grow">${c.member.name}${c.never ? html` <span class="muted small">· poprvé</span>` : ''}</span>
              <div class="pbar"><div style=${`width:${c.pct}%`}></div></div>
              <span class="mono small">${c.pct} %</span>
            </div>`)}
          ${passed.length > 0 && html`<p class="muted small">Předali: ${passed.join(', ')}</p>`}
          ${chances.length === 0 && html`<p class="muted small">Všichni předali. Naběračka zůstává volná.</p>`}
          ${drawLocked && chances.length > 0 ? html`<p class="muted small">🔒 Los skončil v ${drawTime(settings)}. Saunamistra teď může určit už jen ${adminName}.</p>`
            : (iGo || me.is_admin) && chances.length > 0
            ? html`<button class="btn btn-fire" style="width:100%;margin-top:12px" onClick=${() => act(() => api.drawRitual(next), 'Los padl! 🎲')}>🎲 Losovat saunamistra</button>`
            : chances.length > 0 && html`<p class="muted small">Losovat může kdokoliv, kdo jde, do ${drawTime(settings)} v den sauny.</p>`}
        </div>`}

      ${open && goingIds.length > 0 && html`
        <div class="card">
          <div class="row between"><div class="sub">${host?.id === me.id ? 'Vyber rituál' : 'Na co je chuť?'}</div>
            ${!iGo && html`<span class="muted small">hlasují ti, kdo jdou</span>`}</div>
          <div class="vote-grid">
            ${tally.map((t) => {
              const chosen = ritual?.kind === t.k;
              const onClick = host?.id === me.id
                ? () => act(() => api.setRitualKind(next, chosen ? '' : t.k), chosen ? null : `Rituál: ${t.i} ${t.l}`)
                : () => act(() => api.voteRitual(next, t.k));
              return html`
                <button class=${`vote-chip ${myVote === t.k ? 'mine' : ''} ${chosen ? 'chosen' : ''}`} disabled=${!iGo && host?.id !== me.id} onClick=${onClick}>
                  <span>${t.i} ${t.l}</span>${t.n > 0 && html`<b class="mono">${t.n}</b>`}
                </button>`;
            })}
          </div>
          ${host?.id === me.id && html`<p class="muted small">Jako saunamistr vybíráš finální rituál. Čísla jsou hlasy party.</p>`}
        </div>`}

      ${last && html`
        <div class="card fire-card">
          <div class="sub">Minulý rituál · ${short(last.s.date)}</div>
          <div class="row" style="margin-top:8px">
            <${Ava} m=${lastHost} members=${members} size=${40} />
            <div class="grow"><b>${lastHost?.name}</b><div class="muted small">${last.r.kind ? ritualLabel(last.r.kind) : 'rituál'}</div></div>
            <span class="mono fire-txt">🔥 ${fireCount(last.s.id)}</span>
          </div>
          ${iWasThere && lastHost?.id !== me.id && html`
            <button class=${`btn ${iFired ? 'btn-ghost' : 'btn-fire'} btn-sm`} style="width:100%;margin-top:12px"
              onClick=${() => act(() => api.fireRitual(last.s.date), iFired ? null : `🔥 pro ${lastHost?.name}`)}>${iFired ? 'Vzít 🔥 zpět' : 'Dát 🔥 za rituál'}</button>`}
        </div>`}

      ${past.length > 1 && html`
        <div class="card">
          <div class="sub">Historie sezóny</div>
          ${past.slice(1).map(({ s, r }) => {
            const h = members.find((m) => m.id === r.host_id);
            return html`<div class="row between line">
              <span class="row"><span class="mono small muted">${short(s.date)}</span> ${h?.name}</span>
              <span class="muted small">${r.kind ? ritualLabel(r.kind) : ''} 🔥 ${fireCount(s.id)}</span></div>`;
          })}
        </div>`}
    </section>`;
}

// ---------- Kasa ----------

function Kasa({ ctx }) {
  const { me, members, season, data, settings } = ctx;
  const [showQr, setShowQr] = useState(false);
  if (!season || !data) return html`<section class="page"><${SeasonPicker} ctx=${ctx} /><p class="muted">Načítám…</p></section>`;

  const lg = ledger(season, data, members);
  const mine = lg.get(me.id) || { visits: 0, charges: 0, due: 0, paid: 0, left: 0, payments: [] };
  const guests = data.attendance.filter((a) => a.charged_to === me.id && a.member_id !== me.id);
  const qr = mine.left > 0 ? spayd(settings, mine.left, `Sauna ${season.name} ${me.name}`) : null;
  const closed = !!season.closed_at;

  let title, note;
  if (mine.due === 0) { title = 'Zatím nic'; note = 'V téhle sezóně ještě žádná účast.'; }
  else if (mine.left <= 0) { title = 'Zaplaceno ✓'; note = 'Kasa je s tebou v pohodě.'; }
  else if (closed) { title = `Pošli ${kc(mine.left)}`; note = 'Sezóna je uzavřená, je čas zaplatit. Pot se nepočítá jako měna.'; }
  else { title = `Zatím ${kc(mine.left)}`; note = 'Platí se najednou na konci sezóny. Kdo chce, může i dřív.'; }

  return html`
    <section class="page">
      <${SeasonPicker} ctx=${ctx} />
      <div><div class="sub">Tvoje kasa · ${season.name}</div><h1 class=${mine.left > 0 && closed ? 'due' : ''}>${title}</h1><p class="muted">${note}</p></div>
      <div class="card">
        <div class="row between"><span class="muted">${mine.visits}× ty${guests.length ? ` + ${guests.length}× host` : ''} × ${kc(season.price_per_person)}</span><span class="mono">${kc(mine.due)}</span></div>
        <div class="row between"><span class="muted">Zaplaceno</span><span class="mono">${kc(mine.paid)}</span></div>
        <div class="row between total"><span>Zbývá</span><span class="mono">${kc(Math.max(mine.left, 0))}</span></div>
      </div>
      ${mine.left > 0 && (closed || showQr
        ? (qr
          ? html`<div class="card qr-card"><${Qr} text=${qr} /><p class="muted">Naskenuj v bankovní appce. Částka i zpráva se vyplní samy.</p></div>`
          : html`<div class="card muted">Číslo účtu ještě není vyplněné v Adminu.</div>`)
        : html`<button class="btn btn-ghost" onClick=${() => setShowQr(true)}>Zaplatit už teď (QR)</button>`)}
      ${mine.payments.length > 0 && html`
        <div class="card"><div class="sub">Platby</div>
          ${mine.payments.map((p) => html`<div class="row between line"><span>${short(p.paid_on)} ${p.note ? html`<span class="muted">· ${p.note}</span>` : ''}</span><span class="mono">${kc(p.amount)}</span></div>`)}
        </div>`}
      ${guests.length > 0 && html`
        <div class="card"><div class="sub">Tvoji hosté</div>
          ${guests.map((a) => html`<div class="row between line"><span>${members.find((m) => m.id === a.member_id)?.name}</span><span class="muted">${short(data.sessions.find((s) => s.id === a.session_id)?.date || '')}</span></div>`)}
        </div>`}
    </section>`;
}

// ---------- Admin ----------

function Admin({ ctx }) {
  const { members, season, data, settings, act } = ctx;
  const [acc, setAcc] = useState(settings.account || '');
  const [rcp, setRcp] = useState(settings.recipient || '');
  const [edit, setEdit] = useState(null);
  const [guest, setGuest] = useState({ date: iso(nextTuesday()), name: '', chargedTo: '' });
  const [dl, setDl] = useState({ signup: signupTime(settings), draw: drawTime(settings), cap: capacityOf(settings) });
  const nextDate = iso(nextTuesday());
  const nextSess = data?.sessions.find((s) => s.date === nextDate);
  const nextRitual = nextSess && data.rituals.find((r) => r.session_id === nextSess.id);
  const ritualHost = nextRitual?.host_id && members.find((m) => m.id === nextRitual.host_id);
  const ritualPassed = (nextRitual?.passed || []).map((id) => members.find((m) => m.id === id)?.name).filter(Boolean);

  const regulars = members.filter((m) => !m.is_guest);
  const lg = season && data ? ledger(season, data, members) : new Map();
  const owing = [...lg.values()].filter((r) => r.due > 0 || r.paid > 0).sort((a, b) => (a.member?.sort ?? 999) - (b.member?.sort ?? 999));
  const ibanOk = !acc || toIban(acc);

  const newSeason = () => {
    const t = today();
    const spring = t.getMonth() < 6;
    const y = t.getFullYear();
    setEdit({ name: `${spring ? 'Jaro' : 'Podzim'} ${y}`, starts_on: spring ? `${y}-01-01` : `${y}-09-01`, ends_on: spring ? `${y}-06-30` : `${y}-12-31`, price_per_person: 160, rental_price: 750 });
  };

  const field = (k, type = 'text') => html`
    <input type=${type} value=${edit[k]} onInput=${(e) => setEdit({ ...edit, [k]: type === 'number' ? Number(e.target.value) : e.target.value })} />`;

  return html`
    <section class="page">
      <${SeasonPicker} ctx=${ctx} />
      <h1>Admin</h1>

      ${(data?.guestRequests?.length || 0) > 0 && html`
        <div class="card" style="border-color:var(--zhar)">
          <div class="sub">Žádosti o hosty · rozhodni natvrdo</div>
          ${data.guestRequests.map((r) => html`
            <div class="pay-row">
              <div class="grow"><b>${r.name}</b>
                <div class="muted small">${long(r.session_date)} · pozval(a): ${members.find((m) => m.id === r.requested_by)?.name || '?'}, platí za hosta</div>
                ${(() => { const g = guestVoting(r, data, members); return html`<div class="muted small">Souhlasí ${g.yes.length} z ${g.needed.length}${g.no.length ? ` · nesouhlasí: ${g.no.map((m) => m.name).join(', ')}` : ''}</div>`; })()}</div>
              <button class="btn btn-fire btn-sm" onClick=${() => act(() => api.decideGuest(r.id, true), `${r.name} schválen 🎟`, true)}>Schválit</button>
              <button class="btn btn-ghost btn-sm" aria-label="Zamítnout" onClick=${() => act(() => api.decideGuest(r.id, false), 'Zamítnuto')}>×</button>
            </div>`)}
        </div>`}

      ${season && html`
        <div class="card">
          <div class="row between"><div><div class="sub">Sezóna</div><b>${season.name}</b>
            <div class="muted small">${short(season.starts_on)}${season.starts_on.slice(0, 4)} – ${short(season.ends_on)}${season.ends_on.slice(0, 4)} · ${kc(season.price_per_person)}/os · pronájem ${kc(season.rental_price)}</div></div>
            <span class=${`tag ${season.closed_at ? '' : 'tag-hot'}`}>${season.closed_at ? 'uzavřená' : 'otevřená'}</span></div>
          <div class="row wrap">
            ${season.closed_at
              ? html`<button class="btn btn-ghost btn-sm" onClick=${() => act(() => api.saveSeason({ id: season.id, closed_at: null }), 'Sezóna znovu otevřená', true)}>Znovu otevřít</button>`
              : html`<button class="btn btn-fire btn-sm" onClick=${() => confirm(`Uzavřít ${season.name}? Všem se ukáže finální částka a QR.`) && act(() => api.saveSeason({ id: season.id, closed_at: new Date().toISOString() }), 'Sezóna uzavřená. Kasa otevřená! 💸', true)}>Uzavřít sezónu</button>`}
            <button class="btn btn-ghost btn-sm" onClick=${() => setEdit({ ...season })}>Upravit</button>
            <button class="btn btn-ghost btn-sm" onClick=${newSeason}>+ Nová sezóna</button>
          </div>
        </div>`}
      ${!season && html`<button class="btn btn-fire" onClick=${newSeason}>+ Založit sezónu</button>`}

      ${edit && html`
        <form class="card form" onSubmit=${(e) => { e.preventDefault(); const { id, name, starts_on, ends_on, price_per_person, rental_price } = edit; act(() => api.saveSeason({ id, name, starts_on, ends_on, price_per_person, rental_price }), 'Uloženo', true).then(() => setEdit(null)); }}>
          <div class="sub">${edit.id ? 'Upravit sezónu' : 'Nová sezóna'}</div>
          <label>Název ${field('name')}</label>
          <div class="row"><label>Od ${field('starts_on', 'date')}</label><label>Do ${field('ends_on', 'date')}</label></div>
          <div class="row"><label>Kč / osoba ${field('price_per_person', 'number')}</label><label>Pronájem ${field('rental_price', 'number')}</label></div>
          <div class="row"><button class="btn btn-fire btn-sm">Uložit</button><button type="button" class="btn btn-ghost btn-sm" onClick=${() => setEdit(null)}>Zrušit</button></div>
        </form>`}

      ${season && data && html`
        <div class="card">
          <div class="sub">Kasa · ${season.name}</div>
          ${owing.length === 0 && html`<p class="muted">Zatím nikdo nic nedluží.</p>`}
          ${owing.map((r) => html`
            <div class="pay-row">
              <${Ava} m=${r.member} members=${members} size=${32} />
              <div class="grow"><b>${r.member?.name}</b><div class="muted small">${r.charges}× · ${kc(r.due)} · zaplaceno ${kc(r.paid)}</div>
                ${r.payments.map((p) => html`<span class="pay-chip">${short(p.paid_on)} ${kc(p.amount)} <button aria-label="Smazat platbu" onClick=${() => confirm('Smazat platbu?') && act(() => api.deletePayment(p.id), 'Platba smazaná')}>×</button></span>`)}
              </div>
              ${r.left > 0
                ? html`<button class="btn btn-fire btn-sm" title="Označit jako zaplacené" onClick=${() => act(() => api.addPayment({ season_id: season.id, member_id: r.member.id, amount: r.left }), `${r.member.name}: zaplaceno ${kc(r.left)}`)}>✓ ${kc(r.left)}</button>`
                : html`<span class="tag">${r.left < 0 ? `přeplatek ${kc(-r.left)}` : 'OK ✓'}</span>`}
            </div>`)}
        </div>`}

      ${season && data && html`
        <div class="card form">
          <div class="sub">Losování saunamistra · ${long(nextDate)}</div>
          <div>${ritualHost ? html`Saunamistr: <b>${ritualHost.name}</b>` : 'Zatím nevylosováno'}
            ${ritualPassed.length > 0 && html`<div class="muted small">Naběračku předali: ${ritualPassed.join(', ')}</div>`}</div>
          <button type="button" class="btn btn-ghost btn-sm" disabled=${!nextRitual}
            onClick=${() => confirm('Resetovat losování? Saunamistr i seznam těch, kdo předali, se smaže a může se losovat znovu.') && act(() => api.resetRitual(nextSess.id), 'Losování resetované 🎲')}>Resetovat losování</button>
        </div>`}

      <form class="card form" onSubmit=${(e) => { e.preventDefault(); act(() => api.saveSettings({ signup_deadline: dl.signup, draw_deadline: dl.draw, capacity: Number(dl.cap) }), 'Uloženo', true); }}>
        <div class="sub">Zápis a uzávěrky</div>
        <label>Kapacita sauny (lidí včetně hostů) <input type="number" min="1" max="50" value=${dl.cap} onInput=${(e) => setDl({ ...dl, cap: e.target.value })} /></label>
        <div class="row">
          <label>Zápis do <input type="time" value=${dl.signup} onInput=${(e) => setDl({ ...dl, signup: e.target.value })} /></label>
          <label>Los saunamistra do <input type="time" value=${dl.draw} onInput=${(e) => setDl({ ...dl, draw: e.target.value })} /></label>
        </div>
        <p class="muted small" style="margin:0">Po uzávěrce nikdo kromě admina nezapíše ani neodepíše účast a nelosuje.</p>
        <button class="btn btn-ghost btn-sm" disabled=${!dl.signup || !dl.draw || !(Number(dl.cap) >= 1)}>Uložit</button>
      </form>

      <form class="card form" onSubmit=${(e) => { e.preventDefault(); if (!guest.name.trim()) return; act(() => api.addGuest(guest.date, guest.name, guest.chargedTo), `Host ${guest.name} přidán`, true).then(() => setGuest({ ...guest, name: '' })); }}>
        <div class="sub">Přidat hosta</div>
        <div class="row"><label>Úterý <input type="date" value=${guest.date} onInput=${(e) => setGuest({ ...guest, date: e.target.value })} /></label>
          <label>Jméno <input value=${guest.name} placeholder="Pepa" onInput=${(e) => setGuest({ ...guest, name: e.target.value })} /></label></div>
        <label>Kdo platí
          <select value=${guest.chargedTo} onChange=${(e) => setGuest({ ...guest, chargedTo: e.target.value })}>
            <option value="">Host platí sám</option>
            ${regulars.map((m) => html`<option value=${m.id}>${m.name}</option>`)}
          </select></label>
        <button class="btn btn-ghost btn-sm">Přidat hosta</button>
      </form>

      <form class="card form" onSubmit=${(e) => { e.preventDefault(); act(() => api.saveSettings({ account: acc.trim(), recipient: rcp.trim() }), 'Účet uložen', true); }}>
        <div class="sub">Kam se platí</div>
        <label>Číslo účtu nebo IBAN <input value=${acc} placeholder="123456789/0800" onInput=${(e) => setAcc(e.target.value)} /></label>
        ${!ibanOk && html`<p class="due small">Tohle číslo účtu nerozumím. Zkus formát 123456789/0800 nebo IBAN.</p>`}
        <label>Jméno příjemce <input value=${rcp} placeholder="Matěj Ballo" onInput=${(e) => setRcp(e.target.value)} /></label>
        <button class="btn btn-ghost btn-sm" disabled=${!ibanOk}>Uložit</button>
      </form>
      <p class="muted small">Nový PIN pro člena: <code>node scripts/sauna-users.mjs reset slug</code></p>
      <p class="mute small" style="margin:0">Verze appky: <code>${VERSION}</code></p>
    </section>`;
}

// ---------- appka ----------

function App() {
  const [uid, setUid] = useState(undefined);
  const [base, setBase] = useState(null);
  const [seasonId, setSeasonId] = useState(null);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState(() => location.hash.slice(1) || 'dnes');
  const [msg, setMsg] = useState(null);

  const toast = useCallback((text) => { setMsg(text); clearTimeout(window.__t); window.__t = setTimeout(() => setMsg(null), 3200); }, []);

  useEffect(() => {
    if (!configured) { setUid(null); return; }
    api.userId().then(setUid);
    api.onAuth(setUid);
  }, []);

  const loadBase = useCallback(async () => {
    const b = await api.base();
    setBase(b);
    setSeasonId((cur) => {
      if (cur && b.seasons.some((s) => s.id === cur)) return cur;
      const t = iso(nextTuesday());
      return (b.seasons.find((s) => inSeason(s, t)) || b.seasons.find((s) => !s.closed_at) || b.seasons[0])?.id ?? null;
    });
  }, []);

  useEffect(() => {
    if (uid) loadBase().catch((e) => toast(e.message));
    else setBase(null);
  }, [uid]);

  const loadSeason = useCallback(async (id) => setData(id ? await api.season(id) : null), []);
  useEffect(() => { setData(null); loadSeason(seasonId).catch((e) => toast(e.message)); }, [seasonId]);

  useEffect(() => {
    const onHash = () => setTab(location.hash.slice(1) || 'dnes');
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  if (uid === undefined) return html`<main class="login"><${Mark} size=${56} /></main>`;
  if (!uid) return html`<${Login} toast=${toast} />${msg && html`<div class="toast">${msg}</div>`}`;
  if (!base) return html`<main class="login"><${Mark} size=${56} /><p class="muted">Rozpaluju kamna…</p></main>${msg && html`<div class="toast">${msg}</div>`}`;

  const me = base.members.find((m) => m.user_id === uid);
  if (!me) return html`<main class="login"><p>Tenhle účet není spárovaný s žádným členem.</p><button class="btn btn-ghost" onClick=${api.signOut}>Odhlásit</button></main>`;

  const season = base.seasons.find((s) => s.id === seasonId) || null;
  const go = (t) => { location.hash = t; };
  const act = async (fn, okMsg, reloadBase) => {
    try {
      await fn();
      if (okMsg) toast(okMsg);
      if (reloadBase) await loadBase();
      await loadSeason(seasonId);
      return true;
    } catch (e) { toast(e.message); throw e; }
  };
  const safeAct = (...a) => act(...a).catch(() => false);

  const pendingGuests = me.is_admin ? (data?.guestRequests?.length || 0) : 0;
  const ctx = { me, members: base.members, seasons: base.seasons, settings: base.settings, season, data, setSeasonId, act: safeAct, go };
  const tabs = [['dnes', '🧖', 'Dnes'], ['sezona', '🏆', 'Žebříček'], ['ritualy', '🌿', 'Rituály'], ['kasa', '💸', 'Kasa'], ...(me.is_admin ? [['admin', '⚙️', 'Admin']] : [])];
  const current = tabs.some((t) => t[0] === tab) ? tab : 'dnes';
  const Page = { dnes: Today, sezona: Season, ritualy: Rituals, kasa: Kasa, admin: Admin }[current];

  return html`
    <header class="bar">
      <span class="brand"><${Mark} size=${26} />SAUNIČKA</span>
      <nav class="desk-tabs">${tabs.map(([k, , l]) => html`<a href=${`#${k}`} class=${k === current ? 'on' : ''}>${l}${k === 'admin' && pendingGuests > 0 ? html`<span class="badge">${pendingGuests}</span>` : ''}</a>`)}</nav>
      <button class="me-btn" title="Odhlásit" onClick=${() => confirm('Odhlásit se?') && api.signOut()}><${Ava} m=${me} members=${base.members} size=${32} /></button>
    </header>
    <${Page} ctx=${ctx} />
    <nav class="tabbar" style=${`grid-template-columns:repeat(${tabs.length},1fr)`}>
      ${tabs.map(([k, i, l]) => html`<a href=${`#${k}`} class=${k === current ? 'on' : ''}><i>${i}</i>${l}${k === 'admin' && pendingGuests > 0 ? html`<span class="badge">${pendingGuests}</span>` : ''}</a>`)}
    </nav>
    ${msg && html`<div class="toast">${msg}</div>`}`;
}

render(html`<${App} />`, document.getElementById('app'));
