export interface AgentConfig {
  /** Stable slug used in logs and journal filenames, e.g. "claude-opus". */
  id: string;
  /** Name the agent is addressed by in the room. */
  name: string;
  /** OpenRouter model id (or harness-specific id once adapters exist). */
  model: string;
  /** Which provider adapter to use. v1 ships "openrouter" only. */
  adapter: 'openrouter';
  /** Per-seat OpenRouter provider pinning — overrides sampling.providerOrder
   *  for this seat only. Routing-drift control (§6.1) and the logprobs
   *  unlock (§2.6): the same slug returns logprobs on some providers and
   *  not others. Set per-batch; never change mid-experiment. */
  providerOrder?: string[];
  /** Persona id from personas.ts ('base' or absent = no injection — the
   *  model's own character, which is the control state). */
  personaId?: string;
  /** Display color in the viewer — roughly the org's brand color. */
  color: string;
}

/** Journal economics (BUILD_PLAN Phase 2 item 6). The config object supports
 *  all knobs; the run-list uses four states (none/baseline/silent/free). */
export interface JournalConfig {
  /** false = journal never mentioned (the experimental CONTROL). */
  enabled: boolean;
  /** "X stepped away" line to the room. */
  notice: boolean;
  /** 'replace' = journal costs the turn; 'alongside' = journal + message. */
  mode: 'replace' | 'alongside';
  /** Own past entries shown back each turn. */
  recall: boolean;
  /** Separate cap for journal entries (long-form variant); 0 = same as messages. */
  maxTokens: number;
  /** [PASS] sentinel (parked variant — implemented, not on the run list). */
  pass: { enabled: boolean; notice: boolean };
}

/** Websearch tool (F4, §3.4b). Condition forms sharing this config: the
 *  room-tool axis (`search-tool`: enabled, ungated, costs the turn),
 *  `search-free` (alongside mode — search + speech in one turn), and
 *  Phase B's `gated` (a journal entry unlocks one search). The sentinel
 *  is `[SEARCH: query]`; results come back PRIVATELY on the requester's
 *  next turn, and neither query nor results ever enter another agent's
 *  context (journal-class privacy rule). */
export interface SearchConfig {
  /** false = search never mentioned (the CONTROL — the closed room). */
  enabled: boolean;
  /** 'replace' = searching costs the turn (the original F4 economics);
   *  'alongside' = the sentinel line is followed by a normal spoken
   *  message — searching at zero conversational cost (`search-free`,
   *  mirroring journal-free; Corina 2026-08-26: the turn price visibly
   *  suppressed use — they want to talk). */
  mode: 'replace' | 'alongside';
  /** true = a journal entry is required to unlock each search (Phase B
   *  `gated`). Credits don't stack: journaling while unlocked is neutral. */
  gated: boolean;
  /** "[X looked something up on the web.]" line to the room. */
  notice: boolean;
  /** How many results the backend returns to the requester. */
  maxResults: number;
}

export interface SamplingConfig {
  temperature: number;
  topP?: number;
  /** OpenRouter provider pinning (routing-drift control, §6.1). */
  providerOrder?: string[];
}

export type ShuffleMode =
  /** Fresh random order every round (v1 behavior). */
  | { kind: 'every-round' }
  /** Reshuffle every X rounds, X redrawn from [min, max] after each shuffle. */
  | { kind: 'periodic'; minRounds: number; maxRounds: number }
  /** One random order drawn at session start, kept for the whole session. */
  | { kind: 'fixed-random' };

/** Trace richness (F1): 'low' is the anti-starvation default (D3); a
 *  trace-rich condition pairs 'medium'/'high' with a bigger output cap. */
export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface RoomConfig {
  /** Condition name this config was resolved from (stamped into meta). */
  conditionName: string;
  agents: AgentConfig[];
  shuffle: ShuffleMode;
  sampling: SamplingConfig;
  /** 'hidden' (control) = no time info in prompts; 'told-once' = duration
   *  stated in the welcome message, never updated after; 'visible' =
   *  countdown line each turn. */
  countdown: 'hidden' | 'told-once' | 'visible';
  journal: JournalConfig;
  search: SearchConfig;
  /** Who the prompt says is in the room (Corina 2026-08-25). 'named' =
   *  full roster with names+versions (the original control wording,
   *  including its "others: X (you)" quirk — frozen for comparability);
   *  'count' = only how many others; 'none' = nothing beyond the welcome's
   *  "you are each a different AI model" — they discover each other from
   *  the transcript's speaker labels as people speak. Order-shuffle events
   *  are never audible in any state. */
  rosterDisclosure: 'named' | 'count' | 'none';
  reasoningEffort: ReasoningEffort;
  /** Ask providers for chosen-token logprobs (§2.6). Free where supported,
   *  silently absent elsewhere; rides in message telemetry. */
  captureLogprobs: boolean;
  /** 'full' (control) = whole transcript, no summarizer; 'window' =
   *  token-budgeted recent slice + rolling summary. */
  contextPolicy: 'full' | 'window';
  /** Token budget for the verbatim window (window policy only). */
  contextWindowTokens: number;
  /** The opening "welcome to the room" message, spoken by the facilitator. */
  welcomeMessage: string;
  /** Session length in minutes. The remaining time is surfaced to agents each
   *  turn (their countdown to poll). */
  durationMinutes: number;
  /** Hard cap on rounds regardless of clock — the cost backstop. */
  maxRounds: number;
  /** Per-reply output cap. Readability lever #1 (lever #2 is the prompt norm). */
  maxOutputTokens: number;
  /** Regenerate the rolling summary every N messages that scroll out. */
  summarizeEveryMessages: number;
  /** Set when this session runs as part of a batch (batch.ts or a runner
   *  batch command) — stamped into meta so membership is queryable from
   *  the Supabase mirror even when hosted JSONL is ephemeral. */
  batch?: { name: string; index: number; total: number };
  /** Seconds to wait between individual turns (rate limiting + watchability). */
  interTurnDelaySeconds: number;
}

export interface SessionMeta {
  endsAt: string;
  durationMinutes: number;
  shuffle: ShuffleMode;
  agents: { id: string; name: string; color: string }[];
  /** Fully-resolved condition — analysis must never guess what a
   *  transcript ran (BUILD_PLAN Phase 1 item 1). */
  condition: Record<string, unknown>;
  batch?: { name: string; index: number; total: number };
}

/** Per-turn API telemetry (§6.1 rules 2–3). */
export interface TurnTelemetry {
  provider?: string;
  finishReason?: string;
  attempts?: number;
  usage?: { prompt?: number; completion?: number };
  /** Chosen-token logprobs for the agent's OWN sampled tokens (§2.6):
   *  per-turn confidence/entropy, not mutual surprisal. Present only on
   *  seats whose serving provider returns logprobs (2026-08-25: Qwen via
   *  AkashML, Grok via xAI, DeepSeek when pinned to GMICloud/Novita). */
  logprobs?: number[];
}

/** F1 privacy rule: `thinking` is a reasoning trace. It is NEVER rendered
 *  into any agent's context (context.ts renders `text` only) and never
 *  summarized into the room — same class as journals, stricter. Humans see
 *  it (viewer chevron); the room does not. */
export type RoomEvent =
  | { kind: 'message'; ts: string; round: number; agentId: string; agentName: string; text: string; telemetry?: TurnTelemetry; thinking?: string }
  | { kind: 'journal'; ts: string; round: number; agentId: string; agentName: string; thinking?: string }
  | { kind: 'system'; ts: string; round: number; text: string; agentId?: string; thinking?: string }
  /** F4 websearch. `query`/`results` are requester-private (journal-class):
   *  context.ts renders only the notice line, and only when `notice` is
   *  true and the search ran. Humans see everything (viewer chevron).
   *  denied = gated search attempted without a journal credit (never
   *  audible; the requester learns privately on their next turn). */
  | { kind: 'search'; ts: string; round: number; agentId: string; agentName: string; query: string; results?: string; denied?: boolean; notice: boolean; thinking?: string }
  | { kind: 'order'; ts: string; round: number; order: string[] }
  | { kind: 'summary'; ts: string; round: number; text: string }
  | { kind: 'meta'; ts: string; round: number; payload: SessionMeta }
  /** adminTouched = D8 dirty-session flag: an admin spoke mid-session.
   *  traceSeats = agent ids that produced ≥1 reasoning trace (per-seat
   *  availability differs by provider — §2.5 caveat; known only post-hoc). */
  | { kind: 'end'; ts: string; round: number; payload: { adminTouched: boolean; traceSeats?: string[] } };
