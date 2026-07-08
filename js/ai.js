// ============================================================
// Meesho LOD — AI engine (Bifrost gateway → OpenAI)
// One low-level caller + five high-level skills:
//   parseContactsAI   raw paste → {columns, contacts} JSON
//   generateQuestions goal → question stack
//   liveCoach         in-call notes → extracted answers + next questions
//   summarizeCall     call → summary + tags
//   synthesize        all calls → cross-call insight report
// Every skill degrades gracefully — callers must handle null.
// ============================================================

import { AI_DEFAULTS } from './config.js';
import { getSettings } from './store.js';

function aiConfig() {
  const s = getSettings();
  return {
    endpoint: s.aiEndpoint || AI_DEFAULTS.endpoint,
    apiKey: s.aiApiKey || AI_DEFAULTS.apiKey,
    model: s.aiModel || AI_DEFAULTS.model,
    deepModel: s.aiDeepModel || AI_DEFAULTS.deepModel,
    whisperModel: s.aiWhisperModel || AI_DEFAULTS.whisperModel,
  };
}

// Same gateway/host as chat, OpenAI-compatible audio path.
function transcribeEndpoint(chatEndpoint) {
  return chatEndpoint.replace(/\/chat\/completions\/?$/, '/audio/transcriptions');
}

export function aiStatus() {
  const c = aiConfig();
  return { configured: !!(c.endpoint && c.apiKey), ...c };
}

// ---- low level ------------------------------------------------
// A hung gateway (blackholed proxy, captive portal) would otherwise leave
// fetch() neither resolving nor rejecting until the browser's own socket
// timeout (minutes) — every "Saving…" / "Synthesizing…" button would freeze.
// Reasoning models (deep synthesis) get a longer budget than the live coach.
const DEFAULT_TIMEOUT_MS = 30000;
const DEEP_TIMEOUT_MS = 75000;

async function chat(messages, { model, json = false, maxTokens = 1200, temperature = 0.4, signal, timeoutMs } = {}) {
  const cfg = aiConfig();
  const useModel = model || cfg.model;
  const body = {
    model: useModel,
    messages,
  };
  // reasoning models (gpt-5.x) reject temperature/max_tokens
  if (/^gpt-5/.test(useModel)) {
    body.max_completion_tokens = Math.max(maxTokens, 4000);
  } else {
    body.temperature = temperature;
    body.max_tokens = maxTokens;
    if (json) body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const budget = timeoutMs || (/^gpt-5/.test(useModel) ? DEEP_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), budget);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  let res;
  try {
    res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`AI gateway timed out after ${Math.round(budget / 1000)}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI gateway ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  return content;
}

// Audio file → transcript text, via the same gateway/key as chat.
// Slower and heavier than a chat call, so it gets its own generous timeout
// and is NOT routed through chat() — it's multipart, not JSON.
const TRANSCRIBE_TIMEOUT_MS = 120000;

export async function transcribeAudio(file, { signal } = {}) {
  const cfg = aiConfig();
  const url = transcribeEndpoint(cfg.endpoint);

  const form = new FormData();
  form.append('file', file, file.name || 'audio.webm');
  form.append('model', cfg.whisperModel);
  form.append('response_format', 'json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      // no Content-Type — the browser sets the multipart boundary itself
      headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Transcription timed out after ${Math.round(TRANSCRIBE_TIMEOUT_MS / 1000)}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Transcription ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = String(data?.text || data?.transcript || '').trim();
  if (!text) throw new Error('Empty transcript returned');
  return text;
}

function extractJSON(text) {
  if (!text) return null;
  let t = String(text).trim();
  // strip ```json fences
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  // grab the outermost {...} or [...]
  const m = t.match(/[{[][\s\S]*[}\]]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

async function chatJSON(messages, opts = {}) {
  // one retry with a "JSON only" nudge
  for (let attempt = 0; attempt < 2; attempt++) {
    const msgs = attempt === 0 ? messages : [
      ...messages,
      { role: 'user', content: 'Your previous reply was not valid JSON. Reply with ONLY the JSON object, no prose, no markdown.' },
    ];
    try {
      const text = await chat(msgs, { ...opts, json: true });
      const obj = extractJSON(text);
      if (obj) return obj;
    } catch (e) {
      if (attempt === 1) throw e;
    }
  }
  return null;
}

// ---- skills ---------------------------------------------------

// Raw pasted mess → structured contacts. AI names columns properly and
// pulls per-row context; deterministic parser output is passed as a hint.
export async function parseContactsAI(rawText, { goal = '', hint = null } = {}) {
  const sample = String(rawText).slice(0, 14000);
  const sys = `You convert raw pasted spreadsheet/CRM data into clean JSON for a calling platform.
Rules:
- Identify for each row: name (may be empty), phone numbers (Indian, normalize to 10 digits, a cell may contain several), an external id if present.
- Every OTHER column becomes a context field: create snake_case keys and human labels.
- Keep values as short strings. Skip fully-empty columns. Max 40 columns.
- Reply ONLY JSON: {"columns":[{"key":"...","label":"..."}],"contacts":[{"name":"","phone":"9876543210","phones":["9876543210"],"ext_id":"","data":{"key":"value"}}],"notes":"one-line comment on data quality"}`;
  const user = `Calling goal (for context): ${goal || 'n/a'}\n${hint ? `A deterministic parser found columns: ${JSON.stringify(hint)}\n` : ''}RAW DATA:\n${sample}`;
  const out = await chatJSON([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ], { maxTokens: 4000, temperature: 0.1 });
  if (!out || !Array.isArray(out.contacts)) return null;
  out.contacts = out.contacts
    .map(c => ({
      name: String(c.name || '').trim(),
      phone: String(c.phone || (c.phones && c.phones[0]) || '').replace(/\D/g, '').slice(-10),
      phones: (Array.isArray(c.phones) && c.phones.length ? c.phones : [c.phone])
        .map(p => String(p || '').replace(/\D/g, '').slice(-10)).filter(p => p.length === 10),
      ext_id: String(c.ext_id || '').trim(),
      data: (c.data && typeof c.data === 'object') ? c.data : {},
    }))
    .filter(c => c.phone.length === 10);
  out.columns = Array.isArray(out.columns) ? out.columns.filter(c => c && c.key) : [];
  return out;
}

// Goal → a full themed question plan for the flasher.
// This is the "brain": it thinks in THEMES (the angles a call must cover),
// each with a core question and several improvised probes, so a single goal
// expands into a deep, reusable script that works across many use cases
// (category / HR / seller ops / support …). Returns a flat, id-less list
// (caller assigns ids) where every entry carries its theme, and probes sit
// right after the core question they belong to.
export async function generateQuestions(goal, { teamName = '', sampleContact = null, columns = [], themeCount = 5, probesPerCore = 3 } = {}) {
  const colHint = columns.length ? `\nThe uploaded list has these context columns you can reference or probe around: ${columns.map(c => c.label || c.key || c).join(', ')}.` : '';
  const sys = `You are the question-design brain for Meesho's LOD ("Listen Or Die") program — ops teams phone real users, sellers, delivery partners or employees to deeply understand ONE goal. You turn a goal into a rich, structured call script.

Think in THEMES: the distinct angles a good caller must cover to fully answer the goal (e.g. for "why not buying category X": current buying habit, price perception, brand loyalty, pack size, trust/ratings, delivery, awareness). Pick the themes that actually fit THIS goal and audience — infer whether these are customers, sellers, or employees from the goal/team.

For EACH theme produce:
- one "core" question (directly gets the key fact for that theme)
- ${probesPerCore} "probe" follow-ups (dig deeper: causes, comparisons, specifics, emotions, "what would change your mind")

Rules:
- ${themeCount} themes. Every question speakable on an Indian phone call: short, simple, warm, conversational — Hinglish-friendly is fine. No corporate jargon, no compound double-barrel questions.
- Probes must be genuinely different from their core question and from each other.
- Reply ONLY JSON:
{"themes":[{"name":"<short theme label>","core":"<core question>","probes":["<probe1>","<probe2>", ...]}]}`;
  const user = `Team: ${teamName || 'n/a'}\nGoal: ${goal}${colHint}\n${sampleContact ? `Example contact from the list: ${JSON.stringify(sampleContact).slice(0, 800)}` : ''}`;
  const out = await chatJSON([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ], { maxTokens: 2600, temperature: 0.55 });

  // Accept either the rich themed shape or a plain flat {questions:[...]} fallback
  const flat = [];
  if (out && Array.isArray(out.themes)) {
    for (const t of out.themes) {
      const theme = String(t?.name || '').trim() || 'General';
      if (t?.core) flat.push({ text: String(t.core).trim(), type: 'core', theme });
      if (Array.isArray(t?.probes)) {
        for (const p of t.probes) {
          if (p) flat.push({ text: String(p).trim(), type: 'probe', theme });
        }
      }
    }
  } else if (out && Array.isArray(out.questions)) {
    for (const q of out.questions) {
      if (q && q.text) flat.push({ text: String(q.text).trim(), type: q.type === 'core' ? 'core' : 'probe', theme: String(q.theme || '').trim() || 'General' });
    }
  }
  // dedupe by normalized text, keep order
  const seen = new Set();
  const deduped = flat.filter(q => {
    const k = q.text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return deduped.length ? deduped : null;
}

// THE live loop: caller's running notes → what's been answered,
// which questions to flash next, and a suggested follow-up probe.
export async function liveCoach({ goal, questions, contact, notes, disposition }) {
  const qList = questions.map((q, i) => `${i + 1}. [${q.id}] ${q.text}`).join('\n');
  const sys = `You are a live call co-pilot for Meesho's LOD calling program. The caller is ON THE PHONE now, typing rough notes. You must be fast and concrete.
Given the goal, the question stack, contact context and the caller's notes so far:
1. Detect which questions already have an answer in the notes (match by question id).
2. Pick the 1-2 BEST questions to ask next (unanswered, most valuable given what was just learned).
3. Optionally craft ONE sharp improvised follow-up probe reacting to something specific the contact said.
4. Read the direction of the call: one short coaching signal for the caller.
Reply ONLY JSON:
{"answered":[{"id":"<question id>","answer":"<one-line extracted answer>"}],
 "next_ids":["<id>","<id>"],
 "improvised":"<one probe question or empty string>",
 "signal":"<max 12 words of coaching>"}`;
  const user = `GOAL: ${goal}
QUESTIONS:\n${qList}
CONTACT: ${JSON.stringify({ name: contact.name, ...contact.data }).slice(0, 700)}
DISPOSITION SO FAR: ${disposition || 'in progress'}
CALLER NOTES SO FAR:\n${notes}`;
  const out = await chatJSON([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ], { maxTokens: 700, temperature: 0.3 });
  if (!out) return null;
  return {
    answered: Array.isArray(out.answered) ? out.answered.filter(a => a && a.id) : [],
    next_ids: Array.isArray(out.next_ids) ? out.next_ids : [],
    improvised: String(out.improvised || '').trim(),
    signal: String(out.signal || '').trim(),
  };
}

// Post-call: notes → summary + tags + final structured answers
export async function summarizeCall({ goal, questions, contact, notes, disposition, durationSec }) {
  const qList = questions.map(q => `[${q.id}] ${q.text}`).join('\n');
  const sys = `You write the post-call record for Meesho's LOD calling program.
From the caller's rough notes produce:
- summary: 1-3 crisp sentences capturing WHY (the insight, not the transcript).
- tags: 1-4 short reusable theme tags (e.g. "Pricing", "Small pack requirement", "Brand loyal", "Delivery speed", "Adoption", "Rating sensitive"). Reuse plain category words.
- answers: map of question id → one-line answer, only for questions actually addressed.
Reply ONLY JSON: {"summary":"...","tags":["..."],"answers":{"<id>":"..."}}`;
  const user = `GOAL: ${goal}
QUESTIONS:\n${qList}
CONTACT: ${JSON.stringify({ name: contact.name, ...contact.data }).slice(0, 700)}
DISPOSITION: ${disposition} · duration ${Math.round((durationSec || 0) / 60)}min
NOTES:\n${notes || '(no notes)'}`;
  const out = await chatJSON([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ], { maxTokens: 800, temperature: 0.3 });
  if (!out) return null;
  return {
    summary: String(out.summary || '').trim(),
    tags: Array.isArray(out.tags) ? out.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 5) : [],
    answers: (out.answers && typeof out.answers === 'object') ? out.answers : {},
  };
}

// OFFLINE (field) — a recorded on-ground conversation → clean insight buckets.
// This is the heart of the /s/ (LOD Field) surface: transcribe on-device,
// then this buckets the raw transcript into themes with evidence points.
export async function bucketTranscript({ goal, transcript, questions = [] }) {
  const qHint = questions.length ? `\nThe field guide themes to look for: ${[...new Set(questions.map(q => q.theme).filter(Boolean))].join(', ')}.` : '';
  const sys = `You process an on-ground (offline) LOD conversation for Meesho's Field program. The caller recorded a real in-person conversation (may be Hindi/Hinglish). Turn the raw transcript into clean, structured insight.
Produce:
- summary: 2-3 crisp sentences — the WHY / the takeaway, not a retelling.
- buckets: the 2-5 themes actually present, each with 1-4 short evidence points paraphrased from what was said.
- tags: 2-5 short reusable theme tags.
Reply ONLY JSON: {"summary":"...","buckets":[{"theme":"...","points":["...","..."]}],"tags":["..."]}`;
  const user = `GOAL: ${goal}${qHint}\nTRANSCRIPT:\n${String(transcript || '').slice(0, 12000)}`;
  const out = await chatJSON([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ], { maxTokens: 1400, temperature: 0.3 });
  if (!out) return null;
  return {
    summary: String(out.summary || '').trim(),
    buckets: Array.isArray(out.buckets) ? out.buckets
      .filter(b => b && b.theme)
      .map(b => ({ theme: String(b.theme).trim(), points: Array.isArray(b.points) ? b.points.map(p => String(p).trim()).filter(Boolean) : [] })) : [],
    tags: Array.isArray(out.tags) ? out.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 5) : [],
  };
}

// Cross-call synthesis — uses the deep model
export async function synthesize({ lod, calls }) {
  const cfg = aiConfig();
  const rows = calls.map(c => {
    const contact = lod.contacts.find(x => x.id === c.contactId) || {};
    return {
      who: contact.name || contact.ext_id || contact.phone || '?',
      disposition: c.disposition,
      tags: c.tags || [],
      summary: c.summary || '',
      notes: (c.notes || '').slice(0, 500),
    };
  });
  const sys = `You are the insights analyst for Meesho's LOD (Listen Or Die) calling program. Given a calling goal and all call records, produce a sharp markdown report:
# headline finding (one line)
## Key themes — ranked, with counts and 1-2 verbatim-style evidence lines each
## What to do — 3-5 concrete recommended actions for the team
## Data gaps — what the calls still don't answer
Be specific and quantitative where possible. No fluff.`;
  const user = `GOAL: ${lod.goal}\nTEAM: ${lod.name}\nCALLS (${rows.length}):\n${JSON.stringify(rows).slice(0, 24000)}`;
  const text = await chat([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ], { model: cfg.deepModel, maxTokens: 6000 });
  return text || null;
}

// Per-question insights across all calls for a LOD — deep model, JSON.
// We hand the model the question stack plus ONE record per call — its
// pre-extracted per-question answers if present, otherwise the call's
// summary + notes/transcript. It works out where each customer stands on
// each question, clusters them into a few buckets, and COUNTS how many
// fall in each (e.g. "5 disliked pricing"). This is robust to calls that
// never had per-question answers extracted (seeded data, field recordings).
// Returns { [questionId]: { takeaway, breakdown:[{label,count}] } }, or null.
export async function synthesizeByQuestion({ lod, calls }) {
  const cfg = aiConfig();
  const questions = (lod.questions || []).map(q => ({ id: q.id, question: q.text }));
  if (!questions.length) return {};

  // one record per call, from whatever it captured
  const rows = [];
  for (const c of calls) {
    if (c.connected === false) continue; // RNR / busy / wrong number — nothing was said
    const contact = lod.contacts.find(x => x.id === c.contactId) || {};
    const who = contact.name || c.customerLabel || contact.ext_id || contact.phone || '?';
    const answers = (c.answers && Object.keys(c.answers).length) ? c.answers : null;
    const summary = String(c.summary || '').slice(0, 400);
    const notes = String(c.transcript || c.notes || '').slice(0, 700);
    if (answers || summary || notes) rows.push({ who, answers, summary, notes });
  }
  if (!rows.length) return {};

  const sys = `You are the insights analyst for Meesho's LOD ("Listen Or Die") calling program. You are given the calling GOAL, the QUESTIONS in the stack, and one RECORD per customer call — its per-question answers if captured, otherwise a summary and notes/transcript.
For EACH question, work out where each customer stands, then cluster them into a SMALL set of response buckets and COUNT how many customers fall in each.
Rules:
- 2-5 buckets per question. A customer counts toward a question ONLY if their record actually speaks to it — do not force everyone into every question, and per-question counts must not exceed the number of customers.
- Bucket labels are short and phrased as a stance on the question in the customers' framing (e.g. for "did you not like the pricing?": "Found pricing too high", "Pricing was fine"; for "did you find the assortment?": "Could not find what they wanted", "Found it").
- Order buckets by count, largest first. Add a one-line takeaway per question.
- Omit a question entirely if no customer's record addresses it.
Reply ONLY JSON: {"insights":{"<question id>":{"takeaway":"<one line>","breakdown":[{"label":"<bucket>","count":<int>}]}}}`;
  const user = `GOAL: ${lod.goal}\nTEAM: ${lod.name}\nQUESTIONS:\n${JSON.stringify(questions)}\nCUSTOMER RECORDS (${rows.length}):\n${JSON.stringify(rows).slice(0, 24000)}`;
  const out = await chatJSON([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ], { model: cfg.deepModel, maxTokens: 4000 });
  if (!out || !out.insights || typeof out.insights !== 'object') return null;

  // normalize: coerce counts to ints, drop empty buckets, keep only real entries
  const res = {};
  for (const [qid, v] of Object.entries(out.insights)) {
    if (!v) continue;
    const breakdown = Array.isArray(v.breakdown)
      ? v.breakdown
          .map(b => ({ label: String(b?.label || '').trim(), count: Math.max(0, parseInt(b?.count, 10) || 0) }))
          .filter(b => b.label && b.count > 0)
          .sort((a, b) => b.count - a.count)
      : [];
    const takeaway = String(v.takeaway || '').trim();
    if (takeaway || breakdown.length) res[qid] = { takeaway, breakdown };
  }
  return res;
}

export { chat as aiChat, chatJSON as aiChatJSON };
