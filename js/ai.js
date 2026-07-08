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
  };
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

// Goal → question stack for the flasher
export async function generateQuestions(goal, { teamName = '', sampleContact = null, count = 7 } = {}) {
  const sys = `You design short, conversational calling-script questions for Meesho's LOD (Listen Or Die) program — ops teams calling real users/sellers/employees to understand one specific goal.
Rules:
- ${count} questions max. Mix: 2-3 "core" (directly answer the goal) + probes (dig into causes: price, brand, habit, trust, timing, competition...).
- Questions must be speakable on a phone call in India — simple English, short. No jargon.
- Reply ONLY JSON: {"questions":[{"text":"...","type":"core"|"probe"}]}`;
  const user = `Team: ${teamName || 'n/a'}\nGoal: ${goal}\n${sampleContact ? `Example contact context: ${JSON.stringify(sampleContact).slice(0, 800)}` : ''}`;
  const out = await chatJSON([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ], { maxTokens: 1200, temperature: 0.5 });
  if (!out || !Array.isArray(out.questions)) return null;
  return out.questions
    .filter(q => q && q.text)
    .map(q => ({ text: String(q.text).trim(), type: q.type === 'core' ? 'core' : 'probe' }));
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

export { chat as aiChat, chatJSON as aiChatJSON };
