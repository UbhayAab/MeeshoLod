// ============================================================
// Meesho LOD — Live voice listener
//
// Uses the browser's built-in Web Speech API (Chrome / Android /
// Edge) for continuous, real-time speech-to-text. NO API key and
// NO audio upload — recognition runs on-device/in-browser, so it's
// instant and private. The transcript is fed into the existing GPT
// "brain" (js/ai.js liveCoach) which keeps flashing fresh probes.
//
// IMPORTANT constraint: a web page cannot access a native phone
// call's audio. This captures the CALLER'S MICROPHONE — so put the
// call on SPEAKERPHONE and the mic hears both sides.
//
// OpenAI's realtime *voice* API needs a WebSocket + ephemeral keys
// and is not exposed by the /v1/chat/completions gateway, so we use
// the browser recognizer for transcription and the gateway (text)
// for the probes — the fast, robust combination.
// ============================================================

export function isVoiceSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Create a continuous listening session.
// callbacks: { onInterim(text), onFinal(text), onStateChange(running), onError(code) }
export function createVoiceSession({ lang = 'en-IN', onInterim, onFinal, onStateChange, onError } = {}) {
  const SR = (typeof window !== 'undefined') && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SR) return null;

  let rec = null;
  let running = false;   // user wants it on
  let stopping = false;  // user asked to stop (don't auto-restart)

  function build() {
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const txt = (res[0] && res[0].transcript) || '';
        if (res.isFinal) {
          const t = txt.trim();
          if (t) onFinal && onFinal(t);
        } else {
          interim += txt;
        }
      }
      if (interim.trim()) onInterim && onInterim(interim.trim());
    };

    r.onerror = (e) => {
      const code = (e && e.error) || 'error';
      onError && onError(code);
      // permission / hardware failures are terminal — don't fight them
      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
        running = false; stopping = true;
        onStateChange && onStateChange(false);
      }
    };

    r.onend = () => {
      // Chrome ends recognition after a pause; restart to stay continuous.
      if (running && !stopping) {
        try { r.start(); } catch (_) { /* start-race after a quick stop/start */ }
      } else {
        onStateChange && onStateChange(false);
      }
    };
    return r;
  }

  return {
    get running() { return running; },
    supported: true,

    async start() {
      if (running) return true;
      // Ask for the mic explicitly first — clearer permission prompt, and
      // it surfaces a denial before we spin up the recognizer.
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          // We only needed permission; the recognizer opens its own capture.
          stream.getTracks().forEach(t => t.stop());
        }
      } catch (_) {
        onError && onError('not-allowed');
        return false;
      }
      stopping = false;
      running = true;
      rec = build();
      try { rec.start(); } catch (_) { /* already starting */ }
      onStateChange && onStateChange(true);
      return true;
    },

    stop() {
      stopping = true;
      running = false;
      try { rec && rec.stop(); } catch (_) { /* noop */ }
      onStateChange && onStateChange(false);
    },
  };
}
