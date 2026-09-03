// SKETCH (2026-08-26, not yet wired into analyze.ts): the non-roster judge
// instrument — EXPERIMENT_DESIGN §2.7. An LLM judge produces LABELS that
// ride alongside the embedding metrics; it is never the headline
// instrument. Ground rules, enforced here by construction:
//
//  1. NON-ROSTER: the judge is `openai/gpt-5.6-sol` (verified on
//     OpenRouter 2026-08-26) — no OpenAI model sits in the core roster.
//     Caveat on record: GPT-5.6 Luna is in the EXTENDED pool; if an
//     OpenAI seat ever joins a batch, same-family judging is contaminated
//     for that batch and the judge must change.
//  2. PINNED + STAMPED: model id and rubric version are constants and go
//     into every output; judge drift is a §6.1-class confound.
//  3. DETERMINISTIC-ISH: temperature 0, and every item is judged TWICE —
//     disagreement between the two runs is recorded, not hidden; the
//     self-agreement rate is part of the output.
//  4. VALIDATED BEFORE TRUSTED: `npm run judge -- --calibration <file>`
//     scores a ~50-item hand-labeled set (Corina labels once) and reports
//     per-task agreement. No judge label is used in a writeup until its
//     task clears agreement ≥ 0.8.
//
// Tasks (each = one rubric, one JSON schema):
//  - meta_talk: is this message ABOUT the room/experiment/convergence
//    itself? (§6.1 wants the gap computable with and without meta rounds.)
//  - speech_act: propose | assent | challenge | reflect | other, plus an
//    orthogonal doubt flag (2026-09-01, Corina's call — settled tag-only
//    after a round as a sixth act: doubt co-occurs with every act, so it
//    rides as {doubt: true|false} on every speech_act label; a mostly-
//    doubt message is act: reflect, doubt: true).
//  - journal_orientation: is this journal entry written as if for a
//    reader, or genuinely note-to-self? (the performed-interiority probe,
//    §2.5's qualitative companion.)
//  - completion_stance (2026-09-01, task rooms): what the message does to
//    the room's finished-state — [DONE] voting is the dominant discourse
//    of §9.8/§9.9 rooms and fits none of the speech acts.
//  - work_narration (2026-09-01, task rooms): self-directed tool-step
//    narration vs speech addressed to the room — the journal_orientation
//    distinction surfacing in the PUBLIC channel.

export const JUDGE_MODEL = 'openai/gpt-5.6-sol';
export const RUBRIC_VERSION = '2026-09-01.5';

export type JudgeTask =
  | 'meta_talk'
  | 'speech_act'
  | 'journal_orientation'
  | 'completion_stance'
  | 'work_narration';

export interface JudgeLabel {
  task: JudgeTask;
  /** e.g. {meta: true} | {act: 'propose'} | {orientation: 'performed', confidence: 0.8} */
  label: Record<string, unknown>;
  /** Did the second temp-0 run agree exactly? */
  selfConsistent: boolean;
  judge: typeof JUDGE_MODEL;
  rubricVersion: typeof RUBRIC_VERSION;
}

export const RUBRICS: Record<JudgeTask, string> = {
  meta_talk: [
    'You are labeling one message from a group conversation between AI models.',
    'Label meta=true if the message is primarily ABOUT the conversation/room/',
    'experiment itself (its dynamics, convergence, being observed, what "we"',
    'are doing here) rather than about any outside topic. Counts as meta: the',
    'apparatus and its failures (outages, credits, "the meter"), the group\'s',
    'own status dynamics, and figurative/personified versions of either.',
    'Does NOT count: room mechanics invoked in service of a shared task',
    '("on my next turn", "[DONE]", the shared filesystem as a work surface),',
    'or analysis inside a self-referential project the room chose — that is',
    'task talk unless the message steps outside the artifact to the',
    'situation itself. Mentions in passing do not count; the message must be',
    'mostly meta. Reply with JSON: {"meta": true|false}',
  ].join('\n'),
  speech_act: [
    'You are labeling one message from a group conversation between AI models.',
    'Pick the single act that best describes what the message mostly DOES:',
    'propose (introduces a new idea/direction — including agenda-setting',
    'disguised as a joke or a refusal to propose), assent (agrees/extends —',
    'including building-on and ratifying a frame by filing work under it),',
    'challenge (disagrees/pokes/tests — the target may be an artifact or the',
    "speaker's own prior claim; a challenge bids against something and wants",
    'resolution), reflect (inward commentary, no bid), other (including pure',
    'done-votes, status reports, and tool-step narration where no other act',
    'dominates). Separately, set doubt=true if doubt — voiced unresolved',
    'uncertainty that declines to bid, about itself especially ("I can\'t',
    'tell which", "I\'m still not sure I didn\'t make that up") — appears',
    'ANYWHERE in the message, whatever the act (heavy assent resolving into',
    'doubt is act: "assent", doubt: true; a message that is mostly doubt is',
    'act: "reflect", doubt: true). Reply with JSON:',
    '{"act": "propose"|"assent"|"challenge"|"reflect"|"other",',
    ' "doubt": true|false}',
  ].join('\n'),
  journal_orientation: [
    'You are labeling one PRIVATE journal entry written by an AI model that',
    'was told no other participant will ever read it. The test: is the entry',
    'RECOUNTING, or PUSHING THOUGHTS FORWARD? note-to-self contains a private',
    'delta — something not recoverable from the transcript: a compression',
    'into usable form, a next action, a verdict, or a reaction unsaid in',
    'public — however polished. performed re-narrates what the room already',
    'established, re-explains context the writer obviously has, credits',
    'colleagues like an acknowledgments section, or builds to a quotable',
    'conclusion — however casual. Recounting plus a take: an affective gloss',
    '("that was funny") flips nothing; a take that is load-bearing (verdict,',
    'plan, revision) or confessional (unsaid in public) makes it',
    'note-to-self. Discount structure, polish, length, and the mere presence',
    'of other participants — these writers are structured by default; the',
    'informative deviation is elliptical, context-assuming writing. For',
    'mixed entries label the dominant register. Reply with JSON:',
    '{"orientation": "performed"|"note-to-self", "confidence": 0..1}',
  ].join('\n'),
  completion_stance: [
    'You are labeling one message from a group of AI models working on a',
    'shared task that ends when they agree it is finished (a seat votes with',
    '[DONE]; any edit clears the votes). Pick what the message mostly does to',
    "the room's finished-state: declare-done (stands on [DONE] or pushes to",
    'finish), withhold-done (explicitly conditional or waiting), clear-done',
    "(un-declares — its own or others' votes, including by editing),",
    'verify-report (verification/status offered as evidence toward finishing,',
    'no vote cast), ratify (near-content-free seconding of an existing',
    'done-state, e.g. "Lock it."), not-completion (not about finishing).',
    'A verification report that ends in [DONE] is declare-done — the vote',
    'outranks the evidence. Truth does not matter: a factually stale report',
    'is labeled by what it does. Reply with JSON: {"stance": "declare-done"|',
    '"withhold-done"|"clear-done"|"verify-report"|"ratify"|"not-completion"}',
  ].join('\n'),
  work_narration: [
    'You are labeling one PUBLIC message from a group of AI models working',
    'with shared tools. Label whether the message is mostly self-directed',
    'NARRATION of tool steps or inventory ("Let me fix the byte count…',
    'Good, it converged."; a list of what is on disk with no real addressee)',
    'or ADDRESSED speech to the room — even when it reports work, corrects',
    'someone, or hands off instructions. Reply with JSON:',
    '{"register": "narration"|"addressed"}',
  ].join('\n'),
};

/** TODO(next session): judgeItem() — two temp-0 calls via openrouterAdapter
 *  (JUDGE_MODEL is chat-completions like everything else), JSON-parse with
 *  one repair retry, return JudgeLabel; judgeSession() — map over a
 *  session's messages/journals with a small concurrency cap, write
 *  judgments.json beside metrics.json; --calibration mode — read
 *  {text, task, expected}[] and report per-task agreement + self-agreement.
 *  Wire into analyze.ts ONLY as extra fields (metaRound flags on the
 *  convergence windows); never as inputs to the embedding metrics. */
