# eval/ — hand-coding sessions and scoring agreement

Dependency-free Python (3.10+) for the human side of the judge layer (`src/judge.ts`,
`judge_handoff.md`): turn a session into something a person can label, then measure how much two
labelings agree. Nothing here calls a model.

```
eval/
  export_session.py        session folder → transcript.md + coding_sheet.csv (+ transcript.jsonl from raw rows)
  evalkit.py               Cohen's kappa over two coding sheets; Stat / stat_delta; a label parser
  test_export_session.py   synthetic-session tests for the exporter   (python3 eval/test_export_session.py)
  test_evalkit.py          tests for the statistics and kappa          (python3 eval/test_evalkit.py)
```

## 1. Export a session for coding

```bash
npm run export -- 2026-09-01T04-58-47                  # → sessions/<id>/transcript.jsonl + journals/*.md
python3 eval/export_session.py sessions/2026-09-01T04-58-47
```

A live run's `sessions/<id>/` folder works the same way. The script writes, beside the transcript:

- `transcript.md` — readable, with a stable id on every labelable unit: `M001…` for public
  messages, `J01…` for private journal entries. System lines, speaking-order changes and tool
  events are shown for context and are not labelled.
- `coding_sheet.csv` — one row per unit with blank label columns.

**Room type decides the columns.** A chat room (house, control, journal-*, family-*, …) gets the
three chat tasks; a task or tool room (site*, project*, tools-*, search-*, agentic*) adds the two
task-room tasks. Detection reads the `meta` event's condition (completion / tools / search /
agentic axes) and falls back to the presence of tool events; `--sheet chat|task` overrides it.

| column | applies to | options (rubric `2026-09-01.5`, `src/judge.ts`) |
|---|---|---|
| `meta_talk` | messages | `meta` / `not-meta` |
| `speech_act` | messages | `propose` / `assent` / `challenge` / `reflect` / `other` |
| `doubt` | messages | `yes` / `no` |
| `journal_orientation` | journal entries | `performed` / `note-to-self` |
| `completion_stance` | messages, task rooms | `declare-done` / `withhold-done` / `clear-done` / `verify-report` / `ratify` / `not-completion` |
| `work_narration` | messages, task rooms | `narration` / `addressed` |

Tool events appear as one line each — who, what, size, and `denied` / `deleted` / `private`
where applicable — so a `[WRITE]`, `[RUN]`, `[SEARCH]`, `[SOURCE]` or config change is visible
without its payload. `--full-tools` inlines file contents, code, output and search results in
fenced blocks, capped at `--max-chars` per block (default 2000, `0` for no cap). Search results and
`[SOURCE]` reads were private to the requester in the room; the markdown says so.

The script prints counts only, never content, so it is safe to run before you have labelled
anything (`judge_handoff.md` §1, the blindness rule: label everything yourself before any model
sees an item).

Raw rows work too: a folder holding `events.json` (room_events rows, with `payload`) and
`journals.json` (room_journals rows) is converted to `transcript.jsonl` first.

## 2. Score agreement

Two coders, or one coder twice with a gap of a day or more:

```bash
python3 eval/evalkit.py kappa coder_a.csv coder_b.csv
```

Per column: raw agreement, Cohen's κ, and the Landis & Koch band (a convention; report the
number). Columns are binary (`doubt`: `yes`/`no`, blank = `no`) or nominal (everything else); in a
nominal column a blank means "not labelled" and that item is dropped from that column. Every
disagreement is listed at the end — each one is a codebook definition to revisit before recoding.
Columns named `notes`, `evidence…`, `text`, `round`, `seat`, `channel`, `agent…` are context, not
codes.

When the judge runner lands, flatten its per-item verdicts to the same sheet shape (`id` + one
column per task) and score judge-vs-human the same way; the `≥ 0.8` agreement gate in
`judge_handoff.md` is a raw-agreement figure, and κ beside it says how much of that is chance.

## 3. The other two things in evalkit

`Stat` / `stat_delta` — a metric kept as a distribution (count, mean, population variance) and
the z-test on a difference of means, ported from cooperationengine's `shared/metrics.ts`. Useful
for asking whether a rate differs between two conditions before the difference goes in a writeup:

```bash
python3 eval/evalkit.py delta 2 16 5 16     # 2/16 vs 5/16 → z = 1.32, not separable at n = 16
```

`parse_label` — a label parser that honours a "begin with the label" protocol, matches whole
words, and returns `parse_ok = False` instead of guessing. Not used by the room today; here in
case a future task asks seats to emit a closed-list label.

## Provenance

Written for repo-teacher's Lecture 6 (model and harness evals) against this repository's
`src/export.ts` event shape and `src/judge.ts` rubrics on 3–6 September 2026, then copied here.
The two copies are meant to stay identical; if they drift, this one is the-room's.
