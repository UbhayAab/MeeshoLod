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
  if (filter.mode) calls = calls.filter(c => (c.mode || 'online') === filter.mode);
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

// ---------- Ensure a demo admin user (auto-login so deep links work) ----------
export function ensureDemoUser() {
  const existing = getUsers().find(u => u.name === 'Ubhay');
  if (existing) return existing;
  const teams = getTeams();
  const teamId = teams[0]?.id || saveTeam({ name: 'Meesho', desc: 'Default team' }).id;
  return saveUser({ name: 'Ubhay', role: 'admin', teamId });
}

// ============================================================
// HUGE hardcoded demo DB — many teams, many use cases, online +
// offline (field) LODs, ~130 contacts, ~70 calls/sessions. This is
// deliberately generated so both /u/ (online) and /s/ (field)
// surfaces look fully worked-in. Replace with a real backend later
// (see js/store.js data-layer contract).
// ============================================================
export function seedIfEmpty() {
  if (read(K.seeded, false)) return;
  if (getTeams().length || getLods().length) { write(K.seeded, true); return; }

  const DAY = 86400000;
  const NOW = Date.now();

  // deterministic name / phone / id generators (no Math.random → stable seed)
  const FIRST = ['Raju','Vanita','Aparna','Anjali','Mona','Ritesh','Deepak','Reet','Bindu','Vandana','Suresh','Pooja','Imran','Rekha','Sunita','Amit','Kiran','Neha','Farhan','Divya','Manish','Sana','Rohit','Geeta','Arjun','Meera','Sahil','Priya','Vikram','Lata','Nikhil','Asha','Tarun','Kavya','Yusuf','Shreya','Gaurav','Nisha','Zoya','Dev','Pallavi','Irfan','Sneha','Ramesh','Fatima','Ganesh','Ayesha','Bhavesh'];
  const LAST = ['Sarkar','Kukwas','Dongre','Tabhane','Ramteke','Bhure','Dhale','Kandhari','Gupta','Pande','Yadav','Nikam','Shaikh','More','Verma','Joshi','Rao','Iyer','Khan','Menon','Patil','Das','Reddy','Nair','Sharma','Bose','Mehta','Kaur','Singh','Pillai'];
  const SHOPS = ['Sunrise Textiles','Verma Handloom','Krishna Traders','Balaji Sarees','New Fashion Hub','Gupta Garments','Maa Kirana','Sri Venkatesh Stores','Apna Bazaar','Royal Collection','Devi Enterprises','Anand General Store'];
  let ni = 0, si = 0, phoneN = 0, extN = 30000000;
  const nextName = () => { const n = `${FIRST[ni % FIRST.length]} ${LAST[(ni * 3) % LAST.length]}`; ni++; return n; };
  const nextShop = () => { const s = SHOPS[si % SHOPS.length]; si++; return s; };
  const nextPhone = () => { const base = 9100000000 + (phoneN * 813457 % 899999999); phoneN++; return String(base); };
  const nextExt = () => String(extN++);

  const themed = (rows) => rows.flatMap(([theme, core, ...probes]) => [
    { id: uid('q'), type: 'core', theme, text: core },
    ...probes.map(p => ({ id: uid('q'), type: 'probe', theme, text: p })),
  ]);

  const mkContacts = (n, opts = {}) => Array.from({ length: n }, (_, i) => ({
    id: uid('c'), status: 'pending', attempts: 0,
    name: opts.shops ? nextShop() : nextName(),
    phone: nextPhone(), phones: [], ext_id: nextExt(),
    data: opts.data ? opts.data(i) : {},
  })).map(c => { c.phones = [c.phone]; return c; });

  // ---------- teams ----------
  const T = {};
  [
    ['grocery', 'Grocery — Category'],
    ['fashion', 'Fashion — Category'],
    ['hr', 'People / HR'],
    ['seller', 'Seller Ops'],
    ['logistics', 'Delivery / Logistics'],
    ['support', 'Customer Support'],
    ['wellness', 'Pharmacy & Wellness'],
    ['electronics', 'Electronics — Category'],
  ].forEach(([k, name]) => { T[k] = saveTeam({ name, desc: name + ' team' }).id; });

  // ---------- LOD blueprints (mode: online = phone; offline = field) ----------
  const BP = [
    {
      team: 'grocery', mode: 'online', contacts: 16,
      name: 'High-TPC non-transactors — Nagpur',
      goal: 'Understand why repeat grocery users have never transacted in High TPC categories (Biscuits, Namkeen, Noodles, Soft Drinks) despite browsing them — surface pricing, brand, pack-size and adoption blockers.',
      cols: [['od_flag','OD flag'],['days_since_last_order','Days since order'],['last_pdp_l1','Last PDP category']],
      data: (i) => ({ od_flag: ['4od','5od_and_plus'][i%2], days_since_last_order: String(3 + (i*2)%20), last_pdp_l1: ['Biscuits & Cookies','Rice Products','Noodles & Pasta','Chips, Namkeen & Snacks'][i%4] }),
      tags: ['Pricing','Small pack requirement','Brand loyal','Rating sensitive','Monthly purchase habit','Competition','Awareness OK','Adoption'],
      summaries: [
        'Monthly-grocery habit crowds out category; aware of Meesho availability but no trigger to switch.',
        'Buys biscuits in small packs at the local shop for the kids; our packs feel too big.',
        'Uses Mariegold; says biscuits are cheaper on another app so never buys here.',
        'Abandoned Poha in cart over a low rating — will not buy below ~3.5 stars.',
        'Brand-loyal to Britannia; would try a cheaper local brand only if reviews are strong.',
      ],
    },
    {
      team: 'grocery', mode: 'online', contacts: 12,
      name: 'FnV refund-unactivated — Pune',
      goal: 'Understand why refund-affected users have not activated on Fruits & Vegetables — payment doubt, pricing vs local mandi, and delivery freshness/speed.',
      cols: [['user_type','User type'],['refund_flag','Refund flag'],['last_atc_product','Last ATC']],
      data: (i) => ({ user_type: ['new user','mature user'][i%2], refund_flag: 'refund_unactivated', last_atc_product: ['Potato 1kg','Onion 1kg','Pomegranate 4pc','Banana 1dz'][i%4] }),
      tags: ['Prepaid payment issue','Price vs mandi','Freshness','Delivery speed','Needs help ordering'],
      summaries: [
        'Prepaid payment failed once; now hesitant. Would order via daughter-in-law who handles online payments.',
        'Potato/onion cheaper at the local mandi; rest of FnV felt reasonably priced.',
        'Wants same-day delivery for vegetables; 2-day wait is a dealbreaker for freshness.',
      ],
    },
    {
      team: 'fashion', mode: 'online', contacts: 14,
      name: 'Saree returns — repeat returners',
      goal: 'Find out why a segment of saree buyers returns >40% of orders — size/fit, colour mismatch, fabric expectation, or try-and-return behaviour — and what reduces it.',
      cols: [['return_rate','Return rate'],['orders_90d','Orders 90d'],['top_l2','Top sub-cat']],
      data: (i) => ({ return_rate: `${35 + (i*3)%30}%`, orders_90d: String(4 + i%9), top_l2: ['Silk Sarees','Cotton Sarees','Georgette','Banarasi'][i%4] }),
      tags: ['Colour mismatch','Fabric expectation','Size/fit','Photo vs actual','Delivery damage'],
      summaries: [
        'Colour on delivery looked different from the app photos — main reason for returns.',
        'Expected pure silk from the images; received blended fabric.',
        'Orders 2-3 to compare at home and returns the rest — habitual try-and-return.',
      ],
    },
    {
      team: 'hr', mode: 'online', contacts: 10,
      name: 'Warehouse attrition pulse — Bhiwandi',
      goal: 'Understand why fulfilment-centre associates are resigning within 90 days — pay, shift load, manager relationship, growth, and whether a counter-offer would retain them.',
      cols: [['tenure_days','Tenure (days)'],['shift','Shift'],['center','FC']],
      data: (i) => ({ tenure_days: String(30 + (i*7)%70), shift: ['Day','Night'][i%2], center: ['Bhiwandi-1','Bhiwandi-2'][i%2] }),
      tags: ['Shift load','Overtime pay','Manager relationship','Commute','Retainable','Not retainable'],
      summaries: [
        'Night shifts ran 12h vs the 9h promised and OT pay was delayed; retainable if shifts are fixed.',
        'Left for a job closer to home — 3h round-trip commute; pay and team were fine.',
        'Felt disrespected by the shift supervisor; a counter-offer would not have helped.',
      ],
    },
    {
      team: 'seller', mode: 'online', contacts: 12, shops: true,
      name: 'Dropped-off sellers — reactivation',
      goal: 'Find out why previously active sellers stopped listing/dispatching in the last 30 days — inventory, returns/RTO pain, payment cycle, pricing pressure, or competition — and what brings them back.',
      cols: [['gmv_last_month','GMV last month'],['rto_pct','RTO %'],['days_inactive','Days inactive']],
      data: (i) => ({ gmv_last_month: '0', rto_pct: `${18 + (i*4)%25}%`, days_inactive: String(31 + (i*5)%40) }),
      tags: ['RTO pain','Deductions','Payment cycle','Pricing','Competition','Inventory'],
      summaries: [
        'RTO ~34% wiped margins and deductions felt unfair; shifted listings to a competitor.',
        'Settlement took ~15 days which hurt cash flow; would return with faster payouts.',
        'Ran out of stock and never re-listed; needs a nudge + catalog help to restart.',
      ],
    },
    {
      team: 'support', mode: 'online', contacts: 12,
      name: 'Low-CSAT resolutions — win-back',
      goal: 'Call users who rated a support resolution 1-2 stars to understand what went wrong (wait time, repeated follow-ups, unresolved refund) and rebuild trust.',
      cols: [['csat','CSAT'],['issue_type','Issue'],['reopen_count','Reopens']],
      data: (i) => ({ csat: String(1 + i%2), issue_type: ['Refund delay','Wrong item','Return pickup','App bug'][i%4], reopen_count: String(1 + i%3) }),
      tags: ['Refund delay','Repeated follow-ups','Long wait','Resolved on call','Still unhappy'],
      summaries: [
        'Refund promised in 5 days took 3 weeks and 4 follow-ups; furious but calmer after callback.',
        'Return pickup was missed twice; wants a guaranteed slot.',
      ],
    },
    // ---------- OFFLINE / FIELD LODs (Sumit's surface) ----------
    {
      team: 'seller', mode: 'offline', contacts: 10, shops: true,
      name: 'Kirana on-ground visits — Indore',
      goal: 'Field visits to kirana + small sellers to understand real blockers to selling on Meesho — onboarding friction, catalog effort, trust, and cash-flow — recorded in person and auto-bucketed.',
      cols: [['area','Area'],['shop_type','Shop type'],['monthly_sales','Monthly sales']],
      data: (i) => ({ area: ['Rajwada','Vijay Nagar','Palasia','Sudama Nagar'][i%4], shop_type: ['Kirana','Apparel','Cosmetics','General'][i%4], monthly_sales: `₹${40 + (i*7)%120}k` }),
      tags: ['Onboarding friction','Catalog effort','Trust','Cash-flow','Wants training','Ready to list'],
    },
    {
      team: 'logistics', mode: 'offline', contacts: 10,
      name: 'Delivery partner ground interviews',
      goal: 'On-ground conversations with delivery partners about earnings clarity, app usability, payout timing, and safety — recorded at the hub and bucketed into fixable themes.',
      cols: [['hub','Hub'],['tenure_m','Tenure (mo)'],['daily_orders','Orders/day']],
      data: (i) => ({ hub: ['Andheri','Powai','Thane','Vashi'][i%4], tenure_m: String(1 + (i*3)%18), daily_orders: String(18 + (i*4)%25) }),
      tags: ['Payout timing','Earnings clarity','App usability','Safety','Long distances','Wants incentives'],
    },
    {
      team: 'grocery', mode: 'offline', contacts: 8,
      name: 'Store audit — dark store freshness',
      goal: 'Walk dark stores and talk to staff about FnV freshness, cold-chain gaps, wastage, and picking accuracy — recorded on the floor and bucketed for ops.',
      cols: [['store','Store'],['role','Role'],['shift','Shift']],
      data: (i) => ({ store: ['DS-Kandivali','DS-Chembur','DS-Kurla'][i%3], role: ['Picker','Store lead','QC'][i%3], shift: ['AM','PM'][i%2] }),
      tags: ['Cold-chain gap','Wastage','Picking accuracy','Staffing','Layout'],
    },
    {
      team: 'wellness', mode: 'offline', contacts: 8,
      name: 'Pharmacy partner field pulse',
      goal: 'In-person chats with pharmacy partners on prescription-upload friction, delivery SLAs, margin, and returns for medicines — recorded and bucketed.',
      cols: [['city','City'],['type','Type'],['orders_wk','Orders/wk']],
      data: (i) => ({ city: ['Nashik','Aurangabad','Solapur'][i%3], type: ['Standalone','Chain'][i%2], orders_wk: String(20 + (i*6)%60) }),
      tags: ['Rx upload friction','Delivery SLA','Margin','Returns','Cold storage'],
    },
    {
      team: 'electronics', mode: 'online', contacts: 10,
      name: 'Accessory browsers who never buy',
      goal: 'Understand why users who browse phone accessories (cases, chargers, earphones) never convert — price, trust in unbranded, warranty doubt, or delivery.',
      cols: [['views_30d','Views 30d'],['top_l2','Top sub-cat'],['cart','Cart adds']],
      data: (i) => ({ views_30d: String(10 + (i*5)%40), top_l2: ['Cases','Chargers','Earphones','Cables'][i%4], cart: String(i%4) }),
      tags: ['Warranty doubt','Unbranded trust','Pricing','Delivery time','Quality fear'],
    },
    {
      team: 'fashion', mode: 'online', contacts: 14,
      name: 'First-order-only buyers — no repeat',
      goal: 'Understand why one-time fashion buyers never placed a second order — sizing letdown, delivery time, price vs expectation, or simply forgot — and what triggers a repeat.',
      cols: [['first_order','First order'],['days_since','Days since'],['first_l2','Bought']],
      data: (i) => ({ first_order: '1', days_since: String(40 + (i*6)%120), first_l2: ['Kurti','Saree','Top','Dupatta'][i%4] }),
      tags: ['Sizing letdown','Forgot','Delivery time','Price expectation','One-off gift'],
      summaries: [
        'Kurti ran small vs the size chart; lost confidence to reorder.',
        'Bought once as a gift; not a personal-use category for them.',
        'Happy with product but simply forgot — a nudge/offer would bring them back.',
      ],
    },
    {
      team: 'wellness', mode: 'online', contacts: 12,
      name: 'Repeat-medicine lapsers',
      goal: 'Call chronic-care users who stopped reordering monthly medicines — price, moved to local chemist, doctor changed prescription, or delivery reliability.',
      cols: [['condition','Care type'],['last_refill','Last refill'],['months_lapsed','Months lapsed']],
      data: (i) => ({ condition: ['Diabetes','BP','Thyroid','Cardiac'][i%4], last_refill: '1', months_lapsed: String(1 + i%4) }),
      tags: ['Price','Local chemist','Prescription change','Delivery reliability','Reminder needed'],
      summaries: [
        'Switched to the neighbourhood chemist for convenience and instant availability.',
        'Doctor changed the prescription; our reorder no longer matched.',
        'Would continue if we sent a monthly refill reminder + small loyalty price.',
      ],
    },
    {
      team: 'logistics', mode: 'online', contacts: 12,
      name: 'High-RTO pincodes — buyer intent check',
      goal: 'Call buyers in high-RTO pincodes who refused COD delivery to understand why — changed mind, expected different product, address/timing issues, or prepaid distrust.',
      cols: [['pincode','Pincode'],['rto_reason','Marked reason'],['orders','Orders']],
      data: (i) => ({ pincode: ['452001','440010','431001','422002'][i%4], rto_reason: ['Not available','Changed mind','Wrong item feared','Address issue'][i%4], orders: String(1 + i%5) }),
      tags: ['Not available at delivery','Changed mind','Expectation gap','Address/timing','COD habit'],
      summaries: [
        'Was not home at delivery time; wants a delivery-slot choice.',
        'Got cold feet on quality since it was unbranded — prepaid felt risky.',
      ],
    },
    {
      team: 'support', mode: 'offline', contacts: 8,
      name: 'Return-pickup rider ride-alongs',
      goal: 'Ride along with return-pickup riders and record the on-ground friction — customer disputes at door, packaging checks, app steps, and time lost per pickup.',
      cols: [['zone','Zone'],['pickups_day','Pickups/day'],['tenure_m','Tenure (mo)']],
      data: (i) => ({ zone: ['North','South','East','West'][i%4], pickups_day: String(12 + (i*3)%20), tenure_m: String(2 + (i*4)%20) }),
      tags: ['Door disputes','Packaging check','App steps','Time lost','Safety'],
    },
    {
      team: 'fashion', mode: 'offline', contacts: 8, shops: true,
      name: 'Boutique supplier ground visits — Surat',
      goal: 'In-person visits to Surat textile suppliers on catalog quality, MOQ, dispatch SLA, and what stops them scaling on Meesho — recorded and bucketed.',
      cols: [['cluster','Cluster'],['category','Category'],['looms','Looms']],
      data: (i) => ({ cluster: ['Ring Road','Sahara Darwaja','Salabatpura'][i%3], category: ['Sarees','Dress material','Dupattas'][i%3], looms: String(4 + (i*3)%30) }),
      tags: ['Catalog quality','MOQ','Dispatch SLA','Working capital','Wants scale'],
    },
  ];

  const QUESTION_BANK = {
    'High-TPC non-transactors — Nagpur': [
      ['Current habit','Where do you usually buy biscuits and namkeen — local shop, monthly run, or another app?','What makes that option convenient for you?','How often do you restock these?'],
      ['Pricing','Do our prices for these feel higher, lower, or about the same as where you buy now?','Is there a price at which you would switch to us?'],
      ['Brand & pack','Is there a brand you insist on? Would you try a cheaper local brand?','Do our pack sizes suit you, or do you prefer smaller packs?'],
      ['Trust','You added an item but did not order — what stopped you?','Below what rating would you never buy a food item?'],
    ],
    'Warehouse attrition pulse — Bhiwandi': [
      ['Reason for leaving','What is the main reason you decided to leave?','Was it one big thing or several small ones adding up?'],
      ['Pay & shifts','Was the pay and shift schedule what you expected when you joined?','Did overtime get paid correctly and on time?'],
      ['Manager & team','How was your relationship with your supervisor?','Could you raise problems comfortably?'],
      ['Retention','Is there anything we could have done to keep you?','If we fixed that, would you consider coming back?'],
    ],
    'Dropped-off sellers — reactivation': [
      ['Why they stopped','We noticed you paused selling recently — what happened?','Business reason or a platform issue?'],
      ['Returns & RTO','How big a problem were returns and RTO?','Did return deductions feel fair?'],
      ['Payments','Were payout timelines working for your cash flow?','How many days was settlement taking?'],
      ['Comeback','What one change would make you start dispatching again?'],
    ],
  };
  const genericQ = (name, goal) => themed([
    ['Context', `Can you tell me a bit about your experience related to: ${goal.split('—')[0].trim().slice(0,60)}?`, 'What stood out most for you?'],
    ['Root cause', 'What is the single biggest reason behind that?', 'When did it start?', 'Has anything made it better or worse?'],
    ['Comparison', 'How does it compare to alternatives you use?', 'What do they do better?'],
    ['Fix', 'What one change would improve this for you the most?', 'Would that change your behaviour?'],
  ]);

  const OFFLINE_TRANSCRIPTS = [
    { transcript: 'Bhaiya main dukan subah 9 baje kholta hoon. Meesho pe listing ka time nahi milta, aur photo kheech ke daalna mushkil lagta hai. Agar koi aake catalog bana de toh main zaroor bechunga. Paisa time pe aaye toh trust banega.',
      buckets: [ { theme: 'Onboarding friction', points: ['No time to list during shop hours','Photography/cataloging feels hard'] }, { theme: 'Trust', points: ['Wants faster, reliable payouts to build trust'] }, { theme: 'Wants training', points: ['Would sell if someone helps build the catalog'] } ],
      summary: 'Willing to sell but blocked by cataloging effort and time; wants hands-on onboarding + reliable payouts.', tags: ['Onboarding friction','Catalog effort','Wants training'] },
    { transcript: 'Payout 10-12 din baad aata hai, usse ghar chalana mushkil hota hai. App me earning clear dikhni chahiye, kabhi kabhi incentive samajh nahi aata. Lambi distance ke order me petrol zyada lagta hai.',
      buckets: [ { theme: 'Payout timing', points: ['10-12 day payout strains household cash-flow'] }, { theme: 'Earnings clarity', points: ['Incentive structure unclear in-app'] }, { theme: 'Long distances', points: ['Fuel cost high on long-distance orders'] } ],
      summary: 'Cash-flow and clarity are the pain: slow payouts, opaque incentives, and costly long-distance orders.', tags: ['Payout timing','Earnings clarity','Long distances'] },
    { transcript: 'Freezer kabhi kabhi band ho jaata hai raat me, subah kuch stock kharab milta hai. Picking me galat item chala jaata hai jab rush hota hai. Staff kam hai peak time pe.',
      buckets: [ { theme: 'Cold-chain gap', points: ['Freezer trips at night → morning spoilage'] }, { theme: 'Picking accuracy', points: ['Wrong items picked during rush'] }, { theme: 'Staffing', points: ['Understaffed at peak hours'] } ],
      summary: 'Freshness risk from cold-chain trips + picking errors under peak load and thin staffing.', tags: ['Cold-chain gap','Picking accuracy','Staffing'] },
  ];

  const dispoCycle = ['connected','connected','connected','connected','rnr','busy','connected','call_back','connected','wrong_number'];

  BP.forEach((bp, bi) => {
    const questions = QUESTION_BANK[bp.name] ? themed(QUESTION_BANK[bp.name]) : genericQ(bp.name, bp.goal);
    const contacts = mkContacts(bp.contacts, { shops: bp.shops, data: bp.data });
    const lod = saveLod({
      name: bp.name, teamId: T[bp.team], goal: bp.goal, mode: bp.mode,
      questions,
      columns: (bp.cols || []).map(([key, label]) => ({ key, label })),
      contacts, createdBy: 'seed',
    });

    // seed calls / field sessions across ~55% of contacts
    const n = lod.contacts.length;
    const called = Math.max(2, Math.round(n * 0.55));
    for (let i = 0; i < called; i++) {
      const c = lod.contacts[i];
      const daysAgo = (i * 2) % 18;
      const ts = NOW - daysAgo * DAY - (i % 5) * 3600000;
      if (bp.mode === 'offline') {
        const t = OFFLINE_TRANSCRIPTS[(bi + i) % OFFLINE_TRANSCRIPTS.length];
        saveCall({ lodId: lod.id, contactId: c.id, callerId: 'seed', mode: 'offline',
          disposition: 'connected', connected: true,
          notes: t.transcript, transcript: t.transcript, buckets: t.buckets,
          answers: {}, summary: t.summary, tags: t.tags,
          durationSec: 180 + (i % 6) * 40, ts });
        updateContact(lod.id, c.id, { status: 'done', attempts: 1 });
      } else {
        const dispo = dispoCycle[i % dispoCycle.length];
        const connected = dispo === 'connected';
        if (connected) {
          const summary = (bp.summaries || ['Useful conversation captured.'])[i % (bp.summaries || ['x']).length];
          const tagPool = bp.tags || ['General'];
          const tags = [tagPool[i % tagPool.length], tagPool[(i + 2) % tagPool.length]].filter((v, k, a) => a.indexOf(v) === k);
          saveCall({ lodId: lod.id, contactId: c.id, callerId: 'seed', mode: 'online',
            disposition: 'connected', connected: true,
            notes: summary, answers: {}, summary, tags,
            durationSec: 150 + (i % 7) * 35, ts });
          updateContact(lod.id, c.id, { status: 'done', attempts: 1 });
        } else {
          saveCall({ lodId: lod.id, contactId: c.id, callerId: 'seed', mode: 'online',
            disposition: dispo, connected: false, notes: '', answers: {}, summary: '', tags: [],
            durationSec: 0, ts });
          updateContact(lod.id, c.id, { status: dispo === 'wrong_number' ? 'done' : 'pending', attempts: 1 });
        }
      }
    }
  });

  write(K.seeded, true);
}
