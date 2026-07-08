// ============================================================
// Meesho LOD Field — Record (offline, on-ground)
//
// Flow: pick a Field LOD + who you're meeting → hit Record → speak
// the real conversation (mic, continuous transcription on-device) →
// Stop → AI buckets the transcript into themes → Save the session.
// Sessions are stored as calls with mode:'offline' + transcript +
// buckets, into the SAME shared store the online surface reads.
// ============================================================

import { getLods, getLod, nextContact, updateContact, saveCall, getSettings, saveSettings } from '../store.js';
import { getCurrentUser } from '../auth.js';
import { isVoiceSupported, createVoiceSession } from '../voice.js';
import { bucketTranscript, aiStatus } from '../ai.js';
import { showToast } from '../components/toast.js';
import { icon } from '../components/icons.js';
import { avatarColor, getInitials } from '../components/sidebar.js';
import { navigate } from '../router.js';
import { esc, fmtDuration } from '../utils/format.js';
import { formatPhone } from '../utils/parse.js';

let container = null;
let voice = null;
let R = null;         // { lodId, contactId, transcript, seconds, running, buckets, summary, tags }
let tick = null;
let startEpoch = null;
let interim = '';

function fieldLods() { return getLods().filter(l => (l.mode === 'offline')); }

export function renderRecord(c) {
  container = c;
  stopTick();
  const lods = fieldLods();

  if (!lods.length) {
    container.innerHTML = `
      <div class="page-header"><div><h1>Record</h1><p class="header-subtitle">On-ground field LODs</p></div></div>
      <div class="empty-state card card-pad" style="text-align:center; padding:60px 24px">
        <div style="font-size:40px; margin-bottom:12px">🎙️</div>
        <h3 style="margin-bottom:8px">No field projects yet</h3>
        <p style="color:var(--ink-3); margin-bottom:20px">Create a field project (a goal + the people you'll meet) and start recording on the ground.</p>
        <button class="btn btn-primary" id="go-proj">${icon('plus')} New project</button>
      </div>`;
    container.querySelector('#go-proj')?.addEventListener('click', () => navigate('projects'));
    return;
  }

  const settings = getSettings();
  let lodId = lods.some(l => l.id === settings.fieldLodId) ? settings.fieldLodId : lods[0].id;
  if (!R || R.lodId !== lodId) R = freshSession(lodId);

  paint();
}

function freshSession(lodId) {
  const contact = nextContact(lodId);
  return { lodId, contactId: contact?.id || null, transcript: '', seconds: 0, running: false, buckets: null, summary: '', tags: [] };
}

function currentContact() {
  const lod = getLod(R.lodId);
  return lod?.contacts.find(c => c.id === R.contactId) || null;
}

function paint() {
  const lods = fieldLods();
  const lod = getLod(R.lodId);
  const contact = currentContact();
  const pending = lod.contacts.filter(c => c.status !== 'done');
  const ai = aiStatus();

  const who = contact ? (contact.name || `User ${contact.ext_id || ''}`) : 'Walk-in / ad-hoc';
  const dataEntries = contact ? Object.entries(contact.data || {}) : [];
  const colLabel = (k) => (lod.columns.find(cc => cc.key === k)?.label) || k.replace(/_/g, ' ');

  container.innerHTML = `
    <div class="page-header">
      <div><h1>Record</h1><p class="header-subtitle">${esc(lod.name)}</p></div>
    </div>

    <div class="rec-grid">
      <div class="rec-left">
        <div class="card card-pad" style="margin-bottom:14px">
          <div class="form-row" style="display:grid; grid-template-columns:1fr 1fr; gap:12px">
            <div class="form-group" style="margin:0">
              <label class="form-label">Field project</label>
              <select class="select" id="rec-lod">
                ${lods.map(l => `<option value="${l.id}" ${l.id === R.lodId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Who are you meeting?</label>
              <select class="select" id="rec-contact">
                <option value="">Walk-in / ad-hoc</option>
                ${lod.contacts.map(c => `<option value="${c.id}" ${c.id === R.contactId ? 'selected' : ''}>${esc(c.name || 'User ' + (c.ext_id || ''))}${c.status === 'done' ? ' ✓' : ''}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="goal-banner" style="margin-top:14px">${icon('target')}<div><span class="k">Goal</span>${esc(lod.goal)}</div></div>
          ${dataEntries.length ? `<div class="info-grid kv" style="margin-top:12px">${dataEntries.map(([k,v]) => `<div class="info-cell"><div class="info-label">${esc(colLabel(k))}</div><div class="info-value">${esc(v)}</div></div>`).join('')}</div>` : ''}
        </div>

        <div class="card card-pad recorder">
          <div class="rec-who">
            <div class="avatar avatar-lg" style="background:${avatarColor(who)}">${getInitials(who)}</div>
            <div><div style="font:var(--t-h3)">${esc(who)}</div><div style="font:var(--t-xs); color:var(--ink-3)">${pending.length} to go · ${contact ? esc(formatPhone(contact.phone)) : 'no number'}</div></div>
          </div>

          <button class="rec-orb ${R.running ? 'on' : ''}" id="rec-orb" ${isVoiceSupported() ? '' : 'disabled'} aria-label="Record">
            <span class="rec-orb-ring"></span>
            ${icon('mic')}
          </button>
          <div class="rec-timer mono-cell" id="rec-timer">${fmtDuration(R.seconds)}</div>
          <div class="rec-status" id="rec-status">${isVoiceSupported()
            ? (R.running ? 'Recording — speak naturally' : (R.transcript ? 'Paused' : 'Tap to start recording'))
            : 'Recording needs Chrome or Edge — you can still type the notes below.'}</div>
        </div>
      </div>

      <div class="rec-right">
        <div class="card card-pad" style="margin-bottom:14px">
          <div class="eyebrow" style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center">
            <span>Transcript</span><span id="rec-live"></span>
          </div>
          <textarea class="notes-area" id="rec-transcript" placeholder="Live transcript appears here as you record — or type/paste it. Hindi/Hinglish is fine.">${esc(R.transcript)}</textarea>
          <div class="lf-actions" style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap">
            <button class="btn btn-primary" id="rec-bucket" ${ai.configured ? '' : 'disabled title="Configure AI in Settings"'}>${icon('sparkles')} Auto-bucket with AI</button>
            <button class="btn btn-secondary" id="rec-save" ${R.buckets ? '' : 'disabled'}>${icon('check')} Save session</button>
            <button class="btn btn-ghost" id="rec-clear">${icon('refresh')} Clear</button>
          </div>
        </div>

        <div id="rec-result"></div>
      </div>
    </div>`;

  bindRecordEvents();
  renderResult();
  if (R.running) startTick();
}

function renderResult() {
  const el = container.querySelector('#rec-result');
  if (!el) return;
  if (!R.buckets) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="card card-pad">
      <div class="eyebrow" style="margin-bottom:10px">${icon('sparkles')} Auto-bucketed insight</div>
      ${R.summary ? `<p style="font:var(--t-body-strong); margin-bottom:12px">${esc(R.summary)}</p>` : ''}
      <div class="tagrow" style="margin-bottom:14px">${R.tags.map((t, i) => `<span class="tagchip ${['','t2','t3','t4'][i % 4]}">${esc(t)}</span>`).join('')}</div>
      <div class="buckets">
        ${R.buckets.map(b => `
          <div class="bucket">
            <div class="bucket-head">${esc(b.theme)}</div>
            <ul class="bucket-points">${(b.points || []).map(p => `<li>${esc(p)}</li>`).join('')}</ul>
          </div>`).join('')}
      </div>
    </div>`;
}

function bindRecordEvents() {
  container.querySelector('#rec-lod')?.addEventListener('change', (e) => {
    stopVoice();
    saveSettings({ fieldLodId: e.target.value });
    R = freshSession(e.target.value);
    paint();
  });
  container.querySelector('#rec-contact')?.addEventListener('change', (e) => {
    R.contactId = e.target.value || null;
  });

  const ta = container.querySelector('#rec-transcript');
  ta?.addEventListener('input', () => { R.transcript = ta.value; });

  container.querySelector('#rec-orb')?.addEventListener('click', () => {
    if (R.running) stopVoice(); else startVoice();
  });

  container.querySelector('#rec-bucket')?.addEventListener('click', runBucket);
  container.querySelector('#rec-save')?.addEventListener('click', saveSession);
  container.querySelector('#rec-clear')?.addEventListener('click', () => {
    stopVoice();
    R.transcript = ''; R.buckets = null; R.summary = ''; R.tags = []; R.seconds = 0;
    paint();
  });
}

// ---------- recording ----------
function startVoice() {
  if (!isVoiceSupported()) { showToast('Recording needs Chrome or Edge', 'warning'); return; }
  voice = createVoiceSession({
    lang: 'en-IN',
    onInterim: (t) => { interim = t; const l = container.querySelector('#rec-live'); if (l) l.innerHTML = `<span class="voice-dot"></span> <span style="font:var(--t-xs); color:var(--ink-3); font-style:italic">${esc(t.slice(0, 60))}</span>`; },
    onFinal: (t) => {
      const ta = container.querySelector('#rec-transcript');
      const sep = R.transcript && !/\s$/.test(R.transcript) ? ' ' : '';
      R.transcript = (R.transcript || '') + sep + t;
      if (ta) { ta.value = R.transcript; ta.scrollTop = ta.scrollHeight; }
      interim = '';
      const l = container.querySelector('#rec-live'); if (l) l.innerHTML = '';
    },
    onStateChange: (running) => { if (!running && R.running) { R.running = false; reflect(); } },
    onError: (code) => {
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(code)) {
        R.running = false; voice = null; reflect();
        showToast('Microphone blocked — allow mic access to record', 'error');
      }
    },
  });
  if (!voice) { showToast('Recording needs Chrome or Edge', 'warning'); return; }
  voice.start().then(ok => {
    if (ok) { R.running = true; startEpoch = Date.now() - R.seconds * 1000; startTick(); reflect(); showToast('Recording — speak naturally', 'success'); }
    else { R.running = false; voice = null; reflect(); }
  });
}

function stopVoice() {
  if (voice) { try { voice.stop(); } catch (_) {} voice = null; }
  R.running = false;
  stopTick();
  reflect();
}

function reflect() {
  const orb = container?.querySelector('#rec-orb');
  const status = container?.querySelector('#rec-status');
  if (orb) orb.classList.toggle('on', !!R.running);
  if (status) status.textContent = R.running ? 'Recording — speak naturally' : (R.transcript ? 'Paused' : 'Tap to start recording');
}

function startTick() {
  stopTick();
  tick = setInterval(() => {
    if (startEpoch) R.seconds = Math.floor((Date.now() - startEpoch) / 1000);
    const el = container?.querySelector('#rec-timer');
    if (el) el.textContent = fmtDuration(R.seconds);
  }, 500);
}
function stopTick() { if (tick) { clearInterval(tick); tick = null; } }

// ---------- bucketing ----------
async function runBucket() {
  const ta = container.querySelector('#rec-transcript');
  if (ta) R.transcript = ta.value;
  if ((R.transcript || '').trim().length < 20) { showToast('Record or type a bit more first', 'warning'); return; }
  if (!aiStatus().configured) { showToast('Configure AI in Settings first', 'warning'); return; }
  stopVoice();
  const btn = container.querySelector('#rec-bucket');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2.5px"></span> Bucketing…';
  try {
    const lod = getLod(R.lodId);
    const out = await bucketTranscript({ goal: lod.goal, transcript: R.transcript, questions: lod.questions });
    if (out && out.buckets.length) {
      R.buckets = out.buckets; R.summary = out.summary; R.tags = out.tags;
      renderResult();
      const save = container.querySelector('#rec-save'); if (save) save.disabled = false;
      showToast(`Bucketed into ${out.buckets.length} themes`, 'success');
    } else {
      showToast('Could not bucket — try recording more detail', 'warning');
    }
  } catch (e) {
    console.warn(e);
    showToast('Bucketing failed — try again', 'error');
  }
  btn.disabled = false;
  btn.innerHTML = orig;
}

// ---------- save ----------
function saveSession() {
  if (!R.buckets) { showToast('Auto-bucket first', 'warning'); return; }
  const lod = getLod(R.lodId);
  const user = getCurrentUser();
  saveCall({
    lodId: R.lodId, contactId: R.contactId, callerId: user?.id || null, mode: 'offline',
    disposition: 'connected', connected: true,
    notes: R.transcript, transcript: R.transcript,
    buckets: R.buckets, summary: R.summary, tags: R.tags,
    durationSec: R.seconds,
  });
  if (R.contactId) updateContact(R.lodId, R.contactId, { status: 'done', attempts: 1 });
  showToast('Field session saved', 'success');
  R = freshSession(R.lodId);
  paint();
}
