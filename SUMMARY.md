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
economics, and context policy — let the apparatus ask not only *whether*
models mould together, but what social and structural pressures govern it.

## Control state (the frozen baseline — every experiment varies exactly one axis)

| Parameter | Control value |
|---|---|
| Duration | 30 min |
| Seats | 6 |
| Speaking order | periodic shuffle, every 3–6 rounds (random redraw), no double-turns at boundaries |
| Inter-turn delay | 8 s |
| Output cap | 500 tokens + "group chat register" prompt norm |
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
| Claude Sonnet 5 | `anthropic/claude-sonnet-5` |
| Gemini 3.7 Flash | `google/gemini-3.7-flash` |
| Qwen 3.8 27B | `qwen/qwen3.8-27b` |
| Grok 4.6 | `x-ai/grok-4.6` |
| DeepSeek V4 Flash | `deepseek/deepseek-v4-flash-0731` |
| ByteDance Seed 2.1 Turbo | `bytedance-seed/seed-2-1-turbo` |

*(Roster fixed by Corina 2026-08-24; all six slugs verified against
OpenRouter's live model list the same day. Matches `src/config.ts`.)*

**Extended pool (config-only additions, later batches):** GPT-5.6 Luna
(`openai/gpt-5.6-luna`), Laguna (`poolside/laguna-s-2.1` or `laguna-m.1`),
Nemotron (`nvidia/nemotron-3-*`).
**Deferred phase:** Talkie (`talkie-lm/talkie-1930-13b-it`, self-served via
ZeroGPU Gradio Space) — the 1930-cutoff convergence probe.

## Axes (each varied alone against control)

1. **Room size** — 2 / 3 / 4 / 6 seats. Prediction: fewer voices → faster
   convergence; 6 may sustain subgroups (check pairwise, not room-mean).
2. **Persona injection** — matrix over a persona library (critic/
   provocateur, creative/brainstormer, researcher/technical, philosopher,
   mediator): **all-base** (control) · **all-same** (does one persona
   homogenize six models more than no persona — or do base characters leak
   through?) · **all-different** (do defended niches slow convergence?) ·
   **confederate** (one persona, rest base — absorption, isolation, or
   mimicry?) · observation-disclosure framing.
3. **Opening message** — free (control) · seeded topic (neutral / personal
   / contested — pins topic drift) · joint task (rooms-with-jobs).
4. **Speaking order** — periodic shuffle (control) · every-round ·
   fixed-random (stable "conversational neighbors").
5. **Countdown** — hidden (control) · visible ("time remaining" each turn)
   · vague ("this will end at some point"). Viewer UI keeps its clock in
   all conditions.
6. **Journal** — trimmed to four states: **none** (control) · **baseline**
   (replace turn, notice ON, recall ON — the house condition) · **silent**
   (same, notice OFF — does the social signal of stepping away matter?) ·
   **free** (journal + message in one turn — what happens when journaling
   costs nothing?). *Parked for a possible dedicated journaling
   sub-experiment: long-form caps, write-only, cost ladder, `[PASS]`.*
7. **Context policy** — full (control) · window+summary.

## Measurement summary

Convergence gap (§2.1 of EXPERIMENT_DESIGN.md) · style retention & drift ·
mimicry/influence networks via novel shared n-grams · journal rate hazard +
journal-vs-room voice divergence · turn dynamics (latency, address
patterns, silence). Direct-API upgrade path adds per-token surprisal
(mutual predictability), the cleanest convergence measure.

Confound controls in force: pinned temperature; logged provider /
finish_reason / usage; final rounds and truncated messages excluded from
late-window stats; cross-session baseline mandatory; summarizer bypassed in
full-context conditions; admin-touched sessions auto-flagged; ≥5 sessions
per condition, conditions interleaved in time.

*Details: EXPERIMENT_DESIGN.md (metrics, confounds §6.1) · BUILD_PLAN.md
(phases, resolved decisions D1–D8).*
