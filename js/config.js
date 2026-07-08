// ============================================================
// Meesho LOD — App configuration
// AI settings can be overridden at runtime from Settings page
// (persisted to localStorage under mlod_settings).
// ============================================================

export const APP_NAME = 'Meesho LOD';
export const APP_TAG = 'Listen Or Die';
export const APP_BUILD = '20260708a';

// Default AI gateway (Bifrost buildathon gateway → OpenAI).
// NOTE: this key lives client-side by design (static GitHub Pages app).
// Rotate/replace it from Settings without redeploying.
export const AI_DEFAULTS = {
  endpoint: 'https://gateway-buildathon.ltl.sh/v1/chat/completions',
  apiKey: 'sk-bf-cd5a5f2d-142e-4e5a-9317-aafd3fb1f23e',
  // fast model → live in-call coaching, parsing, summaries
  model: 'gpt-4o',
  // deep model → cross-call synthesis reports (reasoning model, slower)
  deepModel: 'gpt-5.5',
  // audio → transcript, for the voice-upload flow
  whisperModel: 'whisper-1',
};

export const ROLES = [
  { key: 'admin',  label: 'Admin',     hint: 'Everything — teams, users, all LODs' },
  { key: 'lead',   label: 'Team Lead', hint: 'Create LODs, upload lists, view team results' },
  { key: 'caller', label: 'Caller',    hint: 'Run the calling console on assigned LODs' },
];

export const DISPOSITIONS = [
  { key: 'connected',    label: 'Connected',      tone: 'ok',      icon: 'phone' },
  { key: 'rnr',          label: 'RNR / No answer', tone: 'warn',    icon: 'phone-missed' },
  { key: 'busy',         label: 'Busy',           tone: 'warn',    icon: 'clock' },
  { key: 'disconnected', label: 'Cut mid-call',   tone: 'info',    icon: 'phone-off' },
  { key: 'wrong_number', label: 'Wrong number',   tone: 'danger',  icon: 'x' },
  { key: 'call_back',    label: 'Call back later', tone: 'primary', icon: 'calendar' },
];

export function dispositionMeta(key) {
  return DISPOSITIONS.find(d => d.key === key) || DISPOSITIONS[0];
}
