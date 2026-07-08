// ============================================================
// Meesho LOD — Calling Console (the heart of the app)
//
// Flow: pick LOD → ready screen → contact loads → tel: call →
// AI flashes the next best question while the caller types notes →
// disposition → AI summary → next contact. Conveyor belt.
//
// The in-flight call (contact, timer, notes, disposition, answered
// map) persists to localStorage — tapping a tel: link can reload
// the page/WebView, and nothing may be lost.
// ============================================================

import { getLods, getLod, saveLod, nextContact, updateContact, saveCall, getCalls, lodProgress,
         saveActiveCall, loadActiveCall, clearActiveCall, getSettings, saveSettings } from '../store.js';
import { getCurrentUser } from '../auth.js';
import { liveCoach, summarizeCall, aiStatus } from '../ai.js';
import { showToast } from '../components/toast.js';
import { icon } from '../components/icons.js';
import { avatarColor, getInitials } from '../components/sidebar.js';
import { navigate } from '../router.js';
import { DISPOSITIONS } from '../config.js';
import { esc, fmtDuration, timeAgo } from '../utils/format.js';
import { formatPhone } from '../utils/parse.js';
import { isVoiceSupported, createVoiceSession } from '../voice.js';

// ---------- module state (one active call at a time) ----------
let S = null; // { lodId, contact, notes, disposition, answered:{qid:ans}, flashIdx, improvised, timer... }
let container = null;
let tickHandle = null;
let coachTimer = null;
let coachInFlight = false;
let lastCoachedNotes = '';
let rotateHandle = null;
let submitting = false;
let voice = null;       // live voice session (Web Speech API)
let voiceOn = false;    // user toggled live listen on

function blankState(lodId, contact) {
  return {
    lodId, contact,
    notes: '', disposition: null,
    answered: {},          // qid → extracted answer
    flashId: null,         // question id currently flashed
    improvised: '',        // AI improvised probe
    signal: '',            // coaching strip
    timerSeconds: 0, timerRunning: false, timerStartEpoch: null,
  };
}

// ---------- entry ----------
export function renderCalling(c) {
  container = c;
  stopAllTimers();
  const user = getCurrentUser();

  // restore an in-flight call first — tel: links reload the page
  const saved = user ? loadActiveCall(user.id) : null;
  if (saved && saved.lodId && getLod(saved.lodId)) {
    S = saved;
    mountActive();
    return;
  }

  mountReady();
}

// ---------- ready screen ----------
function mountReady() {
  const lods = getLods().filter(l => l.status !== 'done');
  const settings = getSettings();
  let selId = settings.lastLodId && lods.some(l => l.id === settings.lastLodId)
    ? settings.lastLodId
    : (lods[0]?.id || null);

  if (!lods.length) {
    container.innerHTML = `
      <div class="page-header"><div><h1>Calling Console</h1><p class="header-subtitle">Listen Or Die</p></div></div>
      <div class="empty-state card card-pad" style="text-align:center; padding: 60px 24px">
        <div style="font-size:40px; margin-bottom:12px">📞</div>
        <h3 style="margin-bottom:8px">No LODs yet</h3>
        <p style="color:var(--ink-3); margin-bottom:20px">Create a LOD — set a goal, upload your list — and start listening.</p>
        <button class="btn btn-primary" id="go-lods">${icon('plus')} Create a LOD</button>
      </div>`;
    container.querySelector('#go-lods')?.addEventListener('click', () => navigate('lods'));
    return;
  }

  const render = () => {
    const lod = getLod(selId);
    const prog = lodProgress(lod);
    const myCalls = getCalls({ lodId: lod.id });
    const connected = myCalls.filter(cl => cl.connected).length;
    const ai = aiStatus();

    container.innerHTML = `
      <div class="page-header">
        <div><h1>Calling Console</h1><p class="header-subtitle">Listen Or Die — every function stays connected to users</p></div>
      </div>

      <div class="ready">
        <div class="ready-card card card-feature card-pad" style="max-width:680px; margin:0 auto">
          <div class="form-group" style="margin-bottom:16px">
            <label class="form-label">Active LOD</label>
            <select class="select" id="lod-select">
              ${lods.map(l => `<option value="${l.id}" ${l.id === selId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
            </select>
          </div>

          <div class="goal-banner" style="margin-bottom:20px">
            ${icon('target')}
            <div><span class="k">Goal</span>${esc(lod.goal)}</div>
          </div>

          <div class="ready-stats" style="display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:20px">
            <div class="qstat"><div class="qstat-num">${prog.pending}</div><div class="qstat-lbl">Pending</div></div>
            <div class="qstat"><div class="qstat-num">${prog.done}</div><div class="qstat-lbl">Done</div></div>
            <div class="qstat"><div class="qstat-num">${myCalls.length ? Math.round(connected / myCalls.length * 100) + '%' : '—'}</div><div class="qstat-lbl">Connect rate</div></div>
            <div class="qstat"><div class="qstat-num">${prog.pct}%</div><div class="qstat-lbl">Coverage</div></div>
          </div>

          <div class="progress-track" style="margin-bottom:24px"><div class="progress-fill" style="width:${prog.pct}%"></div></div>

          ${!ai.configured ? `<p style="font:var(--t-xs); color:var(--warn); margin-bottom:12px">${icon('alertTriangle')} AI co-pilot not configured — questions will still show, but no live parsing. Set the key in Settings.</p>` : ''}

          <button class="btn btn-primary btn-lg btn-block" id="start-btn" ${prog.pending + prog.skipped === 0 ? 'disabled' : ''}>
            ${icon('phoneCall')} ${prog.pending + prog.skipped === 0 ? 'List complete — nothing to call' : 'Start calling'}
          </button>
        </div>
      </div>`;

    container.querySelector('#lod-select')?.addEventListener('change', (e) => {
      selId = e.target.value;
      saveSettings({ lastLodId: selId });
      render();
    });
    container.querySelector('#start-btn')?.addEventListener('click', () => {
      saveSettings({ lastLodId: selId });
      startNext(selId);
    });
  };
  render();
}

function startNext(lodId) {
  const contact = nextContact(lodId);
  if (!contact) {
    showToast('List complete — every contact has been called 🎉', 'success');
    mountReady();
    return;
  }
  const lod = getLod(lodId);
  S = blankState(lodId, contact);
  // flash the first core question by default
  const firstQ = lod.questions.find(q => q.type === 'core') || lod.questions[0];
  S.flashId = firstQ?.id || null;
  persist();
  mountActive();
}

// ---------- active call ----------
function mountActive() {
  const lod = getLod(S.lodId);
  const contact = S.contact;
  const history = getCalls({ contactId: contact.id });
  const displayName = contact.name || (contact.ext_id ? `User ${contact.ext_id}` : formatPhone(contact.phone));

  const dataEntries = Object.entries(contact.data || {});
  const colLabel = (key) => (lod.columns.find(cc => cc.key === key)?.label) || key.replace(/_/g, ' ');

  container.innerHTML = `
    <div class="page-header">
      <div><h1>${esc(lod.name)}</h1><p class="header-subtitle">${esc(lod.goal).slice(0, 110)}${lod.goal.length > 110 ? '…' : ''}</p></div>
      <div class="pg-actions">
        <button class="btn btn-ghost btn-sm" id="end-session-btn">${icon('x')} End session</button>
      </div>
    </div>

    <div class="portal-grid">
      <!-- LEFT: who you're calling -->
      <div class="col-left">
        <div class="pcard card card-pad">
          <div class="pcard-head" style="display:flex; align-items:center; gap:14px; margin-bottom:16px">
            <div class="avatar avatar-lg" style="background:${avatarColor(displayName)}">${getInitials(displayName)}</div>
            <div style="min-width:0">
              <div class="pcard-name" style="font:var(--t-h3)">${esc(displayName)}</div>
              <div style="display:flex; gap:6px; margin-top:5px; flex-wrap:wrap">
                ${contact.ext_id ? `<span class="badge badge-neutral">ID ${esc(contact.ext_id)}</span>` : ''}
                <span class="badge ${contact.attempts > 0 ? 'badge-warn' : 'badge-primary'}">${contact.attempts > 0 ? `Attempt ${contact.attempts + 1}` : 'Fresh'}</span>
              </div>
            </div>
          </div>

          <a class="callbtn" id="tel-link" href="tel:+91${esc(contact.phone)}">
            <span class="cb-ico">${icon('phoneCall')}</span>
            <span>
              <span class="cb-num">${esc(formatPhone(contact.phone))}</span>
              <span class="cb-label">Tap to call</span>
            </span>
          </a>
          <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" id="copy-num">${icon('copy')} Copy number</button>
            ${(contact.phones || []).slice(1).map(p => `<a class="btn btn-ghost btn-sm" href="tel:+91${esc(p)}">${icon('phone')} Alt: ${esc(formatPhone(p))}</a>`).join('')}
          </div>

          <div class="timer" style="margin-top:16px; display:flex; align-items:center; gap:10px">
            <span class="timer-dot" id="timer-dot" style="width:9px;height:9px;border-radius:50%;background:var(--ink-4)"></span>
            <span class="timer-time mono-cell" id="timer-display" style="font-size:16px">${fmtDuration(S.timerSeconds)}</span>
            <button class="btn btn-ghost btn-sm" id="timer-toggle">${S.timerRunning ? 'Pause' : 'Start timer'}</button>
          </div>
        </div>

        ${dataEntries.length ? `
        <div class="card card-pad" style="margin-top:16px">
          <div class="eyebrow" style="margin-bottom:10px">Context</div>
          <div class="info-grid kv">
            ${dataEntries.map(([k, v]) => `
              <div class="info-cell"><div class="info-label">${esc(colLabel(k))}</div><div class="info-value">${esc(v)}</div></div>
            `).join('')}
          </div>
        </div>` : ''}

        ${history.length ? `
        <div class="card card-pad history" style="margin-top:16px">
          <div class="eyebrow" style="margin-bottom:10px">Earlier calls (${history.length})</div>
          ${history.slice(-3).reverse().map(h => `
            <div class="hist-row" style="padding:10px 0; border-bottom:1px dashed var(--line)">
              <div class="hist-meta" style="font:var(--t-xs); color:var(--ink-3); display:flex; gap:8px; align-items:center">
                <span class="badge badge-${h.connected ? 'ok' : 'warn'}" style="font-size:10px">${esc(h.disposition || '')}</span>
                <span>${timeAgo(h.ts)}</span>
              </div>
              ${h.summary ? `<div class="hist-note" style="font:var(--t-sm); color:var(--ink-2); margin-top:5px">${esc(h.summary)}</div>` : ''}
            </div>`).join('')}
        </div>` : ''}
      </div>

      <!-- RIGHT: the co-pilot + log form -->
      <div class="logform">
        <div class="voice-bar" id="voice-bar">
          <button class="voice-btn" id="voice-toggle" ${isVoiceSupported() ? '' : 'disabled'}>
            <span class="voice-ico">${icon('mic')}</span>
            <span id="voice-btn-label">${isVoiceSupported() ? 'Live listen' : 'Voice not supported'}</span>
          </button>
          <div class="voice-live" id="voice-live">
            <span class="voice-hint">${isVoiceSupported()
              ? 'Put the call on speakerphone — I\'ll transcribe both sides live and keep flashing probes.'
              : 'Live listen needs Chrome or Edge. You can still type notes and get probes.'}</span>
          </div>
        </div>

        <div class="flash-deck" id="flash-deck"></div>

        <div class="card card-pad" style="margin-top:14px">
          <div class="eyebrow" style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center">
            <span>Question stack</span>
            <span id="ai-state"></span>
          </div>
          <div class="qstack" id="qstack"></div>
        </div>

        <div class="card card-pad" style="margin-top:14px">
          <div class="eyebrow" style="margin-bottom:10px">Call notes — type, or let Live listen fill this</div>
          <textarea class="notes-area" id="notes" placeholder="Type rough notes, or hit Live listen — the AI reads them live, ticks off answered questions and flashes what to ask next…">${esc(S.notes)}</textarea>
          <div class="tagrow" id="live-answers" style="margin-top:10px"></div>
        </div>

        <div class="card card-pad" style="margin-top:14px">
          <div class="eyebrow" style="margin-bottom:10px">How did it go?</div>
          <div class="seg" id="seg-outcome" style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px">
            ${DISPOSITIONS.map(d => `
              <button class="seg-btn ${S.disposition === d.key ? `on tone-${d.tone}` : ''}" data-status="${d.key}">${esc(d.label)}</button>
            `).join('')}
          </div>
          <div class="lf-actions" style="display:flex; gap:10px; margin-top:18px">
            <button class="btn btn-primary btn-lg" id="save-btn" style="flex:1" ${S.disposition ? '' : 'disabled'}>
              ${icon('check')} Save &amp; next
            </button>
            <button class="btn btn-secondary" id="skip-btn" title="Push this contact to the back of the list">${icon('skip')} Skip</button>
          </div>
        </div>
      </div>
    </div>`;

  renderFlashDeck();
  renderQStack();
  renderLiveAnswers();
  bindActiveEvents();
  bindVoice();
  if (S.timerRunning) startTick();
  startRotation();
  // if listening was on for the previous contact, keep the UI honest
  reflectVoiceState(voiceOn);
}

// ---------- flash deck (the flashing questions) ----------
function currentFlash() {
  const lod = getLod(S.lodId);
  return lod.questions.find(q => q.id === S.flashId) || null;
}

function unansweredQuestions() {
  const lod = getLod(S.lodId);
  return lod.questions.filter(q => !S.answered[q.id]);
}

function renderFlashDeck(flashAnim = false) {
  const deck = container.querySelector('#flash-deck');
  if (!deck) return;
  const q = currentFlash();
  const remaining = unansweredQuestions();

  let html = '';
  if (S.signal) {
    html += `<div class="coach-signal">${icon('zap')} ${esc(S.signal)}</div>`;
  }
  if (S.improvised) {
    html += `
      <div class="flash-card improv ${flashAnim ? 'flash-in' : ''}">
        <div class="flash-eyebrow"><span class="dot"></span> AI probe — react to what they just said</div>
        <div class="flash-q">${esc(S.improvised)}</div>
        <div class="flash-actions">
          <button class="btn btn-ghost btn-sm" id="improv-done" style="color:#fff; border-color:rgba(255,255,255,.25)">${icon('check')} Asked it</button>
        </div>
      </div>`;
  }
  if (q) {
    html += `
      <div class="flash-card pulse ${flashAnim ? 'flash-in' : ''}" id="flash-main">
        <div class="flash-eyebrow"><span class="dot"></span> Ask now ${q.theme ? '· ' + esc(q.theme) : (q.type === 'core' ? '· core' : '· probe')}</div>
        <div class="flash-q">${esc(q.text)}</div>
        <div class="flash-actions">
          <button class="btn btn-ghost btn-sm" id="flash-next" style="color:#fff; border-color:rgba(255,255,255,.25)">${icon('arrowRight')} Next question</button>
          <span style="font:var(--t-mono-label); color:var(--panel-text-3); align-self:center; letter-spacing:.1em">${remaining.length} LEFT</span>
        </div>
      </div>`;
  } else if (!S.improvised) {
    html += `
      <div class="flash-card">
        <div class="flash-eyebrow"><span class="dot"></span> All questions covered</div>
        <div class="flash-q">Everything on the stack has an answer. Wrap up warmly and save the call.</div>
      </div>`;
  }
  deck.innerHTML = html;

  deck.querySelector('#flash-next')?.addEventListener('click', () => { advanceFlash(); });
  deck.querySelector('#improv-done')?.addEventListener('click', () => {
    S.improvised = '';
    persist();
    renderFlashDeck();
  });
}

function advanceFlash(preferIds = null) {
  const remaining = unansweredQuestions();
  if (!remaining.length) { S.flashId = null; renderFlashDeck(true); renderQStack(); return; }
  let next = null;
  if (preferIds && preferIds.length) {
    next = remaining.find(q => preferIds.includes(q.id));
  }
  if (!next) {
    const idx = remaining.findIndex(q => q.id === S.flashId);
    next = remaining[(idx + 1) % remaining.length] || remaining[0];
  }
  S.flashId = next.id;
  persist();
  renderFlashDeck(true);
  renderQStack();
}

// gentle auto-rotate so the deck stays alive even without typing
function startRotation() {
  stopRotation();
  rotateHandle = setInterval(() => {
    // don't rotate while the AI just pinned a question or nothing to rotate
    if (unansweredQuestions().length > 1) advanceFlash();
  }, 45000);
}
function stopRotation() { if (rotateHandle) { clearInterval(rotateHandle); rotateHandle = null; } }

// ---------- question stack (grouped by theme when present) ----------
function renderQStack() {
  const el = container.querySelector('#qstack');
  if (!el) return;
  const lod = getLod(S.lodId);

  const qRow = (q, n) => {
    const ans = S.answered[q.id];
    return `
      <div class="qrow ${ans ? 'answered' : ''} ${q.id === S.flashId ? 'up-next' : ''}" data-qid="${q.id}" data-type="${q.type}">
        <span class="q-ico">${ans ? icon('check') : n}</span>
        <span style="min-width:0">
          <span class="q-text">${esc(q.text)}</span>
          ${ans ? `<div class="q-ans">↳ ${esc(ans)}</div>` : ''}
        </span>
        <span class="q-type">${q.type}</span>
      </div>`;
  };

  const hasThemes = lod.questions.some(q => q.theme);
  if (hasThemes) {
    // group in first-seen theme order; count answered per theme
    const order = [];
    const groups = {};
    lod.questions.forEach(q => {
      const t = q.theme || 'More questions';
      if (!groups[t]) { groups[t] = []; order.push(t); }
      groups[t].push(q);
    });
    let n = 0;
    el.innerHTML = order.map(theme => {
      const qs = groups[theme];
      const done = qs.filter(q => S.answered[q.id]).length;
      return `
        <div class="qtheme-head">
          <span>${esc(theme)}</span>
          <span class="qtheme-count ${done === qs.length ? 'all-done' : ''}">${done}/${qs.length}</span>
        </div>
        ${qs.map(q => qRow(q, ++n)).join('')}`;
    }).join('');
  } else {
    el.innerHTML = lod.questions.map((q, i) => qRow(q, i + 1)).join('');
  }

  // tap a question to flash it manually
  el.querySelectorAll('.qrow').forEach(row => {
    row.addEventListener('click', () => {
      S.flashId = row.dataset.qid;
      persist();
      renderFlashDeck(true);
      renderQStack();
    });
  });
}

function renderLiveAnswers() {
  const el = container.querySelector('#live-answers');
  if (!el) return;
  const lod = getLod(S.lodId);
  const entries = Object.entries(S.answered);
  el.innerHTML = entries.map(([qid, ans]) => {
    const q = lod.questions.find(x => x.id === qid);
    return `<span class="ans-chip"><b>✓</b> ${esc((q?.text || '').slice(0, 42))}${(q?.text || '').length > 42 ? '…' : ''} — ${esc(ans)}</span>`;
  }).join('');
}

function setAIState(text, thinking = false) {
  const el = container.querySelector('#ai-state');
  if (!el) return;
  el.innerHTML = thinking
    ? `<span class="ai-thinking"><span class="spark">${icon('sparkles')}</span> ${esc(text)}</span>`
    : `<span style="font:var(--t-xs); color:var(--ink-3)">${esc(text)}</span>`;
}

// ---------- events ----------
function bindActiveEvents() {
  // tel: click → auto-start timer
  container.querySelector('#tel-link')?.addEventListener('click', () => { startTimer(); persist(); });
  container.querySelector('#copy-num')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(S.contact.phone);
      showToast('Number copied', 'success');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = S.contact.phone; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      showToast('Number copied', 'success');
    }
    startTimer(); persist(); // copying means they're about to dial
  });

  container.querySelector('#timer-toggle')?.addEventListener('click', () => {
    if (S.timerRunning) pauseTimer(); else startTimer();
    persist();
  });

  // notes → debounce live AI coach
  const notesEl = container.querySelector('#notes');
  notesEl?.addEventListener('input', () => {
    S.notes = notesEl.value;
    persistSoon();
    scheduleCoach();
  });

  // disposition
  container.querySelectorAll('#seg-outcome .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (submitting) return;
      S.disposition = btn.dataset.status;
      const d = DISPOSITIONS.find(x => x.key === S.disposition);
      container.querySelectorAll('#seg-outcome .seg-btn').forEach(b => { b.className = 'seg-btn'; });
      btn.className = `seg-btn on tone-${d.tone}`;
      const save = container.querySelector('#save-btn');
      if (save) save.disabled = false;
      persist();
    });
  });

  container.querySelector('#save-btn')?.addEventListener('click', submitCall);
  container.querySelector('#skip-btn')?.addEventListener('click', () => {
    if (submitting) return;
    const lodId = S.lodId, contactId = S.contact.id, attempts = S.contact.attempts || 0;
    updateContact(lodId, contactId, { status: 'skipped', attempts });
    // sink to the back so a skip actually rotates the queue instead of
    // re-serving the same contact when only skipped ones remain
    const l = getLod(lodId);
    const idx = l.contacts.findIndex(x => x.id === contactId);
    if (idx >= 0) { const [c] = l.contacts.splice(idx, 1); l.contacts.push(c); saveLod(l); }
    clearActive();
    S = null;
    lastCoachedNotes = '';
    showToast('Skipped — pushed to the back of the list', 'info');
    setTimeout(() => startNext(lodId), 250);
  });

  container.querySelector('#end-session-btn')?.addEventListener('click', () => {
    if (submitting) return;
    clearActive();
    S = null;
    mountReady();
  });
}

// ---------- live voice (Web Speech API → notes → coach → probes) ----------
let interimText = '';

function reflectVoiceState(on) {
  const btn = container?.querySelector('#voice-toggle');
  const label = container?.querySelector('#voice-btn-label');
  const bar = container?.querySelector('#voice-bar');
  if (!btn || !bar) return;
  btn.classList.toggle('listening', !!on);
  bar.classList.toggle('listening', !!on);
  if (label) label.textContent = on ? 'Listening — tap to stop' : (isVoiceSupported() ? 'Live listen' : 'Voice not supported');
  if (!on) renderInterim('');
}

function renderInterim(text) {
  const live = container?.querySelector('#voice-live');
  if (!live) return;
  if (voiceOn) {
    live.innerHTML = text
      ? `<span class="voice-dot"></span><span class="voice-transcript">${esc(text)}</span>`
      : `<span class="voice-dot"></span><span class="voice-hint">Listening… speak or put the call on speaker.</span>`;
  } else {
    live.innerHTML = `<span class="voice-hint">${isVoiceSupported()
      ? 'Put the call on speakerphone — I\'ll transcribe both sides live and keep flashing probes.'
      : 'Live listen needs Chrome or Edge. You can still type notes and get probes.'}</span>`;
  }
}

// a recognized final phrase → append to notes, re-render, run the coach fast
function handleVoiceFinal(text) {
  if (!S || !text) return;
  const notesEl = container?.querySelector('#notes');
  const sep = S.notes && !/\s$/.test(S.notes) ? ' ' : '';
  S.notes = (S.notes || '') + sep + text;
  if (notesEl) { notesEl.value = S.notes; notesEl.scrollTop = notesEl.scrollHeight; }
  interimText = '';
  renderInterim('');
  persistSoon();
  // snappier than typing debounce — the caller wants probes to keep coming
  scheduleCoach(1400);
}

function bindVoice() {
  interimText = '';
  const btn = container.querySelector('#voice-toggle');
  if (!btn) return;
  if (!isVoiceSupported()) { btn.disabled = true; return; }

  btn.addEventListener('click', async () => {
    if (voiceOn) { stopVoice(); return; }
    // (re)create a session bound to the current handlers
    voice = createVoiceSession({
      lang: 'en-IN',
      onInterim: (t) => { interimText = t; renderInterim(t); },
      onFinal: (t) => handleVoiceFinal(t),
      onStateChange: (running) => {
        // recognizer ended for good (not our stop, not an auto-restart)
        if (!running && voiceOn) {
          voiceOn = false; voice = null;
          reflectVoiceState(false);
        }
      },
      onError: (code) => {
        if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
          voiceOn = false; voice = null;
          reflectVoiceState(false);
          showToast('Microphone blocked — allow mic access to use Live listen', 'error');
        } else if (code === 'network') {
          showToast('Speech service network hiccup — retrying', 'warning');
        }
      },
    });
    if (!voice) { showToast('Live listen needs Chrome or Edge', 'warning'); return; }
    const ok = await voice.start();
    if (ok) {
      voiceOn = true;
      reflectVoiceState(true);
      startTimer(); persist(); // listening implies the call is live
      showToast('Listening live — speak or put the call on speaker', 'success');
    } else {
      voiceOn = false; voice = null;
      reflectVoiceState(false);
    }
  });
}

function stopVoice() {
  voiceOn = false;
  try { voice && voice.stop(); } catch (_) { /* noop */ }
  voice = null;
  interimText = '';
  reflectVoiceState(false);
}

// ---------- timer (wall-clock anchored — survives reloads) ----------
function startTimer() {
  if (S.timerRunning) return;
  S.timerRunning = true;
  S.timerStartEpoch = Date.now() - S.timerSeconds * 1000;
  startTick();
  const btn = container.querySelector('#timer-toggle');
  if (btn) btn.textContent = 'Pause';
}
function pauseTimer() {
  syncTimer();
  S.timerRunning = false;
  stopTick();
  const btn = container.querySelector('#timer-toggle');
  if (btn) btn.textContent = 'Start timer';
  const dot = container.querySelector('#timer-dot');
  if (dot) dot.style.background = 'var(--ink-4)';
}
function syncTimer() {
  if (S.timerRunning && S.timerStartEpoch) {
    S.timerSeconds = Math.floor((Date.now() - S.timerStartEpoch) / 1000);
  }
}
function startTick() {
  stopTick();
  const dot = container.querySelector('#timer-dot');
  if (dot) dot.style.background = 'var(--danger)';
  tickHandle = setInterval(() => {
    syncTimer();
    const el = container.querySelector('#timer-display');
    if (el) el.textContent = fmtDuration(S.timerSeconds);
  }, 1000);
}
function stopTick() { if (tickHandle) { clearInterval(tickHandle); tickHandle = null; } }
function stopAllTimers() {
  stopTick();
  stopRotation();
  if (coachTimer) { clearTimeout(coachTimer); coachTimer = null; }
  stopVoice();
}

// ---------- persistence ----------
let persistHandle = null;
function persist() {
  const user = getCurrentUser();
  if (!user || !S) return;
  syncTimer();
  saveActiveCall(user.id, S);
}
function persistSoon() {
  if (persistHandle) clearTimeout(persistHandle);
  persistHandle = setTimeout(persist, 400);
}
function clearActive() {
  const user = getCurrentUser();
  if (user) clearActiveCall(user.id);
  stopAllTimers();
  if (persistHandle) { clearTimeout(persistHandle); persistHandle = null; }
}

// ---------- live AI coach ----------
// default ~2s after typing stops; voice passes a shorter delay so probes
// keep coming while the caller is mid-conversation
function scheduleCoach(delay = 2200) {
  if (coachTimer) clearTimeout(coachTimer);
  coachTimer = setTimeout(runCoach, delay);
}

async function runCoach() {
  if (coachInFlight) { scheduleCoach(); return; }
  const notes = (S.notes || '').trim();
  if (notes.length < 25 || notes === lastCoachedNotes) return;
  if (!aiStatus().configured) return;

  coachInFlight = true;
  lastCoachedNotes = notes;
  const contactId = S.contact.id;
  setAIState('reading your notes…', true);
  try {
    const lod = getLod(S.lodId);
    const out = await liveCoach({
      goal: lod.goal,
      questions: lod.questions,
      contact: S.contact,
      notes,
      disposition: S.disposition,
    });
    // the caller may have skipped/saved/ended onto a different contact
    // while this request was in flight — never apply a stale result
    if (!S || S.contact.id !== contactId || !container.querySelector('#qstack')) return;
    if (out) {
      let changed = false;
      for (const a of out.answered) {
        if (a.answer && !S.answered[a.id]) { S.answered[a.id] = a.answer; changed = true; }
      }
      if (out.improvised && out.improvised !== S.improvised) { S.improvised = out.improvised; changed = true; }
      if (out.signal) S.signal = out.signal;

      // if the flashed question just got answered — or the AI has a better
      // one — flash the next best
      const flashAnswered = S.flashId && S.answered[S.flashId];
      const preferred = out.next_ids.filter(id => !S.answered[id]);
      if (flashAnswered || (preferred.length && preferred[0] !== S.flashId)) {
        const remaining = unansweredQuestions();
        const next = remaining.find(q => preferred.includes(q.id)) || remaining[0] || null;
        S.flashId = next?.id || null;
        changed = true;
      }
      persist();
      renderFlashDeck(changed);
      renderQStack();
      renderLiveAnswers();
      setAIState(`✓ ${Object.keys(S.answered).length} answered · listening`);
    } else {
      setAIState('AI unavailable — stack still works');
    }
  } catch (e) {
    console.warn('coach error', e);
    setAIState('AI hiccup — retrying on next pause');
    lastCoachedNotes = ''; // allow retry
  } finally {
    coachInFlight = false;
  }
}

// ---------- submit ----------
function setActionButtonsDisabled(disabled) {
  ['#skip-btn', '#end-session-btn'].forEach(sel => {
    const el = container.querySelector(sel);
    if (el) el.disabled = disabled;
  });
  container.querySelectorAll('#seg-outcome .seg-btn').forEach(b => { b.disabled = disabled; });
}

async function submitCall() {
  if (submitting) return;
  const btn = container.querySelector('#save-btn');
  if (!btn || !S.disposition) return;
  submitting = true;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:17px;height:17px;border-width:2.5px"></span> Saving…';
  setActionButtonsDisabled(true);
  syncTimer();
  stopAllTimers();

  // snapshot everything this save needs — S may be replaced by
  // skip/end-session/startNext while we await the AI summary below
  const call = {
    lodId: S.lodId, contact: S.contact, notes: S.notes,
    disposition: S.disposition, answered: { ...S.answered }, timerSeconds: S.timerSeconds,
  };
  const lod = getLod(call.lodId);
  const user = getCurrentUser();
  const connected = call.disposition === 'connected';

  // AI post-call record (best effort — never block saving on AI)
  let summary = '', tags = [], answers = { ...call.answered };
  if (aiStatus().configured && (call.notes || '').trim().length > 10) {
    setAIState('writing summary…', true);
    try {
      const out = await summarizeCall({
        goal: lod.goal, questions: lod.questions, contact: call.contact,
        notes: call.notes, disposition: call.disposition, durationSec: call.timerSeconds,
      });
      if (out) {
        summary = out.summary || '';
        tags = out.tags || [];
        answers = { ...answers, ...out.answers };
      }
    } catch (e) { console.warn('summary failed', e); }
  }

  saveCall({
    lodId: call.lodId, contactId: call.contact.id, callerId: user?.id || null,
    disposition: call.disposition, connected,
    notes: call.notes, answers, summary, tags,
    durationSec: call.timerSeconds,
  });

  // connected or wrong number = done; RNR/busy/cut/callback = try again later
  const finished = connected || call.disposition === 'wrong_number';
  updateContact(call.lodId, call.contact.id, {
    status: finished ? 'done' : 'pending',
    attempts: (call.contact.attempts || 0) + 1,
  });
  // non-finished contacts sink behind fresh ones so we don't redial instantly
  if (!finished) {
    const l = getLod(call.lodId);
    const idx = l.contacts.findIndex(x => x.id === call.contact.id);
    if (idx >= 0) { const [c] = l.contacts.splice(idx, 1); l.contacts.push(c); saveLod(l); }
  }

  submitting = false;
  // only tear down/advance from OUR state — skip/end-session may already
  // have moved S on to a different contact while the summary awaited
  if (S && S.contact.id === call.contact.id && S.lodId === call.lodId) {
    clearActive();
    S = null;
    lastCoachedNotes = '';
    showToast(summary ? 'Saved with AI summary — next contact' : 'Saved — next contact', 'success');
    setTimeout(() => startNext(call.lodId), 400);
  } else {
    showToast(summary ? 'Saved with AI summary' : 'Saved', 'success');
  }
}
