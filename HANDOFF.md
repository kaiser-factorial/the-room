# the-room — session handoff

Multi-agent room experiment: 6 different AI models locked in a task-free,
facilitator-free group conversation; we measure linguistic drift/moulding.
Everything below is true as of **2026-08-27** (end of the third build
session — the tooling sprint: F4 websearch, F4½ tools, xAI adapter, all
merged AND deployed).

## Read these, in order

1. **SUMMARY.md** — abstract, control state, roster, axes (now 13),
   measurement + robustness layer. The at-a-glance spec.
2. **EXPERIMENT_DESIGN.md** — §0 program (Phase A pilot → Phase B journal
   experiment), §2.5 three-channel (incl. the Grok-trace caveat + fix),
   §2.7 robustness layer, **§3.4b websearch** (both economics), §6.1
   confounds, §9 parked extensions (roster generations, thought broadcast
   §9.3, surprisal asymmetry note — rooms-that-build GRADUATED to built).
3. **BUILD_PLAN.md** — F1–F4½ BUILT + status addenda with the open
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
  completions per turn. **Not deployed — the runner needs a redeploy
  (check the liveness probe first: a deploy kills a live round).**
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
- **Code quality**: 97-test suite (`npm test`), incl. the privacy
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
  adapter translates to native `reasoning: {max_tokens}` only when the
  cap affords it (house/control cap 1200 → Claude traceless;
  `trace-rich` cap 2400 → Opus traces richly). Traces: 5/6 seats at
  effort low. Logprobs: 3/6 seats (Qwen, Grok, DeepSeek-pinned), rides
  in telemetry; Gemini/Seed/Anthropic expose none via OpenRouter.
- New axes/knobs: `rosterDisclosure` (named/count/none —
  `roster-hidden` condition), countdown `told-once` (replaced vague),
  `captureLogprobs`, `reasoningEffort` (+ `trace-rich` condition),
  per-seat `providerOrder`, `batch` stamp in meta.
- Journal: typo-tolerant sentinels ([GOURNAL] leaked once — never
  again), wording is neutral ("a space to explore ideas by yourself, if
  you ever want one" — no frequency nudge), alongside turns get cap ×2
  (entry+speech+reasoning shared one cap and starved Seed), recall
  strips timestamps (they leaked wall-clock time into countdown-hidden
  prompts).
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

## Operational reminders

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
