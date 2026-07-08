// ============================================================
// Meesho LOD — LOD detail page
//
// Header + goal + stats, editable question stack, contacts
// table with search, and an "Add contacts" paste modal.
// ============================================================

import { getLod, saveLod, deleteLod, getTeams, lodProgress, getCalls, addContacts, saveSettings, uid } from '../store.js';
import { parseContactsDeterministic, formatPhone } from '../utils/parse.js';
import { showToast } from '../components/toast.js';
import { showModal, closeModal, confirmModal } from '../components/modal.js';
import { icon } from '../components/icons.js';
import { navigate } from '../router.js';
import { esc, timeAgo } from '../utils/format.js';

const MAX_ROWS = 200;
const MAX_CTX_COLS = 3;

export function renderLodDetail(container, params) {
  const lod = getLod(params.id);
  if (!lod) {
    showToast('LOD not found', 'error');
    navigate('lods');
    return;
  }

  const teams = getTeams();
  const teamName = teams.find(t => t.id === lod.teamId)?.name || '—';
  const p = lodProgress(lod);
  const calls = getCalls({ lodId: lod.id });
  const connected = calls.filter(c => c.connected).length;
  const connectRate = calls.length ? Math.round((connected / calls.length) * 100) : 0;

  // Latest call summary per contact
  const lastSummary = {};
  [...calls].sort((a, b) => (a.ts || 0) - (b.ts || 0)).forEach(c => {
    if (c.contactId) lastSummary[c.contactId] = c.summary || '';
  });

  const ctxCols = (lod.columns || []).slice(0, MAX_CTX_COLS);
  const statusBadge = lod.status === 'active' ? 'ok' : lod.status === 'paused' ? 'warn' : 'neutral';
  const contactBadge = (s) => s === 'done' ? 'ok' : s === 'skipped' ? 'warn' : 'neutral';

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">${esc(lod.name)}
          <span class="badge badge-${statusBadge}">${esc(lod.status)}</span>
          <span class="badge badge-primary">${esc(teamName)}</span>
        </h1>
        <p class="header-subtitle">Created ${timeAgo(lod.createdAt)} · ${calls.length} call logs</p>
      </div>
      <div class="pg-actions">
        <button class="btn btn-primary" id="ld-start">${icon('phoneCall')} Start calling</button>
        <button class="btn btn-secondary" id="ld-upload">${icon('mic')} Upload recordings</button>
        <button class="btn btn-secondary" id="ld-add">${icon('userPlus')} Add contacts</button>
        <button class="btn btn-ghost" id="ld-toggle">${lod.status === 'active' ? `${icon('clock')} Pause` : `${icon('play')} Activate`}</button>
        <button class="btn btn-ghost" id="ld-del" style="color:var(--danger)">${icon('trash')} Delete</button>
      </div>
    </div>

    <div class="goal-banner" style="margin-bottom:18px">${icon('target')}<div><span class="k">Goal</span>${esc(lod.goal)}</div></div>

    <div class="stats-grid" style="margin-bottom:22px">
      <div class="stat-card"><span class="stat-ico">${icon('users')}</span><div class="stat-num">${p.total}</div><div class="stat-lbl">Total contacts</div></div>
      <div class="stat-card"><span class="stat-ico">${icon('checkCircle')}</span><div class="stat-num">${p.done}</div><div class="stat-lbl">Done</div></div>
      <div class="stat-card"><span class="stat-ico">${icon('clock')}</span><div class="stat-num">${p.pending}</div><div class="stat-lbl">Pending</div></div>
      <div class="stat-card"><span class="stat-ico">${icon('phone')}</span><div class="stat-num">${connectRate}%</div><div class="stat-lbl">Connect rate</div></div>
    </div>

    <div class="card card-pad" style="margin-bottom:22px">
      <div class="eyebrow" style="margin-bottom:10px">Question stack — flashed during calls</div>
      <div class="qstack" id="ld-qlist"></div>
      <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap">
        <input class="input" id="ld-q-new" placeholder="Add a question…" style="flex:1; min-width:220px" />
        <button class="btn btn-secondary" id="ld-q-add">${icon('plus')} Add</button>
      </div>
    </div>

    <div class="card card-pad">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px">
        <div class="eyebrow">Contacts (${p.total})</div>
        <input class="input" id="ld-search" placeholder="Search name, phone, ID…" style="max-width:280px" />
      </div>
      <div id="ld-contacts"></div>
    </div>
  `;

  // ---------- header actions ----------
  container.querySelector('#ld-start').addEventListener('click', () => {
    saveSettings({ lastLodId: lod.id });
    navigate('calling');
  });
  container.querySelector('#ld-upload').addEventListener('click', () => {
    saveSettings({ voiceLodId: lod.id });
    navigate('voice-upload');
  });
  container.querySelector('#ld-toggle').addEventListener('click', () => {
    lod.status = lod.status === 'active' ? 'paused' : 'active';
    saveLod(lod);
    showToast(lod.status === 'active' ? 'LOD active — dial on' : 'LOD paused', 'info');
    renderLodDetail(container, params);
  });
  container.querySelector('#ld-del').addEventListener('click', () => {
    confirmModal(`Delete "${esc(lod.name)}" with all its contacts? Call logs stay, the LOD goes.`, () => {
      deleteLod(lod.id);
      showToast('LOD deleted', 'success');
      navigate('lods');
    }, { title: 'Delete LOD', confirmLabel: 'Delete', danger: true });
  });
  container.querySelector('#ld-add').addEventListener('click', () => openAddContacts(lod, () => renderLodDetail(container, params)));

  // ---------- question stack ----------
  const renderQuestions = () => {
    const el = container.querySelector('#ld-qlist');
    const qs = lod.questions || [];
    el.innerHTML = qs.length ? qs.map((q, i) => `
      <div class="qrow" data-type="${esc(q.type)}" style="cursor:default">
        <span class="q-ico">${i + 1}</span>
        <span class="q-text" style="flex:1">${esc(q.text)}</span>
        <span class="q-type">${esc(q.type)}</span>
        <button class="btn btn-ghost btn-sm" data-qdel="${i}" title="Remove" style="padding:2px 8px">${icon('x')}</button>
      </div>`).join('')
      : `<p class="hint">No questions yet — add one below.</p>`;
    el.querySelectorAll('[data-qdel]').forEach(b => b.addEventListener('click', () => {
      lod.questions.splice(Number(b.dataset.qdel), 1);
      saveLod(lod);
      renderQuestions();
    }));
  };
  renderQuestions();

  const addQuestion = () => {
    const inp = container.querySelector('#ld-q-new');
    const text = inp.value.trim();
    if (!text) return;
    lod.questions = lod.questions || [];
    lod.questions.push({ id: uid('q'), text, type: 'probe' });
    saveLod(lod);
    inp.value = '';
    renderQuestions();
  };
  container.querySelector('#ld-q-add').addEventListener('click', addQuestion);
  container.querySelector('#ld-q-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') addQuestion(); });

  // ---------- contacts table ----------
  const contactsEl = container.querySelector('#ld-contacts');
  const renderContacts = (q = '') => {
    const needle = q.trim().toLowerCase();
    let rows = lod.contacts || [];
    if (needle) {
      rows = rows.filter(c =>
        (c.name || '').toLowerCase().includes(needle) ||
        (c.phone || '').toLowerCase().includes(needle) ||
        (c.ext_id || '').toLowerCase().includes(needle) ||
        (c.status || '').toLowerCase().includes(needle) ||
        ctxCols.some(col => String(c.data?.[col.key] ?? '').toLowerCase().includes(needle))
      );
    }
    if (!rows.length) {
      contactsEl.innerHTML = `<div class="empty-state" style="text-align:center; padding:32px; color:var(--ink-3)">${needle ? 'No contacts match that search.' : 'No contacts yet — add some.'}</div>`;
      return;
    }
    const shown = rows.slice(0, MAX_ROWS);
    contactsEl.innerHTML = `
      <div class="table-container">
        <table class="data-table">
          <thead><tr>
            <th>Name / ID</th><th>Phone</th><th>Status</th><th>Attempts</th>
            ${ctxCols.map(c => `<th>${esc(c.label)}</th>`).join('')}
            <th>Last call</th>
          </tr></thead>
          <tbody>
            ${shown.map(c => {
              const sum = lastSummary[c.id] || '';
              return `
              <tr>
                <td>${esc(c.name || '—')}${c.ext_id ? `<div class="mono-cell" style="font-size:11px; color:var(--ink-3)">${esc(c.ext_id)}</div>` : ''}</td>
                <td class="mono-cell">${esc(formatPhone(c.phone))}</td>
                <td><span class="badge badge-${contactBadge(c.status)}">${esc(c.status)}</span></td>
                <td class="mono-cell">${c.attempts || 0}</td>
                ${ctxCols.map(col => `<td>${esc(String(c.data?.[col.key] ?? ''))}</td>`).join('')}
                <td style="color:var(--ink-3); font:var(--t-sm)">${sum ? esc(sum.slice(0, 60)) + (sum.length > 60 ? '…' : '') : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${rows.length > MAX_ROWS ? `<p class="hint" style="margin-top:8px">…${rows.length - MAX_ROWS} more — refine the search to see them.</p>` : ''}`;
  };
  renderContacts();
  container.querySelector('#ld-search').addEventListener('input', (e) => renderContacts(e.target.value));
}

// ============================================================
// Add contacts modal
// ============================================================
function openAddContacts(lod, onDone) {
  let parsed = null;

  showModal({
    title: 'Add contacts',
    size: 'lg',
    content: `
      <div class="form-group">
        <label class="form-label">Paste rows — names, numbers, any extra columns</label>
        <textarea class="paste-zone" id="ac-raw" placeholder="Paste from Sheets / CSV. Messy is fine — we pick names and valid phone numbers."></textarea>
      </div>
      <div class="parse-tally" id="ac-tally"></div>
      <div class="form-actions" style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px">
        <button class="btn btn-ghost" id="ac-cancel">Cancel</button>
        <button class="btn btn-primary" id="ac-confirm" disabled>${icon('userPlus')} Add contacts</button>
      </div>`,
  });

  const rawEl = document.getElementById('ac-raw');
  const tallyEl = document.getElementById('ac-tally');
  const confirmBtn = document.getElementById('ac-confirm');

  rawEl.addEventListener('input', () => {
    const raw = rawEl.value;
    parsed = raw.trim() ? parseContactsDeterministic(raw) : null;
    if (!parsed || !parsed.rows.length) {
      tallyEl.innerHTML = raw.trim() ? `<span class="bad">No valid phone numbers found yet</span>` : '';
      confirmBtn.disabled = true;
      return;
    }
    tallyEl.innerHTML = `
      <span><strong class="ok">${parsed.rows.length}</strong> contacts ready</span>
      ${parsed.dup ? `<span>${parsed.dup} repeated</span>` : ''}
      ${parsed.invalid ? `<span class="bad">${parsed.invalid} without a valid number</span>` : ''}`;
    confirmBtn.disabled = false;
  });

  document.getElementById('ac-cancel').addEventListener('click', () => closeModal());
  confirmBtn.addEventListener('click', () => {
    if (!parsed || !parsed.rows.length) return;
    const { added, duplicates } = addContacts(lod.id, parsed.rows);
    closeModal();
    showToast(`${added} contact${added === 1 ? '' : 's'} added${duplicates ? ` · ${duplicates} duplicate${duplicates === 1 ? '' : 's'} skipped` : ''}`, added ? 'success' : 'warning');
    onDone();
  });
}
