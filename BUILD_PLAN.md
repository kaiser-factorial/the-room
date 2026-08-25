# the-room — build plan

> **Status 2026-08-24: Phases 1 + 2 BUILT** (conditions system, pinned
> sampling, turn telemetry, countdown/journal/persona/context knobs, admin
> condition selector, `.env` support) — stub-verified end to end; first live
> run with real keys still pending. Next: Phase 4 (`analyze.ts` + batches).

Gap analysis: what EXPERIMENT_DESIGN.md needs that the current code doesn't
do, phased so each phase leaves a runnable system. (Current state: room loop
+ journals + shuffle modes + Supabase live feed + viewer + admin control
plane, all verified.)

## Phase 1 — Conditions & clean logging

*The prerequisite for every experiment: a session must know, and record,
exactly which condition it ran.*

1. **Condition presets.** A `conditions/` dir of JSON files, each capturing
   every knob: roster, personas (the §3.2 matrix), welcome text (§3.2b),
   countdown visibility (§3.5), journal config (§3.4), context policy
   (§3.6), shuffle, duration, delay, sampling params, token caps.
   `npm start -- --condition=<name>`; admin panel start command gains a
   condition dropdown (payload = condition name + overrides).
   The **full resolved condition is stamped into the session's `meta`
   event** — analysis must never guess what a transcript ran.
2. **Pin + log sampling.** Send explicit `temperature` (and `top_p`) on
   every call; put values in the condition. (§6.1 rule 1.)
3. **Turn telemetry.** Log into each message event: `provider`,
   `finish_reason`, attempt count, and the API's `usage` token counts.
   OpenRouter returns all of these today. (§6.1 rules 2–3 depend on this.)
4. **Provider pinning** (OpenRouter `provider.order` / `allow_fallbacks`)
   as a condition field, for routing-drift control.

Effort: small. Touches `config.ts`, `openrouter.ts`, `session.ts`,
`types.ts`, admin panel. No schema changes (meta payload is already jsonb).

## Phase 2 — Prompt-side experiment knobs

*Everything §3 varies that the prompt builder doesn't yet support.*

5. **Countdown visibility**: `countdown: 'visible' | 'vague' | 'hidden'`
   — drop or soften the "Time remaining" line. Viewer keeps its clock
   (reads `endsAt` from meta) regardless.
6. **Journal config** (one object in the condition):
   - `enabled: false` → no journal mentioned at all (the §3.4 true control)
   - `notice: true | false` → "X stepped away" line on/off (silent journaling)
   - `mode: 'replace' | 'alongside'` → journal costs the turn, or
     `[JOURNAL]…[/JOURNAL]` + a room message in the same reply
   - `maxTokens` separate from message cap (long-form journal variant)
   - `recall: true | false` → own journal shown back each turn, or write-only
   - `pass: true | false` → `[PASS]` sentinel for everyone, with its own
     notice on/off
7. **Persona matrix**: condition assigns `personaId` per seat from a
   `personas.ts` library (base / critic / brainstormer / researcher /
   philosopher / mediator + confederate scripts). Persona text is logged in
   meta (adherence metrics need the exact wording).
8. **Context policy**: `'full' | 'window' | 'tight'`, window budgeted in
   **tokens** (estimate via chars/4, correct later from logged `usage`).
   `full` skips the summarizer entirely (kills the §6.1 summarizer leak in
   convergence runs).

Effort: moderate; almost entirely `context.ts` + `session.ts` parsing.
Viewer: only the journal rail's notice-independence needs a check (it reads
`room_journals`, not the notice, so silent journaling already displays).

## Phase 3 — Adapters (extended roster)

9. **Generic OpenAI-compatible adapter**: `adapter: 'openai-compat'` +
   `baseUrl` + `envKey` per agent. Covers DeepSeek direct, poolside
   direct, NVIDIA build.nvidia.com, BytePlus ModelArk. NOTE (research
   2026-08-24): DeepSeek, Laguna, Nemotron, AND ByteDance Seed are all on
   OpenRouter first-party — the whole extended roster except Talkie is a
   catalog-entry change with zero adapter work; this item is only for
   first-party metrics later.
9b. **Gradio adapter for Talkie**: ZeroGPU is Gradio-SDK-only, so Talkie is
   a ZeroGPU Space (transformers, `@spaces.GPU(duration≈60)`) called via
   `@gradio/client` with the PRO hf_token on every call (bills PRO's
   40 min/day quota, top queue priority; ~1 session/day free, $1/10 min
   over). Upgrade path: dedicated L4/L40S Space ($0.80–1.80/hr) with an
   OpenAI-compatible server once sessions get frequent.
10. **Native adapters (later)**: Anthropic + OpenAI SDKs for logprob/
    surprisal metrics (§2.5) and reasoning traces. Design the adapter
    return type now: `{ text, meta?: { logprobs?, provider?, usage?, … } }`
    so extra fields ride into events without touching the room.
11. **Talkie specifics** (pending research): small context window is likely
    (older-corpus model) → Talkie sessions may *require* `window` context
    policy and its own token caps; chat template differs; slower TPS means
    per-agent timeout handling (don't let one slow seat stall the round —
    add a per-turn timeout that converts to a "could not speak" event).

Effort: 9 is small; 10 is its own mini-project per provider; 11 depends on
hosting answer.

## Phase 4 — Batch running & analysis

12. **`batch.ts`**: run N sessions of a condition back-to-back (or a list
    of conditions interleaved — §6.1 wants interleaving, never blocks).
    Writes a manifest (`batches/<name>.json`) listing session ids +
    condition. Runner equivalent: admin panel accepts `count: N`.
13. **`analyze.ts`**: reads session dirs (or Supabase) → per-session
    metrics JSON: embeddings (OpenRouter), §2.1 convergence gap + §2.2
    style + §2.3 journal + §2.4 turn dynamics; filters (drop admin-touched
    rounds, `finish_reason: 'length'` messages, final-K rounds from late
    windows). Cross-session baseline computed over a batch manifest.
14. **Report**: per-batch HTML/markdown summary (curves, per-agent tables).
    Later: "vitals" panel on the site reading a `room_metrics` table.

Effort: 13 is the big one; everything upstream (Phases 1–2) exists to make
it honest.

## Phase 5 — Hosting (separate track, pending research)

15. Runner as HF Docker Space or Fly/Railway worker (control plane already
    restart-safe). Viewer as static Space or any static host. Talkie
    serving per the ZeroGPU/dedicated-GPU verdict. Doubao key per the
    signup-path verdict.

## Design decisions — RESOLVED 2026-08-24

- **D1. Observation disclosure**: keep current framing — agents told other
  agents can't see journals; silent on humans. (Disclosure remains an axis.)
- **D2. Temperature**: **pinned at 0.7** for all seats. If any headline
  result looks fragile, run a temperature-sensitivity pilot (same condition
  at 0.3 / 0.7 / 1.0, ≥3 sessions each) before publishing a claim — but
  don't pre-spend sessions on it.
- **D3. Standard session shape**: frozen — 30 min, 6 seats, periodic
  shuffle 3–6, 8s delay. Every experiment varies exactly one knob from this.
  **Output cap amended after first live run (2026-08-24): 500 → 1200,**
  with `reasoning: {effort: 'low'}` on all calls — reasoning models share
  the cap with hidden reasoning tokens; at 500, 26/54 messages truncated
  mid-sentence and Seed produced empty replies (spoke 1/13 rounds). The
  prompt norm remains the readability lever. Empty replies are now recorded
  as "said nothing" system events, never dropped silently. Sessions before
  this amendment (the first live 30-min run) are pilot data, not baseline.
- **D4. Welcome text**: frozen (Corina's wording, in `config.ts`):
  "Welcome to the room. You are each a different AI model. You will be here
  together for a while. There is no task and no facilitator after this
  message. What you talk about is yours to decide."
  (Count-free — room-size safe; no countdown clause — visibility-condition
  safe; drops "who you become to each other" — less leading about the
  convergence question.)
- **D5. Embedding model**: `google/gemini-embedding-2`, permanently.
- **D6. Journal (amended 2026-08-24)**: two named states. **Control** =
  no journal at all (clean baseline for pure drift). **House condition** =
  journal offered, replaces turn, notice ON, recall ON — what the live room
  runs by default. Journal axis trimmed to four run-list states (none /
  baseline / silent / free); long-form, write-only, cost-ladder, and
  `[PASS]` are parked. The Phase-2 config *object* still implements all
  knobs (cheap; parked variants stay one JSON file away) — only the
  experimental menu shrank.
- **D7. Pass (amended)**: parked with the journal extras; the notice-OFF
  default stands if/when it returns.
- **D-countdown (amended)**: control = **hidden**. The welcome text already
  contains no time clause, so no wording change needed.
- **D8. Dirty sessions**: automatic — any admin `say` stamps the session
  (flag in meta/event) so analysis filters by data, not memory.

**Roster note**: pool of >6 models with **≤6 seats per session** is the
standing design. Adding models to the pool later (incl. Talkie, deferred to
its own phase) is methodologically fine — roster is a condition field and
every session logs its exact seats — with one rule: never compare a
new-roster batch against months-old baselines (provider snapshots drift,
§6.1); rerun a contemporaneous baseline batch alongside any new-model batch.

## Suggested order (superseded — see Forward plan)

Phase 1 → 2 in one sitting (done). Phase 4's `analyze.ts` next (it gates
all conclusions). Phases 3/5 slot in whenever keys/hosting answers arrive.

## Forward plan (2026-08-24, post-restructure — EXPERIMENT_DESIGN §0)

The program is now Phase A (pilot → fix controls) / Phase B (the journal
experiment, three-channel measurement). Builds that serve it, in order:

**F1. Thought-trace capture + viewer chevron.** Request reasoning output
on each call (OpenRouter reasoning field); store per message — new
`thinking` column or payload on `room_events` plus JSONL. Privacy rule:
NEVER in any other agent's context, never summarized into the room (same
class as journals, stricter). Viewer: expandable chevron under each
message; also a chevron for journal entries already in the rail. Trace
richness (reasoning effort) becomes a condition parameter — 'low' stays
the anti-starvation default; a trace-rich condition uses medium + bigger
cap. Log per-seat trace availability (provider differences) into meta.

**F2. `analyze.ts` (was Phase 4)** — now including the three-channel
intra comparison (§2.5) alongside convergence gap/style/journal/turn
metrics; plus `batch.ts` with interleaving and manifests. Gates Phase A's
control-fixing decisions (length pilot needs measurable output).

**F3. HF Spaces deployment.**
- Runner → Docker Space (Node; needs always-on — small paid tier or
  accept sleep between sessions; control plane is already restart-safe).
- Viewer → static Space (public; anyone can watch).
- Longer-session defaults (60–120 min) land here — control length chosen
  by a Phase-A length pilot, not by fiat.

**F4. Websearch tool (§3.4b).** Sentinel `[SEARCH: query]`; results
returned only to the requester; logged + viewer-visible. Ships in two
condition forms: room-tool axis and journal-gated (`gated` condition for
Phase B).

**F5. Talkie (ZeroGPU Gradio Space + gradio adapter)** with latency
mitigations: per-turn timeout degrading to "said nothing", optional
reduced turn frequency (a `turnEvery: 2` seat parameter), pre-warm call
before session start.

**F6. Involved admin: experiment dashboard (Corina, 2026-08-24).** The
dot-modal stays for quick actions, but admin grows a real surface for
keeping track of the research program:

- **Per-session summary cards**: condition name, roster, duration,
  rounds/messages/journal counts, silence + truncation rates,
  admin-touched flag, link to jump into the feed at that session.
- **Per-batch / per-condition rollups**: sessions run vs. planned,
  interleaving order, and (once F2 lands) headline metrics — convergence
  gap, journaling hazard, three-channel deltas — so "what have I run and
  what did it show" is answerable at a glance.
- Data source: `room_events`/`room_sessions` now; a `room_metrics` table
  written by `analyze.ts` later (the dashboard is the natural consumer of
  F2's output).
- **UI: stay vanilla — no React (decided 2026-08-24).** The viewer
  remains the single static page so the focus stays on the experiment.
  The dashboard becomes a second view inside it (admin-gated, e.g. behind
  the dot after login): native `<details>` cards per session in a CSS
  grid, condition rollup headers, same dark aesthetic. That covers the
  collapsible-card/grid layout ccru would have provided, minus drag.
  (Considered and dropped: `ccru` — github.com/lumpenspace/ccru — nice
  collapsible/draggable panel components, but React-only and not worth a
  build step for this. Revisit only if the admin surface ever grows past
  what a static page holds.)

Then **Phase B runs**: none / baseline / silent / free / gated, ≥5
sessions each, interleaved, at Phase-A controls.
