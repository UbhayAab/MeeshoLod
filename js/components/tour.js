// ============================================================
// Meesho LOD — First-run product tour (spotlight coachmarks)
//
// A beautiful onboarding walkthrough that runs the first time a user
// opens a surface: dimmed backdrop, a moving spotlight over real UI
// elements, and floating cards with Back / Next / Skip.
//
//   startTour({ force })  — run it (auto-runs once per surface)
//   tourSeen()            — has this surface's tour been completed?
//   window.MLODTour.start(true) — replay from anywhere (Settings, etc.)
//
// Variant-aware: reads getVariant() so /u/ (pink) and /s/ (indigo)
// each get their own steps and their own "seen" flag. Pure DOM, no deps.
// ============================================================

import { getVariant } from '../variant.js';
import { icon } from './icons.js';

const KEY = 'mlod_tour_v1_';

export function tourSeen() {
  try { return localStorage.getItem(KEY + getVariant().key) === '1'; }
  catch { return true; }
}
function markSeen() {
  try { localStorage.setItem(KEY + getVariant().key, '1'); } catch {}
}

// ---------- step definitions ----------
function onlineSteps() {
  return [
    {
      center: true, hero: true,
      eyebrow: 'Welcome to Meesho LOD',
      title: 'Listen Or Die.',
      body: 'Every function at Meesho stays glued to real users by calling them. This is your cockpit — turn any list into a live calling operation with an AI co-pilot riding along on every call. Quick 40-second tour?',
    },
    {
      target: '.greet',
      placement: 'bottom',
      icon: 'grid',
      eyebrow: 'Your dashboard',
      title: 'The daily pulse',
      body: 'Every time you land here you see today’s calls, connect rate, pending contacts and your active drives — all live from real data.',
    },
    {
      target: '[data-go="lods"]',
      placement: 'bottom',
      icon: 'upload',
      eyebrow: 'Step 1',
      title: 'Start a LOD',
      body: 'A LOD = one goal + one list. Paste any messy spreadsheet, and the AI cleans it up and writes your question stack automatically. This is where every drive begins.',
    },
    {
      target: '[data-go="calling"]',
      placement: 'bottom',
      icon: 'phoneCall',
      eyebrow: 'Step 2 · the heart',
      title: 'Calling Console',
      body: 'Contacts come one at a time. Put the call on speakerphone and the AI listens live — flashing the next best question, improvising probes, and ticking off answers as you talk.',
    },
    {
      target: '[data-go="insights"]',
      placement: 'bottom',
      icon: 'sparkles',
      eyebrow: 'Step 3',
      title: 'Insights & Results',
      body: 'When calls wrap, the AI writes each summary and tags it. Then synthesize every call into ranked themes, evidence and recommended actions — the “so what” for your leadership.',
    },
    {
      target: '.stats-grid',
      placement: 'top',
      icon: 'activity',
      eyebrow: 'Always live',
      title: 'Numbers that move',
      body: 'These tiles update as your team calls — no dashboards to build, no remarks columns to fill. Just listen, and the picture assembles itself.',
    },
    {
      target: '.sidebar-nav', mobileTarget: '#bottom-nav',
      placement: 'right',
      icon: 'target',
      eyebrow: 'Get around',
      title: 'Everything, one tap away',
      body: 'Projects, LODs, the console, results and insights all live here. Jump anywhere, anytime.',
    },
    {
      center: true, hero: true, final: true,
      eyebrow: 'You’re all set',
      title: 'Ab suno. 📞',
      body: 'A demo drive with real contacts is already loaded so you can dive straight in. Ready to run your first LOD?',
      cta: { label: 'Create my first LOD', route: 'lods' },
    },
  ];
}

function offlineSteps() {
  return [
    {
      center: true, hero: true,
      eyebrow: 'Welcome to LOD Field',
      title: 'Listen on the ground.',
      body: 'Record the real conversation on-site — seller visits, delivery hubs, store audits — and the AI transcribes and buckets it into clean insights by evening. Quick tour?',
    },
    {
      target: '.greet, .page-header',
      placement: 'bottom',
      icon: 'grid',
      eyebrow: 'Overview',
      title: 'Your field pulse',
      body: 'Sessions recorded, themes surfacing, drives in flight — all here, shared with the online surface.',
    },
    {
      target: '#nav-record', mobileTarget: '#bottom-nav',
      placement: 'right',
      icon: 'target',
      eyebrow: 'Step 1 · the heart',
      title: 'Record a conversation',
      body: 'Hit record on-site. Live transcript rolls as you talk — no key, no upload, works right in the browser.',
    },
    {
      target: '#nav-insights', mobileTarget: '#bottom-nav',
      placement: 'right',
      icon: 'sparkles',
      eyebrow: 'Step 2',
      title: 'Auto-bucketed insights',
      body: 'By evening the AI turns raw talk into ranked themes with evidence — nothing typed up by hand.',
    },
    {
      center: true, hero: true, final: true,
      eyebrow: 'You’re all set',
      title: 'Ab suno. 🎤',
      body: 'Everything you record here shows up on the online surface too — one shared store. Ready?',
      cta: { label: 'Start recording', route: 'record' },
    },
  ];
}

// ---------- engine ----------
let live = false;

export function startTour({ force = false } = {}) {
  if (live) return;
  if (!force && tourSeen()) return;
  const V = getVariant();
  const steps = V.mode === 'offline' ? offlineSteps() : onlineSteps();
  run(steps);
}

function run(steps) {
  live = true;
  let i = 0;

  const root = document.createElement('div');
  root.className = 'tour-root';
  root.innerHTML = `
    <div class="tour-catch"></div>
    <div class="tour-spot" hidden></div>
    <div class="tour-card" role="dialog" aria-modal="true"></div>`;
  document.body.appendChild(root);
  document.body.classList.add('tour-lock');

  const catcher = root.querySelector('.tour-catch');
  const spot = root.querySelector('.tour-spot');
  const card = root.querySelector('.tour-card');

  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

  const visible = (el) => {
    if (!el) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  };

  function resolveTarget(step) {
    const sel = (isMobile() && step.mobileTarget) ? step.mobileTarget : step.target;
    if (!sel) return null;
    for (const s of sel.split(',')) {
      const el = document.querySelector(s.trim());
      if (visible(el)) return el;
    }
    // try the primary selector even if we fell back to mobile
    if (step.target && step.target !== sel) {
      for (const s of step.target.split(',')) {
        const el = document.querySelector(s.trim());
        if (visible(el)) return el;
      }
    }
    return null;
  }

  function cardHTML(step, n, total) {
    const dots = Array.from({ length: total }, (_, k) =>
      `<span class="tour-dot ${k === n ? 'on' : ''} ${k < n ? 'done' : ''}"></span>`).join('');
    const back = n > 0 ? `<button class="btn btn-ghost btn-sm" data-t="back">${icon('arrowLeft')} Back</button>` : '<span></span>';
    const nextLabel = step.final ? (step.cta ? step.cta.label : 'Done') : 'Next';
    const nextCls = step.final ? 'btn-gold' : 'btn-primary';
    return `
      <button class="tour-x" data-t="skip" aria-label="Skip tour">${icon('x')}</button>
      ${step.hero ? `<div class="tour-orb">${icon(getVariant().mode === 'offline' ? 'mic' : 'phoneCall')}</div>` : (step.icon ? `<div class="tour-ico">${icon(step.icon)}</div>` : '')}
      <div class="tour-eyebrow">${step.eyebrow || ''}</div>
      <h3 class="tour-title">${step.title || ''}</h3>
      <p class="tour-body">${step.body || ''}</p>
      <div class="tour-foot">
        <div class="tour-dots">${dots}</div>
        <div class="tour-nav">
          ${back}
          <button class="btn ${nextCls} btn-sm" data-t="next">${nextLabel} ${step.final ? '' : icon('arrowRight')}</button>
        </div>
      </div>
      ${!step.final ? `<button class="tour-skip" data-t="skip">Skip tour</button>` : ''}`;
  }

  function placeCard(rect) {
    const m = 16;
    const vw = window.innerWidth, vh = window.innerHeight;
    const cw = card.offsetWidth, ch = card.offsetHeight;

    if (!rect) { // centered
      card.style.left = Math.round((vw - cw) / 2) + 'px';
      card.style.top = Math.round((vh - ch) / 2) + 'px';
      return;
    }
    const step = steps[i];
    const order = [step.placement, 'bottom', 'top', 'right', 'left'].filter(Boolean);
    const cand = {
      bottom: { left: rect.left + rect.width / 2 - cw / 2, top: rect.bottom + m },
      top:    { left: rect.left + rect.width / 2 - cw / 2, top: rect.top - ch - m },
      right:  { left: rect.right + m, top: rect.top + rect.height / 2 - ch / 2 },
      left:   { left: rect.left - cw - m, top: rect.top + rect.height / 2 - ch / 2 },
    };
    const fits = (p) => p.left >= m && p.top >= m && p.left + cw <= vw - m && p.top + ch <= vh - m;
    let pick = order.map(o => cand[o]).find(fits) || cand.bottom;
    const left = Math.max(m, Math.min(pick.left, vw - cw - m));
    const top = Math.max(m, Math.min(pick.top, vh - ch - m));
    card.style.left = Math.round(left) + 'px';
    card.style.top = Math.round(top) + 'px';
  }

  function position() {
    const step = steps[i];
    const el = step.center ? null : resolveTarget(step);
    if (el) {
      const r = el.getBoundingClientRect();
      const pad = 8;
      spot.hidden = false;
      spot.style.left = (r.left - pad) + 'px';
      spot.style.top = (r.top - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px';
      spot.style.height = (r.height + pad * 2) + 'px';
      catcher.classList.remove('solid');
      placeCard(r);
    } else {
      spot.hidden = true;
      catcher.classList.add('solid');
      placeCard(null);
    }
  }

  function show() {
    const step = steps[i];
    card.classList.toggle('hero', !!step.hero);
    card.innerHTML = cardHTML(step, i, steps.length);
    card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');

    card.querySelector('[data-t="next"]')?.addEventListener('click', next);
    card.querySelector('[data-t="back"]')?.addEventListener('click', prev);
    card.querySelectorAll('[data-t="skip"]').forEach(b => b.addEventListener('click', () => end(false)));

    const el = step.center ? null : resolveTarget(step);
    if (el) { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {} }
    // measure after scroll + layout. setTimeout (not rAF) so it still fires
    // when the tab isn't focused; place once fast, once after smooth-scroll.
    position();
    setTimeout(position, el ? 300 : 20);
  }

  function next() {
    const step = steps[i];
    if (step.final) { end(true, step.cta); return; }
    i = Math.min(i + 1, steps.length - 1);
    show();
  }
  function prev() { i = Math.max(i - 1, 0); show(); }

  function end(completed, cta) {
    if (!live) return;
    live = false;
    markSeen();
    root.classList.add('out');
    document.body.classList.remove('tour-lock');
    window.removeEventListener('resize', position, true);
    window.removeEventListener('scroll', position, true);
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => root.remove(), 260);
    if (completed && cta?.route) {
      import('../router.js').then(m => m.navigate(cta.route)).catch(() => {});
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); end(false); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
  }

  catcher.addEventListener('click', () => { /* block page, no dismiss on scrim */ });
  window.addEventListener('resize', position, true);
  window.addEventListener('scroll', position, true);
  document.addEventListener('keydown', onKey, true);

  show();
}

// expose a manual replay hook
if (typeof window !== 'undefined') {
  window.MLODTour = { start: (force = true) => startTour({ force }) };
}
