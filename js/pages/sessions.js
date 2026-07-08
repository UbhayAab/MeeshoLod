// ============================================================
// Meesho LOD Field — Field Sessions
// Every recorded on-ground session (mode:'offline'), newest first,
// with its auto-bucketed insight. Click to read the full transcript.
// ============================================================

import { getLods, getLod, getCalls } from '../store.js';
import { showModal } from '../components/modal.js';
import { icon } from '../components/icons.js';
import { navigate } from '../router.js';
import { avatarColor, getInitials } from '../components/sidebar.js';
import { esc, fmtDuration, timeAgo } from '../utils/format.js';

export function renderSessions(container) {
  const sessions = getCalls({ mode: 'offline' }).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const lodName = (id) => getLod(id)?.name || '—';
  const contactOf = (call) => getLod(call.lodId)?.contacts.find(c => c.id === call.contactId) || null;

  container.innerHTML = `
    <div class="page-header">
      <div><h1>Field Sessions</h1><p class="header-subtitle">Recorded on the ground, auto-bucketed by AI</p></div>
      <div class="pg-actions"><button class="btn btn-primary" id="go-record">${icon('mic')} Record new</button></div>
    </div>

    ${sessions.length ? `
      <div class="stats-grid" style="margin-bottom:20px">
        <div class="stat-card"><div class="stat-ico">${icon('activity')}</div><div class="stat-num">${sessions.length}</div><div class="stat-lbl">Sessions</div></div>
        <div class="stat-card"><div class="stat-ico">${icon('clock')}</div><div class="stat-num">${fmtDuration(sessions.reduce((s, c) => s + (c.durationSec || 0), 0) / Math.max(1, sessions.length))}</div><div class="stat-lbl">Avg length</div></div>
        <div class="stat-card"><div class="stat-ico">${icon('inbox')}</div><div class="stat-num">${new Set(sessions.map(s => s.lodId)).size}</div><div class="stat-lbl">Projects</div></div>
        <div class="stat-card"><div class="stat-ico">${icon('sparkles')}</div><div class="stat-num">${sessions.reduce((s, c) => s + (c.buckets ? c.buckets.length : 0), 0)}</div><div class="stat-lbl">Insight buckets</div></div>
      </div>
      <div style="display:flex; flex-direction:column; gap:12px">
        ${sessions.map(s => {
          const c = contactOf(s);
          const who = c ? (c.name || `User ${c.ext_id || ''}`) : 'Walk-in / ad-hoc';
          return `
          <div class="card card-pad card-hover session-card" data-call="${s.id}" style="cursor:pointer">
            <div style="display:flex; gap:14px; align-items:flex-start">
              <div class="avatar" style="background:${avatarColor(who)}; flex-shrink:0">${getInitials(who)}</div>
              <div style="min-width:0; flex:1">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
                  <strong>${esc(who)}</strong>
                  <span class="badge badge-neutral">${esc(lodName(s.lodId))}</span>
                  <span style="font:var(--t-xs); color:var(--ink-3)">${esc(timeAgo(s.ts))} · ${fmtDuration(s.durationSec)}</span>
                </div>
                ${s.summary ? `<p style="font:var(--t-sm); color:var(--ink-2); margin-top:6px">${esc(s.summary)}</p>` : ''}
                <div class="tagrow" style="margin-top:8px">${(s.tags || []).map((t, i) => `<span class="tagchip ${['','t2','t3','t4'][i % 4]}">${esc(t)}</span>`).join('')}</div>
              </div>
              <div style="flex-shrink:0; text-align:right; font:var(--t-mono-label); color:var(--ink-4); letter-spacing:.08em">${(s.buckets || []).length} BUCKETS</div>
            </div>
          </div>`;
        }).join('')}
      </div>
    ` : `
      <div class="empty-state card card-pad" style="text-align:center; padding:60px 24px">
        <div style="font-size:40px; margin-bottom:12px">🎙️</div>
        <h3 style="margin-bottom:8px">No field sessions yet</h3>
        <p style="color:var(--ink-3); margin-bottom:20px">Record your first on-ground conversation — the AI buckets it into insight automatically.</p>
        <button class="btn btn-primary" id="go-record-empty">${icon('mic')} Record now</button>
      </div>
    `}
  `;

  container.querySelector('#go-record')?.addEventListener('click', () => navigate('record'));
  container.querySelector('#go-record-empty')?.addEventListener('click', () => navigate('record'));
  container.querySelectorAll('[data-call]').forEach(card => {
    card.addEventListener('click', () => {
      const s = sessions.find(x => x.id === card.dataset.call);
      if (s) openSession(s, contactOf(s));
    });
  });
}

function openSession(s, contact) {
  const who = contact ? (contact.name || `User ${contact.ext_id || ''}`) : 'Walk-in / ad-hoc';
  const body = `
    <div class="tagrow" style="margin-bottom:14px">${(s.tags || []).map((t, i) => `<span class="tagchip ${['','t2','t3','t4'][i % 4]}">${esc(t)}</span>`).join('')}</div>
    ${s.summary ? `<p style="font:var(--t-body-strong); margin-bottom:16px">${esc(s.summary)}</p>` : ''}
    ${(s.buckets && s.buckets.length) ? `<div class="buckets" style="margin-bottom:18px">${s.buckets.map(b => `
      <div class="bucket"><div class="bucket-head">${esc(b.theme)}</div><ul class="bucket-points">${(b.points || []).map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>`).join('')}</div>` : ''}
    <div class="eyebrow" style="margin-bottom:8px">Full transcript</div>
    <div class="transcript-box">${esc(s.transcript || s.notes || '(no transcript)')}</div>
  `;
  showModal({ title: `${who} · field session`, size: 'lg', content: body });
}
