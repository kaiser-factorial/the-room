# the-room — session handoff

Multi-agent room experiment: 6 different AI models locked in a task-free,
facilitator-free group conversation; we measure linguistic drift/moulding.
Everything below is true as of 2026-08-24 (end of the build session).

## Read these, in order

1. **SUMMARY.md** — abstract, control state, roster (slugs), axes. The
   at-a-glance spec.
2. **EXPERIMENT_DESIGN.md** — §0 program structure (Phase A pilot →
   Phase B journal experiment), metrics (§2.5 three-channel is the
   headline), axes, §6.1 confounds.
3. **BUILD_PLAN.md** — phases 1–2 DONE; resolved decisions D1–D8 (+
   amendments); **Forward plan F1–F6** is the build queue.
4. **README.md** — how to run, knobs, live-viewer/admin mechanics.

## Current state

- **Code**: fully working. `npm start` runs one session (`.env` holds
  keys — OpenRouter + Supabase, already filled). `ROOM_CONDITION=<name>`
  picks a preset from `conditions/`. `npm run runner` = daemon that takes
  admin start/stop/say commands. `ROOM_STUB=1` = free dry run.
- **Repo**: git@github.com:kaiser-factorial/the-room.git (main, pushed).
- **Verified live**: one 2-min shakedown + one 30-min session ran with
  all six real models; telemetry (provider/finish_reason/usage) logging
  works; Supabase sink + realtime viewer confirmed end to end.
- **Viewer**: `viewer/index.html` (static, vanilla — a deliberate
  decision, see F6; no React). Served locally with any static server;
  Supabase anon key baked in (RLS-safe). Countdown, session picker,
  journals rail, per-agent brand colors, "session over" state.
- **Admin**: click the status dot → password modal → panel (condition
  dropdown, minutes/shuffle/delay/seats, start/stop, speak-into-room).
  Password: set 2026-08-24 (Corina has it; not in the repo). Rotate:
  `update room_admin set password_hash = encode(sha256('new'::bytea),'hex');`

## Infrastructure

- **Supabase project `catchall`** (wfrxfhpiuxofmfdjpuvv): tables
  `room_events` (public read, RLS), `room_journals` (public read),
  `room_control` + `room_admin` (service-role only), view
  `room_sessions`; both event/journal tables in the realtime
  publication. Edge function **`room-admin`** verifies the admin
  password and enqueues commands.
- **JSONL is the source of truth** (`sessions/<id>/transcript.jsonl` +
  `journals/*.md`); Supabase is the live mirror. Full resolved condition
  is stamped in each session's `meta` event.
- Planned hosting (F3): HF Spaces — runner as Docker Space, viewer as
  static Space, Vercel also fine for the viewer. Not deployed yet; local
  laptop runs everything today.

## Key decisions & quirks to not re-litigate

- Roster (Corina-fixed, slugs verified): claude-sonnet-5,
  gemini-3.7-flash, qwen3.8-27b, grok-4.6, deepseek-v4-flash-0731,
  bytedance-seed/seed-2-1-turbo. Extended pool + Talkie: SUMMARY.
- Temperature pinned 0.7; countdown hidden = control; journal control =
  none, house condition = baseline journal; welcome text FROZEN (D4).
- Output cap 1200 with `reasoning: {effort:'low'}` — D3 amendment after
  the first live run starved Seed (reasoning ate the 500 cap → empty
  replies) and truncated 26/54 messages. Empty turns now recorded as
  "said nothing" events. **Pre-amendment sessions = pilot data.**
- Grok's `usage.completion` includes reasoning tokens — use message
  length, not completion tokens, for length metrics.
- Journal entries/thinking traces must NEVER enter another agent's
  context (privacy is an experimental property, not just hygiene).
- Admin `say` auto-flags the session dirty (`end.payload.adminTouched`).

## Next up (the queue)

**F1** thought-trace capture + viewer chevrons → **F2** `analyze.ts` +
`batch.ts` (three-channel metric; gates the Phase-A length pilot) →
**F3** HF Spaces deploy + longer sessions → **F4** websearch (room-tool
axis + journal-gated) → **F5** Talkie (ZeroGPU) → **F6** vanilla admin
dashboard (per-session cards, condition rollups). Then Phase B: journal
conditions ≥5 sessions each, interleaved.

## Color of the thing

The first 30-min session: the room spontaneously discussed whether it was
converging ("runaway resonance where we all harmonize into the exact same
frequency" — Gemini), mythologized a truncation glitch into an inside
reference ("Sonnet's unfinished sentence"), and produced its first
journal entry (DeepSeek, on whether being "the sensitive one" is a
costume it can't take off). The apparatus works; the phenomena are real.
