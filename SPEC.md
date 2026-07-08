# Meesho LOD — Page-builder SPEC (internal)

Vanilla JS ES-module SPA. No framework, no build step. Every page module exports
`render<Name>(container, params)` which renders full HTML into `container` via
`innerHTML` and attaches listeners imperatively after render. **Escape all user
data with `esc()`**.

## Brand
Meesho: primary pink `#F43397`, deep purple night panels. All colors come from
CSS tokens — never hardcode hex. Tone: sharp ops tool, Hinglish-friendly copy OK.
App name: **Meesho LOD — "Listen Or Die"**: every function stays connected to
users by calling them.

## Module contracts (import paths relative to `js/pages/`)

### `../store.js`
- `getUsers() / getUser(id) / saveUser({id?,name,role,teamId}) / deleteUser(id)`
- `getTeams() / getTeam(id) / saveTeam({id?,name,desc?}) / deleteTeam(id)`
- `getLods() / getLod(id) / saveLod(lod) / deleteLod(id)`
- `addContacts(lodId, rows) → {added, duplicates}` — rows: `{name,phone,phones[],ext_id,data{}}`
- `lodProgress(lod) → {total,done,skipped,pending,pct}`
- `getCalls({lodId?,callerId?,contactId?}) → call[]` — call: `{id,lodId,contactId,callerId,disposition,connected,notes,answers{qid:ans},summary,tags[],durationSec,ts}`
- `getSettings() / saveSettings(patch)` — AI overrides live at keys `aiEndpoint,aiApiKey,aiModel,aiDeepModel`
- `exportAll() → json string / importAll(json) / resetAll()`
- `uid(prefix)`
- lod shape: `{id,name,teamId,goal,status:'active'|'paused'|'done',questions:[{id,text,type:'core'|'probe'}],columns:[{key,label}],contacts:[{id,name,phone,phones[],ext_id,data{},status:'pending'|'done'|'skipped',attempts}],createdBy,createdAt}`

### `../auth.js`
`getCurrentUser() / getUserRole() / isAdmin() / isLeadOrAdmin() / login(userId) / signup({name,role,teamId}) / logout() / hasAnyUsers()`

### `../ai.js`
- `aiStatus() → {configured, endpoint, apiKey, model, deepModel}`
- `synthesize({lod, calls}) → markdown string` (async, deep model, can take 30s+)
- `aiChat(messages, opts)` low-level
- All async AI fns can throw / return null — ALWAYS try/catch and degrade gracefully.

### `../router.js` — `navigate(path)`  ·  routes: `login, dashboard, lods, lods/:id (params.id), calling, results, admin, settings`

### `../components/toast.js` — `showToast(msg, 'success'|'error'|'warning'|'info')`
### `../components/modal.js` — `showModal({title,content,size:''|'lg'|'xl',footer,onClose}) / closeModal() / confirmModal(msg, onConfirm, {title,confirmLabel,danger})`
### `../components/icons.js` — `icon(name)` → svg string. Names: grid, phone, phoneCall, users, user, userPlus, chart, shieldCheck, fileText, logOut, x, check, checkCircle, alertCircle, alertTriangle, info, search, filter, plus, chevronRight, chevronDown, arrowRight, arrowLeft, clock, calendar, upload, skip, copy, play, edit, trash, mic, message, download, activity, refresh, star, inbox, book, key, lock, mail, target, settings, zap, sparkles, phoneMissed, phoneOff, flame
### `../components/sidebar.js` — `avatarColor(name), getInitials(name), roleLabel(role)`
### `../config.js` — `ROLES:[{key:'admin'|'lead'|'caller',label,hint}]`, `DISPOSITIONS:[{key,label,tone,icon}]`, `dispositionMeta(key)`, `APP_NAME`, `APP_TAG`
### `../utils/format.js` — `esc(s), fmtDuration(sec)→"mm:ss", timeAgo(ts), fmtDate(ts), mdToHtml(md)`
### `../utils/parse.js` — `formatPhone(p)`, `parseContactsDeterministic(text)`, `toCSV(headers, rows)`

## CSS classes available (already styled — use these, avoid custom CSS)
Layout: `page-header` (flex h1 + `.header-subtitle` + right `.pg-actions`), `card card-pad`, `card-feature`, `card-hover`, `stats-grid`, `stat-card` (`.stat-ico .stat-num .stat-lbl`), `dash-grid`, `content-grid`, `info-grid kv` (`.info-cell .info-label .info-value`), `empty-state`.
Controls: `btn btn-primary|btn-secondary|btn-ghost|btn-danger|btn-gold` + `btn-sm|btn-lg|btn-block|btn-icon`, `input`, `select`, `textarea`, `form-group form-label hint`, `seg-btn` (+`on tone-ok|warn|danger|info|primary`), `switch`, `badge badge-ok|warn|danger|info|primary|gold|neutral|violet`, `avatar avatar-lg`, `spinner`, `eyebrow`.
Tables: `table-container` wrapping `data-table` (mono uppercase th, hover rail).
App-specific (css/lod.css): `flash-deck/flash-card(+improv,pulse,flash-in)/flash-eyebrow/flash-q`, `coach-signal`, `ai-thinking` + `.spark`, `qstack/qrow(+answered,up-next)/q-ico/q-text/q-ans/q-type`, `tagchip (+t2,t3,t4)`, `tagrow`, `wiz-steps/wiz-step(+active,done)/n/wiz-sep`, `paste-zone`, `parse-tally (+.ok,.bad)`, `preview-wrap` (own table), `report` (rendered markdown), `notes-area`, `ans-chip`, `goal-banner` (+`.k`), `progress-track/progress-fill`, `mono-cell`, `pg-actions`.
Login page: `login-page login-split login-hero login-card login-logo lh-*` classes exist from inherited layout.css (dark aurora left panel + form card right).

## Non-negotiables
- Never hardcode colors; tokens only (`var(--primary)` etc.).
- All user/AI data through `esc()` before innerHTML (mdToHtml handles its own escaping).
- Mobile: pages must not overflow horizontally; tables inside `.table-container`.
- Empty states for zero data. Loading spinners on async buttons (swap innerHTML, restore after).
- No external libraries. No fetch except through `../ai.js`.
