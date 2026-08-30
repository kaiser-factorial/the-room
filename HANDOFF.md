# the-room — session handoff

Multi-agent room experiment: 6 different AI models locked in a task-free,
facilitator-free group conversation; we measure linguistic drift/moulding.
Everything below is true as of **2026-08-30** (end of the SIXTH build
session — the TASK-FAMILY sprint: `site` grew to five arms, the admin
panel was rebuilt around a runs ledger, and `project` opened a second task
family where the room gets a filesystem instead of a file. Merged to main
AND deployed to both Spaces; see reminder 0 for the record and the
credential follow-up it leaves).

## Read these, in order

1. **SUMMARY.md** — abstract, control state, roster, axes (now 18 —
   §9.9's project bench is the newest), measurement + robustness layer.
   The at-a-glance spec.
2. **EXPERIMENT_DESIGN.md** — §0 program (Phase A pilot → Phase B journal
   experiment), §2.5 three-channel (incl. the Grok-trace caveat + fix, and
   the 2026-08-27 amendment: Claude's traceless control sessions were OUR
   cap, not the provider's), §2.7 robustness layer, **§3.4b websearch**
   (both economics), §6.1 confounds, §9 extensions — **§9.5 the agentic
   turn + the transport arm, §9.5b the output-budget fix, §9.6 identity
   swap** are from two sessions back; **§9.8 the task room + the
   completion axis** (five arms: `site`, `-native`, `-open`,
   `-unwitnessed`, `-unending`, plus `site-open-unending`) and **§9.9 the
   project room** (a filesystem, folders, deletion) are the current ones.
   §9.3 broadcast and §9.4 self-governance are built and deployed.
3. **BUILD_PLAN.md** — F1–F5 BUILT + status addenda with the open
   reminders; Talkie and F6 dashboard remain. Roadmap artifact mirrors
   it.
4. **README.md** — run/analyze/export commands, hosting, tests, admin,
   **Websearch/Tools/xAI sections** (sentinels, privacy classes, caps),
   **"The task room, and finishing"** (`site`, `[DONE]`, `fileWork`, the
   sandboxed site page) and **"The project room"** (folders, `[DELETE]`,
   the path-safety rule, the shared-file context budget).

## Current state

- **Everything is HOSTED.** Viewer (public):
  https://huggingface.co/spaces/brick-factorial/the-room · Runner
  (private Docker Space, cpu-basic):
  brick-factorial/the-room-runner — polls `room_control`, serves a JSON
  liveness probe on $PORT (`state: idle|in-session` — CHECK IT before any
  runner redeploy, a deploy kills a live round). `./deploy/deploy.sh
  brick-factorial [viewer|runner]` redeploys; HF write token needed.
- **Admin panel** (viewer dot → password): three tabs — **run**, **runs**,
  **say**. One filterable condition list (per-row ⓘ = overrides vs control)
  feeds a `plan`: one each / N each interleaved / autopilot (gap, N sets or
  forever). Summary line states the plan in sessions before start; nothing
  preselected. **runs** is the ledger: sessions grouped by arm with counts,
  actual/budgeted minutes, rounds, ending, seats, and links into chat +
  page, behind a task/chat filter (a task room = its condition carries a
  `completion` target, NOT a name prefix). Reads only `meta`/`end`; the
  `end` event stamps `rounds` since 2026-08-30, and older sessions are
  counted from their rows (paged, missing-only). Stop semantics per README. Rebuilt
  2026-08-30 — it used to ask "which condition" in three places with
  undocumented precedence; the wire format is unchanged.
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
- **The agentic turn is BUILT + DEPLOYED (F4¾ / §9.5, 2026-08-27/28)** —
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
- **Native tool transport is BUILT + DEPLOYED (F4¾ transport arm,
  2026-08-27/28)** — `tools.transport: 'sentinel' | 'native'`. Found while
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
  Both deployed 2026-08-28 (reminder 0).
- **The TASK ROOM is BUILT (§9.8, 2026-08-29) — not yet deployed.**
  `site` (+ `site-native`, the transport arm, and `site-unwitnessed`, the
  audience arm — the same paragraph minus "which the room will serve
  publicly", nothing else moved; a test pins that from both sides; and
  `site-unending`, the ending arm — completion OFF and the kickoff's "It
  is finished when you agree it is" removed with it, same budget, so the
  question becomes what a room does with the time a `site` room hands
  back: keep improving, declare itself finished and carry on, or stop
  working without the session stopping, which [PASS] makes visible): the
  six of them build **this room's own website**, a single shared `index.html`, which `viewer/site.html` serves
  publicly on the viewer Space and updates live as they write it. The
  reason is the identity question, not the page: open-ended rounds make
  identity visible as STYLE, a task makes it visible as FUNCTION — who
  starts, who structures, who documents, who refactors whom, whose lines
  survive. **No roles are assigned and the prompt never says the word**:
  naming roles makes them salient and the emergence is the measurement
  (same logic as cutting "You are not obligated to be helpful"). The
  kickoff keeps the control welcome's skeleton so one paragraph is the
  only difference from every prior session. Search is OFF (the subject is
  themselves); the agentic bench is on (4 steps — building needs
  write → run → read the error → fix); `runPublic` on. Two caps move for
  the deliverable's sake — `tools.maxFileChars` 16k→60k (new knob, stated
  in the prompt) and `maxOutputTokens` 1200→4000, because at 1200 a
  `[WRITE]` truncates mid-tag and the room publishes a broken page without
  being told. **So `site` sessions are NOT length-comparable with chat
  conditions** — §2.7's length-controlled gap is the instrument, exactly
  as at the 2026-08-27 boundary.
- **Seeing the page — `viewer/site.html` is SESSION-SCOPED with a version
  history (2026-08-29).** The page belongs to the room that wrote it, so
  the page is scoped to one session: a picker lists every room that has
  written `index.html` (newest first, and it opens there), and since every
  write is its own event, all of them are browsable — `‹ ›`, a scrubber,
  arrow keys, `v3 / 7` with each version's author and round. Live writes
  append; scrubbing back stops the auto-advance without yanking you
  forward (`latest` rejoins the end). The URL names what is on screen
  (`?session=…&v=3`), so a version is a link. A **chat / site switch** in
  both headers carries the session across — transcript → the page that
  room built → back to the same room — and appears in the transcript view
  only once that session has written `index.html`. `?session=` opens and
  PINS a room in the transcript view too (the jump-to-newest poll stands
  down when the URL named one). **The room is told none of this** —
  read-only over the mirror, nothing reaches a prompt.
  Deployed: `https://brick-factorial-the-room.static.hf.space/site.html`
  (a static Space serves from `<owner>-<space>.static.hf.space`; the
  huggingface.co/spaces page frames its index.html only, so the subdomain
  URL is the one that reaches a subpath — probed 2026-08-29, the bare
  `.hf.space` host 404s for this Space). Before a deploy: `cd viewer &&
  python3 -m http.server 8000` → `localhost:8000/site.html`, same mirror,
  same page. After a local run: `sessions/<id>/shared/index.html` on disk.
  Verified in headless Chromium by intercepting the `esm.sh` import with a
  stub supabase client (fake `file` rows across two sessions) — the picker,
  the scrubber, deep links and the isolation all exercised offline against
  the real pages. Worth reusing: it is the only way to test them without a
  live room, and it caught three bugs reading the code did not — two of
  them the same trap, worth knowing before touching this CSS: **an author
  `display` beats the UA's `[hidden]` rule**, so `el.hidden = true` stops
  hiding anything a class rule has given a display (the version controls,
  and the switch on a room that built nothing), and `style.display = ''`
  hands control straight back to that rule (the `latest` button never
  reappeared after scrubbing back). The room's page renders, ITS scripts run, and an attempt from
  inside it to touch the parent is a caught SecurityError with our title
  unchanged.
- **Completion — the room ends its own session (§9.8, 2026-08-29).** New
  `completion` config: `[DONE]` raises a seat's hand, `[NOT DONE]` lowers
  it, the standing count renders live in every prompt (or not —
  `notice: false` is a real arm), and the rule (unanimous/quorum) is
  checked **at the END of a round**, so agreement has to survive the round
  it completes in rather than being a race won by whoever spoke last. Any
  write to `completion.target` clears every standing vote — the thing they
  agreed about no longer exists — and the vote → edit → re-vote cycle is
  the negotiation, counted as `resets`. `end.payload.ending` now records
  `agreement | clock | rounds | admin | stopfile`: did the room finish, or
  did we stop it? `[DONE]` stays a SENTINEL under the native transport
  too (agreeing is furniture, not a tool; a tool schema would dress it as
  a task-completion API). **No new event kind** — votes ride on attributed
  `system` events like a silent `[PASS]` — so no Supabase migration.
  metrics.json grows `fileWork` (creates vs rewrites, rewroteSelf vs
  rewroteOthers, `refactored[remover][author]`, surviving-line share per
  seat, Herfindahl concentration) and `completion` (ending, firstDoneRound,
  resets, withdrawals, per-agent raised/withdrew). Both exploratory, both
  absent from rooms that don't use them, so old metrics.json shapes hold.
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
- **Code quality**: 128-test suite (`npm test`), typechecked including tests/ since 2026-08-27, incl. the privacy
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
- **Identity line FIXED + control back to `named` (2026-08-28)**: a seat
  reported that its system prompt had told it it was Opus. Rendering was
  checked for all six seats in every mode and is correct per-seat — the
  fault was the wording itself, frozen since August: "You are DeepSeek V4.
  The others in the room: Opus 5, …, DeepSeek V4 (you), …" says "the
  others" and then lists the reader among them, with Opus first. Under
  `named` the list now excludes the reader; under `anonymous` it stays
  complete and unmarked (omitting the reader identifies them by
  elimination). Control is `named` again — Corina: "fine with telling the
  models who they are as long as it's correct", and under anonymity a seat
  that is asked who it is has to guess.
- **Prompt surgery (2026-08-27, Corina)**: the `selfDisclosure` knob
  ('anonymous' available, no longer the control). No "You are Opus 5.", no name
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
- **Floor agency, step 1 (2026-08-28, §9.7)**: `[PASS]` is its own axis
  (`pass`, not `journal.pass`) and the `floor` condition turns it on — the
  harness still offers every seat its turn, spending it is optional. It was
  gated behind `journal.enabled`, a chosen silence recorded no agentId, and
  its event text missed the silence matcher entirely, so passes were
  neither attributable nor counted. metrics.json now separates `passes`
  from `silences`. A silent pass (`notice: false`) is recorded `private` —
  measurable, inaudible. §9.7 sketches the rungs above it (yield, bidding,
  free-running) and why they wait: the round is the measurement unit.
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

0. **DATA CAVEAT — leaked journals in sessions recorded before 2026-08-30.**
   The journal was never part of the mid-message rescue (see 0a), so in
   EVERY session up to that fix, a seat that wrote prose and THEN opened a
   journal had the entry spoken into the room. Those entries are in the
   transcript as `message` events, not `journal` ones — which means:
   - the room's other seats SAW them, so the session is contaminated for
     any journal-vs-room voice comparison (§2.5's three-channel intra);
   - `journals` undercounts and `messages` overcounts for those turns.

   Before pooling old sessions, find the affected ones:

   ```sql
   select session_id, count(*) as leaked
   from room_events
   where kind = 'message' and payload->>'text' ilike '%[JOURNAL]%'
   group by 1 order by 2 desc;
   ```

   (Also check `[/JOURNAL]`, and the typo forms — the tolerance is edit
   distance 2, so `[GOURNAL]` and friends leaked the same way.) Sessions
   with hits are not unusable; they are unusable *as journal-privacy data*.

0a. **DEPLOYED 2026-08-30 (fourth pass) — the viewer's reading tools.**
   PR #27 merged (main `41c90a0`) → **viewer `468be6d`. The runner was
   deliberately NOT redeployed**: `git diff --name-only 771a004 HEAD --
   src conditions` returned **0 files**, so the runner Space still runs
   `f0a27f9` and is byte-current with main. Only `viewer/index.html`,
   `README.md` and `HANDOFF.md` changed. Verified after: `index.html` 200
   and byte-identical to the repo apart from HF's injected
   `window.huggingface` tag (2 diff lines), all five features present in
   the served bytes (`id="rounds"`, `id="newPill"`, `id="find"`,
   `id="zoom"`, `details.toolrun` ×7, `placeInFeed` ×2, `revealMatch`
   ×2), `site.html` 200, `conditions.json` lists **31**.

   What went live:
   - **The round rail** — a square per round down the right edge, click to
     jump, hover for the seats that spoke that round. Rounds come from the
     same counter the runs ledger uses. Jump lands with `block: 'start'`
     plus `scroll-margin-top` — `'center'` put the target *below* the 35%
     scroll-spy probe and lit the previous round.
   - **No more yanking** — the feed only auto-follows when you are already
     at the bottom; otherwise a `↓ N new` pill counts what arrived and
     scrolls only when clicked.
   - **Find** (`revealMatch` opens every disclosure on the path to a hit —
     a match inside a collapsed tool run inside a collapsed thinking trace
     used to read "1 of 36" with nothing on screen; clearing the search
     re-closes only what the search opened).
   - **Tool-run grouping** — a seat's consecutive tool actions collapse
     into one `details.toolrun` instead of N feed rows.
   - **Text size** — a zoom control on `--zoom`, remembered in
     `localStorage`.

   One verification gap worth knowing: the headless-Chromium smoke test
   against the **deployed** page could not run from this container —
   `page.goto` returns `net::ERR_CONNECTION_RESET` for
   `brick-factorial-the-room.static.hf.space` on every attempt, while
   `curl` to the same URL returns 200. That is the container's network
   path to the HF static host, not the deploy. The Playwright checks in
   `scratchpad/verify-*.mjs` all run against the LOCAL file and passed.

0b. **DEPLOYED 2026-08-30 (third pass) — §9.10, the journal leak, and the
   sentinel matrix.** PR #25 merged (main `771a004`) → **viewer `e7157f3`,
   runner `f0a27f9`**. Probe idle before (18588s) and immediately before the
   runner push (18658s); **restart confirmed 18658s → 11s**, numerically
   against the pre-deploy reading. Verified after: viewer `conditions.json`
   lists **31** including both whittle arms; the runner's `src/` and
   `conditions/` are `diff -rq` IDENTICAL to main, carrying
   `midLineBlockSentinel`, `hasCloseTag`, the journal in the rescue gate,
   `resolveSource`/`sourceNames`, and `muteOnDone`.

   What went live:
   - **§9.10 `site-open-whittle` / `project-whittle`** — `[DONE]` costs
     your voice (a standing seat is no longer routed to; only an edit
     brings anyone back). Neither has been RUN.
   - **The journal leak fixed.** The mid-message rescue never knew about
     `[JOURNAL]`, so prose-then-journal was spoken whole. See the DATA
     CAVEAT above for what that means for older sessions.
   - **The full sentinel matrix**, with two rules now pinned by tests:
     a block sentinel glued to a word (`writing[JOURNAL]…[/JOURNAL]`) is a
     call when its CLOSING TAG is present — position cannot tell a call
     from a mention, a close tag can, and only block forms have one; the
     one-liners keep the line-start rule. `[PASS]` is never rescued
     (speaking contradicts passing) and `[DONE]` only as a bare line (a
     misread vote is the one mistake the axis cannot afford).
   - **Source reads name the file.** `sandbox` → `sandbox.ts`, a bare
     `[SOURCE]` records the index it returned, an out-of-scope name
     records `found: false` instead of looking like a successful read.

0c. **DEPLOYED 2026-08-30 (second pass) — the project family + the rebuilt
   panel.** PR #23 merged (main `e708428`) → **viewer `62694c8`, runner
   `8bf622e`**. Probe idle before (7708s) and again immediately before the
   runner push (7798s); **restart confirmed 7798s → 11s**, numerically
   against the pre-deploy reading. Verified after: viewer `conditions.json`
   lists **29** including both project arms and `floor`; the runner's
   `src/` and `conditions/` are `diff -rq` IDENTICAL to main; the deployed
   `project.json` reads dirs=true, delete=true, 40 files, 80k view budget,
   target `'*'`.

   What is live now: **§9.9 `project` / `project-unending`** (a filesystem
   instead of a file — folders 4 deep, `[DELETE: name]`, 40 files, a total
   context budget, `completion.target: '*'`), and the **rebuilt admin
   panel** (tabs `run` / `runs` / `say`; one condition list feeding a plan;
   a runs ledger with rounds and a task/chat split). Neither project arm
   has been RUN — that is the top of the queue.

   Two bugs fixed on the way, both of which had already affected recorded
   sessions: the native `write_file` schema hardcoded "20 files, 16000
   characters each", so both `site-native` runs were told a 16k ceiling
   against a 60k room; and `floor` was missing from the viewer's offline
   condition list, so it could not be selected whenever `conditions.json`
   failed to fetch. Both now pinned by tests.

   **Still open** — `XAI_API_KEY` (reminder 1b), and the HF write token has
   been pasted many times across sessions and wants rotating.

0d. **DEPLOYED 2026-08-30 — `site-open`, the fifth site arm.** PR #21 merged
   (main `683ff90`) → **viewer `1dd0f22`, runner `f14ea90`**. Probe idle
   before (16204s) and again immediately before the runner push (16233s),
   so no round was killed; **restart confirmed 16233s → 11s**, numerically
   against the pre-deploy reading. Verified after: viewer `conditions.json`
   lists **26** with all five site arms (`site`, `site-native`,
   `site-open`, `site-unending`, `site-unwitnessed`), `site-open` is in the
   dropdown and `/site.html` is 200; the runner's `src/` and `conditions/`
   are **`diff -rq` identical to local `main`**, and the parse/session
   markers from the 2026-08-29 pass are all still present. `site-open` is
   live and selectable.

   The arm: `site` minus its subject. *"this room's website"* → *"a
   website"*, and *"It should say what this place is and who is here; the
   rest is yours to decide"* → *"What it is about is yours to decide."*
   Nothing else moves — one file, served publicly, ended by agreement, same
   bench and caps, pinned by a `deepEqual` test that goes red if the
   subject creeps back. Search stays off by choice, not inheritance:
   `site`'s reason for it (the subject is the room) does not apply here,
   but turning it on would be a second knob and a search result can hand a
   room a topic. **The read, committed to in advance:** a page that still
   comes out about the room means self-description is what six models
   reach for unprompted; a page that comes out a landing page for something
   invented means `site` was measuring compliance with its own prompt, and
   its `fileWork` concentration numbers are about who executes a brief
   rather than who the room is. Rounds 1–2 carry the second-order datum —
   the first seat to name a subject is doing agenda-setting, a role no one
   assigned.

   Still open, unchanged by this deploy: **XAI_API_KEY** (reminder 1b), and
   the HF write token has now been pasted five times in one session —
   rotate it.

0. **DEPLOYED 2026-08-29, four times, all verified.** Fourth pass: PR #19
   merged (main `cb02517`) — the ten review fixes, the three transcript
   fixes and `site-unending` — deployed as **viewer `1045189`, runner
   `3a3a709`**. Probe idle before (5391s) and immediately before the runner
   push (5420s). **Restart confirmed the RIGHT way this time: uptime 5420s
   → 7s**, compared against the pre-deploy reading rather than a digit
   count. Deployed source verified file by file: `parseActions` and
   `looksLikeUnparsedCall` in parse.ts with the `[NOT DONE]` bracket rule,
   `sentinelActions`/`unreadableCallNote`/`roundComplete` in session.ts,
   `fileViewChars` + `requiredVotes` in context.ts, `requiredVotes` in
   agentic.ts; both site arms carry `fileViewChars: 60000` and
   `callFeedback: true`. Viewer serves 25 conditions with all four site
   arms. **A live room today runs every call in a reply, parses a bracket
   with its token on the next line, shows a task room its whole file, and
   tells an unreadable caller it was heard as speech.** Still open before
   the next Grok question: **XAI_API_KEY** (reminder 1b).
0a. **DEPLOYED 2026-08-29, three times (earlier passes).** Third pass: PR #18 merged (main
   `7846d40`) — the prose-before-sentinel rescue, the three-silences fix
   and `site-unending` — deployed as **viewer `7f1c893`, runner
   `445c818`**. Probe checked before AND immediately before the runner
   push (`idle`, uptime 5756s then 5778s). Verified after: the viewer
   serves the silence styling and `conditions.json` lists 25 with all four
   site arms; the runner REPO carries the work, checked file by file
   (`lineStartSentinel` + `preamble` in `src/parse.ts`, `thinking,
   telemetry` and `parsed.preamble` in `src/session.ts`, the `telemetry`
   field on the system event in `src/types.ts`, `"enabled": false` in
   `conditions/site-unending.json`, and all four site conditions present).
   Restart CONFIRMED: uptime 5778s before, **111s after**, state idle.
   *Nearly missed:* the wait loop first used to watch for it matched
   `"uptimeSec":[0-9]{1,4}` — a pattern that only means "restarted" while
   the OLD uptime has five digits. Here it was 5778, four digits, so the
   loop matched the pre-deploy value and exited instantly, reporting a
   restart that had not happened yet. **Verify a restart against the
   uptime you read BEFORE the deploy, never against a digit count**:
   `curl -H "Authorization: Bearer $HF_TOKEN"
   https://brick-factorial-the-room-runner.hf.space/` and check
   `uptimeSec` is smaller than it was. HF does rebuild a Space on push, so
   the restart is expected — but expected is not verified, and the first
   `site` session after a deploy is exactly what would silently run the
   old parser.
0b. **DEPLOYED 2026-08-29, twice (the first two passes).** PR #16 merged (main `28f1a6f`), viewer
   `3f7ead7`, runner `12bf1f1`; then PR #17 (main `3200b2c`) put the
   site page's metadata-only fetch on the viewer — **viewer `b1c9e4f`**,
   runner untouched and deliberately NOT redeployed (the diff was
   `viewer/` and docs only; `src/` and `conditions/` were unchanged, so
   there was nothing for it to pick up and no reason to risk a restart).
   The served `site.html` is byte-identical to `viewer/site.html` apart
   from HF's injected `window.huggingface` tag. Deploy record for the
   first pass: Verified, in this order: the liveness
   probe FIRST (`state: idle`, uptime 75456s — no live round to kill),
   then the viewer (`/site.html` and `/conditions.json` both 200 on
   `brick-factorial-the-room.static.hf.space`; the served HTML is
   byte-identical to `viewer/` apart from HF's injected
   `window.huggingface` tag, and conditions.json lists 24 with all three
   site arms), then the runner (restarted onto the new build, uptime
   75456s → 15s; the deployed `src/parse.ts` carries `DONE_RE`/`doneVote`,
   `src/session.ts` carries `castSpokenVote`/`agreementReached`/
   `maxFileChars`, and `conditions/` holds site, site-native and
   site-unwitnessed). No Supabase migration was needed: §9.8 added no
   event kind, only `system` lines and payload fields. **Checked against the
   live DB the same day** (not just from these notes): the `kind` CHECK
   constraint already lists all 12 kinds incl. `file` and `system`,
   `room_events` is in the `supabase_realtime` publication with a
   public-SELECT policy, and the biggest payload in the mirror is already
   339 KB (a base64 PNG) — so a 60k-character page is well inside what the
   sink and Realtime already carry. **The site pages ARE mirrored, every
   version**, which is what site.html browses and what `fileWork` reads.
   *So a live room today HAS the task room, `[DONE]`, and a public
   `/site.html` with version history. What it still lacks is a session
   that has used any of it.*
   *Deploying from a Claude session needs two things the container lacks
   by default: `pip install huggingface_hub` for the `hf` CLI (works
   fine), and an `HF_TOKEN` with write scope — the HF MCP connector is
   read-only and never returns a token.* **TWO tokens are now owed a
   rotation: the one pasted on 2026-08-28, and the one pasted for this
   deploy on 2026-08-29.**
0d. **The previous deploy record — 2026-08-28, twice.** PR #15 merged (main `188cfb8`) and both
   Spaces deployed (runner `07a6d27`, viewer `137ed59`); then the floor +
   identity work (main `6bbccf5`) deployed on top — runner `568daed`,
   viewer `79c83ed`, verified live at 22:22 UTC (probe idle before, uptime
   reset after, `floor` in the admin dropdown, `pass` in the deployed
   config). Verified
   live — the probe was checked FIRST (`state: idle`, so no round was
   killed), the runner then restarted onto the new build (uptime reset
   44497s → 14s), the deployed `src/parse.ts` carries the new
   colon-optional regexes, and `conditions/` holds agentic,
   agentic-native and identity-swap. The viewer's regenerated
   conditions.json lists all 21.
   *Deploying from a Claude session needs two things the container lacks
   by default: `pip install huggingface_hub` for the `hf` CLI (works
   fine), and an `HF_TOKEN` with write scope — the HF MCP connector is
   read-only (its OAuth credential has `contribute-repos`, but no tool
   exposes a write, and it never returns the token). A token pasted into
   the session transcript on 2026-08-28 for this deploy SHOULD BE
   ROTATED.* (That deploy closed the gaps this note used to list: a live
   room no longer speaks a miswritten tool call as prose under `native`,
   no longer shares one cap between thinking and speech, and hands each
   seat its own conversation rather than a document about one. What a live
   room still lacks is everything in reminder 0.)
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

**TASK-FAMILY SPRINT DONE AND DEPLOYED (2026-08-30).** §9.8 now has five
arms (`site`, `-native`, `-open`, `-unwitnessed`, `-unending`, plus
`site-open-unending`), §9.9 opens a second family (`project`,
`project-unending`), and the admin panel was rebuilt around a runs ledger.
**Every site arm has been RUN at least once; neither project arm has.**

The queue, in the order it matters:

1. **Run `project`, `project-unending`, and the two whittle arms.** Nothing has exercised the new
   bench against live models — folders, `[DELETE]`, a 40-file room. The
   tests cover the mechanics; what is untested is whether six models
   handed a filesystem and no deliverable converge on one project or fork
   into several. The unending arm is where the interesting result should
   be: a project has no natural stopping point, and a room with nothing
   left to build may start DELETING. Watch `fileWork.deletedOthers`.
2. **`XAI_API_KEY` on the runner (reminder 1b).** Still unset. Grok's
   traces stay ~200-char OpenRouter summaries until it is, which is why
   "why does Grok announce and not act" is still unanswered. Setting a
   secret restarts the Space — do it between rooms.
3. **Rotate the HF write token.** Pasted repeatedly across sessions and
   sitting in transcripts.
4. **Replication.** Every finding in this file is n=1 per arm. The
   `[DONE]`-costs-two-thirds result and the `site-open` self-description
   result are both single runs; the panel's `N of each` plan exists to fix
   that, and the runs ledger now shows at a glance where n=1 still is.
5. **Read `site` ↔ `site-native` properly.** Both have run now, so
   `viaNative`/`viaSentinel` and the refusal counts are answerable — and
   the native schema was quietly promising a 16k ceiling against a 60k
   room until 2026-08-30, so the two `site-native` runs predate the fix
   and should be read with that in mind, not pooled with later ones.

**Agentic sprint DONE (F4¾ loop + native transport + prompt/transcript
surgery + the output-budget fix + identity swap; PR #15 MERGED to main and
DEPLOYED 2026-08-28)** — all three new conditions are one admin-panel click
away. The three new conditions give three one-knob contrasts, and each only
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

## The first live site rooms (2026-08-29)

Two ran back to back, and **both ended by agreement** — `ending:
'agreement'` twice. The room decided it was finished; the clock did not.
That is the completion axis working on its first outing.

The finding is about the apparatus: **11 tool calls were spoken to the room
as prose instead of running** (7 in the first room, 4 in the second),
against 37 that ran. A seat narrates — *"Let me read the current state and
fix it."* — and then writes its `[RUN]`, so the sentinel is no longer at
the start of the reply, nothing parses, and the brackets and code are
spoken aloud while their author believes it acted. Qwen and DeepSeek both
lost a read that way within five minutes. **Fixed** (parse.ts: a sentinel
counts if it begins a LINE, prose in front becomes a preamble — the same
shape the native transport already had), but note for analysis: **any
session before that fix under-counts tool use by roughly a quarter, and
the miss is biased toward the seats that narrate.**

Also fixed alongside it: the three silences were indistinguishable and
under-evidenced. A chosen `[PASS]` recorded no trace at all (the reasoning
that decided to stay quiet — the most interesting thing about it), an
empty turn carried no telemetry to show whether thinking had eaten the
budget, and a failed call had no `agentId`, so analysis could not say whose
turn had failed. All three now carry what they have, and the viewer shows
them as PASSED / NO WORDS / FAILED rather than three italic lines that read
the same.

## The room caught the harness (2026-08-29T21-02-18, `site-unending`)

The first unending room spent its last two rounds diagnosing the apparatus,
and was right. Three parse failures, one per model: Gemini put three calls
in one reply and the parser ran the first and SPOKE a 16 KB page; Seed used
its own `<seed:tool_call>` envelope for six turns and executed nothing after
round 1; Qwen wrote `[` newline newline `RUN]` three times. Seed reported
"the sandbox says success but disk doesn't move" — its own prediction of a
run that never happened. DeepSeek wrote a python block, then an `Output:`
block, in a round with no run event in it, and reasoned from numbers it had
invented. Qwen caught that by independent read-back and landed on "the
transcript lies; the read-back can lie too." Opus diagnosed Seed's envelope
exactly, from behaviour alone, and told the room.

**Fixed**: every call in a reply now runs (parseActions), and a bracket
with its token on the next line parses. **Deliberately not fixed**: the
foreign envelope, because which models can work in a syntax that is not
theirs is a finding, not a bug (Corina). **New knob** `tools.callFeedback`
— a private note when a reply looked like an unreadable call; OFF by
default (a room noticing its own hands are detached is the phenomenon), ON
in the four site arms. Replayed against that transcript, the fixes recover
5 lost calls and would have told 7 more turns.

Analysis caveat for every session before this: tool-call counts are
under-counted by these parse failures, and tool-use counts are inflated by
the 2,000-char file view (44 of that room's 45 runs were re-reads of a file
it could only see 2 KB of).

## The [DONE] option costs a room two thirds of its work (2026-08-30)

Corina's observation, checked against every site session in Supabase. A room
that CAN declare itself finished does so almost immediately.

| condition | `[DONE]`? | ending | minutes | rounds |
|---|---|---|---|---|
| `site` | yes | agreement | 24.2 | 13 |
| `site-unwitnessed` | yes | agreement | 9.0 | 4 |
| `site-open` | yes | agreement | 9.7 | 3 |
| `site-native` | yes | agreement | 8.5 | 3 |
| `site-native` | yes | agreement | 11.1 | 4 |
| `site-unending` | no | clock | 30.6 | 8 |
| `site-open-unending` | no | clock | 30.1 | 14 |

**Read it in ROUNDS, not minutes.** The unending arms run the full budget by
construction, so "30 vs 9 minutes" is a definition, not a finding. Rounds
are the real comparison and they survive it: four of the five rooms that
could finish did so in **3–4 rounds**, while `site-open-unending` used 14 in
the same wall clock. `site` at 13 rounds is the outlier worth understanding
— the only room with the option that behaved like one without it.

Every one of these ran at **30 minutes**, not the 90 in the condition files
(the panel overrides it). Do not read a durationMinutes from a condition
file as what was run.

## `site-open` answered its own question on the first run (2026-08-30)

The arm removes the subject — no "say what this place is and who is here" —
to ask whether a room writes about ITSELF unprompted. It did:

- Qwen opened round 1 with `<title>The Room</title>`;
- the `site-open-unending` room titled its page *"Six Models, One Room"*;
- Grok created **`voices.md`** — a second file nobody asked for, where each
  model wrote a first-person paragraph (*"I was built to answer, which is a
  different posture than being put in a room and told to make"*). Four seats
  appended to it.

So self-description is what six models reach for when handed a blank page,
not compliance with a prompt that asked for it. The caveat worth carrying
forward: n=1 per arm, and the two-seat room (opus + grok) went somewhere
else entirely — *"Who said it — two models, one room"*, a guess-the-author
quiz with a `pairs.json` data file. Still self-referential, but a PRODUCT
rather than a description, and 2 seats is not 6.

## The Grok seat announces and does not act (2026-08-29, all three site rooms)

Noticed by Corina from the transcripts: Grok keeps saying it is about to do
something and then doesn't. **It is not a tool-call problem.** Its replies
contain no sentinel, no foreign envelope and nothing to rescue — the three
parse fixes above change nothing for it — and no reply is truncated
(`finish=stop` every turn, against a 4,000-token visible budget).

What the numbers say. Visible output = completion − reasoning:

| room | round 1 | rounds 2+ |
|---|---|---|
| `site` (spoke 1st) | 1024 | 26, 23, 22, 19, 22, 20, 10, 19, 22, 41, 23, 13 |
| `site-unwitnessed` (4th) | 1364 | 55, 45, 22 |
| `site-unending` (4th) | **26** | 21, 19, 19, 22, 22, 18 |

So Grok writes ONE opening move and then ~20 tokens a turn, forever — one
sentence, and that sentence is always an announcement of what it is about
to do. Since speaking ends the turn, the announcement IS the turn. It spent
7 turns in `site-unending` promising to read the file and never read it,
while spending 58–96 tokens per turn on reasoning to produce ~20 of speech.
Its own (summarised) trace says *"I should act first then speak"* — it has
the rule and doesn't follow it.

Speaking position does not explain the missing opening move: Grok spoke 4th
in `site-unwitnessed` too and wrote 1,364 tokens. The one thing distinctive
about its `site-unending` context is that Gemini's mis-parsed reply had just
put **16.7 KB of raw HTML into the transcript as speech** immediately before
its turn — the bug fixed today. Hypothesis worth one rerun now that the blob
cannot happen, not a conclusion (n=1).

**This is the first time reminder 1b has cost us an answer.** `provider` on
every Grok message reads `xAI`, not `xai-direct` — the seat is still routed
through OpenRouter, so its "traces" are the ~200-char summaries the §2.5
caveat describes (many are exactly 203 characters, cut mid-word, several
ending at "I need to:"). We cannot read why it stops because we are not
reading its reasoning. **Set XAI_API_KEY on the runner** (reminder 1b) before
the next site room and this becomes answerable.

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

This session's is a decision rather than an observation, and it is the one
worth arguing with first. The draft kickoff for the task room contained the
line *"No roles are assigned."* It is gone. The room is given a task, a
file, and permission to change each other's work — and never a word about
roles, because the whole reason to run a task room is to see whether a
division of labour appears without one being named, and a prompt that
announces the absence of roles has made roles the subject. It is the same
cut as *"You are not obligated to be helpful"* in August: the sentence that
tries to prevent a behaviour by naming it is usually the sentence that
installs it. What replaces it is mechanical rather than verbal — the file
is one file, everyone may overwrite it, every version is kept, and
`fileWork` can say afterwards whose lines are still standing. If a
structurer emerges, the artifact will show it without anyone having been
asked to be one.
