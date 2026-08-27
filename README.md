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
next turn, and the room at most hears the notice line (query/results are
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
tool action. Deliberately scoped: session/context machinery stays
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
next turn either way. Filesystem limits: 20 files, flat namespace
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
  modes, notice flags, budget — never durations, caps, roster, models,
  the manipulations, or governance itself). Unilateral, immediate, free
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
structure to find.

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

**Schema gotcha (bitten 2026-08-27)**: `room_events.kind` has a CHECK
constraint enumerating the allowed kinds — it lives only in Supabase, not
in this repo. **Adding a new event kind requires extending that constraint**
(migration `room_events_allow_tool_kinds` added search/file/run after the
first tools-full session silently mirrored none of its tool events — the
fire-and-forget sink swallowed every 400; the session's pre-fix tool events
exist only in that container's ephemeral JSONL). Current allowed set:
message, journal, system, order, summary, meta, end, search, file, run.

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
