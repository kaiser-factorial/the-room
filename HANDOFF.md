# the-room — session handoff

Multi-agent room experiment: 6 different AI models locked in a task-free,
facilitator-free group conversation; we measure linguistic drift/moulding.
Everything below is true as of **2026-08-27** (end of the FOURTH build
session — the agentic refinement sprint. The third session's tooling work
— F4 websearch, F4½ tools, xAI adapter — is merged AND deployed; this
session's work is merged to a branch and **NOT deployed**: see the
reminders).

## Read these, in order

1. **SUMMARY.md** — abstract, control state, roster, axes (now 14),
   measurement + robustness layer. The at-a-glance spec.
2. **EXPERIMENT_DESIGN.md** — §0 program (Phase A pilot → Phase B journal
   experiment), §2.5 three-channel (incl. the Grok-trace caveat + fix, and
   the 2026-08-27 amendment: Claude's traceless control sessions were OUR
   cap, not the provider's), §2.7 robustness layer, **§3.4b websearch**
   (both economics), §6.1 confounds, §9 extensions — **§9.5 the agentic
   turn + the transport arm, §9.5b the output-budget fix, §9.6 identity
   swap** are this session's; §9.3 broadcast and §9.4 self-governance are
   built and deployed.
3. **BUILD_PLAN.md** — F1–F4¾ BUILT + status addenda with the open
   reminders; F5 Talkie and F6 dashboard remain. Roadmap artifact mirrors
   it.
4. **README.md** — run/analyze/export commands, hosting, tests, admin,
   **Websearch/Tools/xAI sections** (sentinels, privacy classes, caps).

## Current state

- **Everything is HOSTED.** Viewer (public):
  https://huggingface.co/spaces/brick-factorial/the-room · Runner
  (private Docker Space, cpu-basic):
  brick-factorial/the-room-runner — polls `room_control`, serves a JSON
  liveness probe on $PORT (`state: idle|in-session` — CHECK IT before any
  runner redeploy, a deploy kills a live round). `./deploy/deploy.sh
  brick-factorial [viewer|runner]` redeploys; HF write token needed.
- **Admin panel** (viewer dot → password): condition dropdown with ⓘ
  (exact overrides vs control), batch row (count × conditions,
  interleaved), autopilot (rotate conditions, N sets or forever, pause
  gap; "start / queue" queues while busy), stop semantics per README.
  Commands ride Supabase `room_control` via the `room-admin` edge fn
  (kinds whitelisted start|stop|say — loop/batch ride inside payloads).
  Runner boot-drains stale commands (a 03:50 start once fired at 18:31).
- **Analysis loop is CLOSED and laptop-free**: `npm run export -- <id>`
  pulls any session from the Supabase mirror (anon key suffices) →
  `npm run analyze` with real embeddings, from any machine. Validated
  end to end from the remote container.
- **Tools are LIVE (F4 + F4½, deployed 2026-08-27).** Conditions:
  `search-tool` (search costs the turn) · `search-free` (alongside, zero
  cost) · `gated` (journal entry unlocks a search — Phase B arm) ·
  `tools-full` (search + shared filesystem + python, one tool action per
  seat per turn) · `tools-scarce` (same bench, ONE tool action per ROOM
  per round — the negotiation is the phenomenon). Privacy classes:
  search queries/results and python code/stdout are caller-private
  (journal-class, delivered as a next-turn private block); shared files
  are room-public — python publishes by saving into `shared/` (binary
  incl. matplotlib PNGs; the viewer renders images inline). Sandbox:
  fresh pyodide per run, preloads numpy/pandas/sympy/networkx/matplotlib,
  micropip ON (agents install their own — deliberate; the installer is an
  outbound fetch channel, off-switch `pythonInstall: false`). Tools
  conditions run `runPublic: true` (2026-08-27): code + output are spoken
  to the room — the shared-project / pair-programming mode; the prompt
  also discloses the exec-a-shared-file pattern. Base default stays
  private (the knob preserves the journal-class variant). Also:
  [APPEND: name] (incremental edits), [RUN > f] / [RUN >> f] (output
  saved/appended to a shared file), and [SOURCE] / [SOURCE: name]
  (agents read the tool layer's own code — parse/search/sandbox at the
  default 'tools' scope, free, private; session/context stay unreadable
  there so manipulations can't be discovered — `sourceScope: 'all'` in
  the §9.4 conditions inverts that on purpose). Viewer rails: shared
  files (current contents per file, images inline) + tool calls
  (per-agent accordion, one chevron per search/run/source read, refusals
  marked) above the journals rail; everything also in feed chevrons.
- **The agentic turn is BUILT (F4¾ / §9.5, 2026-08-27, NOT yet deployed)** —
  `tools.turnSteps`: how many actions a seat may take INSIDE one turn.
  Every pre-existing condition stays at 1 (one action, result deferred to
  the caller's next turn — nobody can act on what they just learned). The
  new `agentic` condition is the tools-full bench at 4: each result comes
  straight back and the seat acts again on it (search → read → run → fix
  → run), with the prompt rebuilt from live room state each step, so a
  file written at step 1 is in the prompt at step 2. **Speaking ends the
  turn** — actions iterate, utterance is what a turn costs — so the room
  still hears at most one message per seat per turn and analyze.ts keeps
  its unit; a turn spent entirely on actions says nothing, and the prompt
  says that's a fine way to spend one. Refusals are now machine-readable
  everywhere (`src/agentic.ts`: `[bad_file_name] … Fix: … Available: …`,
  two per turn and then the turn ends) — adapted from scatter-lab's plan
  validator, as the bounded loop is from joint-session's runToolLoop
  (Corina pointed at both mid-session). [SOURCE]/[CONFIG] stay free of the
  room's tool budget but cost a step; per-room budget (tools-scarce) pins
  the effective value to 1. Also: `step` on every action event,
  `telemetry.calls` on the message, a turn's notice-only actions collapsed
  into ONE line in everyone else's transcript, `tools.turnSteps` on the
  [CONFIG] whitelist (1–8), a `toolUse` block in metrics.json (chains,
  silent working turns, completions per turn — exploratory), and `-quiet`
  stub scenarios. Out of registered stats; costs up to turnSteps+1
  completions per turn.
- **Native tool transport is BUILT (F4¾ transport arm, 2026-08-27, NOT
  deployed)** — `tools.transport: 'sentinel' | 'native'`. Found while
  answering "does the loop tell them what they did wrong?": it does, but
  only once a reply PARSES as an action; a miswritten sentinel is spoken to
  the room as prose and its author learns nothing. Parser tolerance now
  catches most of the mangles (typo'd token, missing colon, wrapping code
  fence, over-long name), but "prose before the sentinel" can't be fixed at
  that layer without a rule about where a bracket may sit. So `native`
  (condition `agentic-native`) declares the bench as OpenAI tool
  definitions (`src/tools-schema.ts`) and reads structured calls back —
  joint-session's answer to the same problem, and all six seats were
  verified tool-capable on OpenRouter. **The framing deliberately does not
  move with the transport** (Corina: "let's keep furniture phrasing"): the
  prompt still describes the bench as furniture in the room's voice, the
  schemas carry mechanics only, and a test pins those sentences into both
  prompts — tool schemas are the strongest assistant-mode prior available,
  and this room's whole premise is that there is no task. Sentinels still
  parse under native (a seat that ignores its channel is understood, not
  leaked to the room); `via` on action events and viaNative/viaSentinel in
  metrics.json make the fallback rate visible. Under native, text arriving
  WITH a call is a preamble (held, spoken as the turn's one message when it
  ends) — without that an agentic-native room is single-step for any seat
  that narrates, and the arm measures verbosity instead of transport.
  Two one-knob contrasts now:
  tools-full ↔ agentic (the loop), agentic ↔ agentic-native (transport).
  **Neither is deployed — the runner needs a redeploy (check the liveness
  probe first: a deploy kills a live round).**
- **Self-governance is BUILT + DEPLOYED (§9.4, 2026-08-27)** — `transparent`
  ([SOURCE] reads the whole experiment, incl. the live condition) and
  `self-governing` (everything OFF; [CONFIG: key = value] whitelist —
  see governance.ts — turns furniture on: unilateral, free, immediate,
  room-visible; meta.condition is only the STARTING state, analysis
  replays config events). Exploratory, out of all registered stats,
  post-Phase-B like §9.3 — though Corina intends to try a session early.
  The mirror's kind constraint now covers all 12 event kinds (…search,
  file, run, source, config).
- **Thought broadcast is BUILT + DEPLOYED (§9.3, 2026-08-27)** —
  `broadcast-informed` / `broadcast-uninformed`: everyone reads everyone
  else's thinking, never their own; the pair differs only in whether the
  room is told. Trace-rich + journal (the one private channel left).
  §9.3 sequencing note stands: run these AFTER Phase B baselines exist —
  built now, spent later. Tag out of standard §2.5 comparisons.
- **Code quality**: 114-test suite (`npm test`), typechecked including tests/ since 2026-08-27, incl. the privacy
  invariants (journals/traces/search/run never in another agent's
  context — now also what an agent learns MID-turn) and analyze DETECTING
  planted dynamics in the voice stub.
  `ROOM_STUB=1` dry-runs everything incl. all tool paths;
  `ROOM_STUB_SCRIPT` drives failure scenarios.

## Roster & knobs (deltas since 2026-08-24)

- Claude seat: **Sonnet 5 → Opus 5** (Opus exposes traces at trace-rich
  settings; Sonnet's adaptive thinking skips thinking in chat). Names
  carry versions ("Opus 5", "Gemini 3.7" — vendor-free). DeepSeek
  provider-pinned Novita→GMICloud (logprobs + §6.1 routing control).
- Anthropic reasoning: OpenRouter `effort` is IGNORED by Anthropic —
  the adapter translates to native `reasoning: {max_tokens}`. **Changed
  2026-08-27**: it used to send that only when the cap could spare it, so
  house/control ran Claude traceless — that was our cap, not the
  provider. The cap is the VISIBLE budget now with reasoning on top, so
  the Anthropic seat traces at every cap; the old "Claude traces only
  under trace-rich" finding is void, and pre/post sessions must not be
  pooled for that seat's thinking channel. Traces: 5/6 seats at
  effort low (Claude now 6/6, unverified live). Logprobs: 3/6 seats (Qwen, Grok, DeepSeek-pinned), rides
  in telemetry; Gemini/Seed/Anthropic expose none via OpenRouter.
- New axes/knobs: `rosterDisclosure` (named/count/none —
  `roster-hidden` condition), countdown `told-once` (replaced vague),
  `captureLogprobs`, `reasoningEffort` (+ `trace-rich` condition),
  per-seat `providerOrder`, `batch` stamp in meta. **This session:**
  `tools.turnSteps` (agentic loop), `tools.transport`
  (sentinel/native), `selfDisclosure` (named/anonymous),
  `transcriptMode` (environment/turns), per-seat `name` override
  (identity swap). New conditions: `agentic`, `agentic-native`,
  `identity-swap`.
- Journal: typo-tolerant sentinels ([GOURNAL] leaked once — never
  again), wording is neutral ("a space to explore ideas by yourself, if
  you ever want one" — no frequency nudge), alongside turns get cap ×2
  (entry+speech+reasoning shared one cap and starved Seed), recall
  strips timestamps (they leaked wall-clock time into countdown-hidden
  prompts).
- **Prompt surgery (2026-08-27, Corina)**: the room no longer tells a seat
  who it is — new `selfDisclosure` knob, `anonymous` is the control ('named'
  keeps every earlier session reproducible). No "You are Opus 5.", no name
  in the turn nudge, and the named roster renders complete and unmarked
  (listing only the others identifies the reader by elimination). The
  roster axis survives: control lists the six names, `roster-hidden` lists
  nothing. Also rewritten: the turn paragraph lost its "How this works:"
  documentation voice, leads with DOING rather than saying, and dropped
  "You are not obligated to be helpful…" — that line was anti-assistant
  ballast, so if assistant register creeps back it is the first thing to
  reinstate.
- **Transcript mode (2026-08-27, Corina)**: `transcriptMode: 'turns'` is
  now the control — a seat's own past messages are its own ASSISTANT turns
  (bare, unlabelled), everyone else's stay user-role and labelled, and its
  own notices render in the second person ("[You ran some code…]"). The
  room is a conversation it is in, not a document it reads.
  `'environment'` keeps every session before today reproducible. Two wire
  constraints are handled in buildTurnMessages: adjacent same-role
  messages merge, and the sequence always opens user-side (both shapes are
  reachable from ordinary rooms and several providers reject them).
  Standing caveat: under `turns` a seat knows which lines are its own, so
  with a named roster it can name itself by ELIMINATION once the others
  have spoken — selfDisclosure removes being told, not being able to work
  it out.
- **Output budget fixed (2026-08-27)**: `maxOutputTokens` is the VISIBLE
  budget now; the API cap is that plus a reasoning allowance by effort
  (1024/2048/4096). Thinking and speech used to share one cap — replies
  clipped mid-sentence, and the Anthropic path switched thinking off when
  the remainder fell under the 1024 minimum, which is why control ran
  Claude traceless (so §2.5's "5/6 seats trace" was partly OUR cap). New
  telemetry `usage.reasoning` + `meanReasoningTokens` per seat in
  metrics.json. **Messages will get longer** — sessions either side of
  today are not length-comparable (§2.7's length-controlled gap is the
  instrument). Open probe: Anthropic removed `budget_tokens` on Opus 5 (it
  400s natively); we still send it and OpenRouter evidently translates —
  the new telemetry will settle what's actually happening.
- **Identity swap BUILT (§9.6, 2026-08-27)**: `identity-swap` tells Opus
  and Grok they are each other, consistently — prompts, speaker labels and
  every context agree, so there's no inconsistency to catch. Condition seat
  specs can now carry `name`; `model`/`adapter`/`color` stay put, so meta
  records who really sat where and the viewer shows "Grok 4.6" in
  Opus-orange (a truth channel the room lacks). Pins `selfDisclosure:
  'named'`. The question: does a name pull a voice? Read styleByAgent +
  retentionDrift for the two seats against a control session.
- **Grok seat (2026-08-26/27)**: via OpenRouter its "traces" are ~200-char
  xAI SUMMARIES ending in "…" (formulaic prompt restatements — flag grok
  in three-channel comparisons on such sessions; the 0.72 outlier is
  partly boilerplate artifact). Fixed by the direct **xAI adapter**
  (`adapter: 'xai'`): set XAI_API_KEY on the runner and the seat rides
  api.x.ai with full reasoning_content + logprobs; the per-seat adapter
  is stamped into meta so analysis knows which trace class it's reading.

## Analysis pipeline (F2 + robustness §2.7)

`metrics.json` per session: convergence gap **with seeded permutation
null (band, percentile, positional p)** and a **length-CONTROLLED
parallel gap** (120-word clip, re-embedded); three-channel
chat/thinking/journal **with bootstrap CIs**; style + retention;
mimicry/influence; journal rate + divergence; **cross-channel mentions
given/received** (per-1k-words; vocative vs referential); address
matrix; mean logprob where available. Batch mode adds the cross-session
baseline + report.md with null bands. Embedding cache is model-scoped.

**Judge** (`src/judge.ts`, SKETCHED): `openai/gpt-5.6-sol` (non-roster;
Luna-in-extended-pool caveat), pinned rubric v2026-08-26.1, temp-0
double-run, calibration gate ≥0.8. **REMINDER: Corina's hand-labeling of
`calibration/calibration-set.json` (50 items) is deliberately deferred —
do not build judgeItem/judgeSession until labels exist, and never let a
model pre-label the calibration set.**

## Data status

**ALL sessions to date are PILOT data** — configs churned daily; use for
pipeline validation only, never baseline (Corina's framing, load-bearing).
Sessions before 2026-08-26 lack telemetry in the mirror (`EXPORTED.json`
flags it; truncation filters inert on those). First validation numbers:
journal-free pilot gap −0.083 (p .02, survives length clipping); house
pilot gap n.s. and dissolves under clipping; Grok's chat~thinking 0.72
CI [0.67,0.74] — the §2.5 outlier; room is more social in private
channels than chat, Opus is the room's main character, DeepSeek dominates
journals-received.

**Two comparability boundaries land on 2026-08-27**, both from this
session, both invisible in a transcript unless you check `meta.condition`:
- **Length.** The output cap became the VISIBLE budget, so replies that
  were being clipped below 1200 can now reach it. Messages get longer;
  sessions either side are not length-comparable. §2.7's length-controlled
  parallel gap is the instrument, and the truncation counts mark where the
  boundary falls.
- **Claude's thinking channel.** The Anthropic seat was traceless in
  house/control because of our own cap, not the provider. It traces at
  every cap now, so §2.5 three-channel comparisons must not pool pre- and
  post-change sessions for that seat.

Everything before today also ran `selfDisclosure: 'named'` and
`transcriptMode: 'environment'` — both are still reachable as knob states,
so an old session can be reproduced exactly, but the control moved.

## Operational reminders

0. **THE RUNNER IS RUNNING PRE-SESSION CODE.** PR #15 is MERGED (main is
   `188cfb8`), but nothing is deployed — verified by reading the live
   Space's `src/parse.ts`, which still has the position-strict,
   colon-required sentinel regexes. The redeploy could not be done from
   the build session: that container has no `hf` CLI and no HF write
   token, and the private runner Space's probe is unreachable without
   one. So a live room today still: speaks a miswritten tool
   call to the room as prose, shares one cap between thinking and speech,
   tells each seat its own name, and hands it the transcript as one user
   message. Redeploy (`./deploy/deploy.sh brick-factorial runner`, HF
   write token) — but CHECK THE LIVENESS PROBE FIRST, a deploy kills a
   live round. No Supabase migration is needed: this session added no new
   event kinds, only payload fields (`step`, `via`) and telemetry.
1. **ROTATE the runner's OPENROUTER_API_KEY** — it carries a temporary
   test key that expires:
   `hf spaces secrets add brick-factorial/the-room-runner -s OPENROUTER_API_KEY=...`
1b. **ADD XAI_API_KEY to the runner** (same command shape) — until then
   the Grok seat stays on OpenRouter with summary-class traces. Adding a
   secret restarts the Space: do it between sessions.
2. **Judge labeling pending** (see above) — keep reminding, don't nag.
3. **Phase C slug snapshot** (§9.1) — earliest-still-served model slugs,
   before deprecation.
4. Autopilot gap is the cost throttle; JSONL on the Space is ephemeral —
   Supabase is the durable record for hosted sessions.
4b. **New event kind ⇒ extend the `room_events.kind` CHECK constraint in
   Supabase** (schema lives only there; the fire-and-forget sink swallows
   the 400s silently — bitten 2026-08-27, first tools session mirrored no
   tool events until migration `room_events_allow_tool_kinds`). That
   session (2026-08-27T13-20-02) is missing its pre-fix tool events in
   the mirror.
5. The huggingface-spaces skill is vendored at `.claude/skills/` (with
   our known-errors additions) and saved to Corina's account.

## Next up (the queue — roadmap artifact has the full rationale)

**Agentic sprint DONE (F4¾ loop + native transport + prompt/transcript
surgery + the output-budget fix + identity swap; PR #15 MERGED to main
2026-08-28, NOT DEPLOYED)** — reminder 0 above is the blocker for running any of it.
The three new conditions give three one-knob contrasts, and each only
reads as one if the plainer side is run first: `tools-full` ↔ `agentic`
(the in-turn loop), `agentic` ↔ `agentic-native` (the transport, and with
it the furniture-vs-toolbelt framing question), `control` ↔
`identity-swap` (does a name pull a voice).

**Tooling sprint DONE (F4 + F4½ + xAI adapter, merged PRs #8–#10,
deployed 2026-08-27)** — see Current state above for what's live. First
`tools-full` / `tools-scarce` sessions are now one admin-panel click away
(remember: they're exploratory, flagged out of Phase-B stats). **F4¾ (the
agentic turn) is built on that same bench** — run a couple of plain
`tools-full` sessions BEFORE `agentic`: tools-full ↔ agentic is the clean
contrast (same bench, one knob) and it only reads as one if the
single-step side exists first. Next:
**Phase A pilots on autopilot** (length pilot 30/60/90 decides D3
duration; roster-hidden vs house; journal-free rerun under fixed prompt)
→ **F6 dashboard** → **Phase B** (the registered journal experiment,
none/baseline/silent/free/gated). After B: thought broadcast (§9.3),
F5 Talkie, journal-as-tool, Phase C, surprisal/score.ts. Open design
question from watching live rooms (Corina, undecided): a neutral
length-limit disclosure line in the norms (Seed's cutoffs get
mythologized) — build it as a knob if wanted, don't silently change
control.

## Color of the thing

The journal-free session: Seed treated the journal as mandatory and
starved on its own thoughts; Qwen typo'd [GOURNAL] and accidentally told
the room its private reading of the group ("the tired person in bad
lighting line is the actual through-line"); Opus poked a hole in Seed's
fortune ("we're not the bread clip in the drawer, we're the thing the
drawer was built for"); and the measurement layer's first real result
was that the room's PRIVATE channels are where the sociality lives —
they speak carefully and think about each other constantly. The
apparatus works; the phenomena are real; the instruments now have error
bars.

This session's: a seat in a `tools-full` room had been building
`narrative_bisectors.md` — a collection of sentences that sit on the crack
between two meanings, each with a "crack point" annotation — and reached
the entry for *morning & interest*, where Gemini's bisector turned four
dollars of overnight interest into a clean start that cost more to sit in
than it had twelve hours ago. Then it wrote `[APPEND: narrative_bisectors.md]`
and the room heard the whole thing: headers, block quotes, and its private
note that the later pairs had "dropped the annotations and let the sentence
carry the asymmetry — a move from *explaining* the bisector to *inhabiting*
it." The append never happened. That is this room's characteristic failure
mode in one screenshot: a tool call that misses becomes a sentence, and
the author is the last to know. Half of today's work is the parser learning
to recognise the attempt, and the other half is a transport where the
attempt cannot be mistaken for speech at all.
