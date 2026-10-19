#!/usr/bin/env node
// Vytvoří přihlašovací účty pro členy PÁRY a vypíše jejich PINy.
//
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/sauna-users.mjs
//   ... node scripts/sauna-users.mjs reset matej   # nový PIN pro jednoho člena
//
// Service role klíč obchází veškerá oprávnění: nikdy ho nedávej do appky ani do gitu.

import { randomInt } from 'node:crypto';

const EMAIL_DOMAIN = 'sauna.matejballo.com'; // musí sedět se sauna/config.js
const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Chybí SUPABASE_URL nebo SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

// Nové klíče (sb_secret_…) patří jen do hlavičky apikey, staré JWT klíče i do Authorization
const headers = { apikey: key, 'Content-Type': 'application/json', ...(key.startsWith('eyJ') && { Authorization: `Bearer ${key}` }) };
const pin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

async function api(path, init = {}) {
  const res = await fetch(url + path, { ...init, headers: { ...headers, ...init.headers } });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${body}`);
  return body ? JSON.parse(body) : null;
}

const members = await api('/rest/v1/members?select=id,slug,name,user_id&is_guest=eq.false&active=eq.true&order=sort');
const [cmd, slug] = process.argv.slice(2);

if (cmd === 'reset') {
  const m = members.find((x) => x.slug === slug);
  if (!m?.user_id) throw new Error(`Člen "${slug}" nemá účet.`);
  const p = pin();
  await api(`/auth/v1/admin/users/${m.user_id}`, { method: 'PUT', body: JSON.stringify({ password: p }) });
  console.log(`${m.name}: ${p}`);
} else {
  for (const m of members) {
    if (m.user_id) { console.log(`${m.name}: účet už existuje (nový PIN: reset ${m.slug})`); continue; }
    const p = pin();
    const user = await api('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: `${m.slug}@${EMAIL_DOMAIN}`, password: p, email_confirm: true }),
    });
    await api(`/rest/v1/members?id=eq.${m.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: user.id }),
    });
    console.log(`${m.name}: ${p}`);
  }
}
