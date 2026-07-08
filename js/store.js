// ============================================================
// Meesho LOD — Data layer (localStorage)
// Backend intentionally ignored for now: everything persists in
// the browser under mlod_* keys, with JSON export/import so a
// real backend can be dropped in later without touching pages.
// ============================================================

const K = {
  users: 'mlod_users',
  teams: 'mlod_teams',
  lods: 'mlod_lods',
  calls: 'mlod_calls',
  session: 'mlod_session',
  settings: 'mlod_settings',
  seeded: 'mlod_seeded',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function write(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

export function uid(prefix = 'x') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- Settings (AI config overrides etc.) ----------
export function getSettings() { return read(K.settings, {}); }
export function saveSettings(patch) {
  const s = { ...getSettings(), ...patch };
  write(K.settings, s);
  return s;
}

// ---------- Session ----------
export function getSession() { return read(K.session, null); }
export function setSession(userId) { write(K.session, { userId, ts: Date.now() }); }
export function clearSession() { localStorage.removeItem(K.session); }

// ---------- Users ----------
export function getUsers() { return read(K.users, []); }
export function getUser(id) { return getUsers().find(u => u.id === id) || null; }
export function saveUser(user) {
  const users = getUsers();
  const i = users.findIndex(u => u.id === user.id);
  if (i >= 0) users[i] = { ...users[i], ...user };
  else users.push({ id: uid('u'), createdAt: Date.now(), ...user });
  write(K.users, users);
  return i >= 0 ? users[i] : users[users.length - 1];
}
export function deleteUser(id) { write(K.users, getUsers().filter(u => u.id !== id)); }

// ---------- Teams ----------
export function getTeams() { return read(K.teams, []); }
export function getTeam(id) { return getTeams().find(t => t.id === id) || null; }
export function saveTeam(team) {
  const teams = getTeams();
  const i = teams.findIndex(t => t.id === team.id);
  if (i >= 0) teams[i] = { ...teams[i], ...team };
  else teams.push({ id: uid('t'), createdAt: Date.now(), ...team });
  write(K.teams, teams);
  return i >= 0 ? teams[i] : teams[teams.length - 1];
}
export function deleteTeam(id) { write(K.teams, getTeams().filter(t => t.id !== id)); }

// ---------- LODs ----------
// lod: { id, name, teamId, goal, status, questions:[{id,text,type}],
//        columns:[{key,label}], contacts:[{id,name,phone,phones,ext_id,data,status,attempts}],
//        createdBy, createdAt }
export function getLods() { return read(K.lods, []); }
export function getLod(id) { return getLods().find(l => l.id === id) || null; }
export function saveLod(lod) {
  const lods = getLods();
  const i = lods.findIndex(l => l.id === lod.id);
  if (i >= 0) lods[i] = { ...lods[i], ...lod };
  else lods.push({ id: uid('lod'), createdAt: Date.now(), status: 'active', questions: [], columns: [], contacts: [], ...lod });
  write(K.lods, lods);
  return i >= 0 ? lods[i] : lods[lods.length - 1];
}
export function deleteLod(id) {
  write(K.lods, getLods().filter(l => l.id !== id));
  write(K.calls, getCalls().filter(c => c.lodId !== id));
}

export function addContacts(lodId, rows) {
  const lod = getLod(lodId);
  if (!lod) return { added: 0, duplicates: 0 };
  const existing = new Set(lod.contacts.map(c => c.phone));
  let added = 0, duplicates = 0;
  for (const r of rows) {
    if (existing.has(r.phone)) { duplicates++; continue; }
    existing.add(r.phone);
    lod.contacts.push({
      id: uid('c'), status: 'pending', attempts: 0,
      name: r.name || '', phone: r.phone, phones: r.phones || [r.phone],
      ext_id: r.ext_id || '', data: r.data || {},
    });
    added++;
  }
  saveLod(lod);
  return { added, duplicates };
}

// Queue pop: next pending contact (skipped ones sink to the back)
export function nextContact(lodId) {
  const lod = getLod(lodId);
  if (!lod) return null;
  return lod.contacts.find(c => c.status === 'pending')
      || lod.contacts.find(c => c.status === 'skipped')
      || null;
}

export function updateContact(lodId, contactId, patch) {
  const lod = getLod(lodId);
  if (!lod) return;
  const c = lod.contacts.find(x => x.id === contactId);
  if (!c) return;
  Object.assign(c, patch);
  saveLod(lod);
}

export function lodProgress(lod) {
  const total = lod.contacts.length;
  const done = lod.contacts.filter(c => c.status === 'done').length;
  const skipped = lod.contacts.filter(c => c.status === 'skipped').length;
  return { total, done, skipped, pending: total - done - skipped, pct: total ? Math.round(done / total * 100) : 0 };
}

// ---------- Calls ----------
// call: { id, lodId, contactId, callerId, disposition, connected, notes,
//         answers:{}, summary, tags:[], durationSec, ts }
export function getCalls(filter = {}) {
  let calls = read(K.calls, []);
  if (filter.lodId) calls = calls.filter(c => c.lodId === filter.lodId);
  if (filter.callerId) calls = calls.filter(c => c.callerId === filter.callerId);
  if (filter.contactId) calls = calls.filter(c => c.contactId === filter.contactId);
  return calls;
}
export function saveCall(call) {
  const calls = read(K.calls, []);
  const rec = { id: uid('call'), ts: Date.now(), ...call };
  calls.push(rec);
  write(K.calls, calls);
  return rec;
}

// ---------- Active call persistence (tel: links can reload the page) ----------
export function saveActiveCall(userId, state) {
  localStorage.setItem(`mlod_active_${userId}`, JSON.stringify({ ...state, ts: Date.now() }));
}
export function loadActiveCall(userId) {
  try {
    const raw = localStorage.getItem(`mlod_active_${userId}`);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Date.now() - (s.ts || 0) > 20 * 3600 * 1000) { clearActiveCall(userId); return null; } // 20h TTL
    return s;
  } catch { return null; }
}
export function clearActiveCall(userId) { localStorage.removeItem(`mlod_active_${userId}`); }

// ---------- Export / import ----------
export function exportAll() {
  return JSON.stringify({
    version: 1, exportedAt: new Date().toISOString(),
    users: getUsers(), teams: getTeams(), lods: getLods(), calls: getCalls(), settings: getSettings(),
  }, null, 2);
}
export function importAll(json) {
  const d = JSON.parse(json);
  if (d.users) write(K.users, d.users);
  if (d.teams) write(K.teams, d.teams);
  if (d.lods) write(K.lods, d.lods);
  if (d.calls) write(K.calls, d.calls);
  if (d.settings) write(K.settings, d.settings);
}
export function resetAll() {
  for (const key of Object.values(K)) localStorage.removeItem(key);
}

// ---------- Demo seed (Grocery High-TPC example from the real sheet) ----------
export function seedIfEmpty() {
  if (read(K.seeded, false)) return;
  if (getTeams().length || getLods().length) { write(K.seeded, true); return; }

  const grocery = saveTeam({ name: 'Grocery — Category', desc: 'Meesho Grocery category team' });
  saveTeam({ name: 'HR', desc: 'People team — employee pulse calls' });
  saveTeam({ name: 'Seller Ops', desc: 'Seller-side calling' });

  const demo = saveLod({
    name: 'High-TPC non-transactors — Nagpur',
    teamId: grocery.id,
    goal: 'Understand why repeat grocery users have never transacted in High TPC categories (Biscuits, Namkeen, Noodles, Soft Drinks) despite browsing them — surface pricing, brand, pack-size and adoption blockers.',
    questions: [
      { id: uid('q'), type: 'core', text: 'Why have you never bought Biscuits / Namkeen from Meesho even though you order groceries here?' },
      { id: uid('q'), type: 'core', text: 'Where do you currently buy these items — local shop, monthly grocery run, or another app?' },
      { id: uid('q'), type: 'probe', text: 'Is there a specific brand you insist on (e.g. Britannia, Parle)? Would you try a cheaper local brand?' },
      { id: uid('q'), type: 'probe', text: 'Do pack sizes matter — do you prefer small packs over the large packs we list?' },
      { id: uid('q'), type: 'probe', text: 'You added an item to cart but did not order — what stopped you? (price, rating, delivery time?)' },
      { id: uid('q'), type: 'probe', text: 'How do ratings and reviews affect your decision? Is there a rating below which you never buy?' },
    ],
    columns: [
      { key: 'od_flag', label: 'OD flag' },
      { key: 'last_order_date', label: 'Last order' },
      { key: 'days_since_last_order', label: 'Days since order' },
      { key: 'last_pdp_l1', label: 'Last PDP category' },
      { key: 'last_atc_l1', label: 'Last ATC category' },
      { key: 'last_search_l1', label: 'Last search category' },
    ],
    contacts: [
      { id: uid('c'), status: 'pending', attempts: 0, name: 'Raju Sarkar', phone: '8459661845', phones: ['8459661845'], ext_id: '38946897', data: { od_flag: '4od', last_order_date: '2026-06-13', days_since_last_order: '3', last_pdp_l1: 'Noodles & Pasta', last_atc_l1: 'Rice Products', last_search_l1: 'Noodles & Pasta' } },
      { id: uid('c'), status: 'pending', attempts: 0, name: 'Vanita Kukwas', phone: '8208768671', phones: ['8208768671'], ext_id: '389664209', data: { od_flag: '4od', last_order_date: '2026-06-10', days_since_last_order: '6', last_pdp_l1: 'Rice Products', last_atc_l1: 'Rice Products', last_search_l1: 'Rice Products' } },
      { id: uid('c'), status: 'pending', attempts: 0, name: 'Aparna Dongre', phone: '9284196946', phones: ['9284196946'], ext_id: '10825469', data: { od_flag: '5od_and_plus', last_order_date: '2026-06-09', days_since_last_order: '7', last_pdp_l1: 'Rice Products', last_atc_l1: 'Rice Products', last_search_l1: 'Rice Products' } },
      { id: uid('c'), status: 'pending', attempts: 0, name: 'Anjali Tabhane', phone: '9209052554', phones: ['9209052554'], ext_id: '189376458', data: { od_flag: '5od_and_plus', last_order_date: '2026-06-12', days_since_last_order: '4', last_pdp_l1: 'Rice Products', last_atc_l1: 'Chips, Namkeen & Snacks', last_search_l1: 'Biscuits & Cookies' } },
      { id: uid('c'), status: 'pending', attempts: 0, name: 'Mona Ramteke', phone: '7038605789', phones: ['7038605789'], ext_id: '165688574', data: { od_flag: '4od', last_order_date: '2026-06-07', days_since_last_order: '9', last_pdp_l1: 'Biscuits & Cookies', last_atc_l1: 'Biscuits & Cookies', last_search_l1: 'Biscuits & Cookies' } },
      { id: uid('c'), status: 'pending', attempts: 0, name: '', phone: '9158129775', phones: ['9158129775', '8237867628'], ext_id: '537925321', data: { od_flag: '5od_and_plus', last_order_date: '2026-06-13', days_since_last_order: '3', last_pdp_l1: 'Noodles & Pasta', last_atc_l1: 'Chocolates & Sweets', last_search_l1: 'Noodles & Pasta' } },
      { id: uid('c'), status: 'pending', attempts: 0, name: 'Ritesh Bhure', phone: '9579158126', phones: ['9579158126'], ext_id: '250502929', data: { od_flag: '4od', last_order_date: '2026-05-28', days_since_last_order: '19', last_pdp_l1: 'Biscuits & Cookies', last_atc_l1: 'Biscuits & Cookies', last_search_l1: 'Biscuits & Cookies' } },
      { id: uid('c'), status: 'pending', attempts: 0, name: 'Deepak Dhale', phone: '9637672157', phones: ['9637672157'], ext_id: '76016272', data: { od_flag: '5od_and_plus', last_order_date: '2026-06-10', days_since_last_order: '6', last_pdp_l1: 'Biscuits & Cookies', last_atc_l1: 'Biscuits & Cookies', last_search_l1: 'Biscuits & Cookies' } },
    ],
    createdBy: 'seed',
  });

  // one worked example call so Results isn't empty
  const c0 = demo.contacts[0];
  saveCall({
    lodId: demo.id, contactId: c0.id, callerId: 'seed', disposition: 'connected', connected: true,
    notes: 'Biscuit: Uses Britannia Nutrichoice only. Was available with us earlier but never purchased because she gets it during monthly grocery purchase. Aware we sell Nutrichoice. Poha part of monthly purchase, not aware of our pricing. Does not consume noodles or soft drinks.',
    answers: {},
    summary: 'Monthly-grocery habit crowds out category: buys Nutrichoice + poha in one monthly run; aware of Meesho availability but no trigger to switch. No noodles/soft-drinks consumption.',
    tags: ['Monthly purchase habit', 'Brand loyal', 'Awareness OK'],
    durationSec: 312,
  });
  updateContact(demo.id, c0.id, { status: 'done', attempts: 1 });
  write(K.seeded, true);
}
