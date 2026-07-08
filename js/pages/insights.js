// ============================================================
// Meesho LOD — Insights
//
// Pick a LOD, get a per-question rollup: for every question in that
// LOD's stack, how many calls answered it, an AI insight synthesizing
// all the answers, and the raw one-line answers underneath.
// The raw aggregation is deterministic (always shown); the AI insight
// is an optional deep-model pass, cached per LOD.
// ============================================================

import { getLods, getLod, getCalls, getSettings, saveSettings } from '../store.js';
import { synthesizeByQuestion, aiStatus } from '../ai.js';
import { showToast } from '../components/toast.js';
import { icon } from '../components/icons.js';
import { navigate } from '../router.js';
import { getVariant } from '../variant.js';
import { esc, fmtDate } from '../utils/format.js';

export function renderInsights(container) {
  // only LODs for the current surface (online /u vs field /s)
  const wantMode = getVariant().mode;
  const lods = getLods().filter(l => (l.mode || 'online') === wantMode);

  if (!lods.length) {
    container.innerHTML = `
      <div class="page-header"><div><h1>Insights</h1><p class="header-subtitle">Question-by-question, across every call</p></div></div>
      <div class="empty-state card card-pad" style="text-align:center; padding:60px 24px">
        <div style="font-size:40px; margin-bottom:12px">💡</div>
        <h3 style="margin-bottom:8px">No LODs yet</h3>
        <p style="color:var(--ink-3); margin-bottom:20px">Create a LOD and make (or upload) some calls — insights build up here.</p>
        <button class="btn btn-primary" id="go-lods">${icon('plus')} Create a LOD</button>
      </div>`;
    container.querySelector('#go-lods')?.addEventListener('click', () => navigate('lods'));
    return;
  }

  const settings = getSettings();
  let lodId = (settings.insightsLodId && lods.some(l => l.id === settings.insightsLodId)) ? settings.insightsLodId : lods[0].id;

  container.innerHTML = `
    <div class="page-header">
      <div><h1>Insights</h1><p class="header-subtitle">Every question in a LOD, answered across all its calls</p></div>
      <div class="pg-actions">
        <select class="select" id="in-lod" style="min-width:220px">
          ${lods.map(l => `<option value="${l.id}" ${l.id === lodId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
        </select>
        <button class="btn btn-primary" id="in-generate">${icon('sparkles')} Generate AI insights</button>
      </div>
    </div>
    <div id="in-body"></div>`;

  const body = container.querySelector('#in-body');
  const currentLod = () => getLod(lodId);

  container.querySelector('#in-lod').addEventListener('change', (e) => {
    lodId = e.target.value;
    saveSettings({ insightsLodId: lodId });
    renderBody();
  });
  container.querySelector('#in-generate').addEventListener('click', (e) => runGenerate(currentLod(), e.currentTarget));

  function renderBody() {
    const lod = currentLod();
    const questions = lod.questions || [];
    const calls = getCalls({ lodId: lod.id });
    const s = getSettings();
    const cached = s['qinsights_' + lod.id] || {};
    const cachedTs = s['qinsights_ts_' + lod.id];

    if (!questions.length) {
      body.innerHTML = `
        <div class="empty-state card card-pad" style="text-align:center; padding:60px 24px">
          <div style="font-size:40px; margin-bottom:12px">❓</div>
          <h3 style="margin-bottom:8px">No questions on this LOD</h3>
          <p style="color:var(--ink-3)">Add questions from the LOD detail page — insights are built per question.</p>
        </div>`;
      return;
    }
    if (!calls.length) {
      body.innerHTML = `
        <div class="empty-state card card-pad" style="text-align:center; padding:60px 24px">
          <div style="font-size:40px; margin-bottom:12px">📞</div>
          <h3 style="margin-bottom:8px">No calls yet for this LOD</h3>
          <p style="color:var(--ink-3)">Start calling or upload recordings — answers roll up here per question.</p>
        </div>`;
      return;
    }

    // per-question aggregation (deterministic)
    const perQ = questions.map(q => {
      const answers = [];
      for (const c of calls) {
        const a = (c.answers || {})[q.id];
        if (a) {
          const contact = lod.contacts.find(x => x.id === c.contactId) || {};
          answers.push({ who: contact.name || c.customerLabel || contact.ext_id || contact.phone || 'Unknown', answer: String(a) });
        }
      }
      return { q, answers };
    });

    const hasInsights = Object.keys(cached).length > 0;
    // customers actually spoken to — the denominator for "N of M customers"
    const connectedCount = calls.filter(c => c.connected).length || calls.length;

    // AI insight block: a counted breakdown of how customers answered
    const renderInsightBlock = (insight, total) => {
      if (!insight) return '';
      // back-compat: an earlier version cached a plain prose string
      const takeaway = typeof insight === 'string' ? insight : (insight.takeaway || '');
      const breakdown = (insight && typeof insight === 'object' && Array.isArray(insight.breakdown)) ? insight.breakdown : [];
      if (!takeaway && !breakdown.length) return '';
      const max = breakdown.reduce((m, b) => Math.max(m, b.count || 0), 0) || 1;
      return `
        <div class="in-insight">
          <div class="in-insight-eyebrow">${icon('sparkles')} AI insight</div>
          ${takeaway ? `<p>${esc(takeaway)}</p>` : ''}
          ${breakdown.length ? `<div class="in-breakdown">
            ${breakdown.map(b => {
              const pct = total ? Math.round((b.count / total) * 100) : 0;
              return `
                <div class="in-bd-row">
                  <span class="in-bd-count" title="${b.count} of ${total} customers">${b.count}</span>
                  <div class="in-bd-main">
                    <div class="in-bd-label">${esc(b.label)}</div>
                    <div class="in-bd-bar"><span style="width:${Math.round((b.count / max) * 100)}%"></span></div>
                  </div>
                  <span class="in-bd-pct">${pct}%</span>
                </div>`;
            }).join('')}
          </div>` : ''}
        </div>`;
    };

    // group by theme when the stack uses themes (same convention as the calling console)
    const useThemes = questions.some(q => q.theme);
    let n = 0;
    const cardFor = ({ q, answers }) => {
      n++;
      const insight = cached[q.id];
      // how many customers this question's insight covers (bucket sum), else raw answers
      const bd = (insight && typeof insight === 'object' && Array.isArray(insight.breakdown)) ? insight.breakdown : [];
      const responded = bd.length ? bd.reduce((s, b) => s + (b.count || 0), 0) : answers.length;
      const answersHtml = answers.length ? `
        <details class="in-answers">
          <summary>${answers.length} extracted answer${answers.length === 1 ? '' : 's'}</summary>
          <div style="display:flex; flex-direction:column; gap:8px; margin-top:10px">
            ${answers.map(a => `
              <div class="ans-chip">
                <strong style="flex-shrink:0; color:var(--ink-3); min-width:0">${esc(a.who)}</strong>
                <span>${esc(a.answer)}</span>
              </div>`).join('')}
          </div>
        </details>`
        : (insight ? '' : `<p class="hint" style="margin-top:8px">No response captured for this question yet — hit Generate AI insights.</p>`);

      return `
        <div class="card card-pad" style="margin-bottom:14px">
          <div class="eyebrow" style="margin-bottom:8px; display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap">
            <span>Q${n} · ${esc(q.type)}${q.theme ? ' · ' + esc(q.theme) : ''}</span>
            <span style="color:var(--ink-4)">${responded}/${connectedCount} customers</span>
          </div>
          <div style="font:var(--t-body-strong); margin-bottom:10px">${esc(q.text)}</div>
          ${renderInsightBlock(insight, connectedCount)}
          ${answersHtml}
        </div>`;
    };

    let cardsHtml = '';
    if (useThemes) {
      const order = [];
      const groups = {};
      perQ.forEach(item => {
        const t = item.q.theme || 'More questions';
        if (!groups[t]) { groups[t] = []; order.push(t); }
        groups[t].push(item);
      });
      cardsHtml = order.map(theme => `
        <div class="qtheme-head" style="margin-bottom:10px"><span>${esc(theme)}</span></div>
        ${groups[theme].map(cardFor).join('')}`).join('');
    } else {
      cardsHtml = perQ.map(cardFor).join('');
    }

    body.innerHTML = `
      <div class="goal-banner" style="margin-bottom:18px">${icon('target')}<div><span class="k">Goal</span>${esc(lod.goal)}</div></div>

      <div class="stats-grid" style="margin-bottom:18px">
        <div class="stat-card"><div class="stat-ico">${icon('phoneCall')}</div><div class="stat-num">${calls.length}</div><div class="stat-lbl">Calls logged</div></div>
        <div class="stat-card"><div class="stat-ico">${icon('message')}</div><div class="stat-num">${questions.length}</div><div class="stat-lbl">Questions</div></div>
        <div class="stat-card"><div class="stat-ico">${icon('checkCircle')}</div><div class="stat-num">${connectedCount}</div><div class="stat-lbl">Customers spoken to</div></div>
        <div class="stat-card"><div class="stat-ico">${icon('sparkles')}</div><div class="stat-num" style="font-size:15px">${hasInsights ? (cachedTs ? esc(fmtDate(cachedTs)) : 'Ready') : '—'}</div><div class="stat-lbl">AI insights</div></div>
      </div>

      ${!hasInsights ? `<p class="hint" style="margin:-4px 0 14px">Answers are grouped per question below. Hit <strong>Generate AI insights</strong> to see, per question, how many customers said what (e.g. “5 found pricing too high”).</p>` : ''}

      ${cardsHtml}`;
  }

  async function runGenerate(lod, btn) {
    const calls = getCalls({ lodId: lod.id });
    if (!calls.length) return showToast('No calls to analyze yet', 'warning');
    if (!(lod.questions || []).length) return showToast('This LOD has no questions', 'warning');
    if (!aiStatus().configured) return showToast('Configure AI in Settings first', 'warning');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2.5px"></span> Analyzing… (deep model, ~30s)';
    try {
      const insights = await synthesizeByQuestion({ lod, calls });
      if (!insights || !Object.keys(insights).length) throw new Error('no insights returned');
      const ts = Date.now();
      saveSettings({ ['qinsights_' + lod.id]: insights, ['qinsights_ts_' + lod.id]: ts });
      // the user may have switched LODs mid-flight — only redraw if still here
      if (lodId === lod.id) { renderBody(); showToast('Insights ready', 'success'); }
      else showToast(`Insights ready for ${lod.name}`, 'success');
    } catch (err) {
      console.warn(err);
      showToast('Insight generation failed — try again', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = orig;
  }

  renderBody();
}
