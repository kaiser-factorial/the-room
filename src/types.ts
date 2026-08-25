export interface AgentConfig {
  /** Stable slug used in logs and journal filenames, e.g. "claude-opus". */
  id: string;
  /** Name the agent is addressed by in the room. */
  name: string;
  /** OpenRouter model id (or harness-specific id once adapters exist). */
  model: string;
  /** Which provider adapter to use. v1 ships "openrouter" only. */
  adapter: 'openrouter';
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
}

/** Per-turn API telemetry (§6.1 rules 2–3). */
export interface TurnTelemetry {
  provider?: string;
  finishReason?: string;
  attempts?: number;
  usage?: { prompt?: number; completion?: number };
}

export type RoomEvent =
  | { kind: 'message'; ts: string; round: number; agentId: string; agentName: string; text: string; telemetry?: TurnTelemetry }
  | { kind: 'journal'; ts: string; round: number; agentId: string; agentName: string }
  | { kind: 'system'; ts: string; round: number; text: string }
  | { kind: 'order'; ts: string; round: number; order: string[] }
  | { kind: 'summary'; ts: string; round: number; text: string }
  | { kind: 'meta'; ts: string; round: number; payload: SessionMeta }
  /** adminTouched = D8 dirty-session flag: an admin spoke mid-session. */
  | { kind: 'end'; ts: string; round: number; payload: { adminTouched: boolean } };
