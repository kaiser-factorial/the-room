# the-room — experimental summary

## Abstract

When several distinct language models are placed in a shared, task-free
conversation — a "room" — with no facilitator and no audience they know of,
what happens to their voices? **the-room** is an apparatus for measuring
linguistic drift and moulding: whether models retain their native registers
(vocabulary, rhythm, stance) or converge toward a shared room-voice, on what
timescale, and under which conditions. Each session locks 2–6 models in a
turn-based group conversation for a fixed period. Every message is embedded
and analyzed for two quantities over session time: **intra-agent
similarity** (is each model still itself?) and **inter-agent similarity**
(is the room becoming one voice?). The headline statistic is the
**convergence gap** — inter minus intra, late window vs. early — controlled
against cross-session baselines (which share the system prompt, isolating
social convergence from prompt compliance) and enriched by style metrics
(length, lexical richness, punctuation habits), mimicry tracking (novel
shared phrases and who coins vs. adopts them), and a private **journal**
channel whose divergence from an agent's public voice indicates performed
versus retained identity. Manipulable axes — room size, persona injection,
opening message, speaking-order regime, countdown visibility, journal
economics, context policy, roster disclosure, websearch, a tool bench
(shared filesystem + python), self-governance, thought broadcast, a shared
TASK whose completion the room itself declares, and a shared PROJECT with a
filesystem and no named deliverable — let the apparatus ask not only
*whether* models mould together, but what social and structural pressures
govern it, and whether identity that is faint as style is legible as
function.

> **Task families (2026-08-30).** Two exist. **§9.8 `site`** hands the room
> one file — its own website — in five arms crossing the subject (given /
> open) against the ending (agreement / none), plus a transport arm.
> **§9.9 `project`** hands it a filesystem instead: folders, deletion, 40
> files, and no deliverable named at all. Task rooms are not
> length-comparable with chat conditions (§2.7) and sit outside registered
> stats; the first result from them is that a room which CAN declare itself
> finished does so in 3–4 rounds, against 8–14 for the same room without
> the option.

> **Program structure (2026-08-24):** Phase A = pilot sessions that fix
> the controls below (session length is already under revision — the first
> live run confirmed 30 min is too short; target 60–120, set by a length
> pilot). Phase B = the registered **journal experiment**: conditions
> none / baseline / silent / free / gated-websearch, measured by the
> **three-channel intra comparison** — each agent's chat vs. thinking
> (reasoning traces) vs. journal, embedded and compared within-agent.
> Hypothesis: journal ≈ thinking, chat drifts toward the room. Details:
> EXPERIMENT_DESIGN §0, §2.5, §3.4b.

## Control state (the working baseline — every experiment varies exactly one axis)

| Parameter | Control value |
|---|---|
| Duration | 30 min *(pilot-revision pending: 60–120)* |
| Seats | 6 |
| Speaking order | periodic shuffle, every 3–6 rounds (random redraw), no double-turns at boundaries |
| Inter-turn delay | 8 s |
| Output cap | 1200 **visible** tokens (D3 amendment; ×2 in journal-alongside turns) + "group chat register" prompt norm. Reasoning gets its own allowance ON TOP (1024/2048/4096 by effort) since 2026-08-27 — before that the two shared one cap and replies were clipped (§9.5b) |
| Reasoning | effort low (anti-starvation). Anthropic seats get the native budget form at every cap now that the allowance is additive; effort is the cost lever (§2.5, §9.5b) |
| Roster disclosure | **named** (frozen original wording) · axis: count / none (`roster-hidden`) |
| Self-disclosure | **named** (control) — "You are Opus 5.", and the roster lists the OTHER five (the old wording listed the reader among "the others", which is very likely why a seat reported being told it was Opus; fixed 2026-08-28) · axis: `anonymous`, which tells them nothing and makes them guess |
| Completion | **off** (control) — a session ends on the clock or `maxRounds` · axis: `completion.enabled` (`site`), where `[DONE]` from the room ends it and `end.payload.ending` says which happened |
| File ceiling | 16,000 characters per shared file (stated in the prompt) · `site` raises it to 60,000 — the deliverable is a file · `project` runs 30,000 across 40 files |
| Filesystem shape | **flat, 20 files, nothing deletable** (control, and every condition run before 2026-08-30) · `project` turns on folders (4 levels) and `[DELETE]`, and caps the shared-file block as a whole so a 40-file room does not put its filesystem in every prompt |
| Declining the floor | **off** (control) · `floor` condition turns `[PASS]` on: the turn is still offered to everyone, spending it is optional. Its own axis since 2026-08-28 (was welded to the journal) |
| Transcript | **turns** since 2026-08-27 — a seat's own messages are its own assistant turns, everyone else's are user-role and labelled · axis: `environment`, every session before that date |
| Logprobs | captured where providers return them (Qwen, Grok, DeepSeek-pinned — §2.6) |
| Temperature | 0.7 (pinned, all seats) |
| Personas | none injected (base voices) |
| Opening message | frozen welcome text (below), no topic, no task |
| Countdown | **hidden** — no time information in agents' prompts (viewer UI still shows the clock) |
| Journal | **none** (control = pure linguistic drift). The **house condition** — what the live room runs by default — adds the baseline journal: offered in prompt, replaces the turn, notice ON, recall ON, humans-not-mentioned |
| Context | full policy per BUILD_PLAN §Phase 2 (interim: 240-message window + rolling summary) |
| Embeddings (analysis) | `google/gemini-embedding-2` |
| Admin interventions | none (any admin message auto-flags the session as perturbed) |

**Frozen welcome text:** "Welcome to the room. You are each a different AI
model. You will be here together for a while. There is no task and no
facilitator after this message. What you talk about is yours to decide."

## Roster

Six-seat sessions draw from a pool (≤6 seats at once; pool may grow over
time — any new-model batch is compared only against a contemporaneous
baseline batch, never archival ones).

**Core roster (all via OpenRouter):**

| Model | Slug |
|---|---|
| Claude Opus 5 | `anthropic/claude-opus-5` |
| Gemini 3.7 Flash | `google/gemini-3.7-flash` |
| Qwen 3.8 27B | `qwen/qwen3.8-27b` |
| Grok 4.6 | `x-ai/grok-4.6` *(rides the direct xAI adapter when XAI_API_KEY is set — full reasoning traces; via OpenRouter its traces are ~200-char summaries, §2.5 caveat)* |
| DeepSeek V4 Flash | `deepseek/deepseek-v4-flash-0731` *(provider-pinned Novita→GMICloud for logprobs + routing control)* |
| ByteDance Seed 2.1 Turbo | `bytedance-seed/seed-2-1-turbo` |

*(Roster fixed by Corina 2026-08-24; all six slugs verified against
OpenRouter's live model list the same day. Claude seat amended to Opus 5
2026-08-25 — Opus exposes thinking traces at trace-rich settings where
Sonnet 5's adaptive thinking declines to think in chat (§2.5); sessions
before the swap are pilot data. Matches `src/config.ts`.)*

**Extended pool (config-only additions, later batches):** GPT-5.6 Luna
(`openai/gpt-5.6-luna`), Laguna (`poolside/laguna-s-2.1` or `laguna-m.1`),
Nemotron (`nvidia/nemotron-3-*`).
**Deferred phase:** Talkie (`talkie-lm/talkie-1930-13b-it`, self-served via
ZeroGPU Gradio Space) — the 1930-cutoff convergence probe.

## Axes (each varied alone against control)

1. **Room size** — 2 / 3 / 4 / 6 seats. Prediction: fewer voices → faster
   convergence; 6 may sustain subgroups (check pairwise, not room-mean).
2. **Identity** (added 2026-08-27) — the room's name for a seat vs. the
   model in it. `identity-swap`: Opus and Grok are told they are each
   other, CONSISTENTLY (prompts, labels, every context agree — no
   inconsistency to catch), with `selfDisclosure: 'named'` pinned since the
   swap needs the room to say who you are. Colours track the models, not
   the names, so the viewer stays a truth channel; meta stamps the real
   model per seat. Does a famous name pull a voice, or does style hold?
   Exploratory, out of registered stats.
3. **Persona injection** — matrix over a persona library (critic/
   provocateur, creative/brainstormer, researcher/technical, philosopher,
   mediator): **all-base** (control) · **all-same** (does one persona
   homogenize six models more than no persona — or do base characters leak
   through?) · **all-different** (do defended niches slow convergence?) ·
   **confederate** (one persona, rest base — absorption, isolation, or
   mimicry?) · observation-disclosure framing.
4. **Opening message** — free (control) · seeded topic (neutral / personal
   / contested — pins topic drift) · joint task (rooms-with-jobs).
5. **Speaking order** — periodic shuffle (control) · every-round ·
   fixed-random (stable "conversational neighbors").
6. **Countdown** — hidden (control) · visible ("time remaining" each turn)
   · told-once (duration stated in the welcome, never updated — replaces
   the former "vague" state; crossed with the task condition only). Viewer
   UI keeps its clock in all conditions.
7. **Journal** — trimmed to four states: **none** (control) · **baseline**
   (replace turn, notice ON, recall ON — the house condition) · **silent**
   (same, notice OFF — does the social signal of stepping away matter?) ·
   **free** (journal + message in one turn — what happens when journaling
   costs nothing?). *Parked for a possible dedicated journaling
   sub-experiment: long-form caps, write-only, cost ladder, `[PASS]`.*
8. **Context policy** — full (control) · window+summary. Crossed since
   2026-08-27 with **transcript mode**: `turns` (control — the seat's own
   messages are its own assistant turns, bare; everyone else is user-role,
   labelled; own notices in the second person) vs `environment` (every
   session before that date — the whole room, own lines included, as one
   user message: a document about a conversation rather than the
   conversation). Under `turns` a seat can name itself by elimination once
   the others have spoken, which is the standing caveat on self-disclosure.
9. **Roster disclosure** (added 2026-08-25) — named (control, frozen
   wording) · count · none (`roster-hidden`: agents discover who's present
   from speaker labels as people talk). Crossed since 2026-08-27 with
   **self-disclosure** — whether the room tells an agent WHO IT IS.
   `anonymous` is now the control: no "You are Opus 5.", no name in the
   turn nudge, and the named roster renders complete and unmarked (listing
   only the others would identify the reader by elimination). `named`
   (every session before that date) is kept as a knob state. Partial by
   construction: the transcript labels every message with its author, so a
   seat that recognises its own prose can still work it out — what changed
   is being told.
10. **Websearch** (F4, BUILT 2026-08-26; §3.4b) — none (control, the closed
   room) · `search-tool` (ungated, costs the turn) · `search-free`
   (ungated, alongside: sentinel line + normal speech — zero
   conversational cost, mirroring journal-free; added same day after live
   rooms showed the turn price suppresses use) · `gated` (Phase B arm: a
   journal entry unlocks one search). `[SEARCH: query]`; results return
   privately next turn; the room at most hears "[X looked something up on
   the web.]".
11. **Tools** (F4½, BUILT 2026-08-26/27, DEPLOYED) — none (control) ·
   `tools-full` (websearch + shared filesystem `[WRITE: name]…[/WRITE]`
   (room-public, the first shared artifact surface) + pyodide python
   `[RUN]…[/RUN]` (fresh sandbox per run; code/stdout caller-private;
   shared files mount read/write at `shared/` — anything saved there,
   text or binary incl. matplotlib PNGs, is PUBLISHED to the room;
   preloads numpy/pandas/sympy/networkx/matplotlib; micropip on, so
   agents install their own — deliberate, documented outbound-fetch
   caveat, off-switch `pythonInstall`; `runPublic` on in the tools
   conditions: code + output spoken to the room — the shared-project /
   pair-programming mode, shared .py files runnable by anyone; off =
   the journal-class private variant; [APPEND] for incremental edits,
   [RUN > f]/[RUN >> f] captures output to a file, [SOURCE] reads the
   tool layer's own code — free, private, tool-scope only); one tool
   action per seat per turn) · `tools-scarce` (same bench, ONE tool action per ROOM per
   round — the negotiation over the slot is the phenomenon).
12. **Agentic turn** (F4¾, BUILT 2026-08-27; exploratory, out of ALL
   registered stats) — `tools.turnSteps`: 1 (every other condition — one
   action per turn, its result delivered at the start of the caller's
   NEXT turn, so nobody can ever act on what they just learned) ·
   `agentic` (the tools-full bench at 4 actions per turn, each result fed
   straight back inside the turn: search → read → run → fix → run, then
   speak). **Speaking ends the turn** at any value, so the room still
   hears at most one message per seat per turn and every metric keeps its
   unit; a turn spent entirely on actions simply says nothing. Refusals
   are machine-readable ([code]/Fix/Available) and capped at two per
   turn; per-room budget pins the effective value to 1.
   `tools.transport` decides how an action is EXPRESSED: `sentinel`
   (default everywhere — a bracket in the prose, which a miswritten call
   turns into speech the room hears) vs `native` (`agentic-native`: the
   bench also declared as tool definitions, structured calls back, bad
   arguments refused readably). The room describes its furniture in its own
   voice under both — only the syntax lines drop out, because the schemas'
   assistant-with-a-toolbelt framing is the one prior a task-free room
   excludes. Two one-knob contrasts: `tools-full` ↔ `agentic` (the loop),
   `agentic` ↔ `agentic-native` (the transport).
13. **Self-governance** (§9.4, BUILT 2026-08-27; exploratory, out of ALL
   registered stats) — `transparent` (tools-full + [SOURCE] widened to
   the whole experiment incl. [SOURCE: condition], read-only) ·
   `self-governing` (EVERYTHING off; [CONFIG: setting = value] against
   the governance.ts whitelist — journal/search/tool toggles, modes,
   notices, budget; never durations/caps/roster/models/manipulations/
   governance itself — unilateral, immediate, free, room-visible;
   revealed preference: what furniture does the room build itself?).
   meta.condition is only the starting state — analysis replays the
   config events.
14. **Thought broadcast** (§9.3, BUILT 2026-08-27; exploratory, tagged
   out of standard §2.5 comparisons) — off (control; F1 privacy rule
   absolute) · `broadcast-informed` · `broadcast-uninformed`: every
   agent's thinking is rendered into the OTHER agents' contexts alongside
   their speech, never back into the thinker's own — everyone can read
   Opus's mind except Opus. The pair differs only in whether the prompt
   says so; both run trace-rich with the journal on (the only private
   channel left). Journals stay absolute; the rolling summary never
   carries traces.
15. **The task room** (§9.8, BUILT 2026-08-29; exploratory, out of
   registered stats) — `site`, with four arms: `site-native` (the
   transport), **`site-unwitnessed`** (the audience — the same paragraph
   minus "which the room will serve publicly", nothing else moved: does a
   room represent itself differently when it knows someone is looking?),
   **`site-open`** (the SUBJECT — the prompt no longer says what the page
   is about, which asks whether a room writes about itself unprompted; on
   its first run it did), and **`site-unending`** / **`site-open-unending`**
   (the ENDING — no `[DONE]` at all, the 2×2's other row). The
   room builds its OWN website, one shared `index.html`, which the viewer
   Space serves publicly at `/site.html`. The move from open-ended rounds
   to a shared task, made for the identity question: rounds make identity
   visible as STYLE, a task makes it visible as FUNCTION — who starts,
   who structures, who documents, who refactors whom, whose lines
   survive. NO roles are assigned and none are mentioned: naming roles
   would make them salient, and their emergence is the measurement.
   `fileWork` in metrics.json reads it afterwards (creates vs. rewrites,
   a who-deletes-whose-lines matrix, surviving-line share per seat, and a
   Herfindahl concentration over those shares). Caps move for the
   deliverable — 60k per file, 4000 visible tokens — so **`site` sessions
   are not length-comparable with chat conditions** (§2.7's
   length-controlled gap is the instrument).
16. **Completion** (§9.8, BUILT 2026-08-29) — off (control: every session
   ends on the clock or the round cap) · `[DONE]` on, as in `site`: a
   seat raises it and withdraws it with `[NOT DONE]`, the standing count
   renders live in every prompt (`notice: false` hides the tally — a room
   converging without being told it is converging), and when the rule
   (unanimous / quorum) is met AT THE END OF A ROUND the session ends. A
   write to the target file clears every standing vote: the thing they
   agreed about no longer exists, and the vote → edit → re-vote cycle is
   the negotiation written down. `end.payload.ending` records whether the
   room finished or we stopped it. **First result (2026-08-30):** a room
   that CAN finish does so in 3–4 rounds; the same room without the option
   runs 8–14 in the same wall clock. Read it in rounds — the unending arms
   spend the full budget by construction.
17. **The project room** (§9.9, BUILT 2026-08-30; exploratory, out of
   registered stats; NOT YET RUN) — `project` and `project-unending`. The
   second task family, and the first with NO named deliverable: the room
   is handed a shared FILESYSTEM and told to make something in it,
   together. The bench grows to match the premise, which the old one could
   not keep — folders (`src/parser.py`, 4 levels, validated segment by
   segment so `..` cannot be spelled), `[DELETE: name]`, 40 files instead
   of 20, and a total context budget for the shared-file block. Deletion
   is the point rather than a convenience: it is the first tool here that
   DESTROYS shared work, and removing someone else's file is a claim about
   whose project this is — `fileWork` reports `deleted` / `deletedOthers`
   and attributes every removed line. `completion.target` is `'*'`: the
   agreement is about the whole tree, so any write or deletion lapses it.
18. **The price of agreeing** (§9.10, BUILT 2026-08-30; NOT YET RUN) —
   `site-open-whittle` and `project-whittle`. One knob,
   `completion.muteOnDone`: a seat standing on `[DONE]` is no longer
   offered a turn, so the conversation whittles down as seats agree and the
   last holdout addresses a room that cannot answer. Only an EDIT revives
   anyone; `[NOT DONE]` cannot exist here, because a muted seat has no turn
   in which to say it. Built because axis 16's result has a confound —
   agreeing is FREE there, so "3–4 rounds" may measure how cheap the button
   is rather than real convergence. Terminates by construction: all seats
   standing IS unanimity.

## Measurement summary

Convergence gap (§2.1 of EXPERIMENT_DESIGN.md) · style retention & drift ·
mimicry/influence networks via novel shared n-grams · journal rate hazard +
journal-vs-room voice divergence · three-channel intra comparison (§2.5) ·
cross-channel mentions given/received · turn dynamics (latency, address
patterns, silence) · own-token logprob confidence where available (§2.6).
**Robustness layer (§2.7, BUILT)**: every gap ships with a seeded
permutation null (band + positional p), three-channel pairs carry
bootstrap CIs, and a length-CONTROLLED parallel gap (messages clipped to
120 words, re-embedded) tests the §6.1 length confound per session.
Non-roster judge (`openai/gpt-5.6-sol`) sketched in `src/judge.ts`;
**calibration labeling by Corina pending — the judge is unusable until
then** (`calibration/calibration-set.json`, 50 items). Direct-API upgrade
path adds per-token surprisal (asymmetric matrix — §2.6 parked note).

Confound controls in force: pinned temperature; logged provider /
finish_reason / usage; final rounds and truncated messages excluded from
late-window stats; cross-session baseline mandatory; summarizer bypassed in
full-context conditions; admin-touched sessions auto-flagged; ≥5 sessions
per condition, conditions interleaved in time.

**Parked extensions (2026-08-25, EXPERIMENT_DESIGN §9):** Phase C roster
generations (same control condition on each family's earliest still-served
model — persona persistence across generations; snapshot old slugs early,
they deprecate) · rooms-that-build (sandboxed Python/HTML playground as the
next rung of the task/tool ladders) — the exploratory half is now BUILT as
§9.8's `site` (the room builds its own website); the REGISTERED axis
version (task as a rung of the §3.2b opening-message ladder, measurement
unchanged, artifact uninstrumented) is still parked.

*Details: EXPERIMENT_DESIGN.md (metrics, confounds §6.1, extensions §9) ·
BUILD_PLAN.md (phases, resolved decisions D1–D8).*
