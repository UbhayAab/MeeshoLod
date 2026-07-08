// ============================================================
// Meesho LOD — App entry (ES module)
// Boot chain: init() → seed demo data → initAuth → routes →
// login gate → app shell → router.
// ============================================================

import { APP_BUILD } from './config.js';
import { seedIfEmpty } from './store.js';
import { initAuth, isAuthed } from './auth.js';
import { registerRoute, setAuthGuard, initRouter, navigate } from './router.js';
import { renderSidebar, bindSidebarSync } from './components/sidebar.js';

import { renderLogin } from './pages/login.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderLods } from './pages/lods.js';
import { renderLodDetail } from './pages/lodDetail.js';
import { renderCalling } from './pages/calling.js';
import { renderResults } from './pages/results.js';
import { renderAdmin } from './pages/admin.js';
import { renderSettings } from './pages/settings.js';

console.log(`Meesho LOD build ${APP_BUILD}`);

// ---------- App shell ----------
let shellMounted = false;

function renderAppShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="app-shell">
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <aside class="sidebar" id="sidebar"></aside>
      <main class="main-content">
        <header class="header">
          <div class="header-left">
            <button class="mobile-menu-btn" id="mobile-menu-btn" aria-label="Open menu">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
            </button>
          </div>
          <div class="header-right"></div>
        </header>
        <div class="page-content" id="page-content"></div>
      </main>
      <nav class="bottom-nav" id="bottom-nav" aria-label="Primary"></nav>
    </div>
  `;

  renderSidebar();

  document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('active');
  });
  document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('active');
  });

  bindSidebarSync();
  shellMounted = true;
}

// Called by login page after a successful sign-in
export function bootAppShell() {
  renderAppShell();
  const hash = (window.location.hash || '').slice(1);
  navigate(!hash || hash === 'login' ? 'dashboard' : hash);
  initRouter();
}

// ---------- Login (full-screen route, replaces shell) ----------
function mountLogin() {
  shellMounted = false;
  const app = document.getElementById('app');
  app.innerHTML = '<div id="page-content-login"></div>';
  renderLogin(document.getElementById('page-content-login'), { onLogin: bootAppShell });
}

// ---------- Init ----------
function init() {
  try {
    seedIfEmpty();
    initAuth();

    // Routes — handlers receive (container, params)
    registerRoute('login', () => mountLogin(), { requiresAuth: false });
    registerRoute('dashboard', renderDashboard);
    // hash router matches prefixes: '#lods/<id>' resolves to the 'lods'
    // route with params.id — dispatch list vs detail here
    registerRoute('lods', (c, params) => params.id ? renderLodDetail(c, params) : renderLods(c, params));
    registerRoute('calling', renderCalling);
    registerRoute('results', renderResults);
    registerRoute('admin', renderAdmin);
    registerRoute('settings', renderSettings);

    setAuthGuard(() => isAuthed());

    if (!isAuthed()) {
      window.location.hash = 'login';
      mountLogin();
      // still init router so hashchange works after login
      initRouter();
      return;
    }

    renderAppShell();
    const hash = (window.location.hash || '').slice(1);
    if (!hash || hash === 'login') window.location.hash = 'dashboard';
    initRouter();
  } catch (err) {
    console.error('Boot error', err);
    document.getElementById('app').innerHTML =
      '<div class="boot-screen"><p class="boot-msg boot-error">Boot error: ' +
      String(err.message || err) + '</p><button class="boot-link" onclick="location.reload()">Retry</button></div>';
  }
}

// Re-mount login screen whenever we land on #login without a session
window.addEventListener('hashchange', () => {
  const hash = (window.location.hash || '').slice(1);
  if (hash === 'login' && !isAuthed()) mountLogin();
  else if (isAuthed() && !shellMounted && hash !== 'login') renderAppShell();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
