// ============================================================
// Meesho LOD — Results: what the calls actually found.
// Per-LOD stats, tag distribution, call log, CSV export and
// AI-synthesized insight reports (cached per LOD).
// ============================================================

import { getLods, getCalls, getSettings, saveSettings } from '../store.js';
import { synthesize, aiStatus } from '../ai.js';
import { showToast } from '../components/toast.js';
import { showModal } from '../components/modal.js';
import { icon } from '../components/icons.js';
import { dispositionMeta } from '../config.js';
import { esc, fmtDuration, timeAgo, fmtDate, mdToHtml } from '../utils/format.js';
import { toCSV } from '../utils/parse.js';

const CHIP_CLASSES = ['', 't2', 't3', 't4'];

export function renderResults(container) {
  const lods = getLods();

  if (!lods.length) {
    container.innerHTML = `
      <div class="page-header"><div><h1>Results</h1><p class="header-subtitle">What the calls found</p></div></div>
      <div class="empty-state card card-pad" style="text-align:center; padding:60px 24px">
        <div style="font-size:40px; margin-bottom:12px">📊</div>
        <h3 style="margin-bottom:8px">No LODs yet</h3>
        <p style="color:var(--ink-3)">Create a LOD and make some calls — results land here.</p>
      </div>`;
    return;
  }

  const settings = getSettings();
  let lodId = settings.resultsLodId;
  if (!lods.some(l => l.id === lodId)) lodId = lods[0].id;

  container.innerHTML = `
    <div class="page-header">
      <div><h1>Results</h1><p class="header-subtitle">What the calls found</p></div>
      <div class="pg-actions">
        <select class="select" id="res-lod" style="min-width:200px">
          ${lods.map(l => `<option value="${l.id}" ${l.id === lodId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
        </select>
        <button class="btn btn-secondary" id="res-export">${icon('download')} Export CSV</button>
        <button class="btn btn-primary" id="res-synth">${icon('sparkles')} Synthesize insights</button>
      </div>
    </div>
    <div id="res-body"></div>`;

  const body = container.querySelector('#res-body');

  container.querySelector('#res-lod').addEventListener('change', (e) => {
    lodId = e.target.value;
    saveSettings({ resultsLodId: lodId });
    renderBody();
  });
  container.querySelector('#res-export').addEventListener('click', () => exportCSV(currentLod()));
  container.querySelector('#res-synth').addEventListener('click', (e) => runSynthesis(currentLod(), e.currentTarget));

  const currentLod = () => lods.find(l => l.id === lodId);

  function renderBody() {
    const lod = currentLod();
    const calls = getCalls({ lodId: lod.id }).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));

    if (!calls.length) {
      body.innerHTML = `
        <div class="empty-state card card-pad" style="text-align:center; padding:60px 24px">
          <div style="font-size:40px; margin-bottom:12px">📞</div>
          <h3 style="margin-bottom:8px">No calls yet for this LOD</h3>
          <p style="color:var(--ink-3)">Start calling or upload recordings — every logged call shows up here.</p>
        </div>`;
      return;
    }

    // ---- stats ----
    const connected = calls.filter(c => c.connected).length;
    const durs = calls.filter(c => c.durationSec > 0);
    const avgDur = durs.length ? durs.reduce((s, c) => s + c.durationSec, 0) / durs.length : 0;
    const tagCounts = {};
    calls.forEach(c => (c.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
    const tagsSorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
    const topTag = tagsSorted[0]?.[0] || '—';

    const contactOf = (call) => lod.contacts.find(c => c.id === call.contactId);

    // ---- cached report ----
    const s = getSettings();
    const cachedMd = s['synth_' + lod.id];
    const cachedTs = s['synth_ts_' + lod.id];

    body.innerHTML = `
      <div id="res-report">${cachedMd ? reportCard(cachedMd, cachedTs) : ''}</div>

      <div class="stats-grid" style="margin-bottom:18px">
        <div class="stat-card"><div class="stat-ico">${icon('phoneCall')}</div><div class="stat-num">${calls.length}</div><div class="stat-lbl">Calls logged</div></div>
        <div class="stat-card"><div class="stat-ico">${icon('phone')}</div><div class="stat-num">${Math.round(connected / calls.length * 100)}%</div><div class="stat-lbl">Connected</div></div>
        <div class="stat-card"><div class="stat-ico">${icon('clock')}</div><div class="stat-num">${fmtDuration(avgDur)}</div><div class="stat-lbl">Avg duration</div></div>
        <div class="stat-card"><div class="stat-ico">${icon('star')}</div><div class="stat-num" style="font-size:18px">${esc(topTag)}</div><div class="stat-lbl">Top tag</div></div>
      </div>

      ${tagsSorted.length ? `
      <div class="card card-pad" style="margin-bottom:18px">
        <div class="eyebrow" style="margin-bottom:10px">Tag distribution</div>
        <div class="tagrow">
          ${tagsSorted.map(([t, n], i) => `<span class="tagchip ${CHIP_CLASSES[i % CHIP_CLASSES.length]}">${esc(t)} · ${n}</span>`).join('')}
        </div>
      </div>` : ''}

      <div class="table-container">
        <table class="data-table">
          <thead><tr><th>Contact</th><th>Disposition</th><th>Duration</th><th>Tags</th><th>Summary</th><th>When</th></tr></thead>
          <tbody>
            ${calls.map(call => {
              const c = contactOf(call);
              const d = dispositionMeta(call.disposition);
              const summary = call.summary || (call.notes || '').slice(0, 90);
              return `
              <tr data-call="${call.id}" style="cursor:pointer">
                <td><strong>${esc(c?.name || call.customerLabel || '—')}</strong>${c?.ext_id ? `<div class="mono-cell" style="font-size:11px; color:var(--ink-3)">${esc(c.ext_id)}</div>` : ''}</td>
                <td><span class="badge badge-${d.tone}">${esc(d.label)}</span>${call.source === 'voice_upload' ? ` <span class="badge badge-info">🎙 Uploaded</span>` : ''}</td>
                <td class="mono-cell">${call.durationSec ? fmtDuration(call.durationSec) : '—'}</td>
                <td><div class="tagrow" style="gap:4px">${(call.tags || []).slice(0, 3).map((t, i) => `<span class="tagchip ${CHIP_CLASSES[i % CHIP_CLASSES.length]}">${esc(t)}</span>`).join('')}</div></td>
                <td style="max-width:320px"><span style="font:var(--t-sm); color:var(--ink-3)">${esc(summary)}${summary && !call.summary && (call.notes || '').length > 90 ? '…' : ''}</span></td>
                <td style="white-space:nowrap; color:var(--ink-3)">${esc(timeAgo(call.ts))}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;

    body.querySelectorAll('[data-call]').forEach(row => {
      row.addEventListener('click', () => {
        const call = calls.find(c => c.id === row.dataset.call);
        if (call) openCallDetail(lod, call, contactOf(call));
      });
    });
    body.querySelector('#res-regen')?.addEventListener('click', () =>
      runSynthesis(lod, container.querySelector('#res-synth')));
  }

  function reportCard(md, ts) {
    return `
      <div class="card card-pad" style="margin-bottom:18px">
        <div class="eyebrow" style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap">
          <span>${icon('sparkles')} Synthesized insights${ts ? ` · ${esc(fmtDate(ts))}` : ''}</span>
          <button class="btn btn-ghost btn-sm" id="res-regen">${icon('refresh')} Regenerate</button>
        </div>
        <div class="report">${mdToHtml(md)}</div>
      </div>`;
  }

  // ---------- synthesize ----------
  async function runSynthesis(lod, btn) {
    const calls = getCalls({ lodId: lod.id });
    if (!calls.length) return showToast('No calls to synthesize yet', 'warning');
    if (!aiStatus().configured) return showToast('Configure AI in Settings first', 'warning');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2.5px"></span> Synthesizing… (deep model, ~30s)';
    try {
      const md = await synthesize({ lod, calls });
      if (!md) throw new Error('empty synthesis');
      const ts = Date.now();
      saveSettings({ ['synth_' + lod.id]: md, ['synth_ts_' + lod.id]: ts });
      // the user may have switched LODs while the deep model was thinking —
      // only patch the DOM if we're still looking at the LOD this was for
      if (lodId === lod.id) {
        const host = body.querySelector('#res-report');
        if (host) {
          host.innerHTML = reportCard(md, ts);
          host.querySelector('#res-regen')?.addEventListener('click', () => runSynthesis(currentLod(), container.querySelector('#res-synth')));
        }
        showToast('Insights ready', 'success');
      } else {
        showToast(`Insights ready for ${lod.name}`, 'success');
      }
    } catch (err) {
      console.warn(err);
      showToast('Synthesis failed — try again', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = orig;
  }

  // ---------- CSV export ----------
  function exportCSV(lod) {
    const calls = getCalls({ lodId: lod.id });
    if (!calls.length) return showToast('No calls to export', 'warning');
    const qs = lod.questions || [];
    const headers = ['name', 'phone', 'ext_id', 'source', 'disposition', 'duration_sec', 'summary', 'tags', 'notes', ...qs.map(q => q.text)];
    const rows = calls.map(call => {
      const c = lod.contacts.find(x => x.id === call.contactId);
      return [
        c?.name || call.customerLabel || '', c?.phone || '', c?.ext_id || '',
        call.source === 'voice_upload' ? 'recording' : 'live',
        call.disposition || '', call.durationSec || 0,
        call.summary || '', (call.tags || []).join('; '), call.notes || '',
        ...qs.map(q => (call.answers || {})[q.id] || ''),
      ];
    });
    const blob = new Blob([toCSV(headers, rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lod.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'lod'}-results.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`Exported ${rows.length} calls`, 'success');
  }

  // ---------- call detail modal ----------
  function openCallDetail(lod, call, contact) {
    const d = dispositionMeta(call.disposition);
    const qs = lod.questions || [];
    const qText = (qid) => qs.find(q => q.id === qid)?.text || qid;
    const answers = Object.entries(call.answers || {});
    const dataEntries = Object.entries(contact?.data || {});

    showModal({
      title: `${contact?.name || call.customerLabel || 'Call'} — call detail`,
      size: 'lg',
      content: `
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:14px">
          <span class="badge badge-${d.tone}">${esc(d.label)}</span>
          ${call.source === 'voice_upload' ? `<span class="badge badge-info">🎙 ${esc(call.audioFileName || 'Uploaded recording')}</span>` : ''}
          ${call.durationSec ? `<span class="mono-cell">${fmtDuration(call.durationSec)}</span>` : ''}
          <span style="color:var(--ink-3); font:var(--t-sm)">${esc(timeAgo(call.ts))}</span>
        </div>

        ${dataEntries.length ? `
        <div class="eyebrow" style="margin-bottom:8px">Contact context</div>
        <div class="info-grid kv" style="margin-bottom:16px">
          ${contact?.phone ? `<div class="info-cell"><div class="info-label">Phone</div><div class="info-value mono-cell">${esc(contact.phone)}</div></div>` : ''}
          ${contact?.ext_id ? `<div class="info-cell"><div class="info-label">ID</div><div class="info-value mono-cell">${esc(contact.ext_id)}</div></div>` : ''}
          ${dataEntries.map(([k, v]) => `<div class="info-cell"><div class="info-label">${esc(k)}</div><div class="info-value">${esc(String(v))}</div></div>`).join('')}
        </div>` : ''}

        ${answers.length ? `
        <div class="eyebrow" style="margin-bottom:8px">Answers</div>
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px">
          ${answers.map(([qid, ans]) => `
            <div class="ans-chip"><strong style="display:block; font:var(--t-sm); color:var(--ink-3); margin-bottom:2px">${esc(qText(qid))}</strong>${esc(String(ans))}</div>`).join('')}
        </div>` : ''}

        ${call.summary ? `
        <div class="eyebrow" style="margin-bottom:8px">AI summary</div>
        <p style="font:var(--t-sm); margin-bottom:16px">${esc(call.summary)}</p>` : ''}

        ${call.notes ? `
        <div class="eyebrow" style="margin-bottom:8px">Notes</div>
        <div class="card card-pad" style="background:var(--surface-2); white-space:pre-wrap; font:var(--t-sm); margin-bottom:16px">${esc(call.notes)}</div>` : ''}

        ${(call.tags || []).length ? `
        <div class="eyebrow" style="margin-bottom:8px">Tags</div>
        <div class="tagrow">${call.tags.map((t, i) => `<span class="tagchip ${CHIP_CLASSES[i % CHIP_CLASSES.length]}">${esc(t)}</span>`).join('')}</div>` : ''}
      `,
    });
  }

  renderBody();
}
