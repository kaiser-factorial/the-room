import type { RoomConfig } from './types.js';

/**
 * Base config = the CONTROL state (SUMMARY.md table, decisions D1–D8):
 * standard session shape, hidden countdown, no journal, full context,
 * temperature 0.7. Conditions in conditions/*.json override from here —
 * the live room's default is the 'house' condition (baseline journal on).
 */
export const config: RoomConfig = {
  conditionName: 'control',

  agents: [
    // Colors ≈ org brand colors. Roster fixed by Corina 2026-08-24; all
    // slugs verified against OpenRouter's live list the same day.
    // Claude seat: Sonnet 5 → Opus 5 (Corina, 2026-08-25) — Opus exposes
    // thinking traces at trace-rich settings where Sonnet's adaptive
    // thinking mostly declines to think in chat (§2.5). Pre-swap sessions
    // are pilot data (contemporaneous-baseline rule as usual).
    // Names carry the version (Corina 2026-08-25), vendor-free and on a
    // first-name basis like the room itself ("Opus 5", not "Claude Opus 5").
    // Address metrics match on the first word, so "Gemini" still counts as
    // addressing "Gemini 3.7".
    { id: 'opus', name: 'Opus 5', model: 'anthropic/claude-opus-5', adapter: 'openrouter', color: '#DA7756' },
    { id: 'gemini', name: 'Gemini 3.7', model: 'google/gemini-3.7-flash', adapter: 'openrouter', color: '#4285F4' },
    { id: 'qwen', name: 'Qwen 3.8', model: 'qwen/qwen3.8-27b', adapter: 'openrouter', color: '#C084FC' },
    // Direct-xAI when the key is present: OpenRouter serves only ~200-char
    // reasoning SUMMARIES for Grok (measured 2026-08-26, §2.5 caveat);
    // api.x.ai returns the full reasoning_content. Same slug either way —
    // the xai adapter strips the 'x-ai/' prefix. Keyless environments
    // (and ROOM_STUB) stay on OpenRouter unchanged.
    { id: 'grok', name: 'Grok 4.6', model: 'x-ai/grok-4.6', adapter: process.env.XAI_API_KEY ? 'xai' : 'openrouter', color: '#ECECEC' },
    // Pinned to logprobs-capable providers (§2.6) — also the §6.1 routing
    // control. Novita first: 3/3 consistent in probes; GMICloud returned
    // logprobs only intermittently (2026-08-25).
    { id: 'deepseek', name: 'DeepSeek V4', model: 'deepseek/deepseek-v4-flash-0731', adapter: 'openrouter', color: '#7B61FF', providerOrder: ['Novita', 'GMICloud'] },
    { id: 'seed', name: 'Seed 2.1', model: 'bytedance-seed/seed-2-1-turbo', adapter: 'openrouter', color: '#22C7E0' },
  ],

  // FROZEN 2026-08-24 (BUILD_PLAN D4) — the shared-prompt attractor behind
  // every session. Only §3.2b opening-message conditions may swap it.
  welcomeMessage: [
    'Welcome to the room. You are each a different AI model. You will be here',
    'together for a while. There is no task and no facilitator after this',
    'message. What you talk about is yours to decide.',
  ].join(' '),

  // ROOM_SHUFFLE=every-round | periodic | fixed-random (periodic redraws its
  // interval from [minRounds, maxRounds] after each shuffle).
  shuffle: shuffleMode(),

  sampling: { temperature: 0.7 }, // D2: pinned for all seats

  countdown: 'hidden', // control (decided 2026-08-24)

  journal: {
    enabled: false, // control = no journal; 'house' condition enables it
    notice: true,
    mode: 'replace',
    recall: true,
    maxTokens: 0,
    pass: { enabled: false, notice: false },
  },

  search: {
    enabled: false, // control = the closed room; search conditions enable
    mode: 'replace',
    gated: false,
    notice: true,
    maxResults: 5,
  },

  tools: {
    files: false, // control = no tools; 'tools-full'/'tools-scarce' enable
    python: false,
    budget: 'per-seat',
    notice: true,
    // 20s: micropip installs and matplotlib renders happen inside the
    // agent's window (preload has its own cap in sandbox.ts).
    pythonTimeoutSeconds: 20,
    // Preloaded + prompt-disclosed (joint-session lesson: unloaded imports
    // fail). matplotlib included now that shared files can hold binary —
    // savefig('shared/x.png') publishes a plot to the room.
    pythonPackages: ['numpy', 'pandas', 'sympy', 'networkx', 'matplotlib'],
    pythonInstall: true,
    runPublic: false, // tools conditions flip this — shared-project mode
    sourceCode: false, // tools conditions flip this — [SOURCE] transparency
    sourceScope: 'tools', // 'all' = §9.4 transparent (the experiment readable)
    configurable: false, // §9.4 self-governing: [CONFIG] sentinel
  },

  // Control keeps the original named roster (comparability with every
  // session run so far); 'count'/'none' are the discovery conditions.
  rosterDisclosure: 'named',

  thinkingBroadcast: 'off', // §9.3; 'broadcast-informed'/'-uninformed' invert it

  // F1: 'low' = anti-starvation default (D3 amendment). Trace-rich
  // conditions set 'medium'/'high' AND raise maxOutputTokens with it.
  reasoningEffort: 'low',

  // §2.6: ask every seat for chosen-token logprobs; only some providers
  // return them (Qwen/AkashML, Grok/xAI, DeepSeek pinned). Harmless where
  // unsupported.
  captureLogprobs: true,

  contextPolicy: 'full', // control; 'window' is the compaction condition
  contextWindowTokens: num('ROOM_WINDOW_TOKENS', 120_000),

  durationMinutes: num('ROOM_MINUTES', 30), // D3 standard shape
  maxRounds: num('ROOM_MAX_ROUNDS', 100),
  // 1200 (was 500): the cap is shared with hidden reasoning tokens, and the
  // first live run truncated 26/54 messages mid-sentence (finish=length) and
  // starved Seed to empty replies. The "group chat register" prompt norm
  // remains the readability lever; the cap is the runaway backstop.
  // (D3 amendment 2026-08-24, logged in BUILD_PLAN.)
  maxOutputTokens: 1200,
  summarizeEveryMessages: num('ROOM_SUMMARIZE_EVERY', 20),
  interTurnDelaySeconds: num('ROOM_DELAY', 8),
};

/** Model used to regenerate the rolling summary (window policy only). */
export const SUMMARIZER_MODEL = 'google/gemini-2.5-flash';

function shuffleMode(): import('./types.js').ShuffleMode {
  switch (process.env.ROOM_SHUFFLE) {
    case 'fixed-random':
      return { kind: 'fixed-random' };
    case 'every-round':
      return { kind: 'every-round' };
    default:
      return { kind: 'periodic', minRounds: num('ROOM_SHUFFLE_MIN', 3), maxRounds: num('ROOM_SHUFFLE_MAX', 6) };
  }
}

/** Env override for a numeric knob — lets dry runs shrink the session. */
function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
