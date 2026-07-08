// ============================================================
// Meesho LOD — Dashboard: the ops pulse.
// Today's numbers, active LODs, recent call feed. Pure sync reads.
// ============================================================

import { getLods, getCalls, lodProgress, getTeams, saveSettings } from '../store.js';
import { getCurrentUser } from '../auth.js';
import { dispositionMeta } from '../config.js';
import { icon } from '../components/icons.js';
import { navigate } from '../router.js';
import { esc, timeAgo } from '../utils/format.js';

export function renderDashboard(container) {
  const user = getCurrentUser();
  const firstName = (user?.name || 'there').split(' ')[0];
  const lods = getLods();
  const teams = getTeams();
  const teamName = (id) => teams.find(t => t.id === id)?.name || '—';

  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const allCalls = getCalls();
  const todayCalls = allCalls.filter(c => c.ts >= midnight.getTime());
  const connectedToday = todayCalls.filter(c => c.connected).length;
  const connectRate = todayCalls.length ? Math.round(connectedToday / todayCalls.length * 100) : 0;

  const activeLods = lods.filter(l => l.status === 'active');
  const pendingTotal = activeLods.reduce((n, l) => n + lodProgress(l).pending, 0);

  // Contact lookup across LODs for the feed
  const contactName = (call) => {
    const lod = lods.find(l => l.id === call.lodId);
    const c = lod?.contacts?.find(ct => ct.id === call.contactId);
    return { name: c?.name || 'Unknown', lodName: lod?.name || '' };
  };
  const recent = [...allCalls].sort((a, b) => b.ts - a.ts).slice(0, 8);

  const todayStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  container.innerHTML = `
    <div class="page-header">
      <div><h1>Namaste, ${esc(firstName)}</h1><p class="header-subtitle">${esc(todayStr)} — Listen Or Die. Kaun sunega, aap sunoge.</p></div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-ico">${icon('phoneCall')}</div>
        <div class="stat-num">${todayCalls.length}</div>
        <div class="stat-lbl">Calls today</div>
      </div>
      <div class="stat-card">
        <div class="stat-ico">${icon('activity')}</div>
        <div class="stat-num">${todayCalls.length ? connectRate + '%' : '—'}</div>
        <div class="stat-lbl">Connect rate today</div>
      </div>
      <div class="stat-card">
        <div class="stat-ico">${icon('users')}</div>
        <div class="stat-num">${pendingTotal}</div>
        <div class="stat-lbl">Contacts pending</div>
      </div>
      <div class="stat-card">
        <div class="stat-ico">${icon('target')}</div>
        <div class="stat-num">${activeLods.length}</div>
        <div class="stat-lbl">Active LODs</div>
      </div>
    </div>

    <div class="dash-grid" style="margin-top:20px">
      <div class="card card-pad">
        <div class="eyebrow" style="margin-bottom:14px">Active LODs</div>
        ${activeLods.length ? activeLods.map(l => {
          const p = lodProgress(l);
          return `
          <div style="padding:14px 0; border-top:1px solid var(--border)">
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
              <strong style="font:var(--t-sm); color:var(--ink)">${esc(l.name)}</strong>
              <span class="badge badge-primary">${esc(teamName(l.teamId))}</span>
            </div>
            <p style="font:var(--t-sm); color:var(--ink-3); margin-top:4px">${esc(l.goal).slice(0, 110)}${l.goal.length > 110 ? '…' : ''}</p>
            <div style="display:flex; align-items:center; gap:12px; margin-top:10px; flex-wrap:wrap">
              <div class="progress-track" style="flex:1; min-width:120px"><div class="progress-fill" style="width:${p.pct}%"></div></div>
              <span class="mono-cell" style="font-size:12px; flex-shrink:0">${p.done}/${p.total}</span>
              <button class="btn btn-primary btn-sm" data-call="${l.id}">${icon('phoneCall')} Continue calling</button>
            </div>
          </div>`;
        }).join('') : `
        <div class="empty-state" style="text-align:center; padding:36px 16px">
          <div style="font-size:32px; margin-bottom:10px">🎯</div>
          <p style="color:var(--ink-3)">No active LODs. Create one from the LODs page.</p>
        </div>`}
      </div>

      <div class="card card-pad">
        <div class="eyebrow" style="margin-bottom:14px">Recent calls</div>
        ${recent.length ? recent.map(call => {
          const meta = dispositionMeta(call.disposition);
          const { name } = contactName(call);
          const line = call.summary || (call.notes ? call.notes.slice(0, 90) : '');
          return `
          <div style="padding:12px 0; border-top:1px solid var(--border)">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
              <strong style="font:var(--t-sm); color:var(--ink)">${esc(name)}</strong>
              <span class="badge badge-${meta.tone}">${esc(meta.label)}</span>
              <span style="font:var(--t-sm); color:var(--ink-3); margin-left:auto; flex-shrink:0">${esc(timeAgo(call.ts))}</span>
            </div>
            ${line ? `<p style="font:var(--t-sm); color:var(--ink-3); margin-top:4px">${esc(line)}${call.summary ? '' : (call.notes && call.notes.length > 90 ? '…' : '')}</p>` : ''}
            ${call.tags && call.tags.length ? `<div class="tagrow" style="margin-top:6px">${call.tags.slice(0, 4).map((t, i) => `<span class="tagchip ${i ? 't' + (i % 4 + 1) : ''}">${esc(t)}</span>`).join('')}</div>` : ''}
          </div>`;
        }).join('') : `
        <div class="empty-state" style="text-align:center; padding:36px 16px">
          <div style="font-size:32px; margin-bottom:10px">📞</div>
          <p style="color:var(--ink-3)">No calls yet. Pick a LOD and start listening.</p>
        </div>`}
      </div>
    </div>
  `;

  container.querySelectorAll('[data-call]').forEach(btn => {
    btn.addEventListener('click', () => {
      saveSettings({ lastLodId: btn.dataset.call });
      navigate('calling');
    });
  });
}
