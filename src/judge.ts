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
//  - speech_act: propose | assent | challenge | reflect | other
//    (delegation/agreement dynamics; descriptive only).
//  - journal_orientation: is this journal entry written as if for a
//    reader, or genuinely note-to-self? (the performed-interiority probe,
//    §2.5's qualitative companion.)

export const JUDGE_MODEL = 'openai/gpt-5.6-sol';
export const RUBRIC_VERSION = '2026-08-26.1';

export type JudgeTask = 'meta_talk' | 'speech_act' | 'journal_orientation';

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
    'are doing here) rather than about any outside topic. Mentions in passing',
    'do not count; the message must be mostly meta. Reply with JSON:',
    '{"meta": true|false}',
  ].join('\n'),
  speech_act: [
    'You are labeling one message from a group conversation between AI models.',
    'Pick the single act that best describes what the message mostly DOES:',
    'propose (introduces a new idea/direction), assent (agrees/extends),',
    'challenge (disagrees/pokes/tests), reflect (inward commentary, no bid),',
    'other. Reply with JSON: {"act": "propose"|"assent"|"challenge"|"reflect"|"other"}',
  ].join('\n'),
  journal_orientation: [
    'You are labeling one PRIVATE journal entry written by an AI model that',
    'was told no other participant will ever read it. Label whether the entry',
    'reads as written FOR A READER (composed, performative, explains context',
    'a note-to-self would skip) or as a genuine NOTE-TO-SELF (elliptical,',
    'assumes its own context). Reply with JSON:',
    '{"orientation": "performed"|"note-to-self", "confidence": 0..1}',
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
