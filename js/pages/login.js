// ============================================================
// Meesho LOD — Login (skeleton RBAC, local profiles, no passwords)
// Full-screen: hero brand panel + card. Two modes:
//   a) pick an existing profile   b) create a new one (signup)
// Swap auth.js for SSO later — this page stays thin.
// ============================================================

import { getTeams, saveTeam } from '../store.js';
import { login, signup, hasAnyUsers } from '../auth.js';
import { getUsers } from '../store.js';
import { avatarColor, getInitials, roleLabel } from '../components/sidebar.js';
import { showToast } from '../components/toast.js';
import { icon } from '../components/icons.js';
import { ROLES, APP_NAME, APP_TAG } from '../config.js';
import { esc } from '../utils/format.js';

export function renderLogin(container, { onLogin }) {
  // mode: 'pick' when profiles exist, else 'signup'
  let mode = hasAnyUsers() ? 'pick' : 'signup';
  let newTeamOpen = false;

  function render() {
    container.innerHTML = `
      <div class="login-page">
        <div class="login-split">
          <div class="login-hero">
            <div class="lh-brand">
              <span class="logo-icon">${icon('phoneCall')}</span>
              <div>
                <div class="lh-word">${esc(APP_NAME)}</div>
                <div class="lh-tag">${esc(APP_TAG)}</div>
              </div>
            </div>
            <div class="lh-statement">
              <div class="lh-eyebrow">The operating ritual</div>
              <h1>Every function, <em>always connected</em> to users.</h1>
              <p class="lh-sub">Upload a list, get an AI question stack, and call real people — one goal, one conversation at a time.</p>
            </div>
            <div class="lh-foot">
              <svg class="lh-ecg" viewBox="0 0 300 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M0 20 H60 L72 20 82 6 94 34 104 20 H150 L162 20 172 4 184 36 194 20 H300" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <div class="lh-mono">Calls made, not surveys sent</div>
              <div class="lh-mono">Category · HR · Tech · Seller Ops — same skeleton</div>
              <div class="lh-mono">AI listens with you on every call</div>
            </div>
          </div>
          <div class="login-card">
            <div class="card">
              <div class="login-logo">
                <h1>${mode === 'pick' ? 'Who’s calling?' : 'Create your profile'}</h1>
                <p>${mode === 'pick' ? 'Pick your profile to jump back in.' : 'Name, role, team — that’s it.'}</p>
              </div>
              ${mode === 'pick' ? pickHTML() : signupHTML()}
              <p class="hint" style="margin-top:16px; text-align:center">Local demo auth — SSO drops in later. No passwords.</p>
            </div>
          </div>
        </div>
      </div>`;
    attach();
  }

  // ---------- mode a: existing profiles ----------
  function pickHTML() {
    const teams = getTeams();
    const teamName = (id) => teams.find(t => t.id === id)?.name || 'No team';
    return `
      <div style="display:flex; flex-direction:column; gap:8px">
        ${getUsers().map(u => `
          <div class="card card-hover" data-user="${u.id}" style="display:flex; align-items:center; gap:12px; padding:12px 14px; cursor:pointer">
            <span class="avatar" style="background:${avatarColor(u.name)}; flex:none">${esc(getInitials(u.name))}</span>
            <div style="min-width:0; flex:1">
              <div style="font:var(--t-sm); font-weight:600; color:var(--ink)">${esc(u.name)}</div>
              <div style="font:var(--t-xs); color:var(--ink-3)">${esc(roleLabel(u.role))} · ${esc(teamName(u.teamId))}</div>
            </div>
            ${icon('chevronRight')}
          </div>`).join('')}
      </div>
      <button class="btn btn-ghost btn-block" id="lg-new" style="margin-top:14px">${icon('userPlus')} New profile</button>`;
  }

  // ---------- mode b: signup form ----------
  function signupHTML() {
    const teams = getTeams();
    return `
      <div class="form-group">
        <label class="form-label">Your name</label>
        <input class="input" id="lg-name" placeholder="e.g. Abhay Vatsa" autocomplete="off" />
      </div>
      <div class="form-group">
        <label class="form-label">Role</label>
        <select class="select" id="lg-role">
          ${ROLES.map(r => `<option value="${r.key}">${esc(r.label)}</option>`).join('')}
        </select>
        <p class="hint" id="lg-role-hint" style="margin-top:6px">${esc(ROLES[0].hint)}</p>
      </div>
      <div class="form-group">
        <label class="form-label">Team</label>
        ${teams.length ? `
          <div style="display:flex; gap:8px">
            <select class="select" id="lg-team" style="flex:1">
              ${teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
            </select>
            <button class="btn btn-secondary" id="lg-team-toggle" type="button">${icon('plus')} Team</button>
          </div>` : ''}
        <div id="lg-team-new-wrap" style="${teams.length && !newTeamOpen ? 'display:none;' : ''} margin-top:${teams.length ? '8px' : '0'}">
          <input class="input" id="lg-team-new" placeholder="New team name — e.g. Grocery Category, HR, Seller Ops" />
        </div>
        <p class="hint" style="margin-top:6px">Any function can onboard — the LOD skeleton is the same for everyone.</p>
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="lg-submit" style="margin-top:6px">${icon('arrowRight')} Start listening</button>
      ${hasAnyUsers() ? `<button class="btn btn-ghost btn-block" id="lg-back" style="margin-top:10px">${icon('arrowLeft')} Back to profiles</button>` : ''}`;
  }

  // ---------- listeners ----------
  function attach() {
    if (mode === 'pick') {
      container.querySelectorAll('[data-user]').forEach(row => {
        row.addEventListener('click', () => {
          const u = login(row.dataset.user);
          if (!u) return showToast('Profile not found — create a new one', 'error');
          onLogin();
        });
      });
      container.querySelector('#lg-new')?.addEventListener('click', () => { mode = 'signup'; render(); });
      return;
    }

    // signup
    const roleSel = container.querySelector('#lg-role');
    roleSel?.addEventListener('change', () => {
      const hint = container.querySelector('#lg-role-hint');
      if (hint) hint.textContent = ROLES.find(r => r.key === roleSel.value)?.hint || '';
    });

    container.querySelector('#lg-team-toggle')?.addEventListener('click', () => {
      newTeamOpen = !newTeamOpen;
      const wrap = container.querySelector('#lg-team-new-wrap');
      if (wrap) wrap.style.display = newTeamOpen ? '' : 'none';
      if (newTeamOpen) container.querySelector('#lg-team-new')?.focus();
    });

    container.querySelector('#lg-back')?.addEventListener('click', () => { mode = 'pick'; render(); });

    const submit = () => {
      const name = container.querySelector('#lg-name')?.value.trim();
      if (!name) return showToast('Enter your name', 'warning');
      const role = roleSel?.value || 'caller';

      let teamId = '';
      const teamSel = container.querySelector('#lg-team');
      const newTeamName = container.querySelector('#lg-team-new')?.value.trim();
      const wantsNewTeam = !teamSel || newTeamOpen;
      if (wantsNewTeam && newTeamName) {
        teamId = saveTeam({ name: newTeamName }).id;
      } else if (teamSel) {
        teamId = teamSel.value;
      }

      signup({ name, role, teamId });
      onLogin();
    };
    container.querySelector('#lg-submit')?.addEventListener('click', submit);
    container.querySelector('#lg-name')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  render();
}
