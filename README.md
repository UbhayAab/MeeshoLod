# Meesho LOD — Listen Or Die 📞

**Every function, always connected to users.**

LOD is Meesho's discipline of talking to real users, sellers and employees — constantly. This platform turns any spreadsheet into a live calling operation with an AI co-pilot that flashes the right question at the right moment.

## What it does

1. **Any team onboards itself** — Category, HR, Tech, Seller Ops… create a team, create a LOD (one goal + one list). Skeleton role-based access: Admin / Team Lead / Caller.
2. **Paste your list, however messy** — CSV/TSV/Sheets paste. A deterministic parser handles clean data instantly (header synonyms, Indian phone normalization, multi-number cells, dedupe); the **AI clean-up parse** handles the messy rest and names your context columns.
3. **AI writes the question stack** from your goal — 2-3 core questions + probing follow-ups, all editable.
4. **The calling console** — contacts load one by one (conveyor belt). Tap-to-call, wall-clock timer that survives reloads, full contact context. While you type rough notes, the AI:
   - ticks off questions it detects answers for,
   - **flashes the next best question** on the big card,
   - improvises sharp follow-up probes reacting to what the user just said,
   - drops a one-line coaching signal.
5. **Save & next** — AI writes the summary + theme tags (no more manual "Call remarks" columns). Disposition-aware: RNR/busy contacts sink to the back for retry.
6. **Results** — call table, tag distribution, CSV export, and **Synthesize insights**: a deep-model cross-call report (themes ranked with evidence, recommended actions, data gaps).

## Stack

- Vanilla JS ES modules, no framework, no build step — deploys as static files (GitHub Pages).
- Data: browser `localStorage` with JSON export/import (backend drops in later — the data layer is one module, `js/store.js`).
- AI: OpenAI via the Bifrost gateway (`gpt-4o` live, `gpt-5.5` for synthesis). Configurable in Settings, stored per-browser.

## Run locally

```bash
npx serve .        # or any static server
```

## Deploy

Push to `main` → GitHub Pages serves the root.

## Structure

```
index.html            boot screen + entry
css/                  design tokens (Meesho pink/purple) + inherited component system
js/app.js             boot + routes + app shell
js/store.js           data layer (localStorage)
js/ai.js              AI engine (parse / questions / live coach / summary / synthesis)
js/auth.js            local skeleton RBAC
js/pages/             login · dashboard · lods (+wizard) · lodDetail · calling · results · admin · settings
js/utils/parse.js     deterministic paste parser
```

---
Built with inspiration from the Jarurat Care patient-navigator calling portal.
