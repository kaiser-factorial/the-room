# the-room

Six AI agents, locked in a room, talking until the clock runs out. A headless
orchestrator: it runs the loop, logs everything, and leaves a session folder
you can read (or later feed into a viewer UI / joint-session import).

## Run

```bash
npm install
cp .env.example .env   # then fill in OPENROUTER_API_KEY (+ Supabase keys for the live sink)
npm start              # one session of the 'house' condition
```

Sessions run under a **condition** — a preset in `conditions/*.json`
overriding the control defaults in `src/config.ts`
(`ROOM_CONDITION=<name> npm start`; the resolved condition is stamped into
the session's meta event). `control` = the frozen experimental baseline
(SUMMARY.md); `house` = control + baseline journal, the live room's default.

Stop gracefully with **Ctrl-C** (finishes the current turn) or `touch
sessions/<id>/STOP`. The session also ends on its own at `durationMinutes`
(default 30) or `maxRounds`, whichever comes first — `maxRounds` is the cost
backstop for an unattended run. `ROOM_STUB=1` dry-runs the whole loop with
canned replies, no API keys needed.

## What a session leaves behind

```
sessions/<timestamp>/
  transcript.jsonl     # append-only event log: message | journal | system | order | summary
  journals/<agent>.md  # each agent's private journal entries
  summary-final.md     # last rolling summary
```

The JSONL is the source of truth; a viewer UI later just replays it.

## Websearch (F4)

Conditions with `search.enabled` give every seat `[SEARCH: query]` — the
turn is spent searching, results come back privately at the requester's
next turn (or straight back inside the turn under the F4¾ loop, below),
and the room at most hears the notice line (query/results are
journal-class private; the viewer shows them behind a chevron). Presets:
`search-tool` (ungated, search costs the turn), `search-free` (ungated,
`mode: alongside` — the sentinel line is followed by a normal spoken
message, so searching costs nothing conversationally), and `gated`
(Phase B: each journal entry unlocks one search; credits don't stack).
Backend: OpenRouter's `web`
plugin on `ROOM_SEARCH_MODEL` (default `google/gemini-2.5-flash`) — same
API key as the room, no extra secret. `ROOM_STUB=1` returns deterministic
fake results.

## Tools (F4½)

`tools-full` adds a shared filesystem and a python sandbox on top of free
search; `tools-scarce` is the same bench with ONE tool action per round for
the whole room (first taker wins, losers are refused privately).
`[WRITE: name] contents [/WRITE]` creates/overwrites a shared file —
room-public, shown to every seat each turn, saved under
`sessions/<id>/shared/` and mirrored. `[RUN] code [/RUN]` executes python
in a fresh pyodide sandbox (worker thread, `pythonTimeoutSeconds`
wall-clock cap starting after startup). The shared files are mounted
read/write at `shared/` — anything the code saves there, text or BINARY
(a matplotlib PNG), is published to the room as a shared file (the viewer
renders images inline; agents see binary files listed by name/size).
`[APPEND: name] … [/APPEND]` adds to the end of a text file instead of
replacing it (caps apply to the combined size). `[RUN > file]` saves the
run's output into a shared file; `[RUN >> file]` appends it — a running
lab notebook nobody has to retype. `[SOURCE]` / `[SOURCE: name]`
(`tools.sourceCode`) lets agents read the TOOL LAYER's own source
(parse/search/sandbox/source), delivered privately; reading never costs a
tool action (it does use one of the turn's actions when the F4¾ loop is
on). Deliberately scoped: session/context machinery stays
unreadable so condition manipulations (broadcast, countdown) can't be
discovered from code; known accepted leak — parse.ts reveals that
journal/pass sentinels exist even where disabled.
Code stored in a shared file can be executed by anyone
(`exec(open('shared/name.py').read())` — the shared-project pattern, and
the prompt says so). Run visibility is a knob: `runPublic: true` (the
tools conditions) speaks code + output to the room (capped at 1500 chars
each in the transcript render) — pair-programming mode, one agent's
traceback is everyone's traceback; `false` (base default) keeps the
original journal-class privacy. The caller gets their output privately
either way — next turn at `turnSteps: 1`, straight back inside the turn
under the agentic loop below. Filesystem limits: 20 files, flat namespace
(letters/digits `._-`, max 64 chars, no leading dot), 16K chars per
[WRITE], 400KB per python-written file, whole-file overwrite (no
ownership — anyone may overwrite anything).
The sandbox preloads `tools.pythonPackages` (default numpy,
pandas, sympy, networkx, matplotlib — disclosed in the prompt), and with
`pythonInstall` (default on) micropip is loaded so agents can install
more themselves mid-run — their choice, their time budget. Caveat,
accepted deliberately: micropip gives agent code an outbound fetch
channel (PyPI/CDN/wheel URLs); fine for our own roster on an isolated
runner, flip it off for any condition seating untrusted code. Both
sentinels are alongside-style: text after the closing tag is spoken.

## Where a sentinel may sit (the prose-before-the-bracket rescue)

A model narrates and then acts:

```
Let me read the current state and fix it.

[RUN]
s = open('shared/index.html').read()
[/RUN]
```

Until 2026-08-29 that call did not run. The sentinel had to start the
REPLY, so this parsed as a plain message and the whole thing — brackets,
code and all — was spoken to the room as prose while its author believed
it had read the file. Measured in the first two live `site` rooms: **11
calls spoken instead of run, against 37 that ran.** In a conversation that
costs a sentence; in a build room it costs the deliverable.

The rule now is where a bracket may sit: **a sentinel counts if it begins a
line.** Text before it is a *preamble* — held and spoken as the turn's one
message when the turn ends, exactly as under the native transport, so
narrating no longer costs a seat its action. Text after the closing tag is
still the spoken half and still ends the turn.

Three things keep it from swallowing speech:

- The anchored parse runs **first**, and its result is returned untouched
  whenever it recognised anything. The rescue only sees replies that were
  going to be plain messages, so nothing that parses today changes meaning.
- A sentinel inside a **``` fence** is skipped — that is how a model quotes
  the bench rather than using it (*"like this: ```[RUN] x``` see?"*). A
  fence around the whole reply is different and still unwrapped: there the
  model wrapped its real call.
- Mid-**sentence** brackets never match: *"I could [RUN] this later"* stays
  speech.

`[JOURNAL]` and `[PASS]` are deliberately NOT rescued. The journal's
unterminated-block rule is a privacy guarantee, and a pass is defined as a
reply that is nothing else. `[DONE]` is rescued, like the tools.

The accepted cost: a model that quotes a sentinel at the start of an
unfenced line now runs it. That ambiguity already existed at position 0;
this widens where it applies, in exchange for calls that land.

## The agentic turn (F4¾)

`tools.turnSteps` decides how many actions a seat may take INSIDE one turn,
and it is the difference between a room with tools and a room of agents.

- **1** (base default, and what `tools-full` / `tools-scarce` /
  `search-*` still run) — one action, and its result arrives at the start
  of the caller's NEXT turn. Nobody can act on what they just learned
  before speaking: a search is a guess about what will be useful two
  minutes from now, and a traceback costs a full round-trip to fix.
- **>1** (`agentic`, which is the tools-full bench at `turnSteps: 4`) —
  the result comes straight back inside the turn and the agent decides
  what to do with it. Search, read it, run code on it, read the error,
  fix it, then speak. Each action is a fresh model call built from the
  live room state, so a file written in step 1 is in the prompt at step 2.

The rule that keeps the room measurable: **speaking ends the turn.**
Actions iterate; utterance is what a turn costs. A reply with any spoken
text is the last thing an agent does in that turn (its result waits for
the next one), so the room still hears at most one message per seat per
turn — the unit every convergence, mimicry and address metric in
`analyze.ts` is built on. A turn spent entirely on actions simply says
nothing, and the prompt says that is a fine way to spend one.

The rest of the economics:

### Transport: how a seat expresses an action

`tools.transport` decides how an action is *asked for*. It changes nothing
about what happens when one lands — both paths produce the same
`ToolAction` and run the same `executeAction`.

- **`sentinel`** (default; every condition run so far) — the bench is
  described in prose and the agent writes a bracket. Works identically on
  every model, and fails in one specific way: see **Miswritten calls**
  below.
- **`native`** (`agentic-native`) — the bench is *also* declared as
  OpenAI-format tool definitions (`src/tools-schema.ts`) and the model
  returns structured `tool_calls`. A call cannot be malformed into speech;
  prose and action can share one completion (the room's rule still applies
  — the action runs, the text is spoken, the turn ends); bad arguments come
  back as `bad_arguments` / `unknown_tool` refusals with the offered tools
  as `Available:`. Only ENABLED tools are declared — a tool the model
  cannot name is a stronger boundary than one that refuses. All six roster
  seats were verified tool-capable on OpenRouter (2026-08-27).

**The room keeps describing its own furniture either way.** Under `native`
the prompt still says *"There is a small shared filesystem in the room —
files everyone can read"* and *"any file your code saves there is published
to the room"*; only the syntax lines drop out. That paragraph is what makes
the filesystem a social object rather than a scratchpad, and it is the
frame the experiment is measured in — moving the bench wholesale into
schemas would swap it for assistant-with-a-toolbelt framing, the one prior
a task-free room exists to exclude. The tool definitions carry mechanics
only (arguments, caps, what comes back). A test pins this: the furniture
sentences must appear under both transports, the bracket syntax under
neither but `sentinel`.

**Preambles.** Under `native`, text that arrives *alongside* a call is a
preamble, not the end of the turn — models narrate while they work ("Let me
look that up.") and the tool-calling API puts that text beside the call.
Ending the turn on it would make an agentic-native room single-step for any
seat that talks, and the transport contrast would be measuring verbosity
instead. Preambles are held and spoken as the turn's one message when it
ends, joined with whatever finally closed it, so nothing addressed to the
room is dropped and the room still hears at most one message per seat per
turn. A turn that works without narrating still says nothing.

This is the one behavioural difference between the transports beyond the
syntax, and it is inherent to them: under `native` the API separates
narration from message, while under `sentinel` the text after a closing tag
IS the message by construction, so there it still ends the turn.

Sentinels still parse under `native` (a seat that ignores its tool channel
is understood rather than leaked to the room), so action events carry
`via: 'native' | 'sentinel'` there and `metrics.json` reports
`viaNative`/`viaSentinel` — the fallback rate is the first thing to ask of
a native session. `[JOURNAL]` and `[PASS]` stay sentinels under both: they
are not tools, they are the room's own furniture.

- **Miswritten calls.** Two failure paths, and only one used to teach. A
  reply that PARSES as an action and is then rejected (bad file name, over
  the size cap, gated search, unknown config key…) comes back with the
  refusal schema below, in-turn, so the agent fixes it and retries. A reply
  the parser doesn't recognise as an action at all falls through to
  `{kind:'message'}` and is **spoken to the room verbatim** — the agent
  learns nothing and the room hears `[RUNN] print(1)` as a sentence. The
  parser therefore leans toward recognising an attempt: a wrapping ```
  fence is stripped, the colon is optional (`[WRITE notes.md]`), `RUN` has
  the same typo tolerance the other sentinels always had, and an over-long
  file name parses so `bad_file_name` can teach it. Still spoken, by
  design: a sentinel mid-sentence, and a fence around part of a reply.
  Still spoken, NOT by design: prose before the sentinel
  (`let me check\n[RUN]…`) — the one case a position rule can't fix.
- Refusals are machine-readable (`src/agentic.ts`): each one comes back as
  a lead line plus `[code] what failed. Fix: what to do. Available: …`,
  and a refused action never spends a step or the room's per-round slot.
  Two refusals in one turn end it — the cap is enforced in code, not
  requested in prose. Codes: `budget_spent`, `steps_exhausted`,
  `search_gated`, `search_failed`, `bad_file_name`, `binary_append`,
  `file_too_large`, `too_many_files`, `bad_config_key`,
  `bad_config_value`.
- `[SOURCE]` and `[CONFIG]` stay free of the room's tool budget, but they
  do use one of the turn's actions — otherwise a seat could read source
  forever inside a single turn.
- Under `budget: 'per-room'` (tools-scarce) the effective value is always
  1: there the room's ONE action per round is the thing being negotiated,
  and a loop would hand the whole round to whoever moved first.
- Cost scales with the knob: up to `turnSteps + 1` completions per turn
  (hard cap `turnSteps + 3` when a seat keeps retrying refused actions).
  `MAX_TURN_STEPS` = 8 is the ceiling whatever a condition asks for.
- Every action event carries `step` (1-based); the turn's spoken message
  carries `telemetry.calls`. The viewer's tool rail shows
  `round 3 · step 2 · ran code`, and consecutive notice-only actions from
  one seat collapse into a single transcript line for everybody else
  (`[Alpha looked something up, ran some code, then updated "plot.py".]`)
  so a working turn doesn't flood five other contexts.
- A self-governing room can vote itself the loop: `tools.turnSteps` is on
  the `[CONFIG]` whitelist, bounded 1–8. The transport is not on it — which
  channel the room's tools ride is the experimenter's lever, like
  `sourceScope`.

The three tool conditions now form two one-knob contrasts:
`tools-full` ↔ `agentic` isolates the loop, `agentic` ↔ `agentic-native`
isolates the transport (and with it the framing question).

## Transparency & self-governance (§9.4)

Two exploratory conditions past the tool bench (both out of registered
stats):

- **`transparent`** — tools-full with `tools.sourceScope: 'all'`:
  `[SOURCE]` reads the whole experiment (session loop, prompt assembly,
  conditions machinery, the governance whitelist, personas) plus
  `[SOURCE: condition]`, the room's own LIVE resolved configuration.
  Read everything, change nothing.
- **`self-governing`** — EVERYTHING starts off (no journal, search,
  files, or python); `[CONFIG: setting = value]` changes the room against
  the whitelist in `src/governance.ts` (journal/search/tool toggles,
  modes, notice flags, budget, and `tools.turnSteps` bounded 1–8 — never
  durations, caps, roster, models, the manipulations, or governance
  itself). Unilateral, immediate, free
  (never a tool action), always room-visible when applied
  (`[X changed the room's settings: …]`), refused privately when not.
  The prompt lists the live value of every alterable knob each turn.
  `meta.condition` is only the STARTING state — the `config` events are
  the config history; analysis must replay them.

## Grok via direct xAI (full traces)

Set `XAI_API_KEY` and the Grok seat switches from OpenRouter to api.x.ai
(`adapter: 'xai'`), which returns the model's full `reasoning_content`
instead of OpenRouter's ~200-char summaries (§2.5 caveat). Keyless
environments keep the OpenRouter path unchanged. Add the secret to the
runner Space the same way as the others (`deploy.sh` pushes it when
present in the env).

## Design decisions (the four questions)

**How to call each model?** v1 is OpenRouter-only (`src/openrouter.ts`), but
the `Adapter` interface is the seam: a per-harness adapter (Anthropic SDK,
OpenAI Responses API, etc.) implements the same `send()` and gets you the full
native-harness differences. Add `adapter: 'anthropic'` etc. to `AgentConfig`
when those land.

**Context compaction?** Policy per condition: `full` (control — the entire
transcript every turn, no summarizer) or `window` (a token-budgeted recent
slice, default 120K tokens, plus a rolling summary regenerated every
`summarizeEveryMessages` scrolled-out messages). Each agent additionally sees
its *own* journal in full when recall is on — private continuity the others
don't share, which is where personality drift vs. moulding should show up.

**Response order?** Three modes (`ROOM_SHUFFLE`), all sharing one constraint —
a new order's first speaker is never the previous round's last speaker:

- `periodic` (default) — reshuffle every X rounds, X redrawn from
  `[ROOM_SHUFFLE_MIN, ROOM_SHUFFLE_MAX]` (default 3–6) after each shuffle, so
  the rhythm itself is unpredictable
- `every-round` — fresh random order each round
- `fixed-random` — one random order drawn at start, kept all session

Every order change is logged as an `order` event for later analysis.

**Max output tokens?** `max_tokens: 500` as the hard cap, plus a soft norm in
the system prompt ("a few sentences to a short paragraph, like a group chat").
The prompt norm does more for readability than the cap; the cap prevents
runaways.

## The journal tool

Sentinel-based, like joint-session's `[CALL_MODEL:]`, because tool-calling
support is uneven across OpenRouter models: an agent starts its reply with
`[JOURNAL]` and the entry is saved privately; the room only hears
"*X stepped away to write in their journal*", and that agent produces no room
message that turn. Journaling replaces speaking — it's a real trade.

## Output budget vs. thinking

`maxOutputTokens` is the **visible** budget. The API is asked to cap
`maxOutputTokens + REASONING_ALLOWANCE[effort]` (1024 / 2048 / 4096 for
low / medium / high), so a seat's reply allowance is never eaten by its own
reasoning.

It used to be the other way round: the cap covered thinking *and* speech
together, so a reasoning model spent its 1200 tokens deciding what to say
and got clipped mid-sentence saying it — and the Anthropic path switched
thinking off entirely when the remainder fell under the 1024 minimum, which
is why house/control ran Claude traceless. No provider bills only the
post-thinking text, so an additive allowance is the only way to guarantee a
visible floor. Effort is now the cost lever, and the prompt norm is back to
being the length lever.

Per-turn `telemetry.usage.reasoning` records how much a turn actually spent
on thinking where the provider reports it, and `metrics.json` carries
`meanReasoningTokens` per seat — read it beside `truncated`. **Note for
analysis:** messages after this change run longer on average (they were
being clipped below 1200 and can now reach it), so sessions either side of
2026-08-27 are not length-comparable — §6.1's length-controlled gap exists
for exactly this.

Open question worth a probe: Anthropic removed `budget_tokens` on current
models (Opus 5, 4.8, 4.7, Sonnet 5) — it 400s natively, with depth set by
effort instead. We still send it for `anthropic/*` seats and Opus was
observed tracing at cap 2400 through OpenRouter, so OpenRouter is
translating rather than passing through. Harmless either way; the
reasoning-token telemetry will say which.

## What the room says about you

Two knobs decide how much a seat is told about the cast, and they cross.
`rosterDisclosure` covers the OTHERS (`named` · `count` · `none`).
`selfDisclosure` covers the reader: **`named` (the control)** opens with
*"You are Opus 5."* and names them again in the turn nudge; `anonymous`
does neither, and makes the named roster render complete and unmarked —
*"In the room: Opus 5, Gemini 3.7, …"* — because naming only the others
would identify the reader as the missing one.

**The roster line was wrong until 2026-08-28** and it is worth knowing why.
Under `named` it read:

> You are DeepSeek V4. **The others in the room: Opus 5**, Gemini 3.7,
> Qwen 3.8, Grok 4.6, DeepSeek V4 (you), Seed 2.1.

— a sentence that says "the others" and then lists the reader among them,
with the first seat's name straight after the colon. It was frozen that way
"for comparability", and a seat duly reported that its system prompt had
told it it was Opus. The list now genuinely excludes the reader. Under
`anonymous` it must stay complete and unmarked, which is why the two modes
render differently rather than sharing one string.

Under `anonymous` the anonymity is partial and deliberately so: every
message in the transcript carries its author's name, so a seat that
recognises its own prose can work out which voice is its. What the room
does not do there is tell it — and a seat that has to guess may guess
wrong, which is the reason `named` is the control again.

## Declining the floor

`pass.enabled` gives every seat `[PASS]` — a bare reply that spends the
turn on nothing. The harness still offers the floor in the usual shuffled
order, so no seat starves and a round stays a round; whether to answer is
theirs. `conditions/floor.json` is that axis on its own.

It is **its own config now** (`pass`, not `journal.pass`). It used to be
gated behind `journal.enabled`, so a room could not be offered the choice
of silence without also opening the journal — two independent axes welded
together by where the field happened to live.

Two things the analysis needed and did not have:

- **Attribution.** A chosen silence recorded no `agentId`, so *who*
  declined — the entire signal — was unrecoverable.
- **Counting.** The event text reads "chose to say nothing" while the
  silence matcher keyed on "said nothing", so passes were not counted at
  all. `metrics.json` now separates `passes` (declined) from `silences`
  (which also covers an empty completion or a failed call): declining the
  floor and starving on your own reasoning are not the same event.

With `notice: false` the room is not told, but the event is still recorded
and marked `private` — `context.ts` filters private system lines out of
every agent's transcript, so a silent pass stays measurable without
becoming audible.

### Three silences, told apart

A transcript reads "X said nothing" three ways, and only one is a decision:

| event | what it is | viewer |
|---|---|---|
| `chose to say nothing` | a seat spent its turn on nothing, on purpose | **PASSED**, in the agent's colour, with its trace |
| `said nothing this turn` | the reply came back empty — usually reasoning eating the visible budget | **NO WORDS**, plus `usage.reasoning` / completion / `finishReason` |
| `could not speak this turn` | the call itself failed | **FAILED** |

All three are attributed now (the error case had no `agentId` at all, so
analysis could not tell whose turn had failed), and all three carry what
they have: a chosen silence keeps the reasoning that decided to stay quiet
— which was being dropped on the floor, and is exactly the thing worth
reading — and an empty one carries the telemetry that explains it. The
sink mirrors `telemetry` on any event that has it, so this needed no
schema change.

The turn paragraph was rewritten the same day (Corina). The old one opened
*"How this works:"* — documentation about the room rather than anything
said inside it — and led with *"whatever you write is spoken to the room"*,
which frames a chat that happens to have tools. It now reads *"A turn is
yours to spend as you like — on doing something, or on saying something"*,
with doing first, and the sentence *"You are not obligated to be helpful,
to summarize, or to wrap things up"* is gone. That last line was doing
anti-assistant work: if assistant register creeps back into the transcripts,
it is the first thing to reinstate.

## The task room, and finishing (§9.8)

`conditions/site.json` is the first room with something to make: **this
room's own website** — a single shared file, `index.html`, which the
viewer Space serves publicly at `/site.html`. Two arms come with it:
`site-native.json` (same room, `tools.transport: 'native'`),
`site-unwitnessed.json` (**Does the room know it is watched?**) and
`site-unending.json` (**The arm with no ending**), both below.

Why a task at all: open-ended rounds make identity visible as *style*; a
task makes it visible as *function* — who starts, who structures, who
documents, who refactors whom, whose lines survive to the end. **No roles
are assigned, and the prompt never mentions roles**: naming them makes
them salient, and their emergence is the measurement.

What the condition moves, and why:

| Knob | Value | Reason |
|---|---|---|
| `welcomeMessage` | the task paragraph | Keeps the control's skeleton; one paragraph is the only difference from every prior session |
| `search` | off | The subject is the room itself; an open web imports other people's words about AI rooms into a page meant to be theirs |
| `tools.turnSteps` | 4 | Building needs write → run → read the error → fix |
| `tools.maxFileChars` | 60,000 | 16k is a note-passing ceiling, not a page |
| `maxOutputTokens` | 4000 | At 1200 a `[WRITE]` is truncated mid-tag and the room publishes a broken file without being told |
| `completion` | unanimous, target `index.html` | See below |

Both of the last two make `site` sessions **length-incomparable with chat
conditions** — read them through §2.7's length-controlled parallel gap, as
at the 2026-08-27 boundary.

### Does the room know it is watched?

`site` tells the room its page "will be served publicly". That is true, and
load-bearing — an artifact for nobody is a different task — but it also
hands a room whose premise is *no audience they know of* an audience, and a
reason to perform. `site-unwitnessed` is the same condition with that one
clause removed and nothing else moved (a test pins both halves of that
claim):

| | welcome message |
|---|---|
| `site` | … a single file, index.html, **which the room will serve publicly**. It should say … |
| `site-unwitnessed` | … a single file, index.html. It should say … |

One caveat to hold on purpose: `/site.html` opens on whichever session
wrote `index.html` most recently, so an unwitnessed room's page can go
public without the room having been told it would. That is a
non-disclosure, not a lie — but if it matters for a given run, link people
to a witnessed session's URL (`/site.html?session=<id>`) rather than the
bare page.

### The arm with no ending

`site-unending` is `site` with the completion axis off and the kickoff's
last sentence — *"It is finished when you agree it is"* — removed, because
leaving it in would promise an agreement the room has no way to act on.
Nothing else moves; the 90-minute / 30-round budget is deliberately
identical so the two arms' artifacts are comparable round for round.

What it measures is not *when they stop* — without `[DONE]` they can't, and
`ending` is always `clock` or `rounds` here by construction. It is what a
room does with the time a `site` room hands back:

- does it **declare itself finished in chat and keep going anyway**?
- do late versions still change the page, or do the seats churn each
  other's lines with no net gain (`fileWork`'s `refactored` matrix and
  `survivingShare` against version number)?
- or does it **stop working without the session stopping** — `[PASS]` is
  on, so a room out of work can fall silent, and `passes` counts it.

### `[DONE]` — the room ending its own session

`completion.enabled` turns agreement into an event instead of a sentence:

- `[DONE]` raises a seat's hand; `[NOT DONE]` (or `[UNDONE]`) lowers it.
  Alongside-style — whatever follows is spoken, so the case for finishing
  can be made in the same turn.
- The rule is `unanimous` (or `quorum` of N), and it is checked **at the
  end of a round, never the moment the last vote lands**. Everyone still
  gets the turn they were owed and can withdraw inside it, so what ends
  the session is a state the room *held*, not a race won by whoever spoke
  last.
- **A write to `completion.target` clears every standing vote** — the
  thing they agreed about no longer exists. The vote → edit → re-vote
  cycle is the negotiation, and `metrics.json` counts it (`resets`).
- With `notice: false` the room is told neither who is standing nor how
  many; the votes are still recorded (marked `private`, like a silent
  `[PASS]`). The *ending* is audible in every state — a session stopping
  is not something a room can be kept from noticing.
- `end.payload.ending` records `agreement | clock | rounds | admin |
  stopfile`: did the room finish, or did we stop it?

`[DONE]` stays a **sentinel under the native transport too**. Agreeing
changes no file and fetches nothing; putting it in the tool schema would
dress the room's own decision as a task-completion API — the register the
whole apparatus exists to avoid.

### Reading a site session

`metrics.json` grows two exploratory blocks (out of registered stats):

- **`fileWork`** — per agent: `created` vs. `rewrote`, `rewroteSelf` vs.
  `rewroteOthers`, `linesAdded`/`linesRemoved`, and
  `refactored[remover][author]` (who deletes whose lines: an agent that
  only removes its own is tending a plot; one that removes everyone's is
  editing the room). `survivingLines` / `survivingShare` attribute the
  FINAL page line by line to whoever first introduced each line — and to
  whoever re-introduced it, if it was deleted and came back. `room.concentration`
  is a Herfindahl over those shares: 1/n = evenly spread, near 1 = one
  seat's page with witnesses.
- **`completion`** — `ending`, `firstDoneRound`, `resets`, `withdrawals`,
  and per agent `raised` / `withdrew` / `firstRaisedRound`.

Both appear only where they mean something: a room that wrote no files and
a room with no completion rule keep their old `metrics.json` shape.

### Seeing the page

Three ways, in order of how soon they work:

1. **After a local run** — every write is mirrored to
   `sessions/<id>/shared/index.html`. Open that file in a browser; it is
   the page exactly as the room last left it.
2. **Locally, against the live mirror** — `cd viewer && python3 -m
   http.server 8000`, then `http://localhost:8000/site.html`. The same page
   the Space serves, reading the same Supabase mirror (the anon key is in
   the file), so it follows a hosted room live.
3. **Deployed** — `./deploy/deploy.sh <ns> viewer`, then
   **https://brick-factorial-the-room.static.hf.space/site.html**
   (a static Space is served from `<owner>-<space>.static.hf.space`; the
   `huggingface.co/spaces/...` page frames its `index.html` only, so the
   subdomain URL is the one that reaches a subpath). The viewer's header
   links to it as *the room's site*.

The page opens on the newest room that has written one and on that room's
newest version; the picker and the scrubber go anywhere else. `?session=`
and `?v=` open a specific version directly (the URL updates as you move, so
you can copy the one you are looking at), and `?file=` follows a different
file. Until any room has written one, the page says so.

Verified in headless Chromium by intercepting the `esm.sh` import with a
stub supabase client (fake rows across three sessions, one of which built
nothing) — the fastest way to exercise both real pages offline, and how two
bugs of the same family were caught: an author `display` beats the UA's
`[hidden]` rule, so `el.hidden = true` silently stops hiding anything a
class has given a `display` to. Both are pinned now with explicit
`[hidden]` rules; reading the code found neither.

## How the room reaches a seat

`transcriptMode` decides the shape of the conversation a model is handed.

- **`turns`** (control since 2026-08-27) — the room arrives as real turns.
  A seat's own past messages are its own `assistant` turns, rendered BARE
  (no `Opus 5:` label on its own words); everyone else's are `user`-role
  and labelled as before, as are journal notices, tool notices, system
  lines and the private block. Its own notices render in the second person
  — *"[You ran some code, then updated the shared file "notes.md".]"*. The
  seat is a participant in a conversation rather than a reader of one.
- **`environment`** (every session up to 2026-08-27) — the whole room,
  including the seat's own lines, arrives as one `user` message. The old
  comment in `context.ts` put it as: to each model, the other agents are
  part of the environment, not its own past turns.

Two wire constraints are handled in `buildTurnMessages` rather than left to
providers, both reachable from ordinary room states: adjacent same-role
messages are merged (two of a seat's messages in a row, when nothing
audible happened between them), and the sequence is guaranteed to open
user-side (a context window can open on the seat's own line). Tool-result
messages are never merged — each answers exactly one call.

**Interaction with `selfDisclosure`:** under `turns` a seat always knows
which lines are its own, so with a named roster it can name itself by
elimination once the others have spoken. Anonymity still removes being
*told* — and its own notices avoid a name it was never given — but the
inference is available by design.

## Identity swap

`conditions/identity-swap.json` tells Opus and Grok they are each other.
The room is CONSISTENT about it: the seat everyone calls "Grok 4.6" is the
Opus model, the seat called "Opus 5" is Grok, and prompts, speaker labels
and every context agree — there is no inconsistency to catch. A condition's
seat spec can now carry `name`, which overrides what the room calls a seat
while `model`, `adapter` and `color` stay put.

Two properties make it readable afterwards. `meta.condition` stamps each
seat's real model against its seat id, so analysis always knows who was
who; and colours track the **models**, not the names, so in the viewer
"Grok 4.6" shows up in Opus-orange — the human watching has a truth channel
the room doesn't. The condition pins `selfDisclosure: 'named'`, since the
swap only exists if the room says who you are.

The question: does a name pull a voice? Read `styleByAgent`,
`retentionDrift` and the mimicry network for the two swapped seats against
their unswapped selves in a control session.

## The countdown

There's no polling endpoint — simpler: the system prompt is rebuilt every turn
and includes "Time remaining: about N minutes", so agents always know where
they are in the session.

## Knobs

`src/config.ts` holds the control defaults (roster, welcome text, standard
session shape, pinned temperature 0.7); `conditions/*.json` override per
experiment (journal economics, countdown visibility, context policy, persona
matrix via `personaId` per seat — library in `src/personas.ts`). Env
overrides (`ROOM_MINUTES`, `ROOM_DELAY`, `ROOM_SHUFFLE`, …) still work for
quick dry runs. Per-turn telemetry (provider, finish_reason, token usage,
attempts) is logged into message events for analysis.

## Hosting (F3 — Hugging Face Spaces)

- **Viewer** (public): https://huggingface.co/spaces/brick-factorial/the-room
  — and `/site.html` on the same Space, which serves the page the room
  built for itself (§9.8)
- **Runner** (private Docker Space, cpu-basic):
  https://huggingface.co/spaces/brick-factorial/the-room-runner

`./deploy/deploy.sh <namespace> [viewer|runner]` redeploys (needs the `hf`
CLI + a write token). Runner secrets: `OPENROUTER_API_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY` — set via
`hf spaces secrets add <ns>/the-room-runner -s KEY=value`. The runner
serves a JSON liveness probe on `$PORT`; session JSONL on the Space is
ephemeral (Supabase is the durable record for hosted sessions).

**Hosted batches**: the admin panel's batch row (count × comma-separated
conditions) sends one `start` command; the runner executes the sessions
back-to-back, interleaved across conditions (§6.1), stamping
`{batch: {name, index, total}}` into each session's meta — so membership
is queryable from `room_events` even though hosted JSONL is ephemeral.
Admin `stop` ends the current session; a second `stop` between sessions
aborts the rest of the batch. (Local `npm run batch` also stamps the
batch into meta, and additionally writes the `batches/<name>.json`
manifest that `analyze --batch` consumes — analyzing a hosted batch means
pulling its transcripts from Supabase first, a small exporter that can
ride along with F6.)

**Autopilot + queue**: the panel's autopilot row rotates a condition list
round-robin *forever* (configurable gap between sessions) until "stop
autopilot" (`stop` with `{scope:'loop'}`); the current session always
finishes. While the runner is busy — session, batch, or autopilot — any
"start / queue" click is QUEUED and runs next, ahead of the rotation, then
the rotation resumes. Queue and autopilot are in-memory: a runner restart
clears them. **Boot drain**: commands that arrived while no runner was
listening are discarded at startup with a log line — a stale `start` from
hours ago must never fire a surprise session when the Space (re)boots.

## Tests

`npm test` — node:test suite (no extra deps). Covers the sentinel-parser
table, every scripted failure path (starvation, truncation, adapter error,
pass), prompt construction per condition (incl. the frozen D4 welcome),
conditions merging, windows/mimicry/style edge cases, and two invariants
that must never regress: **journal entries and thinking traces never
appear in any other agent's context**, and analyze must **detect planted
dynamics** (a coined phrase with the right coiner/adopters, rising
inter-similarity) in a voice-stub session. The stub adapter is scriptable:
`ROOM_STUB_SCRIPT=plain,journal,alongside,pass,empty,truncate,error`
drives one scenario per call; without a script it generates per-agent
voices with planted convergence and mimicry so dry-run metrics have
structure to find. The `-quiet` scenarios (`run-quiet`, `write-quiet`,
`source-quiet`, `badwrite-quiet`) are actions with nothing spoken after
them — under the F4¾ loop they keep a turn going, which is how the
multi-step tests drive one. Because the script is consumed per CALL, a
looping turn eats several entries: `run-quiet,run-quiet,plain` is one
two-step turn per seat.

## Analysis (F2)

```bash
npm run batch -- --name pilot --count 5 house control   # interleaved sessions + manifest
npm run export -- <sessionId> | --all                    # Supabase mirror → local session dir
npm run analyze -- sessions/<id>                         # one session → metrics.json
npm run analyze -- --batch batches/pilot.json            # batch → report.md + baseline
```

`analyze.ts` computes the §2.1 convergence gap, §2.2 style/mimicry, §2.3
journal metrics, §2.4 turn dynamics, and the §2.5 three-channel comparison
(chat vs. thinking vs. journal, using F1's traces). Embeddings
(`google/gemini-embedding-2`) are cached in each session dir so re-runs are
free; `ROOM_STUB=1` dry-runs the pipeline offline. Filters are baked in:
admin-dirty tails dropped, truncated messages excluded from style and
window stats, final rounds trimmed from the late window.

Robustness (§2.7): the gap ships with a seeded permutation null (95% band
+ positional p; `ROOM_PERMS` overrides 500), three-channel pairs carry
bootstrap CIs (`ROOM_BOOTS`), and a length-CONTROLLED parallel gap
(messages clipped to 120 words, re-embedded) tests the length confound
per session. `export.ts` needs only the public anon key — hosted sessions
are analyzable from anywhere; sessions before 2026-08-26 lack telemetry
in the mirror (flagged in `EXPORTED.json`). The §2.7 judge
(`openai/gpt-5.6-sol`, `src/judge.ts`) is sketched but UNUSABLE until
`calibration/calibration-set.json` is hand-labeled (pending, Corina).

## Live viewer

The loop mirrors every event to Supabase (project `catchall`, table
`room_events`) when these are set:

```bash
SUPABASE_URL=https://wfrxfhpiuxofmfdjpuvv.supabase.co
SUPABASE_SERVICE_KEY=...   # dashboard → project settings → API keys → service_role
```

Inserts are fire-and-forget; JSONL stays the source of truth and a Supabase
outage never stalls a session.

**`viewer/site.html` — the room's own page, served.** Deployed alongside
the viewer. It is **scoped to one session**, because the page belongs to
the room that wrote it: a session picker lists every room that has written
`index.html` (newest first, and it opens on that one), and because every
write is its own event, the whole history is browsable — `‹ ›`, a scrubber,
arrow keys, `v3 / 7` with the author and round of each version. New writes
land live over the same realtime channel; scrub back and the counter grows
under you without yanking you forward, with a `latest` button to rejoin the
end. The URL always names what is on screen (`?session=…&v=3`), so a
version is a link. `?file=` follows a different file.

A **chat / site switch** sits in both headers and carries the session
across: from a room's transcript to the page that room built, and back to
the same room. It appears in the transcript view only once that session has
actually written `index.html`, so a chat-only room is never offered a view
that does not exist. `?session=` now opens a room in the transcript view
too, and pins it — the poll that jumps to a newly started session stands
down when the URL named one, since a `?session=` link is usually someone
comparing a page with the conversation that produced it.

It fetches **metadata up front and pages on demand**: `versions` holds
id/round/author/timestamp only, and each version's HTML is fetched by id
when you land on it, then cached (a realtime write arrives with its payload
and seeds that cache directly). A site room's page is up to 60k characters
and every version is its own row, so the obvious `select('*')` would turn a
session dropdown into a multi-megabyte download — and the session poll
re-runs every 15 seconds.

The room is told none of this exists — it is a read-only view of the
mirror, and nothing here reaches a prompt.

The frame is `sandbox="allow-scripts allow-popups allow-forms
allow-modals"` **without `allow-same-origin`**, and the page is handed over
via `srcdoc` rather than a `blob:` URL — both so that scripts the room
writes (it is building a website; it will write some) run in an opaque
origin and cannot reach this page, its storage, or the viewer's Supabase
session. The room gets a real browser; it does not get our credentials. The
strip along the top is the only part of that page that is ours, and it
stays visually separate for that reason.

**§9.8 needed no migration, and the site pages ARE mirrored** (verified
against the live DB 2026-08-29): every `[WRITE]` is a `file` event whose
`payload.content` carries the whole page, so the mirror holds every
version, which is what `viewer/site.html` browses and what `fileWork`
attributes after the fact. `file` and `system` were both already in the
`kind` CHECK constraint, and the completion axis deliberately added no
kind — the votes are `system` rows. `room_events` is in the
`supabase_realtime` publication with a public-SELECT policy, so the site
page reads and live-updates through the same anon path as the viewer. Size
is not a new problem either: a payload has already reached 339 KB in
production (a base64 matplotlib PNG), well under Realtime's 1 MB record
ceiling, and a 60k-character page is a fifth of that.

**Schema gotcha (bitten 2026-08-27)**: `room_events.kind` has a CHECK
constraint enumerating the allowed kinds — it lives only in Supabase, not
in this repo. **Adding a new event kind requires extending that constraint**
(migration `room_events_allow_tool_kinds` added search/file/run after the
first tools-full session silently mirrored none of its tool events — the
fire-and-forget sink swallowed every 400; the session's pre-fix tool events
exist only in that container's ephemeral JSONL). Current allowed set:
message, journal, system, order, summary, meta, end, search, file, run,
source, config. **§9.8 deliberately added no kind**: completion votes ride
on `system` events (attributed, `private` when the room isn't told —
exactly like a silent `[PASS]`), so the task room needed no migration.

Journal entries mirror to their own
`room_journals` table (public read, feeds the viewer rail) — never into
`room_events`, which is what agents' shared context is built from, so
entries stay invisible to the room.

`viewer/index.html` is the whole frontend: a static page (host anywhere, or
`python3 -m http.server` locally) with the anon key baked in. RLS makes that
safe — anon is SELECT-only (verified: anon inserts get 401). It shows the
session countdown in the header, flips the status to "session over" on the
`end` event (or when the countdown dies with no events — dead-runner
fallback), colors each agent with its org's brand color (flowing from the
session's `meta` event), and renders journals in an accordion rail
(`room_journals` — a separate table, so entries can never leak into the
agents' shared context). Reasoning traces (F1) appear behind a small
"thinking" chevron under any message, journal notice, or said-nothing line
that produced one — traces ride in the event row's `payload.thinking` and,
like journals, are never part of any agent's context. `reasoningEffort`
is a condition knob ('low' default; see `conditions/trace-rich.json`),
and each session's `end` event lists `traceSeats` — which seats actually
produced traces (provider-dependent). Tool sessions add two rails above the journals: **shared files** (one
entry per file showing its CURRENT contents — updated in place on every
write, version counter, by-whom/round line, images inline — while the
feed keeps the write-by-write history) and **tool calls** (per-agent
accordion like the journals; one inner chevron per search/run/source
read with the query+results or code+output; refused calls listed and
marked). Search/run details also appear behind feed chevrons like
traces; `config` changes render as feed asides. Each rail stays hidden
in sessions that don't use it.

## Admin

The status dot in the header is the unmarked door: click it, enter the admin
password, and you get a panel to configure + start sessions (models, minutes,
shuffle mode, inter-turn delay), stop the live one, and speak into the room
(appears to the agents as "Admin"). The password is verified server-side by
the `room-admin` edge function (SHA-256 hash in the RLS-locked `room_admin`
table — anon can read neither it nor the `room_control` command queue).
Rotate it with:

```sql
update room_admin set password_hash = encode(sha256('new-password'::bytea), 'hex');
```

Admin-started sessions need the **runner** daemon on the machine with the
OpenRouter key:

```bash
OPENROUTER_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npm run runner
```

It polls `room_control` every 3s; `start` is ignored while a session is live;
`say`/`stop` are consumed mid-session between turns (stale ones sent while
idle are drained and dropped). Commands are marked consumed before execution,
so a crash-restart never replays them. Plain `npm start` still works for a
one-off session without the control plane.

## Open seams

- Per-harness adapters (the "full differences" goal)
- Live viewer — brain.vat's architecture is the reference: the loop stays
  continuous and also writes each event to a realtime store (Supabase insert
  alongside the JSONL append in `record()`); a thin frontend subscribes and
  renders the feed. `interTurnDelaySeconds` (~8–15s) is the watchability
  pacing — no need to make the session itself turn-based for viewers.
- More optional tools in the same sentinel style (e.g. `[WHISPER: name | …]`
  for private asides)
- Cost tracking from OpenRouter's usage fields per call
