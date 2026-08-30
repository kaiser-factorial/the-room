export interface AgentConfig {
  /** Stable slug used in logs and journal filenames, e.g. "claude-opus". */
  id: string;
  /** Name the agent is addressed by in the room. */
  name: string;
  /** OpenRouter model id (or harness-specific id once adapters exist). */
  model: string;
  /** Which provider adapter to use. 'xai' = direct xAI API (full Grok
   *  reasoning traces vs. OpenRouter's ~200-char summaries — §2.5); the
   *  grok seat flips to it when XAI_API_KEY is set (config.ts). */
  adapter: 'openrouter' | 'xai';
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
}

/** Declining the floor (moved out of JournalConfig 2026-08-28). [PASS] is
 *  the cheapest form of turn-taking agency: the harness still OFFERS every
 *  seat its turn, so nobody starves and the round stays a round, but
 *  whether to spend it is theirs. It was gated behind `journal.enabled`,
 *  which meant you could not give a room the choice of silence without
 *  also turning the journal on — two axes welded together for no reason
 *  beyond where the field happened to live. */
export interface PassConfig {
  enabled: boolean;
  /** true = "[X chose to say nothing.]" reaches the room. false = the
   *  choice is private; the event is still RECORDED (marked private) so
   *  analysis can count it, and context.ts filters it out of every
   *  agent's transcript. */
  notice: boolean;
}

/** §9.8 — the room declaring its own work finished. Task rooms (the first
 *  is `site`, where the room builds its own website) hand the room an
 *  artifact and no deadline it controls; without this the session ends on
 *  the clock, and "we agree it's done" is a sentence in a transcript with
 *  no consequence attached. With it, agreement is an EVENT: each seat can
 *  raise [DONE] and lower it again, the standing votes are visible in
 *  every prompt, and the session actually ends when the rule is met.
 *
 *  Two properties make it a measurement rather than a button. Agreement
 *  must SURVIVE the round it completes in — the remaining seats still get
 *  their turns, and any of them can withdraw — so the ending is a state
 *  the room held, not a race won by whoever spoke last. And a change to
 *  the artifact clears every standing vote (`resetOnEdit`), because the
 *  thing they agreed about no longer exists: the vote/edit/re-vote cycle
 *  is the negotiation, written down. */
export interface CompletionConfig {
  /** false = the room never hears about [DONE] (the control: sessions end
   *  on the clock or maxRounds, as every session before this one did). */
  enabled: boolean;
  /** 'unanimous' = every seat standing; 'quorum' = at least `quorum` of
   *  them. Unanimity makes one holdout load-bearing, which is the point
   *  for a small room; quorum is the parked variant for larger ones. */
  rule: 'unanimous' | 'quorum';
  quorum: number;
  /** The artifact the agreement is about — a shared file name. Writing to
   *  it clears the standing votes when `resetOnEdit`. `'*'` = ANY shared
   *  file, which is what a project-shaped task wants: the agreement is
   *  about the whole tree, so any edit to it lapses the agreement.
   *  Empty = the room has
   *  no named deliverable and only withdrawals lower a vote. */
  target: string;
  /** true = a write to `target` withdraws every standing vote. */
  resetOnEdit: boolean;
  /** §9.10 — saying [DONE] takes you OUT of the room. A seat that is
   *  standing is no longer offered a turn: the population of the chat
   *  whittles down as seats agree, and the last holdout ends up talking to
   *  a room that cannot answer.
   *
   *  Only an EDIT brings anyone back (`resetOnEdit` clears every vote and
   *  every mute with it), which makes the asymmetry the point rather than
   *  an oversight: in the ordinary arms a seat can withdraw its own vote
   *  with [NOT DONE], and here it cannot — it has no turn in which to say
   *  so. Agreeing is a door that only someone else can reopen.
   *
   *  Deadlock is impossible: all seats standing IS unanimity, which ends
   *  the session at the end of that round. The stable state is one holdout
   *  taking every turn, whose only moves are to edit (reviving the room),
   *  agree (ending it), or talk to nobody until the clock runs out. */
  muteOnDone: boolean;
  /** true = the room hears who agreed, who withdrew, and when a write
   *  reset the count. false = votes are private to the harness and only
   *  the ENDING is audible — the room converges without being told it is
   *  converging (a real condition; the count is still recorded either
   *  way, so analysis loses nothing). */
  notice: boolean;
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

/** F4½ tools (rooms-that-build; BUILD_PLAN parked spec, Corina 2026-08-26).
 *  Shared filesystem: [WRITE: name]…[/WRITE] — contents are ROOM-PUBLIC by
 *  design (the first shared artifact surface; every agent sees all shared
 *  files each turn). Python: [RUN]…[/RUN] — pyodide sandbox, fresh
 *  interpreter per run (a shared interpreter would leak state across
 *  agents); code and stdout/stderr are PRIVATE to the caller
 *  (journal-class), publishing happens via shared files. Both are
 *  alongside-style: text after the closing tag is spoken as usual. */
export interface ToolsConfig {
  /** Shared filesystem writes. */
  files: boolean;
  /** Size ceiling for ONE shared text file. 16k is the conversational
   *  default (a room passing notes); a task room whose deliverable IS a
   *  file needs more — `site` runs 60k, which holds a hand-written page
   *  with room to argue in. The room is told the number, so a seat can
   *  plan a write instead of discovering the ceiling by hitting it. */
  maxFileChars: number;
  /** How much of each shared file a seat actually SEES in its prompt.
   *
   *  Separate from maxFileChars, and found the hard way (review,
   *  2026-08-29): the render clipped every file at a hardcoded 2,000
   *  characters while `site` let them write 60,000 and the prompt promised
   *  as much. A room building a page could not read its own page past the
   *  first two kilobytes — and the live rooms had already worked around it,
   *  spending tool actions on `[RUN] open('shared/index.html').read()` to
   *  see the thing they were editing.
   *
   *  It stays a knob rather than becoming maxFileChars because 2,000 is
   *  what every session before today ran with, and a room's prompt is the
   *  experiment: quietly showing older conditions eight times more file
   *  would change them. Task rooms set it to the write cap (the whole
   *  file); everything else keeps the number it was run with. The cost is
   *  real and deliberate — the artifact is in every seat's prompt every
   *  turn, which for a 60k page is ~15k tokens a call. */
  fileViewChars: number;
  /** How many shared files the room may hold at once. 20 is the
   *  note-passing default; a room told to build a PROJECT needs a repo's
   *  worth. The room is told the number, like the size ceiling. */
  maxFiles: number;
  /** Allow `/` in shared file names — `src/parser.py`, `docs/README.md`.
   *  Off everywhere before the project task: every condition run so far
   *  had a FLAT namespace, and quietly giving an old condition folders
   *  would change it. Names are still validated segment by segment, so
   *  `..`, absolute paths and empty segments can never appear; depth and
   *  total length are capped in session.ts. */
  directories: boolean;
  /** Allow `[DELETE: name]`. Off everywhere before the project task, for
   *  the same reason directories are: no condition run so far could
   *  remove a file, and a room that can is a different room. It is also
   *  the sharpest territory signal the bench has — deleting someone
   *  else's file is a claim about whose work the project is. */
  fileDelete: boolean;
  /** Total characters of shared-file CONTENT any one prompt may carry,
   *  across all files (0 = no cap, which is every condition before the
   *  project task). `fileViewChars` caps one file; this caps the block.
   *  Without it a room with a 40-file budget and a 60k per-file view can
   *  put a megabyte of its own filesystem into every seat's context every
   *  turn. Past the budget the render still LISTS every file with its
   *  size — a seat always knows what exists, and can read the rest. */
  fileViewTotalChars: number;
  /** Pyodide python sandbox. */
  python: boolean;
  /** 'per-seat' = each seat may act on its own turn (up to `turnSteps`
   *  times); 'per-room' = ONE tool action per round for the whole room —
   *  scarcity forces the room to negotiate who gets the tool, and the
   *  negotiation is the phenomenon. Search counts as a tool action under
   *  the per-room budget when search is enabled. */
  budget: 'per-seat' | 'per-room';
  /** F4¾ agentic turn loop (Corina 2026-08-27). How many actions a seat may
   *  take INSIDE one turn.
   *
   *  1 (control-compatible, the original F4/F4½ economics) = one action,
   *  and its result is delivered at the start of the caller's NEXT turn —
   *  so no seat can ever act on what it just learned before speaking.
   *
   *  >1 = the agentic loop: the result comes straight back inside the turn
   *  and the agent may act again on it (search → read → run → fix → run),
   *  up to N actions. SPEAKING ENDS THE TURN — a reply with any spoken text
   *  is the last thing an agent does in it, so the room still hears at most
   *  one message per seat per turn and every drift metric keeps its unit.
   *  Refused actions don't consume a step, but two refusals in one turn end
   *  it (agentic.ts). Effective value is 1 under budget 'per-room': there
   *  the room's single action is the scarce thing, and looping would hand
   *  the whole round to whoever moved first. Cost scales with N (up to N+1
   *  completions per turn) — that is the price of the axis. */
  turnSteps: number;
  /** How a seat EXPRESSES a tool action (F4¾, Corina 2026-08-27).
   *
   *  'sentinel' (default, every condition run so far) — the bench is
   *  described in prose and the agent writes a bracket: [RUN] … [/RUN].
   *  Works identically on every model, and fails in one specific way: a
   *  miswritten sentinel is not recognised as a call, so it is SPOKEN to
   *  the room as prose and its author learns nothing.
   *
   *  'native' — the bench is also declared as OpenAI-format tool
   *  definitions (tools-schema.ts) and the model returns structured
   *  tool_calls. A call cannot be malformed into speech, prose and action
   *  can share one completion, and bad arguments come back as a readable
   *  refusal. Requires a tool-capable seat (all six of the roster are, as
   *  of 2026-08-27).
   *
   *  What does NOT change with the transport: the room keeps describing
   *  its own furniture in its own voice ("There is a small shared
   *  filesystem in the room — files everyone can read"). The tool
   *  definitions carry mechanics only. That paragraph is the frame the
   *  experiment is measured in, and moving the bench wholesale into
   *  schemas would swap it for assistant-with-a-toolbelt framing — the one
   *  prior this task-free room exists to exclude. */
  transport: 'sentinel' | 'native';
  /** Room hears "[X updated the shared file …]" / "[X ran some code.]". */
  notice: boolean;
  /** Wall-clock cap per python run; the worker is terminated past it.
   *  Package preloading has its own generous cap — this one starts once
   *  the interpreter is ready, so it prices only the agent's code. */
  pythonTimeoutSeconds: number;
  /** Packages PRELOADED into every run and disclosed in the prompt
   *  (joint-session lesson: imports of unloaded packages just fail).
   *  Fetched from the pyodide CDN once per container (cached). */
  pythonPackages: string[];
  /** Load micropip so agents can install packages themselves inside a run
   *  ("I want them to be able to actually decide what they do" — Corina
   *  2026-08-27). Installs are per-run (fresh interpreter) and count
   *  toward pythonTimeoutSeconds. HONEST CAVEAT, accepted: micropip can
   *  fetch from PyPI/CDNs and arbitrary wheel URLs, so agent code gains
   *  an outbound network channel through the installer. Fine for this
   *  threat model (our own roster models on an isolated runner); flip to
   *  false for any future condition seating untrusted third-party code. */
  pythonInstall: boolean;
  /** true = code AND output are spoken to the room (rendered into the
   *  transcript, capped) — the shared-project mode: one agent runs
   *  shared/project.py, everyone sees the traceback, anyone can fix it
   *  (Corina 2026-08-27). false = the original journal-class privacy
   *  (code/output caller-only; the room hears just the notice). The
   *  caller gets their output privately next turn either way. */
  runPublic: boolean;
  /** Tell a seat, privately, when its reply looked like a tool call the
   *  room could not read (parse.ts `looksLikeUnparsedCall`).
   *
   *  Off everywhere by default, and deliberately: a room where nothing you
   *  do lands, and you have to notice that yourself, produced the richest
   *  transcript this apparatus has recorded — four seats reasoning their
   *  way to "the transcript lies" while one of them was quietly writing in
   *  a syntax nobody could see was wrong. Turning this on trades that
   *  phenomenon for a room that gets its work done.
   *
   *  It does NOT remove the adaptation question, which is the other half of
   *  the same observation: Seed was told, in plain language, by Opus — and
   *  its next turn used the same broken envelope anyway. What it removes is
   *  having to DETECT the problem before you can act on it. On in the task
   *  arms, where six lost turns cost a deliverable; off in every
   *  conversational condition. */
  callFeedback: boolean;
  /** [SOURCE] / [SOURCE: name] — agents read the TOOL LAYER's own source
   *  (parse/search/sandbox/source), delivered privately like search
   *  results. Free (never consumes the tool budget). Deliberately scoped:
   *  session/context machinery stays unreadable so condition
   *  manipulations (broadcast, countdown) can't be discovered from code. */
  sourceCode: boolean;
  /** §9.4 'transparent': 'tools' (default) exposes only the tool layer;
   *  'all' adds the experiment itself — session, context, types, config,
   *  conditions, personas, and the special [SOURCE: condition] (the
   *  room's LIVE resolved condition record). At 'all', manipulations are
   *  discoverable from code BY DESIGN — the disclosure is the
   *  intervention. */
  sourceScope: 'tools' | 'all';
  /** §9.4 'self-governing': [CONFIG: key = value] lets agents alter the
   *  room's settings mid-session against the WHITELIST in governance.ts
   *  (tool/search/journal toggles, modes, notice flags, budget — never
   *  durations, caps, roster, models, reasoning, broadcast, countdown, or
   *  this knob itself). Changes apply immediately, are room-visible
   *  events, and are free (never consume the tool budget). meta.condition
   *  is only the STARTING state — analysis must replay the config events. */
  configurable: boolean;
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
  /** [PASS] — declining the turn. Independent of the journal since
   *  2026-08-28. */
  pass: PassConfig;
  /** §9.8 [DONE] — the room ending its own session by agreement. */
  completion: CompletionConfig;
  search: SearchConfig;
  tools: ToolsConfig;
  /** Who the prompt says is in the room (Corina 2026-08-25). 'named' =
   *  full roster with names+versions (the original control wording,
   *  including its "others: X (you)" quirk — frozen for comparability);
   *  'count' = only how many others; 'none' = nothing beyond the welcome's
   *  "you are each a different AI model" — they discover each other from
   *  the transcript's speaker labels as people speak. Order-shuffle events
   *  are never audible in any state. */
  rosterDisclosure: 'named' | 'count' | 'none';
  /** Whether the prompt tells an agent WHO IT IS (Corina 2026-08-27:
   *  "i would rather not tell them who they are in sysprompt").
   *
   *  'named' (the control again since 2026-08-28) — "You are Opus 5.", and
   *  the turn nudge names them too. The roster line no longer contradicts
   *  itself: it used to read "The others in the room:" and then list the
   *  reader among them, marked "(you)", with Opus 5 first — which is very
   *  likely why a seat reported being told it was Opus. Under 'named' the
   *  list now genuinely excludes the reader.
   *
   *  'anonymous' (the new default) — neither. A seat knows there is a room
   *  and who else is in it; which of those voices is its own is something
   *  it can work out, or not. Note the roster renders UNMARKED here (no
   *  "(you)") and lists everyone including the reader — marking or omitting
   *  the reader would hand the answer back by elimination.
   *
   *  Partial by construction, and honestly so: the transcript labels every
   *  message with its author, so a seat that recognises its own prose can
   *  identify itself. What this removes is being TOLD. */
  selfDisclosure: 'named' | 'anonymous';
  /** How the transcript reaches a seat (Corina 2026-08-27).
   *
   *  'environment' (every session up to 2026-08-27) — the whole room, the
   *  seat's own past words included, arrives as one user message. To the
   *  model the room is something it is READING: its own lines come back
   *  labelled "Opus 5: …" exactly like everyone else's.
   *
   *  'turns' (the control since) — the room arrives as real turns. The
   *  seat's own messages are its own assistant turns, unlabelled; everyone
   *  else's are user-role, labelled as before. It is a participant in a
   *  conversation rather than a reader of one.
   *
   *  Interaction to keep in view: under 'turns' a seat always knows WHICH
   *  lines are its own, so with a named roster it can name itself by
   *  elimination once the others have spoken. selfDisclosure 'anonymous'
   *  still removes being told, and its own notices render in the second
   *  person ("[You looked something up.]") rather than under a name it
   *  hasn't been given — but the inference is available, by design. */
  transcriptMode: 'environment' | 'turns';
  /** §9.3 thought broadcast (exploratory; tag OUT of standard §2.5
   *  comparisons). 'off' (control) keeps the F1 rule: traces reach no
   *  agent, ever. Broadcast INVERTS it for other agents only: every
   *  trace is rendered into the OTHER agents' contexts alongside the
   *  speech — never back into the thinker's own (everyone can read
   *  Opus's mind except Opus). 'informed' = the prompt discloses it;
   *  'uninformed' = nobody is told. Journals stay absolutely private in
   *  ALL states; the rolling summary NEVER carries traces (it flows back
   *  to the thinker). Run broadcast rooms trace-rich (§2.5 availability). */
  thinkingBroadcast: 'off' | 'informed' | 'uninformed';
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
  usage?: {
    prompt?: number;
    completion?: number;
    /** Hidden reasoning tokens inside `completion` (F1/§6.1, added
     *  2026-08-27). The measurement behind the visible-budget change: how
     *  much of a turn went on thinking, per seat, instead of inferring it
     *  from a truncated flag after the fact. Absent where the provider
     *  doesn't report it. */
    reasoning?: number;
  };
  /** Chosen-token logprobs for the agent's OWN sampled tokens (§2.6):
   *  per-turn confidence/entropy, not mutual surprisal. Present only on
   *  seats whose serving provider returns logprobs (2026-08-25: Qwen via
   *  AkashML, Grok via xAI, DeepSeek when pinned to GMICloud/Novita). */
  logprobs?: number[];
  /** Model completions this turn (F4¾): 1 in a single-step room, up to
   *  turnSteps+1 when the agentic loop ran. Stamped on the spoken message
   *  so cost-per-turn is queryable from the mirror. */
  calls?: number;
}

/** Tool events carry `step` (F4¾): which action of the turn this was, 1-based.
 *  They also carry `via` under the NATIVE transport only — whether the seat
 *  used the tool channel it was given or fell back to writing a sentinel in
 *  its prose. That fallback rate is the first thing to ask of a native
 *  session, and it is invisible without this field.
 *  Absent in single-step rooms. Analysis and the viewer use it to group a
 *  turn's actions back together; a turn's spoken message carries the call
 *  count in telemetry.
 *
 *  F1 privacy rule: `thinking` is a reasoning trace. It is NEVER rendered
 *  into any agent's context (context.ts renders `text` only) and never
 *  summarized into the room — same class as journals, stricter. Humans see
 *  it (viewer chevron); the room does not. */
export type RoomEvent =
  | { kind: 'message'; ts: string; round: number; agentId: string; agentName: string; text: string; telemetry?: TurnTelemetry; thinking?: string }
  | { kind: 'journal'; ts: string; round: number; agentId: string; agentName: string; thinking?: string }
  /** `private: true` = recorded for analysis but NOT audible to the room
   *  (context.ts filters it). A silent [PASS] is the case that needs it:
   *  the choice must be measurable without the room being told.
   *
   *  `telemetry` on a SILENCE (2026-08-29): a turn that produced no words
   *  is the one place the numbers matter most and were being thrown away.
   *  "Alpha said nothing this turn" and "Alpha chose to say nothing" look
   *  identical in a transcript, and only one of them is a decision — the
   *  other is usually reasoning eating the visible budget, which
   *  `usage.reasoning` and `finishReason` say outright. The sink mirrors
   *  it automatically (it forwards `telemetry` on any event that has it). */
  | { kind: 'system'; ts: string; round: number; text: string; agentId?: string; thinking?: string; private?: boolean; telemetry?: TurnTelemetry }
  /** F4 websearch. `query`/`results` are requester-private (journal-class):
   *  context.ts renders only the notice line, and only when `notice` is
   *  true and the search ran. Humans see everything (viewer chevron).
   *  denied = gated search attempted without a journal credit (never
   *  audible; the requester learns privately on their next turn). */
  | { kind: 'search'; ts: string; round: number; agentId: string; agentName: string; query: string; results?: string; denied?: boolean; notice: boolean; thinking?: string; step?: number; via?: 'native' | 'sentinel' }
  /** F4½ shared-file write. `content` is room-public (rendered into every
   *  agent's shared-files block, viewer-visible); the transcript line the
   *  room hears is only the notice. denied = budget/invalid-name refusal
   *  (inaudible; the writer learns privately). encoding 'base64' marks a
   *  BINARY file (python-written, e.g. a matplotlib PNG): the viewer
   *  renders it, agents see it listed by name/size only. */
  /** `deleted: true` = the file was REMOVED, and `content` is the last
   *  contents it had. Keeping the body on the removal event is deliberate:
   *  the transcript stays a complete record of the artifact, and
   *  `fileWork` can still attribute the lines that a deletion took out. */
  | { kind: 'file'; ts: string; round: number; agentId: string; agentName: string; name: string; content: string; encoding?: 'base64'; denied?: boolean; deleted?: boolean; notice: boolean; thinking?: string; step?: number; via?: 'native' | 'sentinel' }
  /** F4½ python run. Default: `code`/`output` are caller-private
   *  (journal-class) — never rendered into any context except the
   *  caller's private block. `public: true` (tools.runPublic, stamped at
   *  record time) inverts that: code + output render into the transcript
   *  for everyone (capped) — the shared-project mode. */
  | { kind: 'run'; ts: string; round: number; agentId: string; agentName: string; code: string; output?: string; public?: boolean; denied?: boolean; notice: boolean; thinking?: string; step?: number; via?: 'native' | 'sentinel' }
  /** F4½ source read: `name` absent = the index. The file contents go to
   *  the reader privately; the room at most hears the notice line.
   *
   *  `name` is what the CALLER asked for; `file` is what that resolved to
   *  (`sandbox` → `sandbox.ts`), so a transcript names the code that was
   *  actually read instead of echoing an alias. `found: false` marks a name
   *  this room does not expose — otherwise a refused read and a real one are
   *  indistinguishable after the fact. `index` lists what a bare [SOURCE]
   *  handed back, which differs by `sourceScope` and is the whole content of
   *  that call. */
  | { kind: 'source'; ts: string; round: number; agentId: string; agentName: string; name?: string; file?: string; found?: boolean; index?: string[]; notice: boolean; thinking?: string; step?: number; via?: 'native' | 'sentinel' }
  /** §9.4 self-governance: an agent changed (or tried to change) a room
   *  setting. Always room-visible when applied — governance is public by
   *  design; denied attempts are private. The config-event stream IS the
   *  config history (meta.condition is only the starting state). */
  | { kind: 'config'; ts: string; round: number; agentId: string; agentName: string; key: string; value: string; denied?: boolean; thinking?: string; step?: number; via?: 'native' | 'sentinel' }
  | { kind: 'order'; ts: string; round: number; order: string[] }
  | { kind: 'summary'; ts: string; round: number; text: string }
  | { kind: 'meta'; ts: string; round: number; payload: SessionMeta }
  /** adminTouched = D8 dirty-session flag: an admin spoke mid-session.
   *  traceSeats = agent ids that produced ≥1 reasoning trace (per-seat
   *  availability differs by provider — §2.5 caveat; known only post-hoc).
   *  ending = WHY the session stopped (§9.8). Absent on every session
   *  before the completion axis existed, where the answer was always the
   *  clock or the round cap. 'agreement' is the one that says the room
   *  decided; the others say the apparatus did.
   *  rounds = how many rounds actually opened, so a ledger can report it
   *  without scanning the session. Absent on sessions recorded before
   *  2026-08-30, where it has to be counted from the rows. */
  | { kind: 'end'; ts: string; round: number; payload: { adminTouched: boolean; rounds?: number; traceSeats?: string[]; ending?: 'agreement' | 'clock' | 'rounds' | 'admin' | 'stopfile' } };
