# Notes for Sumit (and Sumit's Claude) — read me first

Hi! Ubhay and I set up a **two-surface** structure so we each have a distinct app
that shares one codebase and one data store. Your offline work now lives in the
**Field** surface. Here's the plan and where to work.

## The big idea: one repo, two surfaces, shared data

| URL | Surface | Owner | Theme | Primary flow |
|-----|---------|-------|-------|--------------|
| `/u/#…` | **LOD Live** (online) | Ubhay | Meesho **pink** | Upload list → call → live AI co-pilot |
| `/s/#…` | **LOD Field** (offline) | Sumit | **indigo/teal** | Record on-ground convo → AI buckets it |

- Both are served from the **same origin**, so `localStorage` is **shared** — a LOD or
  call created on one surface shows up on the other. This is the "pull all" / shared DB.
- The surface is chosen by `window.__MLOD_VARIANT` set in `u/index.html` / `s/index.html`
  **before** `app.js` runs. Everything variant-specific reads **`js/variant.js` → `getVariant()`**.
- Root `index.html` is a chooser that links to `/u/` and `/s/`.

## Where YOUR stuff is wired in

Your three commits merged cleanly. They're now reachable inside the variant framework:

- **`js/pages/voiceUpload.js`** → route `#voice-upload`, in the **Field** (offline) nav as
  "Upload Recordings". (Upload a recording → `transcribeAudio()` → summarize.)
- **`js/pages/insights.js`** → route `#insights`, in **both** navs as "Insights"
  (count-based per-question rollup by LOD).
- **`js/ai.js`** → your `transcribeAudio()` + `whisperModel` are intact.

To change what's in each surface's sidebar, edit the `NAV_ONLINE` / `NAV_OFFLINE`
arrays in **`js/variant.js`** (NOT `sidebar.js` anymore — the nav moved to variant.js).

## ⚠️ One thing to know about `transcribeAudio()` (Whisper)

The buildathon gateway currently returns **403 Access Denied** on
`/v1/audio/transcriptions` (I probed it — only `/v1/chat/completions` is open). So the
upload→Whisper path may 403 at runtime until the org allowlists that endpoint. Two options:
1. Ask the organisers to open `/v1/audio/transcriptions` on the gateway, or
2. Use the **browser** speech recognizer instead (no key, no upload). I built a wrapper at
   **`js/voice.js`** (`createVoiceSession`) and a live recorder at **`js/pages/record.js`**
   that already does on-ground record → live transcript → `bucketTranscript()`. You can
   reuse `js/voice.js` for the upload page's "record live" alternative.

## Data model (js/store.js) — the shared store

- `getLods()` → LODs have `mode: 'online' | 'offline'` (offline = your field projects).
- `getCalls({ mode: 'offline' })` → **field sessions** (records with `transcript` + `buckets`).
- A call/session: `{ id, lodId, contactId, callerId, mode, disposition, connected, notes,
  transcript?, buckets?:[{theme,points[]}], summary, tags[], durationSec, ts }`.
- `saveCall(...)`, `updateContact(lodId, contactId, patch)`, `lodProgress(lod)`.
- Everything is `localStorage` for now (keys `mlod_*`). Swapping in a real backend =
  reimplement `js/store.js` only; pages don't change. **This is where the DB goes.**

## AI brain (js/ai.js) — all via the gateway key in `js/config.js`

- `generateQuestions(goal,…)` → themed question stack (core + probes).
- `liveCoach(…)` → live probes from running notes (online).
- `summarizeCall(…)` / `synthesize({lod,calls})` → summary/tags + deep cross-call report.
- **`bucketTranscript({goal, transcript, questions})`** → offline transcript → `{summary, buckets, tags}`.
- `transcribeAudio(file)` → Whisper (see 403 note above).

## Please DON'T

- Don't re-add nav items inline in `sidebar.js` — put them in `js/variant.js`.
- Don't hardcode colors; use CSS tokens (the indigo theme is `:root[data-variant="s"]`
  in `css/variables.css`).
- Don't break the shared store shape — add fields, don't rename existing ones.

## Deploy

We deploy via the buildathon flow (Docker → `registry.buildathon.meesho.dev` →
buildathon portal → Deploy Live). See `DEPLOY.md`. It's a static site, so the image
just serves these files.

— Ubhay
