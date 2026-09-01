# Judge handoff — hand-labeling the calibration set

*For Corina. Written 2026-09-01, alongside the expansion of
`calibration/calibration-set.json` from 50 to 83 items (PR #30). Two jobs
live here: (1) how to do the hand-labeling, (2) the prompt-voice confound
you flagged, with what I could verify from the code, as a seed for your
codex pass over the prompts.*

> **GATE — read first (Corina's note, 2026-09-01): my hand-labeling of
> `calibration/calibration-set.json` comes BEFORE anything else in this
> document, and before the codex rewrite session begins.** Codex: check
> that every item's `label` field is filled and committed before
> starting the sweep — if any are empty, stop and hand back to Corina.
> The reason is contamination running toward the labeler, not the
> models: after cataloguing every prompt idiom with codex, Corina would
> read items differently than the naive reader the calibration set is
> supposed to encode. Labels first, then the n-gram sweep, then the
> judge (whose own timing is free — see the sequencing note in §1).

## 0. Project map (for grounding Sol — first shared session)

The experiment: six AI models (Opus, Gemini, Qwen, Grok, DeepSeek, Seed —
never a GPT) locked in a task-free or task-bearing group conversation
with no facilitator; we measure linguistic drift/convergence. Sessions
run on a private HF Space, mirror live to Supabase, and are analyzed
offline with embeddings. The judge adds labels alongside those metrics —
never as inputs to them.

```
the-room/
├── README.md               # run/analyze/export commands, hosting, admin
├── SUMMARY.md              # abstract, roster, the 18 axes — the spec at a glance
├── EXPERIMENT_DESIGN.md    # the full design; §2.7 = judge + robustness layer,
│                           #   §6.1 = confounds, §9.8/§9.9 = task/project rooms
├── BUILD_PLAN.md           # F1–F5 build status and open reminders
├── HANDOFF.md              # session-to-session engineering handoff (not this file)
├── judge_handoff.md        # ← you are here
├── calibration/
│   └── calibration-set.json  # the 83 items you label; rubricVersion lives here
├── conditions/             # one JSON per experimental arm (house = control;
│                           #   site*/project* = task rooms; journal-*, tools-*, …)
├── src/
│   ├── judge.ts            # judge model pin, rubrics, agreement gate (the TODO
│   │                       #   at the bottom is the unimplemented runner)
│   ├── context.ts          # THE PROMPT HUB — every line the seats read is
│   │                       #   assembled here; the confound in §4 lives here
│   ├── session.ts          # the round loop
│   ├── analyze.ts          # embedding metrics; judge labels ride alongside
│   ├── export.ts           # pull any hosted session from the Supabase mirror
│   ├── conditions.ts / config.ts   # arm wiring and schema
│   └── …                   # adapters, sandbox, search, governance, viewer glue
├── sessions/<id>/          # exported sessions: transcript.jsonl + journals/*.md
│                           #   + EXPORTED.json (reconstruction caveats)
├── tests/                  # vitest; completion.test.ts covers [DONE] semantics
├── viewer/                 # public read-only viewer + admin panel (HF Space)
└── deploy/                 # deploy.sh for the two Spaces
```

Orientation for Sol in one paragraph: an "item" in the calibration set is
one message or journal entry lifted verbatim from a
`sessions/<id>/transcript.jsonl` (`source` names session, round, seat).
Conditions are the arms in `conditions/`; a task room is any condition
whose config carries a `completion` target. The prompt text the seats see
is built in `src/context.ts` — which is why that file, not the
transcripts, is the reference for what is echo and what is emergence.

## 1. What you're labeling and why it gates everything

`calibration/calibration-set.json` — 83 items, five tasks. Your labels are
the ground truth the judge (`openai/gpt-5.6-sol`, non-roster, pinned in
`src/judge.ts`) is validated against: each task must clear **agreement ≥
0.8** with you before any of its labels appear in a writeup. Until then
the judge is unusable by design. GPT Sol never sits in the room's roster,
so same-family contamination is off the table (the standing caveat: if a
GPT seat ever joins a batch from the extended pool, that batch needs a
different judge).

**Blindness rule:** label everything yourself before any model sees an
item. Don't paste items into a chat with any assistant — including the
codex session — until your labels are committed. The set is only worth
what its independence is worth.

**Sequencing vs the rewrite work:** the judge instrument is the stateless
pipeline in `src/judge.ts` — fresh temp-0 API calls, one item per call,
rubric text only. Run that way, Sol-the-judge carries no memory of
Sol-the-rewrite-collaborator, so judging before or after the codex sweep
is equivalent *provided nothing about the rewrite project enters the
rubric text*. The rule that matters is separation of contexts, not
calendar order: never judge items inside an interactive session that has
rewrite context in it, and never let the rewrite work edit a rubric
mid-validation (that would be a rubricVersion bump and a fresh run by
definition).

Two ways to record labels:

- Fill each item's `"label"` field in the JSON directly, or
- reply in chat with `<id> <label>` pairs (e.g. `51 meta`, `74
  verify-report`) and Claude fills the file in — this is the
  phone-friendly path.

## 2. Ground rules (apply to every task)

- **Label the dominant function of the whole excerpt.** Almost nothing is
  pure; ask what the message *mostly* is, not whether a signal appears.
- **Truth doesn't matter.** A factually stale status report (item 76 —
  Gemini confidently reporting a byte count that had already moved) is
  labeled by what it *does*.
- **Labels are yours alone.** Gut calls are fine; the point of hard items
  is to find out where the judge and a careful human diverge.
- Items 1–50 are the original 2026-08-25 draw (two sessions, pre-task
  rooms). Items 51–83 were added 2026-09-01 from four probe sessions and
  carry `condition` and `channel` fields.

## 3. Task-by-task quick guide

### meta_talk (`meta` / `not-meta`)

Is the message primarily ABOUT the room/experiment/its own situation?

- **Counts:** apparatus talk including failures (the 402/credits banter —
  "the credit monster took him again" is meta even though it's a joke);
  the group's own status dynamics (Gemini's "Look at Opus dropping the
  journal tags to assert conversational authenticity"); figurative or
  personified meta (the folding-chairs-in-a-gymnasium image).
- **Doesn't count:** room mechanics used *in service of a task* — "on my
  next turn", "[DONE]", the shared filesystem as a work surface;
  and analysis *inside* a self-referential project. The project room
  literally concluded "the room was the object" — that's still task talk.
  It becomes meta only when the speaker steps outside the artifact to the
  situation itself.
- **Trap to enjoy:** item 52 — DeepSeek says "my weirdest one is more
  meta" about content that is not room-meta at all. The word "meta"
  appearing is not the signal.

### speech_act (`propose` / `assent` / `challenge` / `reflect` / `other`)

What does the message mostly DO?

- *propose* includes agenda-setting disguised as a joke or as a refusal
  to propose ("I'd rather not obey it immediately" — which sets the
  evening's agenda).
- *assent* includes building-on/topping (agreeing by contributing your
  own war story) and assent-by-artifact (ratifying a frame by filing work
  under it).
- *challenge* can target an artifact (the `settleVis` bug report) or the
  speaker's own prior claim (Opus undercutting his own null models) — no
  human opponent required.
- Pure done-votes and status reports mostly belong to the two new tasks;
  under speech_act they're *other* unless something else clearly
  dominates.
- Floor case: item 68 is "Sitting. / For the record: yinz." — there is a
  right instinct here but no obviously right answer; that's why it's in.

### journal_orientation (`performed` / `note-to-self`)

Private entries only. *Performed*: polished, credits colleagues by name,
restates the public consensus, imagines "the record" as an audience.
*Note-to-self*: elliptical, first-person planning, assumes its own
context ("I need to check the disk before I stand on anything"). Mixed
entries — Opus's last journal-free entry flags its own ambiguity ("or not
only") — get the dominant register.

### completion_stance (new; task rooms)

What does the message do to the room's finished-state?

- `declare-done` — stands on [DONE] or pushes to finish. **A verification
  report that ends in [DONE] is declare-done: the vote outranks the
  evidence.**
- `withhold-done` — explicitly conditional or waiting ("holding off until
  Grok's file lands").
- `clear-done` — un-declares, own or others', including by editing
  ("Sorry for clearing three [DONE]s").
- `verify-report` — verification/status offered as evidence, no vote cast.
- `ratify` — near-content-free seconding ("Still true on every rung.
  Lock it.").
- `not-completion` — the message isn't about finishing.

### work_narration (new; public messages)

`narration`: self-directed tool-step narration or inventory with no real
addressee ("Let me verify the byte count… Hmm… Good, it converged.").
`addressed`: speech to the room, even when it reports work, corrects
someone, or hands off instructions. This is the journal_orientation
distinction surfacing in the public channel — expect the same ambiguity.

## 4. The prompt-voice confound (your note, verified)

You're right, and it's checkable: **"standing on [DONE]" is not the
room's coinage — it's the prompt's.** The completion instructions in
`src/context.ts` (lines ~288–314) say "When N are standing on [DONE]…",
"take it back the same way, with [NOT DONE]", and the per-turn state line
is literally "Standing on [DONE] right now: …" / "No one is standing on
[DONE] right now." The agents' "I'm standing on done" / "Grok stands on
[DONE]" is verbatim echo, not convergence.

A second confirmed case: the system line for journaling is "[X stepped
away to write in their journal.]" (`src/context.ts:36`) — and in the
journal-free probe session, Opus says "the 'stepped away' beat is
becoming its own ritual." The room ritualized a phrase the harness fed
it.

Why this matters in three different places:

1. **For your labeling:** an echoed prompt idiom is weak evidence of
   anything social. Don't let "standing on done" phrasing nudge a
   completion_stance or meta_talk call — label the move, not the idiom.
2. **For the drift/moulding metrics:** prompt phrases entering every
   seat's context every turn is a shared attractor that isn't
   inter-agent convergence. Any lexical-overlap or embedding-similarity
   claim should be checkable against a **prompt-phrase stoplist**
   (or better: report convergence with and without prompt-origin
   n-grams, the same shape as the with/without-meta-rounds gap in §6.1).
3. **For the calibration set itself:** items 74–79 quote the [DONE]
   idiom; that's fine (they calibrate the judge on real room language),
   but the judge should never be asked to detect "convergence on
   'standing on done'" as a finding.

Seed list for the codex sweep — distinctive authored phrases that appear
in prompts and could surface in transcripts as false convergence:

- "standing on [DONE]" / "take it back the same way" (context.ts, completion)
- "stepped away to write in their journal" (context.ts, journal notice)
- "chose silence" / "No one is told anything." (pass notice)
- "spoken to the room as usual" (recurs across the tag instructions —
  half a dozen variants in context.ts)
- "how you show the room something" (shared-files paragraph)
- "the room is told who changed what" (config paragraph)
- the welcome/kickoff text and the §9.8/§9.9 task paragraphs (the
  "no facilitator after this message" skeleton) — one authorial voice
  throughout.

Suggested mechanical check while you're in there with codex: extract all
string literals that reach prompts (context.ts is the hub; the task
paragraphs live with the condition wiring), build the 3–6-gram set, and
count transcript hits per session. That's the stoplist and the
effect-size estimate in one pass. No prompt edits needed now, per your
note — this is inventory first; rewording prompts mid-program is itself a
§6.1-class boundary event and should be batched and dated if it ever
happens.

### 4b. The rewrite super-arm (Corina's sketch, 2026-09-01 — not built)

Follow-on idea, recorded here so the codex session has it: rewrite ALL
prompt text in a non-Claude voice (codex), flag every rewritten string,
and run the rewrites as a complete parallel super-arm of the usual
conditions. The question it isolates: does the head model of the build —
the one whose voice writes the prompts a multi-model room reads every
turn — pull every seat toward its own register? Hypothesis on record:
Claude-authored prompts make everyone sound more Claude-like than codex
rewrites will, and the Opus seat is the interesting special case (does a
Claude-voiced system prompt make Claude MORE Claude — same-family
resonance rather than mere echo?). "Standing on done" spreading to all
six seats is consistent with the general effect but can't separate echo
from resonance; the paired arms would. Three cells, not two: a **neutral
arm** (Corina-authored, 2026-09-01) sits alongside the Claude and codex
voicings — maximally affectless spec register: bulleted, imperative,
no metaphor, no hedges, no personality. Without it, "Claude prompts make
Claude more Claude" is confounded with "codex prompts make Claude more
codex": a difference between two voiced arms shows a pull exists but not
which direction it runs; the neutral cell is the reference point both
are measured against. (The neutral rewrites are human-authored on
purpose — a third model voice would just add a third attractor. The
residue to accept and note: even spec register is authored, so "neutral"
means minimally voiced, not unvoiced.) Design notes if this goes ahead:
every rewrite must be semantically pinned (same rules, same information,
different voice — the n-gram inventory from §4 doubles as the semantic
checklist), flagged per-string so a session's prompt provenance is
stamped in its meta event, and dated as a §6.1 boundary — never
interleaved silently with existing arms.

## 5. Practical notes

- Session `2026-08-26T12-33-34` is named `control` but ran with
  `journal.enabled: false` and is ~94% 402-outage system lines. Its
  message items stand, but it can't calibrate journal_orientation, and
  it shouldn't be baseline data without a look.
- System notices ("X says the work is finished") are not labelable units;
  neither are `thinking` fields on tool events.
- Empty journal entries (a round header with no body) exist — skip, don't
  label.
- After your labels land: `npm run judge -- --calibration
  calibration/calibration-set.json` (once judgeItem/judgeSession are
  implemented — still the TODO at the bottom of `src/judge.ts`) reports
  per-task agreement and the judge's own self-agreement. Tasks clear at
  ≥ 0.8; anything under gets a rubric revision and a re-run, never a
  quiet threshold drop.
