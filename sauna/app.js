import { html, render, useState, useEffect, useMemo, useCallback } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import { api, configured } from './api.js';

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
    <main class="login"><${Mark} size=${56} /><h1>PÁRA</h1>
      <div class="card">Appka zatím není napojená na databázi. Doplň <code>sauna/config.js</code>.</div></main>`;

  return html`
    <main class="login">
      <${Mark} size=${56} />
      <h1>PÁRA</h1>
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
  const { me, members, seasons, data, season, act, go } = ctx;
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

  return html`
    <section class="page">
      <div><div class="sub">${long(next)} · Lužánky</div><h1>${iGo ? 'Vidíme se v páře 🔥' : 'Jdeš se potit?'}</h1></div>
      ${!nextSeason ? html`<div class="card muted">Na tohle úterý není otevřená sezóna. ${me.is_admin ? 'Založ ji v Adminu.' : 'Matěj ji brzo založí.'}</div>` : html`
        <div class="heat">
          <div class="row between"><span class="mono-s">${untilLabel(next).toUpperCase()}</span><span class="mono-s">90 °C</span></div>
          <div class="big">${!nextGoing.length ? 'Zatím nikdo' : `${nextGoing.length} ${nextGoing.length === 1 ? 'člověk' : nextGoing.length <= 4 ? 'lidi' : 'lidí'}`}</div>
          <div class="row between">
            <div class="stack">${nextGoing.map((m) => html`<${Ava} m=${m} members=${members} size=${32} />`)}</div>
            <span class="heat-note">${iGo ? 'jdeš taky ✓' : nextGoing.length ? '+ ty?' : 'buď první'}</span>
          </div>
        </div>
        ${iGo
          ? html`<button class="btn btn-ghost" onClick=${() => act(() => api.toggle(next, me.id), 'Škoda. Příště.')}>Nakonec nejdu</button>`
          : html`<button class="btn btn-fire" onClick=${() => act(() => api.toggle(next, me.id), 'Zapsáno. Ručník s sebou. 🧖')}>Jdu se potit 🔥</button>`}
      `}
      ${prevSeason && html`
        <div class="card row between">
          <div><div class="sub">Minulé úterý · ${short(prev)}</div><b>${iWent ? 'Účast zapsaná ✓' : 'Nezapsáno'}</b></div>
          <button class=${`btn btn-sm ${iWent ? 'btn-ghost' : 'btn-fire'}`} onClick=${() => act(() => api.toggle(prev, me.id))}>${iWent ? 'Odepsat' : 'Zapsat'}</button>
        </div>`}
      ${mine && html`
        <button class="card row between link-card" onClick=${() => go('kasa')}>
          <div><div class="sub">${season.name} · kasa</div><b>${mine.visits}× v sauně</b></div>
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
  const { me, members, season, data, act } = ctx;
  if (!season) return html`<section class="page"><h1>Sezóna</h1><p class="muted">Zatím žádná sezóna.</p></section>`;
  if (!data) return html`<section class="page"><${SeasonPicker} ctx=${ctx} /><p class="muted">Načítám…</p></section>`;

  const lg = ledger(season, data, members);
  const present = new Set(data.attendance.map((a) => `${a.session_id}|${a.member_id}`));
  const guestIds = new Set(data.attendance.map((a) => a.member_id));
  const rows = members.filter((m) => (!m.is_guest && m.active) || guestIds.has(m.id));
  const limit = iso(addDays(today(), 7));
  const canEdit = (m, date) => me.is_admin || (m.id === me.id && !season.closed_at && date <= limit);

  // žebříček s remízami jako v excelu
  const ranks = [];
  for (const m of members.filter((x) => !x.is_guest)) {
    const v = lg.get(m.id)?.visits || 0;
    if (!v) continue;
    const r = ranks.find((x) => x.visits === v);
    r ? r.people.push(m) : ranks.push({ visits: v, people: [m] });
  }
  ranks.sort((a, b) => b.visits - a.visits);

  const collected = data.attendance.length * season.price_per_person;
  const rental = data.sessions.filter((s) => data.attendance.some((a) => a.session_id === s.id)).length * season.rental_price;

  return html`
    <section class="page wide">
      <${SeasonPicker} ctx=${ctx} />
      <h1>${season.name}</h1>
      ${ranks.length > 0 && html`
        <div class="card podium-list">
          ${ranks.slice(0, 3).map((r, i) => html`
            <div class="rank-row">
              <span class="rank">${['🥇', '🥈', '🥉'][i]}</span>
              <div class="stack">${r.people.map((m) => html`<${Ava} m=${m} members=${members} size=${32} ring=${i === 0} />`)}</div>
              <b class="grow">${r.people.map((m) => m.name).join(', ')}</b>
              <span class="mono">${r.visits}×</span>
            </div>`)}
        </div>`}
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
        <div class="card"><div class="sub">Fond na cenu</div><b class="mono fire-txt">${kc(collected - rental)}</b></div>
      </div>
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
    } catch (e) { toast(e.message); throw e; }
  };
  const safeAct = (...a) => act(...a).catch(() => {});

  const ctx = { me, members: base.members, seasons: base.seasons, settings: base.settings, season, data, setSeasonId, act: safeAct, go };
  const tabs = [['dnes', '🧖', 'Dnes'], ['sezona', '🏆', 'Sezóna'], ['kasa', '💸', 'Kasa'], ...(me.is_admin ? [['admin', '⚙️', 'Admin']] : [])];
  const current = tabs.some((t) => t[0] === tab) ? tab : 'dnes';
  const Page = { dnes: Today, sezona: Season, kasa: Kasa, admin: Admin }[current];

  return html`
    <header class="bar">
      <span class="brand"><${Mark} size=${26} />PÁRA</span>
      <nav class="desk-tabs">${tabs.map(([k, , l]) => html`<a href=${`#${k}`} class=${k === current ? 'on' : ''}>${l}</a>`)}</nav>
      <button class="me-btn" title="Odhlásit" onClick=${() => confirm('Odhlásit se?') && api.signOut()}><${Ava} m=${me} members=${base.members} size=${32} /></button>
    </header>
    <${Page} ctx=${ctx} />
    <nav class="tabbar" style=${`grid-template-columns:repeat(${tabs.length},1fr)`}>
      ${tabs.map(([k, i, l]) => html`<a href=${`#${k}`} class=${k === current ? 'on' : ''}><i>${i}</i>${l}</a>`)}
    </nav>
    ${msg && html`<div class="toast">${msg}</div>`}`;
}

render(html`<${App} />`, document.getElementById('app'));
