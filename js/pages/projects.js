// ============================================================
// Meesho LOD — Projects (portfolio view)
//
// One place to see every calling project (LOD) across every team.
// Grouped by team with aggregate stats — built for the "millions of
// teams" reality: each team's projects sit under its own heading.
// Reuses the New-LOD wizard from lods.js.
// ============================================================

import { getLods, getTeams, getCalls, lodProgress } from '../store.js';
import { icon } from '../components/icons.js';
import { navigate } from '../router.js';
import { esc } from '../utils/format.js';
import { avatarColor, getInitials } from '../components/sidebar.js';
import { openWizard } from './lods.js';

export function renderProjects(container) {
  const lods = getLods();
  const teams = getTeams();

  // aggregate top-line
  const allCalls = getCalls();
  const totalContacts = lods.reduce((s, l) => s + l.contacts.length, 0);
  const connected = allCalls.filter(c => c.connected).length;
  const connectRate = allCalls.length ? Math.round(connected / allCalls.length * 100) : 0;

  const lodCard = (l) => {
    const p = lodProgress(l);
    const calls = getCalls({ lodId: l.id });
    return `
      <div class="card card-pad card-hover" data-lod="${l.id}" style="cursor:pointer">
        <div class="lod-card-row">
          <div style="min-width:0; flex:1">
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
              <h3 style="font:var(--t-h3)">${esc(l.name)}</h3>
              <span class="badge badge-${l.status === 'active' ? 'ok' : l.status === 'paused' ? 'warn' : 'neutral'}">${esc(l.status)}</span>
            </div>
            <p style="font:var(--t-sm); color:var(--ink-3); margin-top:6px">${esc(l.goal).slice(0, 150)}${l.goal.length > 150 ? '…' : ''}</p>
          </div>
          <div style="text-align:right; flex-shrink:0">
            <div class="mono-cell" style="font-size:13px"><strong style="color:var(--ink)">${p.done}</strong>/${p.total} called · ${calls.length} logs</div>
            <div class="progress-track" style="width:170px; margin-top:8px"><div class="progress-fill" style="width:${p.pct}%"></div></div>
            <div style="font:var(--t-mono-label); color:var(--ink-4); margin-top:6px; letter-spacing:.08em">${l.questions.length} QUESTIONS</div>
          </div>
        </div>
      </div>`;
  };

  // teams that actually have LODs, in team order; then any "orphan" LODs
  const byTeam = new Map();
  lods.forEach(l => {
    const key = l.teamId || '_none';
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key).push(l);
  });

  const teamSection = (team, teamLods) => {
    const tContacts = teamLods.reduce((s, l) => s + l.contacts.length, 0);
    const tCalls = teamLods.reduce((s, l) => s + getCalls({ lodId: l.id }).length, 0);
    const name = team ? team.name : 'Unassigned';
    return `
      <div class="proj-team">
        <div class="proj-team-head">
          <div class="avatar" style="background:${avatarColor(name)}">${getInitials(name)}</div>
          <div style="min-width:0">
            <div class="proj-team-name">${esc(name)}</div>
            <div class="proj-team-meta">${teamLods.length} project${teamLods.length === 1 ? '' : 's'} · ${tContacts} contacts · ${tCalls} calls</div>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:12px">
          ${teamLods.map(lodCard).join('')}
        </div>
      </div>`;
  };

  const sections = [];
  teams.forEach(t => { if (byTeam.has(t.id)) sections.push(teamSection(t, byTeam.get(t.id))); });
  if (byTeam.has('_none')) sections.push(teamSection(null, byTeam.get('_none')));

  container.innerHTML = `
    <div class="page-header">
      <div><h1>Projects</h1><p class="header-subtitle">Every calling project, across every team</p></div>
      <div class="pg-actions">
        <button class="btn btn-primary" id="new-project-btn">${icon('plus')} New project</button>
      </div>
    </div>

    ${lods.length ? `
      <div class="stats-grid" style="margin-bottom:22px">
        <div class="stat-card"><div class="stat-ico">${icon('target')}</div><div class="stat-num">${lods.length}</div><div class="stat-lbl">Projects</div></div>
        <div class="stat-card"><div class="stat-ico">${icon('users')}</div><div class="stat-num">${totalContacts}</div><div class="stat-lbl">Contacts</div></div>
        <div class="stat-card"><div class="stat-ico">${icon('phoneCall')}</div><div class="stat-num">${allCalls.length}</div><div class="stat-lbl">Calls logged</div></div>
        <div class="stat-card"><div class="stat-ico">${icon('phone')}</div><div class="stat-num">${allCalls.length ? connectRate + '%' : '—'}</div><div class="stat-lbl">Connect rate</div></div>
      </div>
      <div style="display:flex; flex-direction:column; gap:26px">
        ${sections.join('')}
      </div>
    ` : `
      <div class="empty-state card card-pad" style="text-align:center; padding:60px 24px">
        <div style="font-size:40px; margin-bottom:12px">🗂️</div>
        <h3 style="margin-bottom:8px">No projects yet</h3>
        <p style="color:var(--ink-3); margin-bottom:20px">Create your first calling project — a goal and a pasted list is all it takes.</p>
        <button class="btn btn-primary" id="new-project-empty">${icon('plus')} New project</button>
      </div>
    `}
  `;

  container.querySelectorAll('[data-lod]').forEach(card => {
    card.addEventListener('click', () => navigate(`lods/${card.dataset.lod}`));
  });
  container.querySelector('#new-project-btn')?.addEventListener('click', () => openWizard(container));
  container.querySelector('#new-project-empty')?.addEventListener('click', () => openWizard(container));
}
