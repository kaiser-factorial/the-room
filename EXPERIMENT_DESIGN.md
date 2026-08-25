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
  budget form `reasoning: {max_tokens ≥ 1024}`, which the adapter now
  sends for anthropic/* WHEN the output cap affords it (so house/control
  at cap 1200 keep Claude traceless — the budget would re-create D3
  starvation — while trace-rich at cap 2400 enables it; Opus 5 traces
  richly there). Second wrinkle: Sonnet 5 thinks ADAPTIVELY — even with a
  budget it produced zero thinking on conversational room-style prompts
  and traced only on genuinely hard ones. Sonnet's thinking channel in
  chat sessions is therefore sparse-to-empty BY THE MODEL'S OWN CHOICE;
  treat trace presence per-turn as data, and expect the three-channel
  comparison to run on ~5 seats regardless.**
- **Effort knob**: reasoning effort low (the anti-starvation default)
  yields thin traces. A trace-rich condition wants medium effort + a
  bigger cap — that's a condition parameter, not a global.

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

Mechanics when built: sentinel (`[SEARCH: query]`), results returned only
to the requesting agent, search events logged (and visible in the viewer,
chevron-style).

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

### 9.3 Thought broadcast (Corina 2026-08-25 — exploratory, parked)

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

**Sequencing for the extensions**: F2 gates everything; the sandbox is
effectively F4½ (shares tool plumbing with websearch). Natural slot:
F2 → F3 → F4 → sandbox riding the same plumbing → exploratory build
sessions interleaved whenever. Phase C waits for the main-program batches
it would be compared against — but check old-slug availability early.
Thought broadcast (9.3) waits for Phase-B baselines.
