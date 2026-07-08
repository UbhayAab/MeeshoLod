// ============================================================
// Meesho LOD — Voice Upload
// Batch-transcribe calls that already happened against a LOD's
// predefined question set. The transcript stands in for the live
// caller's "notes" — everything downstream (summarizeCall, tag
// distribution, synthesis) is exactly what Results already does
// for live calls; this page's only job is turning audio into a
// saved call record.
// ============================================================

import { getLods, getLod, saveCall, updateContact, getSettings, saveSettings } from '../store.js';
import { getCurrentUser } from '../auth.js';
import { transcribeAudio, summarizeCall, aiStatus } from '../ai.js';
import { matchContactByFilename, formatPhone } from '../utils/parse.js';
import { showToast } from '../components/toast.js';
import { icon } from '../components/icons.js';
import { navigate } from '../router.js';
import { esc, fmtDuration } from '../utils/format.js';

const MAX_FILE_BYTES = 25 * 1024 * 1024; // Whisper's per-file cap
const CONCURRENCY = 2;

let container = null;
let lodId = null;
let rows = [];       // {id, file, contactId, adhocLabel, duration, status, error, summary, tags}
let rowSeq = 0;
let processing = false;

export function renderVoiceUpload(c) {
  container = c;
  rows = [];
  processing = false;

  const lods = getLods();
  if (!lods.length) {
    container.innerHTML = `
      <div class="page-header"><div><h1>Upload Recordings</h1><p class="header-subtitle">Listen Or Die</p></div></div>
      <div class="empty-state card card-pad" style="text-align:center; padding: 60px 24px">
        <div style="font-size:40px; margin-bottom:12px">🎙️</div>
        <h3 style="margin-bottom:8px">No LODs yet</h3>
        <p style="color:var(--ink-3); margin-bottom:20px">Create a LOD first — recordings upload against its goal, question stack and contact list.</p>
        <button class="btn btn-primary" id="go-lods">${icon('plus')} Create a LOD</button>
      </div>`;
    container.querySelector('#go-lods')?.addEventListener('click', () => navigate('lods'));
    return;
  }

  const settings = getSettings();
  lodId = (settings.voiceLodId && lods.some(l => l.id === settings.voiceLodId)) ? settings.voiceLodId : lods[0].id;
  render();
}

function currentLod() { return getLod(lodId); }

function render() {
  const lods = getLods();
  const lod = currentLod();
  const ai = aiStatus();

  container.innerHTML = `
    <div class="page-header">
      <div><h1>Upload Recordings</h1><p class="header-subtitle">Batch-transcribe calls that already happened — same question stack, same summaries</p></div>
      <div class="pg-actions">
        <select class="select" id="vu-lod" style="min-width:220px">
          ${lods.map(l => `<option value="${l.id}" ${l.id === lodId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="goal-banner" style="margin-bottom:18px">
      ${icon('target')}
      <div><span class="k">Goal</span>${esc(lod.goal)}</div>
    </div>

    <div class="card card-pad" style="margin-bottom:18px">
      <div class="eyebrow" style="margin-bottom:10px">Question stack — what gets extracted from every recording</div>
      <div class="qstack">
        ${(lod.questions || []).map((q, i) => `
          <div class="qrow" style="cursor:default">
            <span class="q-ico">${i + 1}</span>
            <span class="q-text" style="flex:1">${esc(q.text)}</span>
            <span class="q-type">${esc(q.type)}</span>
          </div>`).join('') || '<p class="hint">This LOD has no questions yet — add some from LOD detail first.</p>'}
      </div>
    </div>

    ${!ai.configured ? `
    <p style="font:var(--t-xs); color:var(--warn); margin-bottom:12px">${icon('alertTriangle')} AI not configured — set the gateway key in Settings before processing recordings.</p>` : ''}

    <div class="card card-pad" style="margin-bottom:18px">
      <div class="eyebrow" style="margin-bottom:10px">Add recordings</div>
      <p class="hint" style="margin:-2px 0 12px">Recordings are grouped under this LOD — <strong>${esc(lod.name)}</strong>. To roll follow-up calls about the same issue into one summary, upload them to this same LOD later.</p>
      <div class="paste-zone" id="vu-drop" tabindex="0" style="min-height:110px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; cursor:pointer; text-align:center">
        ${icon('upload')}
        <span style="font:var(--t-sm); color:var(--ink-2)">Drag audio files here, or click to browse</span>
        <span class="hint">mp3 / wav / m4a / ogg — up to 25MB each</span>
      </div>
      <input type="file" id="vu-file-input" accept="audio/*" multiple style="display:none" />
      <p class="hint" style="margin-top:10px">Only the transcript is kept — raw audio isn't stored, so there's no playback after processing.</p>
    </div>

    <div class="card card-pad" id="vu-list-card" style="${rows.length ? '' : 'display:none'}">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px">
        <div class="eyebrow">Recordings (${rows.length})</div>
        <button class="btn btn-primary" id="vu-process" ${!ai.configured ? 'disabled' : ''}>${icon('sparkles')} Process</button>
      </div>
      <div id="vu-filelist"></div>
      <div id="vu-banner" style="margin-top:14px"></div>
    </div>
  `;

  container.querySelector('#vu-lod').addEventListener('change', (e) => {
    lodId = e.target.value;
    saveSettings({ voiceLodId: lodId });
    rows = [];
    render();
  });

  const dropZone = container.querySelector('#vu-drop');
  const fileInput = container.querySelector('#vu-file-input');
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; });
  dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = ''; });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '';
    addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

  container.querySelector('#vu-process')?.addEventListener('click', runProcessing);

  renderFileList();
}

// ---------- file intake ----------
function addFiles(fileList) {
  const lod = currentLod();
  const incoming = Array.from(fileList || []).filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|webm|aac)$/i.test(f.name));
  if (!incoming.length) { showToast('No audio files found in that selection', 'warning'); return; }

  for (const file of incoming) {
    const row = {
      id: `f${++rowSeq}`,
      file,
      contactId: '',
      adhocLabel: file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim(),
      duration: 0,
      status: file.size > MAX_FILE_BYTES ? 'error' : 'queued',
      error: file.size > MAX_FILE_BYTES ? `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB > 25MB limit) — trim or compress it` : '',
      summary: '', tags: [],
    };
    const match = matchContactByFilename(file.name, lod.contacts || []);
    if (match) { row.contactId = match.id; row.adhocLabel = ''; }
    rows.push(row);
    if (row.status === 'queued') readDuration(row);
  }
  container.querySelector('#vu-list-card').style.display = '';
  renderFileList();
}

function readDuration(row) {
  try {
    const url = URL.createObjectURL(row.file);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => {
      row.duration = Number.isFinite(audio.duration) ? Math.round(audio.duration) : 0;
      URL.revokeObjectURL(url);
      renderFileList();
    });
    audio.addEventListener('error', () => URL.revokeObjectURL(url));
    audio.src = url;
  } catch { /* best effort — duration just stays 0 */ }
}

// ---------- file list ----------
function statusChip(row) {
  const spinning = row.status === 'transcribing' || row.status === 'analyzing';
  const map = {
    queued: ['neutral', 'Queued'],
    transcribing: ['info', 'Transcribing…'],
    analyzing: ['info', 'Analyzing…'],
    done: ['ok', 'Done'],
    error: ['danger', 'Failed'],
  };
  const [tone, label] = map[row.status] || ['neutral', row.status];
  const spin = spinning ? '<span class="spinner" style="width:11px;height:11px;border-width:2px;margin-right:5px"></span>' : '';
  return `<span class="badge badge-${tone}" style="display:inline-flex; align-items:center">${spin}${esc(label)}</span>`;
}

function renderFileList() {
  const el = container.querySelector('#vu-filelist');
  const card = container.querySelector('#vu-list-card');
  if (!el || !card) return;
  card.style.display = rows.length ? '' : 'none';
  const eyebrow = card.querySelector('.eyebrow');
  if (eyebrow) eyebrow.textContent = `Recordings (${rows.length})`;

  const lod = currentLod();
  const contacts = lod.contacts || [];
  const locked = processing;

  el.innerHTML = `
    <div class="table-container">
      <table class="data-table">
        <thead><tr><th>File</th><th>Match</th><th>Duration</th><th>Status</th><th>Result</th><th></th></tr></thead>
        <tbody>
          ${rows.map(row => `
            <tr data-row="${row.id}">
              <td style="max-width:220px"><span style="font:var(--t-sm)">${esc(row.file.name)}</span></td>
              <td style="min-width:200px">
                <select class="select vu-match" data-row="${row.id}" ${locked ? 'disabled' : ''} style="margin-bottom:4px">
                  <option value="">— New / unmatched customer —</option>
                  ${contacts.map(c => `<option value="${c.id}" ${row.contactId === c.id ? 'selected' : ''}>${esc(c.name || formatPhone(c.phone))}${c.ext_id ? ' · ' + esc(c.ext_id) : ''}</option>`).join('')}
                </select>
                ${!row.contactId ? `<input class="input vu-adhoc" data-row="${row.id}" placeholder="Customer name (optional)" value="${esc(row.adhocLabel)}" ${locked ? 'disabled' : ''} style="font-size:12.5px; padding:6px 10px" />` : ''}
              </td>
              <td class="mono-cell">${row.duration ? fmtDuration(row.duration) : '—'}</td>
              <td>${statusChip(row)}</td>
              <td style="max-width:320px">
                ${row.status === 'done'
                  ? `<div class="tagrow" style="gap:4px; margin-bottom:4px">${(row.tags || []).slice(0, 3).map(t => `<span class="tagchip">${esc(t)}</span>`).join('')}</div><span style="font:var(--t-xs); color:var(--ink-3)">${esc((row.summary || '').slice(0, 90))}</span>`
                  : row.status === 'error'
                    ? `<span style="font:var(--t-xs); color:var(--danger)">${esc(row.error)}</span>`
                    : '<span style="color:var(--ink-4)">—</span>'}
              </td>
              <td style="white-space:nowrap">
                ${row.status === 'error' ? `<button class="btn btn-ghost btn-sm vu-retry" data-row="${row.id}">${icon('refresh')} Retry</button>` : ''}
                ${(row.status === 'queued' || row.status === 'error') ? `<button class="btn btn-ghost btn-sm vu-remove" data-row="${row.id}" title="Remove">${icon('x')}</button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  el.querySelectorAll('.vu-match').forEach(sel => sel.addEventListener('change', (e) => {
    const row = rows.find(r => r.id === e.target.dataset.row);
    if (row) { row.contactId = e.target.value; renderFileList(); }
  }));
  el.querySelectorAll('.vu-adhoc').forEach(inp => inp.addEventListener('input', (e) => {
    const row = rows.find(r => r.id === e.target.dataset.row);
    if (row) row.adhocLabel = e.target.value;
  }));
  el.querySelectorAll('.vu-retry').forEach(btn => btn.addEventListener('click', (e) => {
    const row = rows.find(r => r.id === e.currentTarget.dataset.row);
    if (!row) return;
    if (processing) { showToast('Already processing — wait for the current batch', 'info'); return; }
    row.status = 'queued'; row.error = '';
    processing = true;
    updateProcessButton();
    processRow(row).finally(() => { processing = false; updateProcessButton(); updateBanner(); });
  }));
  el.querySelectorAll('.vu-remove').forEach(btn => btn.addEventListener('click', (e) => {
    rows = rows.filter(r => r.id !== e.currentTarget.dataset.row);
    renderFileList();
  }));

  updateBanner();
  updateProcessButton();
}

function updateProcessButton() {
  const btn = container.querySelector('#vu-process');
  if (!btn) return;
  const eligible = rows.filter(r => r.status === 'queued');
  btn.disabled = processing || !aiStatus().configured || !eligible.length;
  btn.innerHTML = processing
    ? '<span class="spinner" style="width:16px;height:16px;border-width:2.5px"></span> Processing…'
    : `${icon('sparkles')} Process ${eligible.length || ''} recording${eligible.length === 1 ? '' : 's'}`.trim();
}

function updateBanner() {
  const el = container.querySelector('#vu-banner');
  if (!el) return;
  const done = rows.filter(r => r.status === 'done').length;
  const failed = rows.filter(r => r.status === 'error').length;
  if (!done && !failed) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="card-hover card card-pad" style="display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; background:var(--surface-2)">
      <span style="font:var(--t-sm)">${done} processed${failed ? ` · ${failed} failed` : ''}</span>
      ${done ? `<button class="btn btn-secondary btn-sm" id="vu-view-results">${icon('chart')} View in Results</button>` : ''}
    </div>`;
  el.querySelector('#vu-view-results')?.addEventListener('click', () => {
    saveSettings({ resultsLodId: lodId });
    navigate('results');
  });
}

// ---------- processing ----------
async function runProcessing() {
  if (processing) return;
  const queue = rows.filter(r => r.status === 'queued');
  if (!queue.length) return;
  processing = true;
  updateProcessButton();
  renderFileList();

  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const row = queue[cursor++];
      await processRow(row);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  processing = false;
  updateProcessButton();
  renderFileList();
  const done = queue.filter(r => r.status === 'done').length;
  const failed = queue.filter(r => r.status === 'error').length;
  showToast(`${done} recording${done === 1 ? '' : 's'} processed${failed ? ` · ${failed} failed` : ''}`, failed && !done ? 'error' : 'success');
}

async function processRow(row) {
  row.status = 'transcribing'; row.error = '';
  renderFileList();
  const lod = currentLod();
  const contact = row.contactId ? (lod.contacts || []).find(c => c.id === row.contactId) : null;

  let transcript;
  try {
    transcript = await transcribeAudio(row.file);
  } catch (e) {
    row.status = 'error';
    row.error = String(e.message || e).slice(0, 160);
    renderFileList();
    return;
  }

  row.status = 'analyzing';
  renderFileList();

  let summary = '', tags = [], answers = {};
  try {
    const out = await summarizeCall({
      goal: lod.goal, questions: lod.questions, contact: contact || { name: row.adhocLabel || 'Unmatched customer', data: {} },
      notes: transcript, disposition: 'connected', durationSec: row.duration,
    });
    if (out) { summary = out.summary || ''; tags = out.tags || []; answers = out.answers || {}; }
  } catch (e) {
    console.warn('voice-upload summarize failed — saving transcript without extraction', e);
  }

  const user = getCurrentUser();
  saveCall({
    lodId, contactId: contact?.id || null, callerId: user?.id || null,
    disposition: 'connected', connected: true,
    notes: transcript, answers, summary, tags, durationSec: row.duration,
    source: 'voice_upload', audioFileName: row.file.name,
    customerLabel: contact ? '' : (row.adhocLabel || 'Unmatched customer'),
  });
  if (contact) updateContact(lodId, contact.id, { status: 'done', attempts: (contact.attempts || 0) + 1 });

  row.status = 'done'; row.summary = summary; row.tags = tags;
  renderFileList();
}
