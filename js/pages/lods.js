// ============================================================
// Meesho LOD — LODs list + "New LOD" wizard
//
// Wizard: 1) Goal & team  2) Paste the list (deterministic parse
// instantly, AI parse for messy data + column naming)  3) AI
// question stack (editable)  4) Launch.
// Any team can onboard itself here — the skeleton is generic.
// ============================================================

import { getLods, getLod, saveLod, deleteLod, getTeams, saveTeam, lodProgress, getCalls, uid } from '../store.js';
import { getCurrentUser, isLeadOrAdmin } from '../auth.js';
import { parseContactsAI, generateQuestions, aiStatus } from '../ai.js';
import { parseContactsDeterministic } from '../utils/parse.js';
import { showToast } from '../components/toast.js';
import { showModal, closeModal, confirmModal } from '../components/modal.js';
import { icon } from '../components/icons.js';
import { navigate } from '../router.js';
import { esc, timeAgo } from '../utils/format.js';

export function renderLods(container) {
  const lods = getLods();
  const teams = getTeams();
  const teamName = (id) => teams.find(t => t.id === id)?.name || '—';

  container.innerHTML = `
    <div class="page-header">
      <div><h1>LODs</h1><p class="header-subtitle">Listen Or Die — one goal, one list, real conversations</p></div>
      <div class="pg-actions">
        <button class="btn btn-primary" id="new-lod-btn">${icon('plus')} New LOD</button>
      </div>
    </div>

    ${lods.length ? `
    <div class="content-grid" style="display:grid; gap:14px">
      ${lods.map(l => {
        const p = lodProgress(l);
        const calls = getCalls({ lodId: l.id });
        return `
        <div class="card card-pad card-hover" data-lod="${l.id}" style="cursor:pointer">
          <div class="lod-card-row">
            <div style="min-width:0; flex:1">
              <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
                <h3 style="font:var(--t-h3)">${esc(l.name)}</h3>
                <span class="badge badge-${l.status === 'active' ? 'ok' : l.status === 'paused' ? 'warn' : 'neutral'}">${esc(l.status)}</span>
                <span class="badge badge-primary">${esc(teamName(l.teamId))}</span>
              </div>
              <p style="font:var(--t-sm); color:var(--ink-3); margin-top:6px">${esc(l.goal).slice(0, 160)}${l.goal.length > 160 ? '…' : ''}</p>
            </div>
            <div style="text-align:right; flex-shrink:0">
              <div class="mono-cell" style="font-size:13px"><strong style="color:var(--ink)">${p.done}</strong>/${p.total} called · ${calls.length} logs</div>
              <div class="progress-track" style="width:160px; margin-top:8px"><div class="progress-fill" style="width:${p.pct}%"></div></div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>` : `
    <div class="empty-state card card-pad" style="text-align:center; padding:60px 24px">
      <div style="font-size:40px; margin-bottom:12px">🎯</div>
      <h3 style="margin-bottom:8px">No LODs yet</h3>
      <p style="color:var(--ink-3)">Create the first one — a goal and a pasted list is all it takes.</p>
    </div>`}
  `;

  container.querySelectorAll('[data-lod]').forEach(card => {
    card.addEventListener('click', () => navigate(`lods/${card.dataset.lod}`));
  });
  container.querySelector('#new-lod-btn')?.addEventListener('click', () => openWizard(container));
}

// ============================================================
// Wizard
// ============================================================
function openWizard(container) {
  const W = {
    step: 1,
    name: '', teamId: '', goal: '',
    raw: '', parsed: null, aiParsed: false, aiNotes: '',
    questions: [],
  };

  const teams = getTeams();
  if (teams.length) W.teamId = teams[0].id;

  const overlayHost = document.createElement('div');
  document.body.appendChild(overlayHost);

  const stepsBar = () => `
    <div class="wiz-steps">
      ${[['1', 'Goal'], ['2', 'The list'], ['3', 'Questions'], ['4', 'Launch']].map(([n, label], i) => `
        <div class="wiz-step ${W.step === i + 1 ? 'active' : ''} ${W.step > i + 1 ? 'done' : ''}">
          <span class="n">${W.step > i + 1 ? '✓' : n}</span> ${label}
        </div>${i < 3 ? '<div class="wiz-sep"></div>' : ''}
      `).join('')}
    </div>`;

  function render() {
    const body = document.getElementById('wiz-body');
    if (!body) return;
    document.getElementById('wiz-steps-host').innerHTML = stepsBar();
    if (W.step === 1) renderStep1(body);
    if (W.step === 2) renderStep2(body);
    if (W.step === 3) renderStep3(body);
    if (W.step === 4) renderStep4(body);
  }

  showModal({
    title: 'New LOD',
    size: 'xl',
    content: `<div id="wiz-steps-host"></div><div id="wiz-body"></div>`,
    onClose: () => overlayHost.remove(),
  });
  render();

  // ---------- Step 1: goal & team ----------
  function renderStep1(body) {
    const teamsNow = getTeams();
    body.innerHTML = `
      <div class="form-group">
        <label class="form-label">LOD name</label>
        <input class="input" id="w-name" placeholder="e.g. High-TPC non-transactors — Nagpur" value="${esc(W.name)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Team</label>
        <div style="display:flex; gap:8px">
          <select class="select" id="w-team" style="flex:1">
            ${teamsNow.map(t => `<option value="${t.id}" ${t.id === W.teamId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select>
          <button class="btn btn-secondary" id="w-add-team">${icon('plus')} Team</button>
        </div>
        <p class="hint" style="margin-top:6px">Any team can onboard — Category, HR, Tech, Seller Ops… the skeleton is the same.</p>
      </div>
      <div class="form-group">
        <label class="form-label">The goal — what must every call answer?</label>
        <textarea class="notes-area" id="w-goal" style="min-height:90px" placeholder="e.g. Why are repeat grocery users not buying Biscuits & Namkeen despite browsing them? / Why did this employee's weekly metric drop?">${esc(W.goal)}</textarea>
        <p class="hint" style="margin-top:6px">The AI builds the question stack and reads live notes against this goal. Be specific.</p>
      </div>
      <div class="form-actions" style="display:flex; justify-content:flex-end; gap:10px; margin-top:18px">
        <button class="btn btn-primary" id="w-next1">Continue ${icon('arrowRight')}</button>
      </div>`;

    body.querySelector('#w-add-team')?.addEventListener('click', () => {
      const name = prompt('New team name (e.g. "HR", "Seller Ops", "Fashion — Category")');
      if (name && name.trim()) {
        const t = saveTeam({ name: name.trim() });
        W.teamId = t.id;
        render();
      }
    });
    body.querySelector('#w-next1')?.addEventListener('click', () => {
      W.name = body.querySelector('#w-name').value.trim();
      W.teamId = body.querySelector('#w-team').value;
      W.goal = body.querySelector('#w-goal').value.trim();
      if (!W.name) return showToast('Give the LOD a name', 'warning');
      if (!W.teamId) return showToast('Pick or create a team', 'warning');
      if (W.goal.length < 15) return showToast('Write a real goal — the AI works off it', 'warning');
      W.step = 2; render();
    });
  }

  // ---------- Step 2: paste the list ----------
  function renderStep2(body) {
    const ai = aiStatus();
    body.innerHTML = `
      <div class="form-group">
        <label class="form-label">Paste your list — straight from Sheets / CSV / anywhere</label>
        <textarea class="paste-zone" id="w-raw" placeholder="Paste rows with headers (meesho_user_id, phone_number, name, any metric columns…) — or just names and numbers. Messy is fine.">${esc(W.raw)}</textarea>
      </div>
      <div class="parse-tally" id="w-tally"></div>
      <div id="w-preview"></div>
      <div class="form-actions" style="display:flex; justify-content:space-between; gap:10px; margin-top:18px; flex-wrap:wrap">
        <button class="btn btn-ghost" id="w-back2">${icon('arrowLeft')} Back</button>
        <div style="display:flex; gap:10px">
          <button class="btn btn-secondary" id="w-ai-parse" ${ai.configured ? '' : 'disabled title="Configure AI in Settings"'}>${icon('sparkles')} AI clean-up parse</button>
          <button class="btn btn-primary" id="w-next2" disabled>Continue ${icon('arrowRight')}</button>
        </div>
      </div>`;

    const rawEl = body.querySelector('#w-raw');
    const tallyEl = body.querySelector('#w-tally');
    const prevEl = body.querySelector('#w-preview');
    const nextBtn = body.querySelector('#w-next2');

    const renderPreview = () => {
      if (!W.parsed || !W.parsed.rows.length) {
        tallyEl.innerHTML = W.raw.trim() ? `<span class="bad">No valid phone numbers found yet</span>` : '';
        prevEl.innerHTML = '';
        nextBtn.disabled = true;
        return;
      }
      const { rows, invalid, dup, columns } = W.parsed;
      tallyEl.innerHTML = `
        <span><strong class="ok">${rows.length}</strong> contacts ready</span>
        <span>${columns.length} context columns</span>
        ${dup ? `<span>${dup} repeated</span>` : ''}
        ${invalid ? `<span class="bad">${invalid} without a valid number</span>` : ''}
        ${W.aiParsed ? `<span class="tagchip">${icon('sparkles')} AI-parsed${W.aiNotes ? ' — ' + esc(W.aiNotes) : ''}</span>` : ''}`;
      const showCols = columns.slice(0, 6);
      prevEl.innerHTML = `
        <div class="preview-wrap">
          <table>
            <thead><tr><th>Name</th><th>Phone</th>${showCols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
            <tbody>
              ${rows.slice(0, 6).map(r => `
                <tr><td>${esc(r.name || '—')}</td><td class="mono-cell">${esc(r.phone)}</td>
                ${showCols.map(c => `<td>${esc(r.data[c.key] || '')}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${rows.length > 6 ? `<p class="hint" style="margin-top:6px">…and ${rows.length - 6} more</p>` : ''}`;
      nextBtn.disabled = false;
    };

    const recompute = () => {
      W.raw = rawEl.value;
      W.aiParsed = false; W.aiNotes = '';
      W.parsed = W.raw.trim() ? parseContactsDeterministic(W.raw) : null;
      renderPreview();
    };
    rawEl.addEventListener('input', recompute);
    if (W.raw.trim() && !W.parsed) recompute(); else renderPreview();

    body.querySelector('#w-ai-parse')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!W.raw.trim()) return showToast('Paste something first', 'warning');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2.5px"></span> AI parsing…';
      try {
        const det = parseContactsDeterministic(W.raw);
        const out = await parseContactsAI(W.raw, {
          goal: W.goal,
          hint: det.columns.map(c => c.label),
        });
        if (out && out.contacts.length) {
          W.parsed = { rows: out.contacts, columns: out.columns, invalid: 0, dup: 0 };
          W.aiParsed = true;
          W.aiNotes = out.notes || '';
          showToast(`AI parsed ${out.contacts.length} contacts`, 'success');
        } else {
          showToast('AI parse came back empty — using the standard parser', 'warning');
        }
      } catch (err) {
        console.warn(err);
        showToast('AI parse failed — standard parser still works', 'error');
      }
      btn.disabled = false;
      btn.innerHTML = `${icon('sparkles')} AI clean-up parse`;
      renderPreview();
    });

    body.querySelector('#w-back2')?.addEventListener('click', () => { W.step = 1; render(); });
    nextBtn.addEventListener('click', () => {
      if (!W.parsed || !W.parsed.rows.length) return;
      W.step = 3; render();
      if (!W.questions.length) autoQuestions();
    });
  }

  // ---------- Step 3: question stack ----------
  function renderStep3(body) {
    const ai = aiStatus();
    body.innerHTML = `
      <div class="goal-banner" style="margin-bottom:16px">${icon('target')}<div><span class="k">Goal</span>${esc(W.goal)}</div></div>
      <div class="eyebrow" style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center">
        <span>Question stack — flashed during calls</span>
        <span id="w-q-state"></span>
      </div>
      <div class="qstack" id="w-qlist"></div>
      <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap">
        <input class="input" id="w-q-new" placeholder="Add your own question…" style="flex:1; min-width:220px" />
        <button class="btn btn-secondary" id="w-q-add">${icon('plus')} Add</button>
        <button class="btn btn-secondary" id="w-q-regen" ${ai.configured ? '' : 'disabled'}>${icon('refresh')} Regenerate with AI</button>
      </div>
      <div class="form-actions" style="display:flex; justify-content:space-between; gap:10px; margin-top:18px">
        <button class="btn btn-ghost" id="w-back3">${icon('arrowLeft')} Back</button>
        <button class="btn btn-primary" id="w-next3" ${W.questions.length ? '' : 'disabled'}>Continue ${icon('arrowRight')}</button>
      </div>`;

    const renderList = () => {
      const el = body.querySelector('#w-qlist');
      if (!el) return;
      el.innerHTML = W.questions.length ? W.questions.map((q, i) => `
        <div class="qrow" data-type="${q.type}" data-i="${i}" style="cursor:default">
          <span class="q-ico">${i + 1}</span>
          <span class="q-text" style="flex:1">${esc(q.text)}</span>
          <span class="q-type">${q.type}</span>
          <button class="btn btn-ghost btn-sm" data-del="${i}" title="Remove" style="padding:2px 8px">${icon('x')}</button>
        </div>`).join('')
        : `<p class="hint">No questions yet — generate with AI or add manually.</p>`;
      el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        W.questions.splice(Number(b.dataset.del), 1);
        renderList();
        body.querySelector('#w-next3').disabled = !W.questions.length;
      }));
    };
    renderList();

    body.querySelector('#w-q-add')?.addEventListener('click', () => {
      const inp = body.querySelector('#w-q-new');
      const text = inp.value.trim();
      if (!text) return;
      W.questions.push({ id: uid('q'), text, type: 'probe' });
      inp.value = '';
      renderList();
      body.querySelector('#w-next3').disabled = false;
    });
    body.querySelector('#w-q-regen')?.addEventListener('click', () => autoQuestions(true));
    body.querySelector('#w-back3')?.addEventListener('click', () => { W.step = 2; render(); });
    body.querySelector('#w-next3')?.addEventListener('click', () => {
      if (!W.questions.length) return;
      W.step = 4; render();
    });

    // expose state setter for autoQuestions
    W._setQState = (html) => {
      const el = body.querySelector('#w-q-state');
      if (el) el.innerHTML = html;
    };
    W._renderQList = renderList;
  }

  async function autoQuestions(force = false) {
    if (!aiStatus().configured) return;
    if (W.questions.length && !force) return;
    W._setQState?.(`<span class="ai-thinking"><span class="spark">${icon('sparkles')}</span> writing questions…</span>`);
    try {
      const sample = W.parsed?.rows?.[0] ? { name: W.parsed.rows[0].name, ...W.parsed.rows[0].data } : null;
      const qs = await generateQuestions(W.goal, {
        teamName: getTeams().find(t => t.id === W.teamId)?.name || '',
        sampleContact: sample,
      });
      if (qs && qs.length) {
        W.questions = qs.map(q => ({ id: uid('q'), ...q }));
        showToast(`AI drafted ${qs.length} questions`, 'success');
      } else {
        showToast('AI question draft failed — add questions manually', 'warning');
      }
    } catch (e) {
      console.warn(e);
      showToast('AI question draft failed — add questions manually', 'error');
    }
    W._setQState?.('');
    W._renderQList?.();
    const nextBtn = document.getElementById('wiz-body')?.querySelector('#w-next3');
    if (nextBtn) nextBtn.disabled = !W.questions.length;
  }

  // ---------- Step 4: launch ----------
  function renderStep4(body) {
    const teamsNow = getTeams();
    body.innerHTML = `
      <div class="card card-pad" style="background:var(--surface-2); margin-bottom:16px">
        <div class="eyebrow" style="margin-bottom:12px">Ready to launch</div>
        <div class="kv info-grid">
          <div class="info-cell"><div class="info-label">LOD</div><div class="info-value">${esc(W.name)}</div></div>
          <div class="info-cell"><div class="info-label">Team</div><div class="info-value">${esc(teamsNow.find(t => t.id === W.teamId)?.name || '')}</div></div>
          <div class="info-cell"><div class="info-label">Contacts</div><div class="info-value">${W.parsed.rows.length}</div></div>
          <div class="info-cell"><div class="info-label">Questions</div><div class="info-value">${W.questions.length}</div></div>
        </div>
      </div>
      <div class="goal-banner" style="margin-bottom:20px">${icon('target')}<div><span class="k">Goal</span>${esc(W.goal)}</div></div>
      <div class="form-actions" style="display:flex; justify-content:space-between; gap:10px">
        <button class="btn btn-ghost" id="w-back4">${icon('arrowLeft')} Back</button>
        <button class="btn btn-primary btn-lg" id="w-launch">${icon('phoneCall')} Launch LOD</button>
      </div>`;

    body.querySelector('#w-back4')?.addEventListener('click', () => { W.step = 3; render(); });
    body.querySelector('#w-launch')?.addEventListener('click', () => {
      const user = getCurrentUser();
      const lod = saveLod({
        name: W.name, teamId: W.teamId, goal: W.goal,
        questions: W.questions,
        columns: W.parsed.columns || [],
        contacts: W.parsed.rows.map(r => ({
          id: uid('c'), status: 'pending', attempts: 0,
          name: r.name || '', phone: r.phone, phones: r.phones && r.phones.length ? r.phones : [r.phone],
          ext_id: r.ext_id || '', data: r.data || {},
        })),
        createdBy: user?.id || null,
      });
      closeModal();
      overlayHost.remove();
      showToast('LOD launched — go listen', 'success');
      navigate(`lods/${lod.id}`);
    });
  }
}

export { openWizard };
