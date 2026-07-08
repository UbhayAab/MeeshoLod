# Meesho LOD — Full documentation

**LOD = "Listen Or Die"** — Meesho's discipline of staying connected to real users,
sellers, delivery partners and employees by *talking to them*, constantly. This app
turns that ritual into software, with an AI brain that does the listening-grunt-work.

One idea, **two surfaces**, one shared brain and data store.

---

## 1. The two surfaces

### `/u/` — **LOD Live** (online, pink) — Ubhay
Phone-based LODs. Upload a list, set a goal, call people one-by-one; an AI co-pilot
transcribes/reads your notes live and flashes the next best probe.

### `/s/` — **LOD Field** (offline, indigo) — Sumit
On-ground LODs. Record the real in-person conversation; the AI transcribes and
**auto-buckets** it into clean themed insights by evening. Plus upload pre-recorded audio.

Both share `localStorage` (same origin) — data created on one appears on the other.
Root `/` is a chooser linking to both.

---

## 2. Roles (skeleton RBAC)

`admin` (everything) · `lead` (create LODs, upload, view team results) · `caller`
(run the console). For the demo the app auto-signs-in an **Ubhay / admin** profile so
deep links (`/u/#dashboard`, `/s/#dashboard`) just work; logout → login screen, signup works.

---

## 3. Core objects

- **Team** — any function onboards itself (Grocery, Fashion, HR, Seller Ops, Logistics,
  Support, Wellness, Electronics …). Millions-of-teams skeleton.
- **LOD / Project** — one goal + one contact list + a question stack. `mode: online|offline`.
- **Contact** — name, phone(s), external id, arbitrary context columns (from the CSV).
- **Call / Field session** — disposition, notes, AI summary + tags; offline sessions also
  carry the full `transcript` and themed `buckets`.

---

## 4. Use cases seeded (the hardcoded demo DB)

16 LODs across 8 teams, ~200 contacts, ~100 calls + ~28 field sessions. Examples:

**Online (Live):** High-TPC non-transactors (grocery) · FnV refund-unactivated · saree
repeat-returners · first-order-only fashion buyers · warehouse attrition pulse (HR) ·
dropped-off seller reactivation · low-CSAT win-back (support) · repeat-medicine lapsers
(wellness) · high-RTO pincode intent check (logistics) · accessory browsers who never buy.

**Offline (Field):** kirana on-ground visits (Indore) · delivery-partner hub interviews ·
dark-store freshness audit · pharmacy partner field pulse · return-pickup rider ride-alongs ·
Surat boutique supplier visits.

---

## 5. Flows

### 5.1 Create a LOD (both surfaces)
Projects/LODs → **New**: (1) name + team + goal → (2) **paste OR upload a CSV/TSV** →
deterministic parser (header-synonyms, Indian phone normalization, multi-number cells,
dedupe) + optional **AI clean-up parse** → (3) AI-generated **themed question stack**
(core + probes), editable → (4) launch. Or **⚡ Auto-build & launch** in one tap.

### 5.2 Online calling (`/u/#calling`)
Pick LOD → contacts load one-by-one (conveyor belt). Tap-to-call, wall-clock timer that
survives reloads. **🎙️ Live listen** transcribes the call live (speakerphone) into the
notes; the AI ticks off answered questions, flashes the next probe + improvised follow-ups,
and shows a coaching signal. Save → AI writes summary + tags → next contact.

### 5.3 Offline recording (`/s/#record`)
Pick a field project + who you're meeting → big **Record** orb → speak the conversation
(live on-device transcription) → **Auto-bucket with AI** → themed buckets + summary + tags
→ **Save session**. Also `/s/#voice-upload` to upload a pre-recorded file (Whisper; see
gateway note in SUMIT_NOTES.md). Sessions listed at `/s/#sessions`.

### 5.4 Results & Insights (both)
- **Results** — per-LOD stats, tag distribution, call log, CSV export, and **Synthesize
  insights** (deep model → ranked themes with evidence + recommended actions).
- **Insights** — count-based per-question rollup across a LOD's calls.

---

## 6. The AI brain (`js/ai.js`, via the buildathon gateway)

`generateQuestions` (themed stack) · `liveCoach` (live probes) · `summarizeCall` ·
`synthesize` (deep cross-call report) · `bucketTranscript` (offline transcript → buckets) ·
`parseContactsAI` (messy paste → clean JSON) · `transcribeAudio` (Whisper).
Models: `gpt-4o` (fast/live), `gpt-5.5` (deep synthesis), `whisper-1` (audio). All keys
configurable in **Settings** (stored per-browser); the gateway key ships for the buildathon.

**Transcription split:** live transcription uses the browser's on-device Web Speech API
(instant, free, no key). The gateway key powers the *intelligence* (probes, buckets,
synthesis). OpenAI's realtime voice + Whisper endpoints are blocked by the gateway today
(403) — see SUMIT_NOTES.md.

---

## 7. Architecture

Vanilla-JS ES-module SPA, no framework, no build step; static-hostable. Hash router with
role guards (`js/router.js`). Variant system in `js/variant.js`. Design tokens in
`css/variables.css` (pink default + `:root[data-variant="s"]` indigo). Data layer isolated
in `js/store.js` (localStorage now → real backend later, one module to swap).

```
index.html        root chooser (→ /u/, /s/)
u/index.html      Live surface entry (variant u)
s/index.html      Field surface entry (variant s)
css/              tokens + component/layout system (+ variant overrides)
js/variant.js     the two surfaces + their navs
js/store.js       shared data layer + the huge demo seed
js/ai.js          the AI brain
js/voice.js       browser speech-to-text wrapper
js/pages/         login · dashboard · projects · lods(+wizard) · lodDetail · calling ·
                  record · sessions · voiceUpload · results · insights · admin · settings
```

---

## 8. Deploy
See `DEPLOY.md` — buildathon Docker registry → portal → Deploy Live.
