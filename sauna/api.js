import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, EMAIL_DOMAIN } from './config.js';

export const configured = !SUPABASE_URL.includes('YOUR-');
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const ok = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

export const api = {
  loginMembers: () => sb.from('members').select('id,slug,name,sort').order('sort').then(ok),

  async signIn(slug, pin) {
    const { error } = await sb.auth.signInWithPassword({ email: `${slug}@${EMAIL_DOMAIN}`, password: pin });
    if (error) throw new Error(error.status === 400 ? 'Špatný PIN' : error.message);
  },
  signOut: () => sb.auth.signOut(),
  async userId() {
    const { data } = await sb.auth.getSession();
    return data.session?.user.id ?? null;
  },
  onAuth(cb) {
    sb.auth.onAuthStateChange((_event, session) => cb(session?.user.id ?? null));
  },

  async base() {
    const [members, seasons, settings] = await Promise.all([
      sb.from('members').select('*').order('sort').order('name').then(ok),
      sb.from('seasons').select('*').order('starts_on', { ascending: false }).then(ok),
      sb.from('settings').select('*').eq('id', 1).single().then(ok),
    ]);
    return { members, seasons, settings };
  },

  async season(id) {
    const inSeason = (table, cols) =>
      sb.from(table).select(`${cols},sessions!inner(season_id)`).eq('sessions.season_id', id).then(ok);
    const [sessions, attendance, payments, rituals, votes, fires, absences] = await Promise.all([
      sb.from('sessions').select('id,date').eq('season_id', id).order('date').then(ok),
      inSeason('attendance', 'session_id,member_id,charged_to'),
      sb.from('payments').select('*').eq('season_id', id).order('paid_on').then(ok),
      inSeason('rituals', 'session_id,host_id,kind,passed'),
      inSeason('ritual_votes', 'session_id,member_id,kind'),
      inSeason('ritual_fires', 'session_id,member_id'),
      inSeason('absences', 'session_id,member_id'),
    ]);
    return { sessions, attendance, payments, rituals, votes, fires, absences };
  },

  toggle: (date, memberId) => sb.rpc('toggle_attendance', { p_date: date, p_member: memberId }).then(ok),
  toggleAbsence: (date, memberId) => sb.rpc('toggle_absence', { p_date: date, p_member: memberId }).then(ok),
  addGuest: (date, name, chargedTo) =>
    sb.rpc('add_guest', { p_date: date, p_name: name, p_charged_to: chargedTo || null }).then(ok),
  drawRitual: (date) => sb.rpc('draw_ritual', { p_date: date }).then(ok),
  passRitual: (date) => sb.rpc('pass_ritual', { p_date: date }).then(ok),
  setRitualKind: (date, kind) => sb.rpc('set_ritual_kind', { p_date: date, p_kind: kind }).then(ok),
  voteRitual: (date, kind) => sb.rpc('vote_ritual', { p_date: date, p_kind: kind }).then(ok),
  fireRitual: (date) => sb.rpc('fire_ritual', { p_date: date }).then(ok),
  resetRitual: (sessionId) => sb.from('rituals').delete().eq('session_id', sessionId).then(ok),
  addPayment: (payment) => sb.from('payments').insert(payment).then(ok),
  deletePayment: (id) => sb.from('payments').delete().eq('id', id).then(ok),
  saveSettings: (settings) => sb.from('settings').update(settings).eq('id', 1).then(ok),
  saveSeason: ({ id, ...season }) =>
    (id ? sb.from('seasons').update(season).eq('id', id) : sb.from('seasons').insert(season)).then(ok),
};
