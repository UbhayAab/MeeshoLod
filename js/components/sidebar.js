// ============================================================
// Meesho LOD — Sidebar + bottom nav
// Active state is computed from location.hash at render time —
// not from the router's cached route (which lags one navigation).
// ============================================================

import { getCurrentUser, getUserRole, logout } from '../auth.js';
import { getTeam } from '../store.js';
import { navigate } from '../router.js';
import { showToast } from './toast.js';
import { confirmModal } from './modal.js';
import { icon } from './icons.js';
import { ROLES } from '../config.js';
import { esc } from '../utils/format.js';
import { getVariant } from '../variant.js';

const MGMT = ['admin', 'lead'];
// Nav is variant-defined (js/variant.js). Sumit's Insights + Upload-Recordings
// items are wired into those nav lists there, not inline here.
const NAV_ITEMS = getVariant().nav;

const AVATAR_COLORS = ['#F43397', '#7B1264', '#5145C4', '#A21C85', '#C0761C', '#2A63A6'];
export function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
export function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
export function roleLabel(role) {
  return ROLES.find(r => r.key === role)?.label || role || '';
}

function activeRouteFromHash() {
  const hash = (window.location.hash || '').slice(1);
  if (!hash) return 'dashboard';
  const allRoutes = NAV_ITEMS.flatMap(s => s.items.map(i => i.route));
  if (allRoutes.includes(hash)) return hash;
  let best = '';
  for (const r of allRoutes) {
    if ((hash === r || hash.startsWith(r + '/')) && r.length > best.length) best = r;
  }
  return best || hash.split('/')[0];
}

export function renderSidebar() {
  const user = getCurrentUser();
  const role = getUserRole();
  const active = activeRouteFromHash();

  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const navHTML = NAV_ITEMS.map(section => {
    const visibleItems = section.items.filter(item => item.roles.includes(role));
    if (visibleItems.length === 0) return '';
    return `
      <div class="nav-section">
        <div class="nav-section-title">${section.section}</div>
        ${visibleItems.map(item => `
          <button class="nav-item ${active === item.route ? 'active' : ''}"
                  data-route="${item.route}" id="nav-${item.id}" aria-current="${active === item.route ? 'page' : 'false'}">
            ${icon(item.icon)}
            <span>${item.label}</span>
          </button>
        `).join('')}
      </div>
    `;
  }).join('');

  const team = user?.teamId ? getTeam(user.teamId) : null;
  const V = getVariant();

  sidebar.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-logo">${icon(V.mode === 'offline' ? 'mic' : 'phoneCall')}</div>
      <div class="sidebar-brand">
        <span class="sidebar-brand-name">${esc(V.brand)}</span>
        <span class="sidebar-brand-sub">${esc(V.sub)}</span>
      </div>
    </div>
    <nav class="sidebar-nav">
      ${navHTML}
    </nav>
    <div class="sidebar-footer">
      <div class="sidebar-user">
        <button class="sidebar-user-main" id="sidebar-profile-btn" title="Profile">
          <div class="avatar" style="background: ${avatarColor(user?.name)}">${getInitials(user?.name)}</div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name">${esc(user?.name || 'User')}</div>
            <div class="sidebar-user-role">${esc(roleLabel(role))}${team ? ' · ' + esc(team.name) : ''}</div>
          </div>
        </button>
        <button class="sidebar-logout-btn" id="sidebar-logout-btn" title="Sign out" aria-label="Sign out">${icon('logOut')}</button>
      </div>
    </div>
  `;

  sidebar.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      navigate(btn.dataset.route);
      sidebar.classList.remove('open');
      document.getElementById('sidebar-overlay')?.classList.remove('active');
    });
  });

  document.getElementById('sidebar-profile-btn')?.addEventListener('click', () => {
    navigate('settings');
    sidebar.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('active');
  });
  document.getElementById('sidebar-logout-btn')?.addEventListener('click', () => {
    confirmModal('Switch profile / sign out of Meesho LOD?', () => {
      logout();
      navigate('login');
      showToast('Signed out', 'success');
    }, { title: 'Sign out', confirmLabel: 'Sign out', danger: false });
  });

  renderBottomNav(role, active);
}

function renderBottomNav(role, active) {
  const el = document.getElementById('bottom-nav');
  if (!el) return;

  // first (up to) 5 role-visible items from the variant's nav, with short labels
  const SHORT = { dashboard: 'Home', calling: 'Call', results: 'Results', record: 'Record', sessions: 'Sessions', projects: 'Projects', lods: 'LODs', settings: 'Settings', admin: 'Teams' };
  const flat = NAV_ITEMS.flatMap(s => s.items).filter(i => i.roles.includes(role));
  const items = flat.slice(0, 5).map(i => ({ ...i, label: SHORT[i.id] || i.label }));

  el.innerHTML = `
    <div class="bottom-nav-list">
      ${items.map(it => `
        <button class="bottom-nav-item ${active === it.route ? 'active' : ''}" data-route="${it.route}" aria-label="${it.label}">
          ${icon(it.icon)}
          <span>${it.label}</span>
        </button>
      `).join('')}
    </div>
  `;

  el.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.route));
  });
}

let syncBound = false;
export function bindSidebarSync() {
  if (syncBound) return;
  syncBound = true;
  window.addEventListener('hashchange', () => {
    if (document.getElementById('sidebar')) renderSidebar();
  });
}
