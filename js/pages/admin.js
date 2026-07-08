// ============================================================
// Meesho LOD — Admin: Teams & Users (RBAC skeleton)
//
// Roles here map 1:1 to future SSO groups — this page is the
// manual stand-in until SSO lands.
// ============================================================

import { getUsers, saveUser, deleteUser, getTeams, saveTeam, deleteTeam, getLods } from '../store.js';
import { getCurrentUser, isLeadOrAdmin } from '../auth.js';
import { showToast } from '../components/toast.js';
import { showModal, closeModal, confirmModal } from '../components/modal.js';
import { icon } from '../components/icons.js';
import { avatarColor, getInitials, roleLabel } from '../components/sidebar.js';
import { ROLES } from '../config.js';
import { esc, fmtDate } from '../utils/format.js';

export function renderAdmin(container) {
  if (!isLeadOrAdmin()) {
    container.innerHTML = `
      <div class="empty-state card card-pad" style="text-align:center; padding:60px 24px">
        <div style="font-size:40px; margin-bottom:12px">🔒</div>
        <h3 style="margin-bottom:8px">Not allowed</h3>
        <p style="color:var(--ink-3)">Teams & Users is for leads and admins only.</p>
      </div>`;
    return;
  }

  const users = getUsers();
  const teams = getTeams();
  const lods = getLods();
  const me = getCurrentUser();
  const teamName = (id) => teams.find(t => t.id === id)?.name || '—';
  const memberCount = (tid) => users.filter(u => u.teamId === tid).length;
  const lodCount = (tid) => lods.filter(l => l.teamId === tid).length;
  const roleBadge = (role) => role === 'admin' ? 'gold' : role === 'lead' ? 'violet' : 'info';
  const rerender = () => renderAdmin(container);

  container.innerHTML = `
    <div class="page-header">
      <div><h1>Teams & Users</h1><p class="header-subtitle">RBAC skeleton — these roles map to SSO groups later</p></div>
    </div>

    <div class="eyebrow" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
      <span>Teams</span>
      <button class="btn btn-primary btn-sm" id="adm-add-team">${icon('plus')} Add team</button>
    </div>
    ${teams.length ? `
    <div class="stats-grid" style="margin-bottom:28px">
      ${teams.map(t => `
        <div class="card card-pad card-hover">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px">
            <div style="min-width:0">
              <h3 style="font:var(--t-h3)">${esc(t.name)}</h3>
              ${t.desc ? `<p style="font:var(--t-sm); color:var(--ink-3); margin-top:4px">${esc(t.desc)}</p>` : ''}
            </div>
            <div style="display:flex; gap:4px; flex-shrink:0">
              <button class="btn btn-ghost btn-sm btn-icon" data-edit-team="${t.id}" title="Edit">${icon('edit')}</button>
              <button class="btn btn-ghost btn-sm btn-icon" data-del-team="${t.id}" title="Delete">${icon('trash')}</button>
            </div>
          </div>
          <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap">
            <span class="badge badge-primary">${icon('users')} ${memberCount(t.id)} member${memberCount(t.id) === 1 ? '' : 's'}</span>
            <span class="badge badge-neutral">${icon('target')} ${lodCount(t.id)} LOD${lodCount(t.id) === 1 ? '' : 's'}</span>
          </div>
        </div>`).join('')}
    </div>` : `
    <div class="empty-state card card-pad" style="text-align:center; padding:40px 24px; margin-bottom:28px">
      <div style="font-size:32px; margin-bottom:10px">👥</div>
      <h3 style="margin-bottom:6px">No teams yet</h3>
      <p style="color:var(--ink-3)">Add the first team — Category, HR, Seller Ops, whoever needs to listen.</p>
    </div>`}

    <div class="eyebrow" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
      <span>Users</span>
      <button class="btn btn-primary btn-sm" id="adm-add-user">${icon('userPlus')} Add user</button>
    </div>
    ${users.length ? `
    <div class="table-container">
      <table class="data-table">
        <thead><tr><th>User</th><th>Role</th><th>Team</th><th>Joined</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td>
                <div style="display:flex; align-items:center; gap:10px">
                  <div class="avatar" style="background:${avatarColor(u.name)}">${getInitials(u.name)}</div>
                  <span>${esc(u.name)}${u.id === me?.id ? ' <span class="badge badge-neutral">you</span>' : ''}</span>
                </div>
              </td>
              <td><span class="badge badge-${roleBadge(u.role)}">${esc(roleLabel(u.role))}</span></td>
              <td>${esc(teamName(u.teamId))}</td>
              <td class="mono-cell">${u.createdAt ? esc(fmtDate(u.createdAt)) : '—'}</td>
              <td style="text-align:right; white-space:nowrap">
                <button class="btn btn-ghost btn-sm btn-icon" data-edit-user="${u.id}" title="Change role / team">${icon('edit')}</button>
                <button class="btn btn-ghost btn-sm btn-icon" data-del-user="${u.id}" title="Delete">${icon('trash')}</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `
    <div class="empty-state card card-pad" style="text-align:center; padding:40px 24px">
      <div style="font-size:32px; margin-bottom:10px">🙋</div>
      <h3 style="margin-bottom:6px">No users yet</h3>
      <p style="color:var(--ink-3)">Add callers and leads so LODs have people behind the phones.</p>
    </div>`}
  `;

  // ---------- Teams ----------
  container.querySelector('#adm-add-team')?.addEventListener('click', () => openTeamModal(null, rerender));
  container.querySelectorAll('[data-edit-team]').forEach(b => b.addEventListener('click', () => {
    const t = teams.find(x => x.id === b.dataset.editTeam);
    if (t) openTeamModal(t, rerender);
  }));
  container.querySelectorAll('[data-del-team]').forEach(b => b.addEventListener('click', () => {
    const t = teams.find(x => x.id === b.dataset.delTeam);
    if (!t) return;
    if (lodCount(t.id) > 0) {
      return showToast(`"${t.name}" has ${lodCount(t.id)} LOD(s) — move or delete those first`, 'warning');
    }
    confirmModal(`Delete team "${esc(t.name)}"? Members stay but lose their team.`, () => {
      deleteTeam(t.id);
      showToast('Team deleted', 'success');
      rerender();
    }, { title: 'Delete team', confirmLabel: 'Delete', danger: true });
  }));

  // ---------- Users ----------
  container.querySelector('#adm-add-user')?.addEventListener('click', () => openUserModal(null, rerender));
  container.querySelectorAll('[data-edit-user]').forEach(b => b.addEventListener('click', () => {
    const u = users.find(x => x.id === b.dataset.editUser);
    if (u) openUserModal(u, rerender);
  }));
  container.querySelectorAll('[data-del-user]').forEach(b => b.addEventListener('click', () => {
    const u = users.find(x => x.id === b.dataset.delUser);
    if (!u) return;
    if (u.id === me?.id) {
      return showToast('You cannot delete yourself — ask another admin', 'warning');
    }
    confirmModal(`Delete user "${esc(u.name)}"? Their call logs stay attributed by id.`, () => {
      deleteUser(u.id);
      showToast('User deleted', 'success');
      rerender();
    }, { title: 'Delete user', confirmLabel: 'Delete', danger: true });
  }));
}

// ============================================================
// Team modal (add / edit)
// ============================================================
function openTeamModal(team, done) {
  showModal({
    title: team ? 'Edit team' : 'Add team',
    content: `
      <div class="form-group">
        <label class="form-label">Team name</label>
        <input class="input" id="tm-name" placeholder="e.g. Grocery — Category" value="${esc(team?.name || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label">Description <span class="hint">(optional)</span></label>
        <input class="input" id="tm-desc" placeholder="What does this team listen for?" value="${esc(team?.desc || '')}" />
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:18px">
        <button class="btn btn-ghost" id="tm-cancel">Cancel</button>
        <button class="btn btn-primary" id="tm-save">${team ? 'Save changes' : 'Add team'}</button>
      </div>`,
  });
  document.getElementById('tm-cancel')?.addEventListener('click', () => closeModal());
  document.getElementById('tm-save')?.addEventListener('click', () => {
    const name = document.getElementById('tm-name').value.trim();
    const desc = document.getElementById('tm-desc').value.trim();
    if (!name) return showToast('Team needs a name', 'warning');
    saveTeam(team ? { id: team.id, name, desc } : { name, desc });
    closeModal();
    showToast(team ? 'Team updated' : 'Team added', 'success');
    done();
  });
}

// ============================================================
// User modal (add / edit role + team)
// ============================================================
function openUserModal(user, done) {
  const teams = getTeams();
  showModal({
    title: user ? `Edit ${user.name}` : 'Add user',
    content: `
      <div class="form-group">
        <label class="form-label">Name</label>
        <input class="input" id="um-name" placeholder="Full name" value="${esc(user?.name || '')}" ${user ? '' : 'autofocus'} />
      </div>
      <div class="form-group">
        <label class="form-label">Role</label>
        <select class="select" id="um-role">
          ${ROLES.map(r => `<option value="${r.key}" ${(user?.role || 'caller') === r.key ? 'selected' : ''}>${esc(r.label)} — ${esc(r.hint)}</option>`).join('')}
        </select>
        <p class="hint" style="margin-top:6px">Roles map to SSO groups once we're off the manual skeleton.</p>
      </div>
      <div class="form-group">
        <label class="form-label">Team</label>
        <select class="select" id="um-team">
          <option value="">— No team —</option>
          ${teams.map(t => `<option value="${t.id}" ${user?.teamId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:18px">
        <button class="btn btn-ghost" id="um-cancel">Cancel</button>
        <button class="btn btn-primary" id="um-save">${user ? 'Save changes' : 'Add user'}</button>
      </div>`,
  });
  document.getElementById('um-cancel')?.addEventListener('click', () => closeModal());
  document.getElementById('um-save')?.addEventListener('click', () => {
    const name = document.getElementById('um-name').value.trim();
    const role = document.getElementById('um-role').value;
    const teamId = document.getElementById('um-team').value || null;
    if (!name) return showToast('User needs a name', 'warning');
    saveUser(user ? { id: user.id, name, role, teamId } : { name, role, teamId });
    closeModal();
    showToast(user ? 'User updated' : 'User added', 'success');
    done();
  });
}
