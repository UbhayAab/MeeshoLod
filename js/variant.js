// ============================================================
// Meesho LOD — Variant system
//
// Two products, ONE codebase, ONE shared data store (same-origin
// localStorage is shared across /u/ and /s/ — "write to the pull-all").
//
//   /u/  → Ubhay · LIVE   — online phone LODs + live AI co-pilot
//   /s/  → Ubhay · FIELD  — offline on-ground LODs: record the
//                            conversation, auto-bucket into insights
//
// The entry HTML (u/index.html, s/index.html) sets window.__MLOD_VARIANT
// BEFORE app.js runs. Everything variant-specific reads getVariant().
// ============================================================

const NAV_ONLINE = [
  { section: 'Main', items: [
    { id: 'dashboard', label: 'Dashboard',       icon: 'grid',      route: 'dashboard', roles: ['admin','lead','caller'] },
    { id: 'projects',  label: 'Projects',        icon: 'inbox',     route: 'projects',  roles: ['admin','lead','caller'] },
    { id: 'lods',      label: 'LODs',            icon: 'target',    route: 'lods',      roles: ['admin','lead','caller'] },
    { id: 'calling',   label: 'Calling Console', icon: 'phoneCall', route: 'calling',   roles: ['admin','lead','caller'] },
    { id: 'results',   label: 'Results',         icon: 'chart',     route: 'results',   roles: ['admin','lead','caller'] },
  ]},
  { section: 'Management', items: [
    { id: 'admin',    label: 'Teams & Users', icon: 'shieldCheck', route: 'admin',    roles: ['admin','lead'] },
    { id: 'settings', label: 'Settings',      icon: 'settings',    route: 'settings', roles: ['admin','lead','caller'] },
  ]},
];

const NAV_OFFLINE = [
  { section: 'Field', items: [
    { id: 'dashboard', label: 'Overview',       icon: 'grid',      route: 'dashboard', roles: ['admin','lead','caller'] },
    { id: 'record',    label: 'Record',         icon: 'mic',       route: 'record',    roles: ['admin','lead','caller'] },
    { id: 'sessions',  label: 'Field Sessions', icon: 'activity',  route: 'sessions',  roles: ['admin','lead','caller'] },
    { id: 'projects',  label: 'Projects',       icon: 'inbox',     route: 'projects',  roles: ['admin','lead','caller'] },
    { id: 'results',   label: 'Insights',       icon: 'chart',     route: 'results',   roles: ['admin','lead','caller'] },
  ]},
  { section: 'Management', items: [
    { id: 'admin',    label: 'Teams & Users', icon: 'shieldCheck', route: 'admin',    roles: ['admin','lead'] },
    { id: 'settings', label: 'Settings',      icon: 'settings',    route: 'settings', roles: ['admin','lead','caller'] },
  ]},
];

export const VARIANTS = {
  u: {
    key: 'u',
    mode: 'online',
    brand: 'Meesho LOD',
    sub: 'Live · Listen Or Die',
    product: 'LOD Live',
    home: 'dashboard',
    heroStatement: 'Every function, always connected to users.',
    heroBlurb: 'Upload a list, get an AI question stack, and call real people — one goal, one conversation at a time.',
    nav: NAV_ONLINE,
  },
  s: {
    key: 's',
    mode: 'offline',
    brand: 'Meesho LOD',
    sub: 'Field · Record & Bucket',
    product: 'LOD Field',
    home: 'record',
    heroStatement: 'Listen on the ground. Understand by evening.',
    heroBlurb: 'On-ground LODs — record the real conversation, and the AI transcribes and buckets it into clean insights automatically.',
    nav: NAV_OFFLINE,
  },
};

export function getVariant() {
  const v = (typeof window !== 'undefined' && window.__MLOD_VARIANT) || 'u';
  return VARIANTS[v] || VARIANTS.u;
}

export function isOffline() { return getVariant().mode === 'offline'; }
