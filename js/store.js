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
  const hr = saveTeam({ name: 'HR', desc: 'People team — employee pulse calls' });
  const seller = saveTeam({ name: 'Seller Ops', desc: 'Seller-side calling' });

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

  // a couple more grocery calls so Results/Projects look worked-in
  const gc1 = demo.contacts[1], gc2 = demo.contacts[4];
  saveCall({ lodId: demo.id, contactId: gc1.id, callerId: 'seed', disposition: 'connected', connected: true,
    notes: 'Buys cream biscuits from the local shop in small packs whenever her kid asks. Searched Poha, added to cart, did not order because rating looked low.',
    answers: {}, summary: 'Small-pack + impulse buying at local shop; abandoned Poha over low rating. Pack size and ratings are the blockers.',
    tags: ['Small pack requirement', 'Rating sensitive'], durationSec: 208 });
  updateContact(demo.id, gc1.id, { status: 'done', attempts: 1 });
  saveCall({ lodId: demo.id, contactId: gc2.id, callerId: 'seed', disposition: 'connected', connected: true,
    notes: 'Uses Mariegold biscuits. Says biscuits are cheaper on another app so never buys from here. No noodles/soft drinks at home.',
    answers: {}, summary: 'Pure pricing gap on biscuits vs a competing app; no demand for noodles/soft drinks.',
    tags: ['Pricing', 'Competition'], durationSec: 151 });
  updateContact(demo.id, gc2.id, { status: 'done', attempts: 1 });

  // ---------- Use-case 2: HR employee pulse (themed questions) ----------
  const hrLod = saveLod({
    name: 'Warehouse attrition pulse — Bhiwandi',
    teamId: hr.id,
    goal: 'Understand why fulfilment-centre associates are resigning within 90 days — pay, shift load, manager relationship, growth, and whether a counter-offer would retain them.',
    questions: [
      { id: uid('q'), type: 'core', theme: 'Reason for leaving', text: 'What is the main reason you decided to leave?' },
      { id: uid('q'), type: 'probe', theme: 'Reason for leaving', text: 'Was it one big thing or several small ones adding up?' },
      { id: uid('q'), type: 'probe', theme: 'Reason for leaving', text: 'When did you first start thinking about leaving?' },
      { id: uid('q'), type: 'core', theme: 'Pay & shifts', text: 'Was the pay and shift schedule what you expected when you joined?' },
      { id: uid('q'), type: 'probe', theme: 'Pay & shifts', text: 'How many hours were you actually doing versus what was promised?' },
      { id: uid('q'), type: 'probe', theme: 'Pay & shifts', text: 'Did overtime get paid correctly and on time?' },
      { id: uid('q'), type: 'core', theme: 'Manager & team', text: 'How was your relationship with your supervisor?' },
      { id: uid('q'), type: 'probe', theme: 'Manager & team', text: 'Did you feel comfortable raising problems with them?' },
      { id: uid('q'), type: 'core', theme: 'Retention', text: 'Is there anything we could have done to make you stay?' },
      { id: uid('q'), type: 'probe', theme: 'Retention', text: 'If we fixed that, would you consider coming back?' },
    ],
    columns: [
      { key: 'tenure_days', label: 'Tenure (days)' }, { key: 'shift', label: 'Shift' },
      { key: 'center', label: 'FC' }, { key: 'last_working_day', label: 'LWD' },
    ],
    contacts: [
      { id: uid('c'), status: 'pending', attempts: 0, name: 'Suresh Yadav', phone: '9823011223', phones: ['9823011223'], ext_id: 'EMP20481', data: { tenure_days: '54', shift: 'Night', center: 'Bhiwandi-2', last_working_day: '2026-06-30' } },
      { id: uid('c'), status: 'pending', attempts: 0, name: 'Pooja Nikam', phone: '9765443210', phones: ['9765443210'], ext_id: 'EMP20512', data: { tenure_days: '71', shift: 'Day', center: 'Bhiwandi-1', last_working_day: '2026-07-02' } },
      { id: uid('c'), status: 'pending', attempts: 0, name: 'Imran Shaikh', phone: '9004567781', phones: ['9004567781'], ext_id: 'EMP20533', data: { tenure_days: '38', shift: 'Night', center: 'Bhiwandi-2', last_working_day: '2026-07-05' } },
      { id: uid('c'), status: 'pending', attempts: 0, name: 'Rekha More', phone: '9922113344', phones: ['9922113344'], ext_id: 'EMP20560', data: { tenure_days: '83', shift: 'Day', center: 'Bhiwandi-1', last_working_day: '2026-07-06' } },
    ],
    createdBy: 'seed',
  });

  // HR calls
  const hc = hrLod.contacts;
  saveCall({ lodId: hrLod.id, contactId: hc[0].id, callerId: 'seed', disposition: 'connected', connected: true,
    notes: 'Night shifts were 12 hours instead of the 9 promised, and overtime pay was delayed by weeks. Supervisor was okay but he could not raise issues comfortably. Would have stayed if shifts were fixed at 9h.',
    answers: {}, summary: 'Shift-length mismatch (12h vs 9h) + delayed OT pay drove exit; retainable if shifts fixed. Manager approachability weak.',
    tags: ['Shift load', 'Overtime pay', 'Retainable'], durationSec: 286 });
  updateContact(hrLod.id, hc[0].id, { status: 'done', attempts: 1 });
  saveCall({ lodId: hrLod.id, contactId: hc[1].id, callerId: 'seed', disposition: 'connected', connected: true,
    notes: 'Left for a job closer to home — commute was 1.5 hours each way. Pay and shifts were fine, no complaints about the team.',
    answers: {}, summary: 'Commute distance (3h round trip) was the sole driver; comp and management were fine. Not a pay/manager problem.',
    tags: ['Commute', 'Not pay-related'], durationSec: 188 });
  updateContact(hrLod.id, hc[1].id, { status: 'done', attempts: 1 });
  saveCall({ lodId: hrLod.id, contactId: hc[2].id, callerId: 'seed', disposition: 'rnr', connected: false,
    notes: 'No answer — will retry.', answers: {}, summary: '', tags: [], durationSec: 0 });
  updateContact(hrLod.id, hc[2].id, { status: 'pending', attempts: 1 });
  saveCall({ lodId: hrLod.id, contactId: hc[3].id, callerId: 'seed', disposition: 'connected', connected: true,
    notes: 'Felt disrespected by the shift supervisor; repeated conflict. Said a counter-offer would not have changed her mind.',
    answers: {}, summary: 'Manager relationship breakdown; not retainable by pay. Signals a supervisor-behaviour issue at this FC.',
    tags: ['Manager relationship', 'Not retainable'], durationSec: 242 });
  updateContact(hrLod.id, hc[3].id, { status: 'done', attempts: 1 });

  // ---------- Use-case 3: Seller ops reactivation (themed questions) ----------
  const sellerLod = saveLod({
    name: 'Dropped-off sellers — reactivation',
    teamId: seller.id,
    goal: 'Find out why previously active sellers stopped listing/dispatching in the last 30 days — inventory, returns/RTO pain, payment cycle, pricing pressure, or competition — and what would bring them back.',
    questions: [
      { id: uid('q'), type: 'core', theme: 'Why they stopped', text: 'We noticed you paused selling recently — what happened?' },
      { id: uid('q'), type: 'probe', theme: 'Why they stopped', text: 'Was it a business reason or an issue with the platform?' },
      { id: uid('q'), type: 'core', theme: 'Returns & RTO', text: 'How big a problem were returns and RTO for you?' },
      { id: uid('q'), type: 'probe', theme: 'Returns & RTO', text: 'Roughly what percent of orders were coming back?' },
      { id: uid('q'), type: 'probe', theme: 'Returns & RTO', text: 'Did return-related deductions feel fair to you?' },
      { id: uid('q'), type: 'core', theme: 'Payments', text: 'Were payment timelines working for your cash flow?' },
      { id: uid('q'), type: 'probe', theme: 'Payments', text: 'How many days was the settlement actually taking?' },
      { id: uid('q'), type: 'core', theme: 'Competition', text: 'Are you selling more on another platform now? Which one and why?' },
      { id: uid('q'), type: 'core', theme: 'Comeback', text: 'What one change would make you start dispatching with us again?' },
    ],
    columns: [
      { key: 'gmv_last_month', label: 'GMV last month' }, { key: 'rto_pct', label: 'RTO %' },
      { key: 'category', label: 'Category' }, { key: 'days_inactive', label: 'Days inactive' },
    ],
    contacts: [
      { id: uid('c'), status: 'pending', attempts: 0, name: 'Sunrise Textiles', phone: '9811002200', phones: ['9811002200'], ext_id: 'SLR88213', data: { gmv_last_month: '0', rto_pct: '34%', category: 'Sarees', days_inactive: '41' } },
      { id: uid('c'), status: 'pending', attempts: 0, name: 'Verma Handloom', phone: '9871223344', phones: ['9871223344'], ext_id: 'SLR88240', data: { gmv_last_month: '0', rto_pct: '28%', category: 'Kurtis', days_inactive: '33' } },
      { id: uid('c'), status: 'pending', attempts: 0, name: 'KrishnaTraders', phone: '9333445566', phones: ['9333445566'], ext_id: 'SLR88301', data: { gmv_last_month: '0', rto_pct: '19%', category: 'Home Furnishing', days_inactive: '52' } },
    ],
    createdBy: 'seed',
  });

  // Seller calls
  const sc = sellerLod.contacts;
  saveCall({ lodId: sellerLod.id, contactId: sc[0].id, callerId: 'seed', disposition: 'connected', connected: true,
    notes: 'RTO around 34% wiped out margins and the return deductions felt unfair. Shifted most listings to another platform. Would come back if RTO protection improved.',
    answers: {}, summary: 'High RTO (34%) + perceived-unfair deductions pushed them to a competitor; reactivation hinges on RTO protection.',
    tags: ['RTO pain', 'Deductions', 'Competition'], durationSec: 324 });
  updateContact(sellerLod.id, sc[0].id, { status: 'done', attempts: 1 });
  saveCall({ lodId: sellerLod.id, contactId: sc[1].id, callerId: 'seed', disposition: 'connected', connected: true,
    notes: 'Settlement was taking ~15 days which hurt cash flow, and pricing pressure squeezed margins. Would dispatch again with a faster payment cycle.',
    answers: {}, summary: 'Slow ~15-day settlement + pricing pressure; retainable with faster payouts. Cash-flow, not demand, is the blocker.',
    tags: ['Payment cycle', 'Pricing'], durationSec: 261 });
  updateContact(sellerLod.id, sc[1].id, { status: 'done', attempts: 1 });
  saveCall({ lodId: sellerLod.id, contactId: sc[2].id, callerId: 'seed', disposition: 'busy', connected: false,
    notes: 'Line busy — retry later.', answers: {}, summary: '', tags: [], durationSec: 0 });
  updateContact(sellerLod.id, sc[2].id, { status: 'pending', attempts: 1 });

  write(K.seeded, true);
}
