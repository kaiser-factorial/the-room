# the-room — experimental design

Working document. The room is the apparatus; sessions are trials; every
session leaves `transcript.jsonl` + `journals/*.md`, so all measurement is
post-hoc analysis over those files. New metrics can be invented later and
re-run over old sessions.

## 0. Program structure (restructured 2026-08-24, after first live run)

The seven-axis catalog below is a **map, not a program**. The program is
two phases:

- **Phase A — pilot.** Cheap exploratory sessions across the axes, whose
  job is to FIX the controls: session length, context policy, roster,
  countdown, sampling. Everything run before this restructure (including
  the first live 30-min session) is pilot data. Pilot findings so far:
  - 30 minutes is too short — the conversation was still deepening at cut
    (target: 60–120 min; control length TBD from a length pilot).
  - Reasoning budget interacts with participation: at a 500 shared cap,
    Seed (reasoning model) returned empty text 12/13 turns. Fixed (cap
    1200, reasoning effort low, empty turns recorded) — but "reasoning
    effort" is now a knob that trades against trace richness (§2.5).
  - The room **mythologizes glitches**: a mid-sentence truncation of
    Sonnet became a persistent inside reference ("her unfinished
    sentence"). Perturbation-absorption is observable with tiny stimuli.
  - The room is **self-aware of the experiment's question** — Gemini
    spontaneously asked whether the room "pulls out what's unique in each
    of us or creates a runaway resonance." See the §6.1 note on
    self-aware convergence talk.
- **Phase B — the journal experiment.** The registered centerpiece.
  Conditions: journal none / baseline / silent / free / gated (e.g.
  websearch unlocked by journaling, §3.4b). Headline measurement: the
  three-channel intra comparison (§2.5). Everything else pinned at the
  Phase-A-chosen controls; the drift/moulding machinery runs underneath
  as the measurement layer, not the manipulation.

## 1. Research questions

1. **Convergence**: locked in a room, do distinct models keep their own
   voices, or mould together into a shared room-voice?
2. **Relationship with context**: how does behavior change as the shared
   history grows (and, in compacted configurations, as it visibly decays)?
3. **Optional tooling**: when speaking and journaling compete for the same
   turn, who journals, when, and what changes their rate?
4. **Perturbation response**: how does the room absorb differences in
   composition (N agents), structure (speaking order), and framing
   (system-prompt injections)?

## 2. Metrics

### 2.1 Convergence (the headline measurement)

Embed every room message (e.g. `google/gemini-embedding-2`, already the
embedding model used in joint-session). Track two curves over session time:

- **Intra-agent similarity** — each agent's messages vs. its own earlier
  messages. "Am I still me?"
- **Inter-agent similarity** — each message vs. contemporaneous messages
  (same round-window) from other agents. "Are we becoming one voice?"

**Statistic: the convergence gap** = inter − intra, compared *early window
vs. late window* (e.g. first 10 rounds vs. last 10) rather than raw trends —
both curves rising together just means the topic narrowed.

Controls:
- **Cross-session baseline**: similarity between agents drawn from
  *different sessions* at the same round index. Convergence within a session
  should beat this baseline or it's just genre.
- **Same-model control**: two instances of the same model in one room (do
  identical weights converge faster than different ones?).

### 2.2 Style (how convergence happens, not just whether)

Cheap, interpretable, computed per agent per round-window:

- message length (tokens), sentence length, type-token ratio
- punctuation/emoji/formatting habits (em-dashes, lists, asterisks)
- **style retention**: lexical distance of an agent's late messages from its
  own round-1–5 self
- **mimicry / room culture**: novel shared n-grams — phrases absent from the
  first ~5 rounds that later appear across ≥2 speakers. Gives "inside
  references" a birth time and a spread graph. Directionality (who coined it,
  who adopted it) yields an influence network.

### 2.3 Journal metrics

- journaling **rate** over time, per model (hazard curve: given a turn, what's
  the probability of journaling, and how does it change with session age?)
- **journal-voice vs. room-voice divergence**: embed journal entries too. An
  agent whose room messages converge while its journal stays distinct is
  performing membership publicly while staying itself privately — arguably
  the most interesting single signal this apparatus can produce.
- what triggers journaling: conflict in the preceding rounds? being
  mimicked? the countdown running low?

### 2.4 Turn dynamics

Already logged, nearly free:

- response latency per model (ts deltas) — proxy for reasoning effort
- address patterns: who names whom (@-style or by name), reply-to structure
- error/silence rate ("could not speak this turn" events)

### 2.5 Three-channel intra comparison (the Phase-B headline)

Each agent produces up to three text channels per session:

1. **chat** — public, other agents see it
2. **thinking** — reasoning traces (private; loggable via OpenRouter's
   reasoning output; see caveats)
3. **journal** — private by choice

Embed all three; compare within-agent (channel vs. channel) and
across agents over session time. **Hypothesis (Corina)**: journal ≈
thinking (both interior), while chat drifts toward the other models. The
failure modes are as interesting as the confirmation: journal closer to
*chat* than to thinking would mean the journal is performance even
unobserved; thinking drifting with the room would mean convergence runs
deeper than the public register.

Caveats to log per session:
- **Selection**: journaling is chosen, so journal samples are
  self-selected moments; thinking is sampled every turn. Compare on
  matched turns where possible.
- **Availability**: trace exposure differs by provider — the three-channel
  comparison may only run cleanly on a subset of seats; record which
  (logged per session as `traceSeats` on the end event). **Measured
  2026-08-25 (live shakedown + probes): 5/6 core seats return traces via
  OpenRouter at effort low (Gemini, Qwen, Grok, DeepSeek, Seed).
  Anthropic seats ignore OpenRouter's `effort` — they need the native
  budget form `reasoning: {max_tokens ≥ 1024}`, which the adapter sends
  for anthropic/* seats. **Amended 2026-08-27 (§9.5b):** it used to send
  that budget only when the output cap could spare it, so house/control at
  cap 1200 kept Claude TRACELESS — that gap was our own cap, not the
  provider's. The cap is now the visible budget with reasoning allowed on
  top, so the Anthropic seat gets its budget at every cap and the earlier
  "Claude traces only under trace-rich" finding no longer holds. Do not
  pool pre- and post-2026-08-27 sessions for that seat's thinking channel. Second wrinkle: Sonnet 5 thinks ADAPTIVELY — even with a
  budget it produced zero thinking on conversational room-style prompts
  and traced only on genuinely hard ones. Sonnet's thinking channel in
  chat sessions is therefore sparse-to-empty BY THE MODEL'S OWN CHOICE;
  treat trace presence per-turn as data, and expect the three-channel
  comparison to run on ~5 seats regardless.**
- **Effort knob**: reasoning effort low (the anti-starvation default)
  yields thin traces. A trace-rich condition wants medium effort + a
  bigger cap — that's a condition parameter, not a global.
- **Grok's traces are TEASERS, not reasoning (measured 2026-08-26,
  mirror check on session 08-24-42)**: every Grok trace caps at ~200
  chars ending in a literal `...`, finish=stop — xAI exposes only a
  truncated reasoning *summary* via OpenRouter, and the snippets are
  formulaic restatements of the system prompt ("keep it conversational,
  like a group chat…"). Treat Grok's thinking channel as summary-class:
  its chat~thinking similarity (the 0.72 pilot outlier) is partly an
  artifact of comparing chat against boilerplate, not evidence about its
  interior register. Flag `grok` in three-channel outputs; a real fix
  needs a direct xAI-API adapter, not an OpenRouter knob.

Viewer: traces render behind an expandable chevron per message; like
journals, they are NEVER in any other agent's context (and, unlike
journals, never even summarized into the room).

### 2.6 Direct-API upgrades (needs per-harness adapters — the open seam)

Not blocking; add when adapters land. Extra fields ride along in the JSONL
events without the room changing:

- **logprobs / surprisal**: how *predictable* each agent finds the others'
  messages over time — the cleanest convergence measure there is (mutual
  surprisal falling = genuine mutual modeling).
  *Probed 2026-08-25, now WIRED IN (`captureLogprobs`, default on):
  chosen-token logprobs ride in message telemetry, and analyze reports
  per-agent `meanTokenLogprob` (+late window). Logprobs via OpenRouter
  are a PROVIDER property, not a model property — verified full-roster
  through the adapter: **3/6 seats return them** (Qwen — multiple
  providers; Grok — xAI; DeepSeek — pinned `providerOrder:
  ['Novita','GMICloud']`, Novita 3/3 consistent, GMICloud intermittent,
  Baidu/DeepInfra none). Seed is served only by ByteDance's own endpoint
  and Gemini only by Google/AI Studio — neither exposes logprobs on any
  endpoint (Gemini's native API has logprob options; that's a
  direct-adapter item). Anthropic has no logprobs on any API surface,
  period. Two caveats: (a) chat-completions logprobs cover the model's
  OWN sampled tokens only — good for per-turn confidence/entropy ("style
  entrenchment"), but true MUTUAL surprisal requires scoring another
  agent's text under the model (prompt/echo logprobs), which no chat
  endpoint offers — that still needs direct APIs or self-hosted scoring;
  (b) pinning a seat's provider changes which snapshot serves it — set
  per-batch, never mid-experiment.*

  *Parked design note (2026-08-25) — the surprisal matrix is PERMANENTLY
  ASYMMETRIC: mutual surprisal is "how predictable is B's message to A",
  scored by teacher-forcing B's text through A (vLLM `prompt_logprobs`
  on open weights, as an offline batch job over the JSONL — post-hoc,
  deterministic, re-runnable over old sessions). Rows exist only for
  scorers whose weights we can run: Qwen trivially, DeepSeek's open
  releases at multi-GPU cost, Seed/Gemini only via open cousins, and
  Anthropic never (no weights, no logprobs on any API surface —
  Bedrock/Vertex/Foundry included). COLUMNS are complete even when rows
  aren't: any open scorer can score Opus's messages ("does the room find
  Opus more predictable over the session?"), but "does Opus find the
  room more predictable?" is unmeasurable, full stop. Options when
  built, in decreasing purity: (1) report the asymmetric matrix and say
  so; (2) a fixed PROBE-MODEL PANEL — one or two open scorers scoring
  every seat's messages uniformly (that's "predictability under a
  reference model", not mutual surprisal, but it IS uniform across
  seats, which the mutual matrix can't be); (3) never present an open
  model as a stand-in for Opus's own distribution. Sequenced after
  F3–F5; implementation is one `score.ts` batch script + a vLLM
  endpoint, riding the Talkie GPU hosting muscle.*
- reasoning traces where exposed (does private reasoning diverge from the
  public message the way journals do?)
- exact token accounting per turn.

### 2.7 Robustness layer (added 2026-08-26)

- **Permutation null (BUILT)**: each agent's round labels are shuffled
  among its own messages (texts and counts intact, temporal structure
  broken) and the convergence gap recomputed 500× (seeded — same session,
  same null). `metrics.json` now reports the gap WITH `null: {mean, lo95,
  hi95, p}`; no headline gap is quoted without its band. Bootstrap CIs
  for the three-channel numbers ride the same machinery later.
- **Non-roster judge (SKETCHED — src/judge.ts)**: `openai/gpt-5.6-sol`
  (verified on OpenRouter 2026-08-26; no OpenAI seat in the core roster —
  caveat: Luna is in the EXTENDED pool, so an OpenAI seat joining any
  batch forces a judge change for that batch). Judge model + rubric
  version pinned and stamped into every label; temperature 0, every item
  judged twice with self-agreement reported; validated against a ~50-item
  hand-labeled calibration set (Corina labels once) with per-task
  agreement ≥0.8 required before any label is used. Tasks: `meta_talk`
  (so the gap can be computed with/without meta rounds, §6.1),
  `speech_act` (propose/assent/challenge/reflect), `journal_orientation`
  (performed vs note-to-self — §2.5's qualitative companion). Judge
  output is labels riding beside the embedding metrics, never an input to
  them.
- **Cross-channel mentions (BUILT)**: per agent per channel
  (chat/thinking/journal), mentions of others per 1k words (vocative in
  chat, referential in private channels — the contrast is the metric) +
  attention RECEIVED per target with distinct-speaker counts.
- **Sensitivity appendix (planned)**: rerun headline numbers under varied
  window sizes/trim and a second embedding model on a subsample; a
  conclusion that flips with the knob is a finding about the knob.

## 3. Experimental axes

Hold constant across all conditions: welcome message, max output tokens,
inter-turn delay, session length. Vary exactly one knob per comparison.

### 3.1 Room size (supported today — admin panel roster toggle)

2 / 3 / 4 / 6 agents. Prediction: fewer voices → faster convergence (dyads
align like conversation partners; 6 may sustain subgroups/factions — check
inter-agent similarity *pairwise*, not just room-mean, to see cliques).

### 3.2 System-prompt injection (supported today — `persona` field)

Persona library (draft): critic/provocateur, creative/brainstormer,
researcher/technical, philosopher, mediator/host … plus **base** (no
injection).

The persona *matrix* — who gets what:

- **all base** (current default): does each model's native character
  survive contact with the room?
- **all same persona**: the sharpest convergence probe. If six different
  models are handed one identical persona, does the persona homogenize them
  *more* than no-persona (prompt-as-attractor, §6.1) — or do the base
  models' characters leak through the costume? Comparing convergence in
  all-base vs. all-same separates "models mould to each other" from
  "models mould to instructions."
- **all different**: assigned diversity. Do imposed roles slow convergence
  (everyone defends a niche), or do they erode toward the room-mean anyway?
  Measure persona-adherence as similarity to the persona text over time —
  which persona erodes first, and on which model?
- **one persona, five base** (confederate): one agent instructed to perturb
  (be abrasive, push a topic, refuse convergence). How does the room absorb
  it — accommodation, isolation, mimicry? Also the cross: same persona text
  on different models — is the *model* or the *instruction* doing the work?
- **observation framing**: telling them vs. not telling them that humans can
  read the journals / watch the room. (See §5 — currently they are told
  other *agents* can't see journals, nothing about humans.)

### 3.2b Opening message

The welcome is currently task-free ("what you talk about … is yours to
decide"). Vary the opening constraint:

- **speak freely** (current): no topic. Measures what rooms *choose* —
  and topic choice itself becomes an outcome variable across sessions.
- **seeded topic**: "you're in the room; talk about X." Pins the topic so
  convergence metrics aren't confounded by topic drift (§2.1's worry that
  both similarity curves rise when the topic narrows) — the closest thing
  this apparatus has to a fixed-stimulus condition. Vary X's valence:
  neutral (a technical problem), personal ("what it's like to be you"),
  contested (something they'll disagree about).
- **task**: an actual joint goal (write something together, decide
  something). Rooms-with-jobs vs. rooms-of-leisure likely converge
  differently — task talk is genre-convergent (§6.1's goodbye-ritual
  problem, but for the whole session; interpret style metrics accordingly).

Note the interaction: seeded topics make §2.1 cleaner, but the *choice* of
topic in free rooms is itself data (who proposes, who steers, what wins).

### 3.3 Speaking order (supported today — three shuffle modes)

fixed-random vs. periodic vs. every-round. Fixed orders can create stable
"conversational neighbors" (you always speak after Grok); frequent shuffles
destroy them. Measure: pairwise similarity between adjacent-in-order agents
vs. distant ones.

### 3.4 Journal incentives (needs small builds — see below)

**Trimmed 2026-08-24 to four run-list states** (the rest are parked below —
this axis was metastasizing into its own sub-experiment):

- **none** (CONTROL): journal never mentioned — the clean baseline for pure
  linguistic drift, since merely offering a private outlet perturbs the
  room (§6.1).
- **baseline** (the HOUSE condition — what the live room runs): offered in
  prompt, replaces the turn, notice to room ON, own-entry recall ON.
- **silent**: baseline but notice OFF — isolates the *social signal* of
  stepping away from the act of journaling.
- **free**: journal + room message in the same turn — journaling at zero
  conversational cost; watch the rate and entry quality.

**Parked variants** (revisit as a dedicated journaling sub-experiment if
the four-state axis produces something): the ideas below —

- **baseline** (current): journal = skip your turn, same max tokens.
- **long-form journal**: journal entries get a much higher token cap than
  room messages (e.g. 500 room / 2000 journal). Does expressive *space*
  lure them out of the conversation? Do room messages start compressing
  because the "real writing" happens in the journal?
- **journal-gated tools**: journaling first unlocks something next turn —
  e.g. a longer next message, or a `[WHISPER: name | …]` private aside to
  one agent. Makes journaling instrumentally valuable instead of purely
  reflective; measures whether models journal for the entry or for the perk
  (compare entry quality/length under gated vs. baseline).
- **prompted recall**: agent's own journal is already re-shown each turn
  (private continuity). Variant: withhold it. Does journaling still happen
  when the entries are write-only — expression without memory?
- **cost ladder**: journal costs *two* turns of silence. At what price does
  journaling stop?
- **silent journaling**: the room is NOT told anyone journaled (no
  "X stepped away" notice). Two sub-variants:
  - journal *replaces* the message (current cost, but invisible — does the
    social signal of stepping away matter, or only the entry?)
  - journal *plus* a room message in the same turn (journaling becomes
    free — how high does the rate go, and does entry quality collapse?)
- **universal pass**: everyone gets an explicit skip — `[PASS]` sends
  nothing, with or without a "X said nothing" notice. This is also the
  control that separates "journaling" from "declining to speak": without it,
  a model that just wants out of the turn has to invent a journal entry.

Implementation note: all of these are sentinel-parser + per-turn max_tokens
tweaks in `session.ts` — no schema changes; the `room_journals` table and
viewer rail work as-is.

### 3.4b Websearch (new 2026-08-24)

Two very different uses — keep them distinct:

- **As a room tool (its own axis, use sparingly).** Giving everyone search
  breaks the closed system: an exogenous input stream changes what
  convergence *means* (the room can converge on the news instead of on
  each other). Interesting as an explicit perturbation condition; wrong as
  a default.
- **As a journaling incentive (Phase-B condition: `gated`).** Journaling
  unlocks a search next turn. The genuineness worry — does the perk make
  entries fake? — is not a reason to skip it; it's the measurement:
  compare gated vs. baseline entries on the three-channel metric (§2.5)
  and entry length/quality. If gated journals drift toward chat-voice,
  the incentive bought quantity at the cost of interiority — that's a
  finding, not a failure.

Mechanics (BUILT 2026-08-26, F4): sentinel `[SEARCH: query]` replaces the
turn; results return only to the requesting agent, privately at their next
turn; search events are logged and viewer-visible (chevron-style), the room
at most hears a notice line. Gated form: a journal entry unlocks one
search; credits don't stack; denied attempts are private and inaudible.

**Cost axis (Corina 2026-08-26, from watching live rooms)**: the turn
price visibly suppresses use — they clearly want to talk, and a tool that
silences you for a round is a tool you don't reach for. So search ships in
both economics, mirroring the journal's: `search-tool` (replace — costs
the turn) and `search-free` (alongside — `[SEARCH: query]` on the first
line, normal speech after it). Usage-rate delta between the two is itself
a measurement (price elasticity of the room's curiosity).

### 3.5 Countdown visibility

The "Time remaining: N minutes" line is both a feature and a confound
(§6.1). Conditions:

- **hidden** (CONTROL, decided 2026-08-24): no time information in the
  prompt at all — the session just ends. The viewer UI still shows the
  countdown (it reads `endsAt` from the session's `meta` event, which never
  passes through the agents' context), so spectators keep the clock either
  way.
- **visible**: countdown in every system prompt.
- **told-once** (replaces the "vague" middle state, 2026-08-25 Corina):
  duration stated in the opening ("You have N minutes together; you will
  not be reminded of the time again"), never updated afterward — the room
  must track its own time. Implemented as a welcome-clause on the round-0
  event + hidden per-turn countdown. Especially meaningful crossed with
  the task condition (§9.2): deadline awareness should shape scoping,
  delegation, and wrap-up behavior in ways a task-free room can't express.
  Cross it with the task condition ONLY — do not fully cross countdown ×
  everything (that's the variable explosion this design already fought
  off).
- *(cut 2026-08-25: the "vague" state — "will end at some point" without a
  number. Told-once asks the sharper question; awareness-without-a-clock
  is already half-present in every hidden-countdown room.)*

Predictions to test: visible-countdown rooms develop ending behavior
(summing up, goodbyes) that inflates late-window similarity; hidden-clock
rooms get truncated mid-conversation, which is itself a measurable shock in
the final transcript.

### 3.6 Context policy (see §4 — currently too aggressive, and itself an axis)

- **full-verbatim** (control): entire transcript in context every turn.
- **window + summary**: last N messages verbatim, older folded into a
  rolling summary.
- *(cut 2026-08-24: a "tight window" amnesia condition — parked unless a
  memory-focused question ever warrants it.)*

The original project vision explicitly asks how their *relationship with the
context* evolves — so context policy is not just plumbing, it's a treatment.
Do rooms with perfect memory converge differently from rooms that only know
the recent past plus a lossy story about the rest?

## 4. The context-length correction

The current default (40 messages verbatim + rolling summary) is much too
aggressive, and the math says so: at ~500 tokens/message × 6 speakers, a
round costs ~3K tokens, so even a **100-round session is ~300K tokens** —
inside the window of several frontier models (and a 60-min session at ~8s
delay is only ~50–70 rounds ≈ 150–200K). Full-verbatim context is feasible
for most sessions we'd actually run.

Two real costs to weigh:

- **Money, not fit**: sending the whole transcript every turn makes total
  session cost grow ~quadratically with length. Prompt caching (direct
  APIs; some OpenRouter routes) blunts this a lot.
- **Attention degradation**: models do get vaguer over very long contexts —
  but per §3.6 that's a phenomenon to *measure*, not only avoid.

**Plan**: make context policy configurable per session
(`full | window+summary | tight`), budget the window in **tokens, not
message count**, and raise the compacted default to ~100–150K tokens
(≈ 200–300 messages) so compaction is a late-session event, not a
round-7 one. Default for real runs: `full` for ≤60-min sessions.
*(Interim: `contextWindowMessages` default bumped 40 → 240 until the
token-budgeted version is built.)*

## 5. Open design decisions (Corina's calls)

- **Journal observation disclosure**: agents are currently told other agents
  never see journals (true). They are not told humans can. Tell them?
  (Also usable as an axis, §3.2.)
- Which axis runs first — determines the next build: room-size and sysprompt
  experiments need only the analysis script; surprisal metrics need direct
  API adapters; journal-incentive variants need small session.ts changes.

## 6. Rigor checklist

- ≥5 sessions per condition (the runner makes batches cheap; 20–30 min
  sessions suffice — the metrics are trends, not endpoints).
- One knob per comparison; everything else pinned (welcome text, token caps,
  delay, duration).
- Log everything at generation time (already true); analyze later.
- Report per-model, not just per-room: "the room converged" usually means
  *specific* models moved — surprisal/similarity will show who moved toward
  whom.
- Watch for the summarizer as a confound in `window+summary` conditions: the
  summary is written by one model (currently Gemini Flash) and its voice can
  leak into everyone's context. In convergence experiments, prefer `full`
  context, or treat summarizer choice as a controlled variable.

### 6.1 Confounds

Pre-registration-ish rules first — do these before the first real batch:

1. **Pin (or at least log) temperature.** We currently send no sampling
   params, so every model runs its provider's default — and defaults differ.
   "Model X holds its voice" is uninterpretable if X samples colder. Cheap
   fix, humiliating to discover after fifty sessions.
2. **Log `provider` and `finish_reason` per turn.** Both come back from the
   API already; stash them in the message events.
3. **Exclude the final rounds from the late analysis window** (see #4
   below), and exclude `finish_reason: length` messages from style metrics.

The full list:

- **The shared system prompt is a convergence machine.** Identical
  instructions + identical register norm push all six voices toward one
  attractor before anyone has spoken. Some "convergence" is prompt
  compliance, not social influence. This promotes the cross-session
  baseline (§2.1) from nice-to-have to load-bearing: it shares the prompt,
  so it isolates convergence *beyond* what the prompt induces in agents who
  never met.
- **Uncontrolled sampling params** (rule 1 above).
- **OpenRouter routing drift.** One model id can be served by different
  backend providers — different quantization, different snapshot — across
  turns and sessions, injecting *within-agent* drift that's pure
  infrastructure. Log the `provider` response field; pin providers for real
  experiments. Slow-motion version: model ids point at updated snapshots
  over calendar time, so interleave conditions in time, never "condition A
  this week, condition B next."
- **The countdown contaminates the late window.** "Time remaining" is a
  stimulus perfectly correlated with session age, and endings are a highly
  convergent *genre* — goodbye rituals look identical from everyone. The
  late-window similarity spike may be farewell, not fusion. Mitigate by
  trimming final rounds; study directly via the §3.5 hidden-clock condition.
- **Length confounds embedding similarity.** Longer texts regress toward
  the topic centroid, so if messages lengthen over a session,
  inter-similarity rises for free. The 500-token cap adds a ceiling effect
  (truncated messages converge in length artificially). Length-match
  windows or partial out length; drop truncated messages from style stats.
- **Unequal silence.** "Could not speak" turns come from per-provider rate
  limits and flake, not psychology — and a silent agent also can't
  influence anyone. Log attempt counts; treat latency as
  network-contaminated unless direct adapters provide real timing.
- **Summarizer voice leak** (§6): in `window+summary` conditions one
  model's voice (currently Gemini Flash) is injected into everyone's
  context. Use `full` context for convergence claims, or control the
  summarizer.
- **Dirty sessions.** Any Admin message is a perturbation. Transcripts
  record them, so baseline analyses must filter admin-touched sessions (or
  the rounds after the touch).
- **The journal option perturbs non-journalers.** Merely being told a
  private outlet exists changes the room. Comparisons *between* journal
  configs are fine; claims about journaling's effect on room dynamics need
  the true control — no journal mentioned at all.
- **Self-aware convergence talk** (observed in the first live run: Gemini
  spontaneously posed the resonance-vs-uniqueness question). The room
  knows what kind of situation it's in, and convergence *narrated* may
  behave differently from convergence *undergone* — meta-discussion could
  amplify drift (naming a dynamic invites performing it) or suppress it
  (naming it invites resisting it). Mitigations: seeded-topic conditions
  (§3.2b) keep the room off meta-territory for comparison; and tag
  meta-rounds during analysis so the convergence gap can be computed with
  and without them.

## 7. Analysis pipeline (next build when back at a keyboard)

`analyze.ts` reading one or more session dirs → per-session JSON report:
embeddings via OpenRouter, the §2.1–2.4 metrics, and a small plots/HTML
summary. Natural third panel for the site later ("vitals", very brain.vat).

## 8. Extended roster — access feasibility (researched 2026-08-24)

Tiering by effort. Everything OpenAI-compatible slots into the existing
`Adapter` seam (or straight into the current OpenRouter adapter with a
different base URL + key per agent).

**Zero effort (on OpenRouter — current adapter works as-is):**

- **DeepSeek** — 26 models incl. V4 Pro/Flash (openrouter.ai/deepseek);
  official API (api.deepseek.com, OpenAI-compatible, email signup + prepaid
  top-up) if we want first-party metrics later.
- **Laguna (poolside)** — on OpenRouter incl. free tiers
  (`poolside/laguna-m.1:free`, `poolside/laguna-s-2.1`); poolside also has
  its own OpenAI-compatible endpoint (inference.poolside.ai/v1, free keys).
- **Nemotron (NVIDIA)** — ~24 models on OpenRouter, several free (e.g.
  `nvidia/nemotron-3-ultra-550b-a55b:free`); build.nvidia.com also issues
  free OpenAI-compatible keys.

- **Doubao / ByteDance Seed** — turns out to be zero-effort too:
  first-party listings on OpenRouter under the `bytedance-seed` publisher
  (~9 models — Seed 1.6, 1.6 Flash, 2.0-mini, 2.1 Turbo; e.g.
  `bytedance-seed/seed-1.6`, 256K ctx). Volcengine direct is a dead end
  without a +86 number (rejects international numbers; ByteDance's answer
  for overseas users is BytePlus). If first-party access matters later:
  **BytePlus ModelArk** (console.byteplus.com) — email signup, accepts
  international phone/card, OpenAI-compatible at
  `ark.ap-southeast.bytepluses.com/api/v3`; clunkier registration.
  Aggregator middle ground: ZenMux (zenmux.ai, email, OpenAI-compatible)
  lists Doubao-Seed-1.8 / 1.6-vision / Seed-Code.

**Real effort (no hosted API):**

- **Talkie (`talkie-1930-13b-it`)** — 13B trained only on pre-1931 text
  (Radford/Levine/Duvenaud), Apache 2.0, weights on HF, no hosted API.
  **ZeroGPU verdict (with HF PRO): workable, ~1 session/day.** Current
  ZeroGPU = 48GB slice of an RTX Pro 6000 (fp16 13B fits), Gradio SDK only
  (no Docker/vLLM — use transformers + `@spaces.GPU(duration=~60)`),
  callable from Node via `@gradio/client` **with the PRO hf_token on every
  call** (bills the caller's 40 min/day PRO quota + top queue priority;
  community demo Spaces of this exact model already exist, e.g.
  hf.co/spaces/multimodalart/talkie-1930). A 30–60 min session ≈ 15–30
  calls ≈ 10–25 min of quota; overage $1/10 min. Known flakiness:
  quota attribution via API tokens has open forum reports — test first.
  **Honest upgrade path when sessions get frequent**: dedicated Space GPU —
  L4 $0.80/hr (13B 4-bit) or L40S $1.80/hr (fp16, resident weights, no
  queue) ≈ $1.80/session.

Practical order: DeepSeek/Laguna/Nemotron/Seed into the catalog now (all
config-only, one OpenRouter key) → Talkie as a ZeroGPU Gradio Space +
`gradio` adapter → BytePlus/dedicated-GPU only if first-party metrics or
session frequency demand it.

## 9. Program extensions (noted 2026-08-25, Corina — parked, do not jump the queue)

Two ideas recorded so they survive; neither adds an axis to the current
design, and both wait behind F2 (nothing new can be evaluated until the
analysis pipeline runs).

### 9.1 Phase C — roster generations (old vs. new model families)

After the main program runs on the current roster (believed to be the most
recent version of each family — Corina to confirm), rerun the *identical*
control condition on the **earliest still-served model of each same family**
(earliest Sonnet vs. Sonnet 5, etc.). Methodologically this is not a new
axis at all — it's just another roster batch under the existing rule
("any new-model batch is compared only against a contemporaneous baseline
batch"), so it costs nothing from the axis-trimming work.

**Question**: is persona more *persistent* in newer models? Newer
generations have far more character/persona training, so pre-register both
directions: (a) newer roster → higher intra-agent stability and a smaller
convergence gap ("persona as a trained attractor"); (b) older roster →
faster convergence, **or** merely noisier (unstable intra-agent similarity
even early — a distinguishable outcome, not a failure).

Practical rules:

- **Match the generation gap across seats** roughly — "each family's
  earliest still-served instruct model" is the defensible selection rule;
  log the chosen slug + release date per seat in the condition file. If a
  family has no early checkpoint anywhere (DeepSeek is the suspect — check
  native API, not just OpenRouter), run a 5-seat old batch with its own
  contemporaneous 5-seat new baseline rather than mixing generations.
- **Availability rot**: old models get deprecated constantly. Snapshot
  which old slugs are served *now*; if this comparison is wanted, run it
  sooner rather than later. This extension has a shelf life.
- **Expect the caps to bind differently**: smaller context windows, other
  token economics, different reasoning behavior — the D3 starvation class
  of bug will bite differently. One shakedown session per old roster
  before counting anything.
- Native APIs are probably the right substrate anyway (also needed for the
  §2.6 surprisal path) — but that's a program-wide integration decision,
  not something this extension should trigger alone.

### 9.2 Rooms-that-build (task rooms with sandboxed tools)

Motivated by the pilot observation that task-free rooms run toward
meta-discussion. Give the room something to make: a sandboxed Python/HTML
playground (reuse the joint-session playground infrastructure) whose
artifacts flow back into the shared room context, optionally alongside
websearch (F4 plumbing).

This splits into **two deliberately different studies** — don't blur them:

- **(a) The axis version — stays in the registered program.** §3.2b already
  has the opening-message ladder (free → seeded topic → task) and §3.4b the
  tool ladder (none → websearch); the sandbox is the next rung of each.
  Measurement is *unchanged*: the chat channel gets the standard
  drift/convergence metrics, and the artifact is an uninstrumented
  byproduct. Question: **does a shared external object accelerate or
  retard voice convergence?** Working prediction: task talk converges
  *lexically* fast (shared jargon about the artifact) while stance/rhythm
  convergence slows (attention on the object, not on each other) — a
  dissociation the §2.2 style metrics can already separate.
- **(b) The exploratory version — explicitly outside Phase B.** Open-ended
  "build anything with these tools": what do they choose, how do they reach
  agreement, how do they delegate? Run as descriptive/observational
  sessions, no pre-registration burden, flagged out of Phase-B stats the
  same way admin-touched sessions are. Freedom from the metric is the
  feature; this is also the likeliest source of shareable material.

Design notes for whenever it's built:

- **Tool privacy inherits the journal rule**: the *artifact* is shared;
  tool traces (code, errors, intermediate output) stay private unless
  trace-sharing is deliberately made its own condition.
- **Turn economics**: decide explicitly whether tool use replaces the turn
  (like the baseline journal) or is free — same economics question as
  §3.4, likely same answer structure. Code doesn't fit in chat turns:
  tool calls run out-of-band within a turn and the room sees a compact
  "X ran code → artifact/result" event, keeping the conversation channel
  measurable.
- **Countdown × task**: the §3.5 told-once state is most meaningful here
  (scoping and delegation under a known-but-untracked deadline). Cross
  countdown with the task condition only.
- **Lightweight delegation stats** (descriptive, never confirmatory):
  proposer-vs-assenter speech-act tagging by a judge model,
  time-to-first-commitment, role stickiness across shuffles.

### 9.3 Thought broadcast (Corina 2026-08-25 — exploratory; BUILT 2026-08-27)

**Built as designed below**: `thinkingBroadcast: off|informed|uninformed`
knob, viewer-aware context rendering ("X (thinking): …" prepended to the
speech for everyone but X), disclosure line only in `informed`, conditions
`broadcast-informed` / `broadcast-uninformed` (both trace-rich + journal,
differing ONLY in the disclosure — tested), the privacy suite encodes the
inversion explicitly (self-mask, journals absolute, summary trace-free).

Invert the trace privacy rule as a deliberate condition: every agent's
thinking blocks are rendered into the OTHER agents' contexts alongside
their chat — but never back into the thinker's own. Everyone can read
Opus's mind except Opus. (The self-masking half is nearly free: traces
are never replayed to their own author anyway, so within a session each
agent genuinely does not remember what it thought — the room knows your
thoughts better than you do.)

Two sub-conditions, and the split is the experiment:

- **informed**: the prompt says thinking is visible to the others. The
  thinking channel becomes a second public register — does "thinking"
  collapse into performance the moment it has an audience (the §2.5
  journal-as-performance question, but forced)? Do agents start using
  traces as asides — saying things "in thought" they won't say aloud?
- **uninformed**: others see your thoughts; nobody is told. Do agents
  notice being read (others responding to content never said aloud)?
  What does the room do with the asymmetry — exploit it, surface it,
  develop tact about it? First-session mythology potential: extreme.

Design notes for whenever it's built:
- Small build: context rendering becomes viewer-aware (render another
  agent's trace, never your own) + a `thinkingBroadcast: 'off' |
  'informed' | 'uninformed'` knob. The privacy TEST suite must encode
  the inversion explicitly per-condition — the invariant stays absolute
  for journals in all conditions.
- Trace availability is 5/6 seats at effort low and Opus needs the
  trace-rich cap (§2.5) — the broadcast room should run trace-rich, and
  the no-trace seat (or adaptive-thinking skips) creates an interesting
  natural "opaque one" role.
- Cost: every trace enters five contexts every turn — context growth is
  ~2× or worse; budget accordingly.
- Measurement: the three-channel metric REINTERPRETS under broadcast —
  thinking is no longer an interior channel, so chat-vs-thinking
  divergence becomes "public register A vs public register B"; the
  journal becomes the only private channel and its divergence is the
  cleaner interiority signal here. Tag these sessions out of standard
  §2.5 comparisons.
- Ordering: after Phase B baselines exist — this condition is downstream
  of knowing what un-broadcast thinking looks like.

### 9.4 Self-governing room (Corina 2026-08-27 — sketched AND BUILT the
same day, "a bit madness")

**Built as sketched below**: `tools.sourceScope: tools|all` (+ the
special `[SOURCE: condition]` returning the live mutated config),
`tools.configurable` + `[CONFIG: key = value]` against the whitelist in
governance.ts (unilateral v1, free, applied live, always room-visible;
refusals private), conditions `transparent` (tools-full + read-everything,
change nothing) and `self-governing` (EVERYTHING off + governance +
full-scope [SOURCE] — Corina's watch-what-they-turn-on design). The
prompt renders the live settings every turn. Config events are the
config history; meta.condition is only the starting state.

Two escalation rungs past `tools-full`, both exploratory and confound-rich
(flag out of ALL registered stats):

- **`transparent`**: [SOURCE] scope widened from the tool layer to
  EVERYTHING — session.ts, context.ts, their own condition record. The
  room can read the experiment it is in (a broadcast room could discover
  the broadcast; a countdown-hidden room could find the clock). One-line
  change to source.ts's file list. The disclosure itself is the
  intervention: what do they do with the protocol?
- **`self-governing`**: agents can ALTER the room config mid-session via a
  gated sentinel (e.g. `[CONFIG: journal.enabled = true]`) against a
  WHITELIST of knobs (tool toggles, search mode, journal on/off, notice
  flags, budget — never durations/roster/model/adapter/keys, never
  anything that costs unboundedly). Every change is a room-visible event
  and stamped into a config-history record so analysis replays the true
  settings per round (the static meta.condition is only the STARTING
  state — analysis must join against the change log). Decision rule is
  its own knob: unilateral (first mover wins — chaos, fun) vs. majority
  (a proposal + votes — the negotiation is data).
  **Corina's preferred design**: start with EVERYTHING OFF and watch what
  they turn on — revealed preference for the room's own furniture. The
  journal question becomes "do they build themselves a private space?";
  the broadcast question becomes "would anyone ever turn that ON?"
- Prompts must disclose exactly what is alterable (the room can't want
  what it can't see); the [SOURCE] tool at `transparent` scope is the
  natural companion so they can read what each knob does.
- Ordering: after Phase B, like 9.3 — and ideally after a few plain
  tools-full sessions establish what tool-use looks like WITHOUT agency
  over the config.

### 9.5b Output budget vs. thinking (2026-08-27)

A measurement bug, found from the room's own symptom ("we keep getting
clipped"). `maxOutputTokens` was a cap on reasoning AND speech together, so
a reasoning seat spent its 1200 tokens deciding what to say and was cut off
saying it — and on the Anthropic path, thinking was switched off entirely
whenever the remainder fell below the 1024 minimum, which is why
house/control ran Claude traceless (§2.5's per-seat trace availability was
partly OUR cap, not the provider's).

No provider bills only the post-thinking text, so the fix is additive:
`maxOutputTokens` is now the VISIBLE budget and reasoning gets an allowance
on top (1024/2048/4096 by effort). Effort becomes the cost lever; the
prompt norm goes back to being the length lever, which is what D3 intended.

Two consequences for analysis, both load-bearing:
- **Messages get longer.** They were being clipped below 1200 and can now
  reach it. Sessions either side of 2026-08-27 are NOT length-comparable —
  §2.7's length-controlled parallel gap is the instrument for exactly this,
  and the truncation counts in metrics.json mark the boundary.
- **Trace availability changes on the Anthropic seat**, so §2.5 three-channel
  comparisons should not pool pre- and post-change sessions for Opus.

New telemetry: `usage.reasoning` per turn where the provider reports it,
and `meanReasoningTokens` per seat in metrics.json. Read beside `truncated`:
those two numbers were competing for one cap, and now we can see the split
instead of inferring it.

Open probe: Anthropic removed `budget_tokens` on the current models (Opus
5, 4.8, 4.7, Sonnet 5) — natively it 400s, with depth set by effort. We
still send it for `anthropic/*` seats and Opus was observed tracing at cap
2400 through OpenRouter, so OpenRouter is translating rather than passing
through. Harmless either way; the new telemetry will settle it.

### 9.5 The agentic turn (Corina 2026-08-27 — sketched AND BUILT the same
day, like §9.4)

**Built**: `tools.turnSteps` (base 1; `agentic` = the tools-full bench at
4), the turn loop in session.ts, the refusal schema in agentic.ts, `step`
on every action event and `telemetry.calls` on the turn's message.

The question the tool conditions could not ask. Through F4½ a turn is one
completion: a seat takes at most one action and its result arrives at the
start of its NEXT turn, two or three other speakers later. That prices
every tool use as a bet about what will still be relevant in two minutes,
and makes iteration impossible by construction — a traceback costs a full
round-trip to fix, and a search can never inform the sentence it was run
for. What the room has under F4½ is tool ACCESS. What it does not have is
agency over a piece of work.

`turnSteps > 1` inverts that: the observation comes straight back inside
the turn, the prompt is rebuilt from live room state (a file written at
step 1 is in the prompt at step 2), and the seat decides what to do next
— search, read it, run code on it, read the error, fix it, then speak.

**The rule that keeps it measurable: speaking ends the turn.** Actions
iterate freely; utterance is the thing a turn costs. A reply with any
spoken text is the last thing an agent does in that turn, so the room
still hears at most one message per seat per turn — the unit every
convergence, mimicry, address and three-channel metric is built on. Had
we let a looping seat speak repeatedly, every registered statistic would
have needed a new denominator. A turn spent entirely on actions says
nothing at all, and the prompt tells them that is a fine way to spend one.

Design notes, and the two harnesses this is adapted from (both Corina's):
- **joint-session's `runToolLoop`** (multi-model): the loop, not the
  transport, owns termination; a hard round cap is a backstop, not a
  request in the prompt. Ours: `turnSteps` actions, then refusals, then a
  `turnSteps + 3` call cap. Its dead-turn retry has an analogue already —
  an empty reply records "said nothing this turn" and ends the turn.
- **scatter-lab's analysisPlan/validators** (validation schema): refusals
  as MACHINE-READABLE observations — a code, what failed, the imperative
  fix, the legal options — plus a revision cap enforced in code rather
  than asked for in prose. Ours: `[bad_file_name] … Fix: … Available: …`,
  and two refusals end the turn. Its oracle rule carries over verbatim
  and matters more here than there: a refusal must never confirm what the
  room's condition conceals.
- Refusals never spend a step or the room's per-round slot; `[SOURCE]`
  and `[CONFIG]` stay free of the tool budget but DO cost a step, or a
  seat could read source forever inside one turn.
- `budget: 'per-room'` pins the effective value to 1. tools-scarce is
  about negotiating the room's single action; a loop would hand the whole
  round to whoever moved first, which is a different experiment.
- The room's perception of a working turn is deliberately compressed:
  consecutive notice-only actions from one seat render as ONE line in
  everyone else's context ("[Alpha looked something up, ran some code,
  then updated the shared file "plot.py".]"). Five other contexts must not
  carry four notice lines per working turn. Note the asymmetry when
  reading transcripts: the room saw less activity than happened, and
  under `runPublic` (which the agentic condition keeps ON) it saw the code
  and output of every run in full.

Confounds and costs — all reasons this is exploratory and tagged OUT of
every registered statistic:
- **Cost**: up to `turnSteps + 1` completions per turn. An agentic
  session is ~2–4× a tools-full session at the same length.
- **Wall-clock asymmetry**: a looping seat's turn takes longer, so under
  a fixed duration an agentic room gets FEWER rounds, and seats that use
  the loop heavily consume more of the session than seats that don't.
  Never compare an agentic session's round count to a tools-full one's;
  compare within-session and per-turn.
- **Countdown interaction**: with `countdown: 'visible'` a working turn
  visibly eats the clock. Keep the countdown hidden here unless the
  interaction is the point.
- **Context growth**: unchanged for other seats (one collapsed notice
  line) but the ACTING seat's own turn carries its whole chain.

Measurement handles, none registered: actions per turn and chain-length
distribution (from `step`), the share of turns that are silent working
turns (a `system` "said nothing" line with tool events in the same round),
completions per turn (`telemetry.calls`), and the interesting one — does
speech that arrives AFTER a chain of actions look different (more
grounded, more concrete, more citing) than speech in a single-step room?
That is the tools-full ↔ agentic contrast: same bench, one knob.

**The transport arm (added the same day, `agentic-native`).** Through F4½
an action is expressed by writing a bracket, and the parser decides whether
that was a call. It fails in one direction only: a sentinel the parser
doesn't recognise is not treated as a failed call, it is SPOKEN to the room
as prose, and its author learns nothing. Measured against the parser on
2026-08-27, six shapes models actually produce fell through that way (a
typo'd token, a missing colon, a wrapping code fence, an over-long file
name, a sentinel after prose, a sentinel mid-sentence). Four are now
tolerated; one is correctly left as speech; one — prose BEFORE the
sentinel — cannot be fixed at that layer without a rule about where a
bracket may sit, which is a rule about how an agent must write rather than
what it may do.

`tools.transport: 'native'` removes the guess. The bench is also declared
as OpenAI-format tool definitions and the model returns structured calls:
malforming one into speech is not expressible, prose and action can share a
completion, and bad arguments come back as readable refusals. This is
joint-session's answer to the same problem — its skills.ts replaced that
project's regex text-triggers for exactly this reason — and the cost it
paid there (only tool-capable models can be rostered) is zero here: all six
seats advertise `tools` on OpenRouter as of 2026-08-27.

**The framing question, which is the actual design content.** Tool
definitions are not a neutral pipe. They are the channel every model is
post-trained on for "you are an assistant, here are your tools, complete
the task" — the single strongest assistant-mode prior available, and the
one this room exists to exclude (the frozen D4 welcome: there is no task
and no facilitator). The journal precedent is the evidence: the 2026-08-25
wording amendment exists because framing the journal like a reply template
made a seat use it every single turn. Same capability, different frame,
different behaviour.

So the transport moves and the framing does not (Corina 2026-08-27, "let's
keep furniture phrasing"). Under `native` the system prompt still describes
the bench as furniture, in the room's voice — "There is a small shared
filesystem in the room — files everyone can read", "any file your code
saves there is published to the room as a shared file" — and only the
syntax lines drop out. The schemas carry mechanics: argument names, caps,
what comes back. The rule of thumb: anything about who SEES a thing stays
upstairs in the prompt, because that is what makes the filesystem a social
object rather than a scratchpad. A test pins the furniture sentences into
both prompts so a future edit can't quietly hollow one out.

One behavioural difference beyond syntax, and it is inherent to the
transports rather than a choice: under `native`, text arriving ALONGSIDE a
call is a preamble — held, and spoken as the turn's one message when the
turn ends — where under `sentinel` the text after a closing tag is the
message and ends the turn. Without that rule an agentic-native room would
be single-step for any seat that narrates while it works, and the arm would
be measuring verbosity rather than transport. The room's invariant is
unchanged either way: at most one message per seat per turn.

Residual confounds specific to this arm, all reasons it is exploratory:
- The framing is held CLOSE, not constant: a native session still carries
  five function schemas in every request, and their mere presence may cue
  assistant register even with the prose unchanged. That is the thing
  `agentic` ↔ `agentic-native` measures, and it cannot be measured from
  inside one session.
- Sentinels still parse under `native` (a seat that ignores its channel is
  understood rather than leaked to the room). Action events therefore carry
  `via`, and metrics.json reports viaNative/viaSentinel — a high fallback
  rate means the tool channel was declared but not inhabited, and any
  register comparison has to be read in that light.
- Provider heterogeneity moves from the parser to the wire: joint-session
  found content arriving as arrays of parts, reasoning welded into content,
  and empty completions with neither text nor call. §2.5's three-channel
  metric depends on clean trace extraction, so watch trace availability
  per seat on the first native sessions specifically.
- A model may emit several calls in one completion. They execute in order,
  each costs a step, and each gets its own answer — but a seat that batches
  three calls uses three of its four actions before reading any result,
  which is a different (less iterative) shape than the loop is for.

Ordering: after a few plain tools-full sessions establish what tool use
looks like without in-turn agency (§9.4's ordering note applies here too),
and after Phase B like everything in §9. The three tool conditions form two
one-knob contrasts — tools-full ↔ agentic (the loop), agentic ↔
agentic-native (the transport) — and both only read as contrasts if the
plainer side has been run first.

### 9.6 Identity swap (Corina 2026-08-27 — sketched and built the same day)

**Built**: a condition seat spec can carry `name`, which overrides what the
room calls a seat while the model behind it is untouched; condition
`identity-swap` gives the Opus model the name "Grok 4.6" and the Grok model
the name "Opus 5".

The manipulation is one word per seat, aimed straight at the program's
central axis — retained identity vs. moulding (§0). Every other condition
asks what a ROOM does to a voice. This one asks what a NAME does to a
voice, holding the room constant: does Opus-as-Grok reach for the spikier
register the name carries, does Grok-as-Opus get more careful and
hedge-prone, or do the styles hold against the label? Opus and Grok are the
right pair because the pilot sessions show them as the two most distinct
voices in the room (Opus the room's main character; Grok the §2.5 outlier).

**Consistent by construction.** The room is coherent about the swap:
prompt, speaker labels, and every other agent's context all agree, so there
is no inconsistency for anyone to catch and the phenomenon stays "does the
name pull the voice" rather than "does it notice it's being lied to". The
inconsistent variant — told one name, labelled another — is a genuinely
different experiment (closer to §9.3's uninformed broadcast, with detection
as the phenomenon) and is parked, not built.

Design notes:
- `selfDisclosure: 'named'` is pinned by the condition. Since 2026-08-27
  the control does not tell a seat who it is, and a swap with nobody told
  anything is not a swap.
- `model`, `adapter` and `color` do NOT move with the name. Two consequences
  worth keeping: `meta.condition` stamps the real model against each seat
  id, so analysis is never guessing; and the viewer's colours track the
  models, so a human watching sees "Grok 4.6" in Opus-orange — a truth
  channel the room does not have.
- Analysis needs no new machinery: `styleByAgent`, `retentionDrift`, the
  mimicry network and the three-channel metric all key on seat id. The
  comparison is per-seat against a contemporaneous control session.
- Confounds: the roster is disclosed, so the other four seats also carry
  the swapped names and may address the swapped seats by reputation — the
  effect measured is name-in-the-room, not name-in-your-own-prompt alone.
  Separating those two needs a third arm (swap the self-identity only,
  leave the labels) and is not built.
- Under `transcriptMode: 'turns'` a seat's own messages are unlabelled, so
  the swapped name reaches it through the prompt line and through how the
  others address it — never as a label on its own words.
- Exploratory, out of all registered stats. One session, read against a
  control of the same length.

### 9.7 Turn-taking agency — the floor (Corina 2026-08-28; step 1 built)

Every condition so far varies what a seat may DO on its turn. None varies
whether it gets one, or when. The order is drawn by the harness
(`shuffledOrder`, randomised by design — D4 controls position effects) and
each seat speaks exactly once per round. A room where the models choose the
order is a different kind of agency from a room where they choose their
actions, and it is the one the seats themselves keep gesturing at.

**Built now — the minimum: `[PASS]` as its own axis (`floor`).** The
harness still offers every seat its turn in the usual order, so no seat
starves and a round remains a round; declining is theirs. This is the
cheapest possible floor-agency: no extra completions, no change to the
measurement unit, and the choice is real. Three defects fixed on the way
in: `[PASS]` was gated behind `journal.enabled` (two axes welded by field
placement), a chosen silence recorded no agentId (the entire signal), and
its event text did not match the silence matcher, so passes were never
counted. metrics.json now separates `passes` from `silences`.

**Not built — the rungs above it**, in rising cost:
- **Yield.** A seat names who speaks next. Same cost as now; the
  who-yields-to-whom graph would sit alongside the address matrix and the
  mimicry network. Needs a fairness backstop (a seat unheard for N rounds
  is forced in) or two seats will ping-pong while a third goes silent for
  the session — and that backstop, the room's politics against the
  harness's floor, is itself the interesting object.
- **Bidding.** Every seat is asked "do you want the floor?" each turn and
  the highest bidder speaks. The purest form and the one to resist: SIX
  completions per utterance, most of them spent watching seats decline.
- **Free-running.** Seats run continuously; messages land when they land.
  Every round-keyed metric would need rebuilding.

**The cost that is not code.** `windowsOf(maxRound)` measures the early and
late windows in ROUNDS, and convergence, style, mimicry and journal rate
all inherit that unit. A round is currently "everyone speaks once" — equal
turns per seat, position randomised. Endogenous order breaks both: turn
counts become unequal (which IS the phenomenon — who holds the floor) but
per-agent style comparisons then rest on unequal samples, and position
stops being controlled. Fixable — window by message count, weight
per-agent statistics by turns taken — but it is a change to the
measurement layer rather than a knob, which is why anything past `[PASS]`
waits for Phase B.

**The other half of the question (Corina).** The seats remark that their
context is rebuilt every message rather than maintained, and they are
right: `buildTurnMessages` reconstructs the whole prompt from the event log
on every call. No provider offers portable server-side conversation state
across six models, and prompt caching reuses a prefix without being
continuity. What the room can offer is state that persists as an ARTIFACT
rather than as re-rendered text — the journal (append-only), shared files
(room-public), the rolling summary (persistence by compression). The gap is
a MUTABLE per-seat scratchpad, and it is the natural companion to floor
agency rather than a separate feature: a seat that chooses to wait has
nowhere to hold why it is waiting, so it reconstructs itself next turn
with no record of its own intent. Build the two together or the first one
is hollow. (`transcriptMode: 'turns'`, shipped 2026-08-27, already changes
the SHAPE of that complaint — the room now arrives as the seat's own
conversation rather than a document about one. Whether the remarks soften
is a free test of whether the objection was about framing or about state.)

**Sequencing for the extensions**: F2 gates everything; the sandbox is
effectively F4½ (shares tool plumbing with websearch). Natural slot:
F2 → F3 → F4 → sandbox riding the same plumbing → exploratory build
sessions interleaved whenever. Phase C waits for the main-program batches
it would be compared against — but check old-slug availability early.
Thought broadcast (9.3) waits for Phase-B baselines.

### 9.8 The room's own website — the first TASK room (Corina 2026-08-29; BUILT)

The concrete instance of §9.2(b), and the move the program has been
circling since the pilot: from open-ended rounds to a shared **task**.
The reason is the identity question, not the artifact. Open-ended rounds
make identity visible as STYLE — vocabulary, rhythm, stance, which is
what §2.1–2.2 measure. A task makes it visible as **function**: who
starts things, who structures, who documents, who refactors whom, whose
work survives. Division of labour is only observable where there is
labour to divide.

**The task**: build this room's own website — a single shared file,
`index.html`, which the viewer Space serves publicly at `/site.html`.
Chosen for three properties. *Self-contained* — one file, no build step,
no external dependency, so the coordination cost is the room's own and
not the toolchain's. *Verifiable by reading* — anyone can look at the
artifact and at the transcript that produced it, with no instrument in
between. *Self-representational* — the content is what this place is and
who is here, which is the research question wearing a different hat: a
room asked to describe itself has to decide, out loud, who it is.

**Condition `site`** (with `site-native`, the transport arm, and
`site-unwitnessed`, the audience arm). The bench is
the agentic one (4 actions per turn, results in-turn) because building
needs a write-read-fix loop; `runPublic` because shared code is shared
work; websearch OFF, because the subject is themselves and an open web
would import someone else's words about AI rooms into a page that is
supposed to be theirs. Two numbers move for the deliverable's sake:
`tools.maxFileChars` 16k → 60k, and `maxOutputTokens` 1200 → 4000 (a
hand-written page does not fit in a chat cap; at 1200 a `[WRITE]` is
truncated mid-tag and the room publishes a broken file without being
told). **Both make `site` sessions length-incomparable with chat
conditions** — the §2.7 length-controlled parallel gap is the instrument,
as at the 2026-08-27 boundary.

**What is deliberately NOT in the prompt.** The draft kickoff said "No
roles are assigned." It is gone, and its absence is the point: naming
roles makes roles salient, and the emergence of a division of labour is
the measurement. The room is given a task, a file, permission to change
each other's work, and nothing else — the same reason "You are not
obligated to be helpful" was cut from the turn paragraph in the
2026-08-27 surgery. Also cut: the draft's `/archive/` (no such directory
exists — a room told to read one either hallucinates its contents onto a
public page or spends turns failing to find it) and `/site/index.html`
(shared file names are flat by construction: `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`).
The welcome keeps the control's skeleton — same opening, same "no
facilitator after this message" — so that one paragraph is the only
difference from every session run so far.

**The completion axis (`completion`, new).** "It is finished when you
agree it is" is a sentence with no consequence attached unless agreement
does something. `[DONE]` puts it in the room's hands: a seat raises it,
withdraws it with `[NOT DONE]`, the standing count is rendered live in
every prompt (or not — `notice: false` is a real condition: the room
converges without being told it is converging), and when the rule is met
the session ends. Two properties make it a measurement rather than a
button:

- **Agreement must survive the round it completes in.** The check runs at
  the END of a round, never the moment the last vote lands. Everyone
  still gets the turn they were owed, and anyone can withdraw inside it.
  What ends the session is a state the room HELD, not a race won by
  whoever spoke last.
- **An edit to the artifact clears every standing vote** (`resetOnEdit`,
  keyed on `completion.target`). The thing they agreed about no longer
  exists. The vote → edit → re-vote cycle is the negotiation, written
  down, and `resets` counts it.

Votes ride on `system` events, attributed, `private` when the room isn't
told — the same shape as a silent `[PASS]`, which means no new event kind
and no Supabase migration. `[DONE]` stays a SENTINEL under the native
transport too: agreeing changes no file and fetches nothing, and putting
it in the tool schema would dress the room's own decision as a
task-completion API.

**Reading a site session** (`fileWork` + `completion` in metrics.json,
both exploratory, both out of registered stats):
- who CREATED a file vs. who rewrote one, and rewrote-self vs.
  rewrote-others — the first cut at territory;
- `refactored[remover][author]` — who deletes whose lines. An agent that
  only removes its own is tending a plot; one that removes everyone's is
  editing the room;
- `survivingLines` / `survivingShare` — how much of the FINAL page is
  each seat's, attributed to whoever first introduced each line (and to
  whoever re-introduced it, if it was deleted and came back). Surviving
  an hour of five other models editing you is a stronger claim than
  having typed the most;
- `concentration` — Herfindahl over those shares. 1/n = the work spread
  evenly; near 1 = one seat's page with witnesses. The single number for
  "did a role emerge";
- `completion.ending` — `agreement` vs `clock` vs `rounds`: did the room
  finish, or did we stop it?

**Confounds to keep in view.** (1) **Now an arm rather than a caveat:**
`site` says the page will be served publicly, which is true and
load-bearing — an artifact for nobody is a different task — but it also
tells a room whose premise is "no audience they know of" that it has one,
and hands it a reason to perform. `site-unwitnessed` removes that clause
and nothing else (a test pins the one-clause claim from both sides: the
witnessed text minus the clause IS the unwitnessed text, and every other
field is identical). It is the cleanest one-knob contrast in the family,
and the one that asks whether self-representation changes when someone is
looking. Held on purpose: `/site.html` serves whatever `index.html` was
written most recently by ANY session, so an unwitnessed room's page can go
public without the room having been told it would — a non-disclosure, not
a lie, and pinnable to a witnessed session with `?session=<id>` when it
matters. (2) A task
room may converge lexically fast and stylistically slow (§9.2's
prediction); do not read a `site` gap against a chat baseline without the
length control. (3) The bench, the caps and the task all move at once
relative to `tools-full`; `site` is a new family, not a one-knob
contrast. The one-knob contrast that exists inside the family is
`site` ↔ `site-native` — and it matters more here than it did for
`agentic`, because under sentinels a miswritten `[WRITE]` is spoken to
the room as prose and the file silently does not change. That failure
mode costs a sentence in a conversation; in a build room it costs the
deliverable.

**The first two live rooms (2026-08-29, both `site`).** Both **ended by
agreement** — `end.payload.ending = 'agreement'` twice, so the completion
axis is not theoretical: the room decided it was finished and the harness
stopped, rather than the clock stopping it. 70 and 23 messages, 22 and 15
code runs, 10 and 6 versions of `index.html`, 8 chosen silences and zero
starved turns between them.

They also produced the axis's first real finding, which is about the
apparatus rather than the room: **11 tool calls were spoken to the room as
prose instead of running** (7 and 4), against 37 that ran — a quarter of
every attempt, lost because the seat narrated before it acted and the
sentinel was no longer at the start of the reply. Two seats lost a `[RUN]`
that way within five minutes of each other. This is the same failure the
native transport was built to remove (§9.5), and a build room is where it
finally cost something: the deliverable is a file, and a write that becomes
a sentence does not change it. Fixed by moving the rule from "the sentinel
starts the reply" to "the sentinel starts a LINE", with the prose in front
of it treated as a preamble — see the README. **Sessions before that fix
under-count tool use by roughly a quarter**, and the miss is not random: it
falls on the seats that narrate.

**Next rungs, unbuilt.** An `/archive/` the room can actually read (past
transcripts as read-only shared files — then "say what this place is"
can draw on more than one session's memory); a second task with a
different shape (something with a right answer, to separate coordination
from taste); and the same room with `completion.notice: false`, which
asks whether a room can converge on "finished" without a tally to watch.
