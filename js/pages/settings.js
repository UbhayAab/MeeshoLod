// ============================================================
// Meesho LOD — Settings
//
// Three cards: Profile (name edit), AI Engine (endpoint / key /
// models + test connection), Data (export / import / reset +
// storage usage).
// ============================================================

import { saveUser, saveSettings, exportAll, importAll, resetAll, getTeam } from '../store.js';
import { getCurrentUser } from '../auth.js';
import { aiStatus, aiChat } from '../ai.js';
import { showToast } from '../components/toast.js';
import { confirmModal } from '../components/modal.js';
import { icon } from '../components/icons.js';
import { roleLabel } from '../components/sidebar.js';
import { esc } from '../utils/format.js';

function storageUsageKB() {
  let bytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      bytes += (k.length + (localStorage.getItem(k) || '').length) * 2; // UTF-16
    }
  } catch { /* ignore */ }
  return (bytes / 1024).toFixed(1);
}

export function renderSettings(container) {
  const user = getCurrentUser();
  const team = user?.teamId ? getTeam(user.teamId) : null;
  const ai = aiStatus();

  container.innerHTML = `
    <div class="page-header">
      <div><h1>Settings</h1><p class="header-subtitle">Profile, AI engine and your data — all local to this browser</p></div>
    </div>

    <div class="content-grid" style="display:grid; gap:16px; max-width:820px">

      <!-- Profile -->
      <div class="card card-pad">
        <div class="eyebrow" style="margin-bottom:14px">${icon('user')} Profile</div>
        <div class="form-group">
          <label class="form-label">Your name</label>
          <div style="display:flex; gap:8px; flex-wrap:wrap">
            <input class="input" id="st-name" value="${esc(user?.name || '')}" style="flex:1; min-width:200px" />
            <button class="btn btn-primary" id="st-name-save">${icon('check')} Save</button>
          </div>
        </div>
        <div class="info-grid kv" style="margin-top:12px">
          <div class="info-cell">
            <div class="info-label">Role</div>
            <div class="info-value"><span class="badge badge-primary">${esc(roleLabel(user?.role))}</span></div>
          </div>
          <div class="info-cell">
            <div class="info-label">Team</div>
            <div class="info-value">${esc(team?.name || '—')}</div>
          </div>
        </div>
        <p class="hint" style="margin-top:10px">Role and team are read-only here — admins change them in Teams &amp; Users.</p>
      </div>

      <!-- AI Engine -->
      <div class="card card-pad">
        <div class="eyebrow" style="margin-bottom:14px">${icon('sparkles')} AI Engine</div>
        <div class="form-group">
          <label class="form-label">Endpoint</label>
          <input class="input" id="st-ai-endpoint" value="${esc(ai.endpoint || '')}" placeholder="https://…/v1/chat/completions" />
        </div>
        <div class="form-group">
          <label class="form-label">API key</label>
          <div style="display:flex; gap:8px">
            <input class="input" id="st-ai-key" type="password" value="${esc(ai.apiKey || '')}" style="flex:1" autocomplete="off" />
            <button class="btn btn-secondary btn-icon" id="st-key-toggle" title="Show / hide key">${icon('key')}</button>
          </div>
          <p class="hint" style="margin-top:6px">Key ships with the app for the buildathon — rotate it here anytime, stored only in this browser.</p>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px">
          <div class="form-group">
            <label class="form-label">Model</label>
            <input class="input" id="st-ai-model" list="st-model-list" value="${esc(ai.model || '')}" placeholder="gpt-4o" />
            <datalist id="st-model-list">
              <option value="gpt-4o"></option>
              <option value="gpt-5.5"></option>
            </datalist>
            <p class="hint" style="margin-top:6px">Fast model — live coach, parsing.</p>
          </div>
          <div class="form-group">
            <label class="form-label">Deep model</label>
            <input class="input" id="st-ai-deep" list="st-model-list" value="${esc(ai.deepModel || '')}" placeholder="gpt-5.5" />
            <p class="hint" style="margin-top:6px">Heavy model — synthesis reports.</p>
          </div>
        </div>
        <div style="display:flex; gap:10px; margin-top:6px; flex-wrap:wrap">
          <button class="btn btn-primary" id="st-ai-save">${icon('check')} Save AI settings</button>
          <button class="btn btn-secondary" id="st-ai-test">${icon('zap')} Test connection</button>
        </div>
      </div>

      <!-- Data -->
      <div class="card card-pad">
        <div class="eyebrow" style="margin-bottom:14px">${icon('fileText')} Data</div>
        <p style="font:var(--t-sm); color:var(--ink-3); margin-bottom:14px">
          Everything lives in this browser's localStorage — currently <strong id="st-usage" style="color:var(--ink)">${storageUsageKB()} KB</strong>.
          Export a backup before switching machines or clearing the browser.
        </p>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <button class="btn btn-secondary" id="st-export">${icon('download')} Export backup</button>
          <button class="btn btn-secondary" id="st-import">${icon('upload')} Import backup</button>
          <input type="file" id="st-import-file" accept=".json,application/json" style="display:none" />
          <button class="btn btn-danger" id="st-reset" style="margin-left:auto">${icon('trash')} Reset everything</button>
        </div>
      </div>

    </div>
  `;

  // ---------- Profile ----------
  container.querySelector('#st-name-save')?.addEventListener('click', () => {
    const name = container.querySelector('#st-name').value.trim();
    if (!name) return showToast('Name cannot be empty', 'warning');
    if (!user) return showToast('No user session — log in again', 'error');
    saveUser({ ...user, name });
    showToast('Name updated', 'success');
  });

  // ---------- AI Engine ----------
  const keyInput = container.querySelector('#st-ai-key');
  container.querySelector('#st-key-toggle')?.addEventListener('click', () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  });

  const readAIForm = () => ({
    aiEndpoint: container.querySelector('#st-ai-endpoint').value.trim(),
    aiApiKey: keyInput.value.trim(),
    aiModel: container.querySelector('#st-ai-model').value.trim(),
    aiDeepModel: container.querySelector('#st-ai-deep').value.trim(),
  });

  container.querySelector('#st-ai-save')?.addEventListener('click', () => {
    saveSettings(readAIForm());
    showToast('AI settings saved', 'success');
  });

  container.querySelector('#st-ai-test')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    // save first so aiChat picks up whatever is in the form
    saveSettings(readAIForm());
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2.5px"></span> Testing…';
    const t0 = Date.now();
    try {
      await aiChat([{ role: 'user', content: 'Reply OK' }], { maxTokens: 5 });
      showToast(`AI connected — ${Date.now() - t0} ms`, 'success');
    } catch (err) {
      console.warn(err);
      showToast(`Connection failed after ${Date.now() - t0} ms — ${String(err.message || err).slice(0, 120)}`, 'error');
    }
    btn.disabled = false;
    btn.innerHTML = original;
  });

  // ---------- Data ----------
  container.querySelector('#st-export')?.addEventListener('click', () => {
    const blob = new Blob([exportAll()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'meesho-lod-backup.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Backup downloaded', 'success');
  });

  const fileInput = container.querySelector('#st-import-file');
  container.querySelector('#st-import')?.addEventListener('click', () => fileInput.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      importAll(text);
      showToast('Backup imported — reloading', 'success');
      setTimeout(() => location.reload(), 600);
    } catch (err) {
      console.warn(err);
      showToast('Import failed — not a valid backup file', 'error');
      fileInput.value = '';
    }
  });

  container.querySelector('#st-reset')?.addEventListener('click', () => {
    confirmModal(
      'This wipes ALL LODs, calls, users and settings from this browser. Export a backup first if in doubt. There is no undo.',
      () => {
        resetAll();
        location.hash = 'login';
        location.reload();
      },
      { title: 'Reset everything?', confirmLabel: 'Wipe it all', danger: true }
    );
  });
}
