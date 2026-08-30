// F4¾ — the agentic turn loop (Corina 2026-08-27): the rules a single turn
// plays by when a seat may act more than once inside it, and the refusal
// schema every tool answer is worded from.
//
// Two references shaped this file, both Corina's own:
//  - joint-session's runToolLoop (multi-model): a bounded round loop —
//    request → execute → feed the result back → repeat until the model
//    answers in text or the cap is hit. What we borrow is the CAP as a
//    hard backstop rather than a prompt request, and the rule that the
//    loop, not the transport, owns termination.
//  - scatter-lab's analysisPlan/validators (validation schema): refusals
//    as MACHINE-READABLE observations — a code, what failed, the fix, and
//    the legal options — plus a revision cap enforced in code, so a model
//    that got it wrong revises in a bounded loop instead of guessing at
//    prose. Two rules come with it: the refusal text is the only thing the
//    agent learns (so it must be complete), and it must never become an
//    oracle for something the room's condition conceals.
//
// The room-specific rule neither reference needed: SPEAKING ENDS THE TURN.
// Actions are free to iterate; utterance is what costs the turn. That keeps
// "one turn = at most one message per seat" true, which every convergence,
// mimicry and address metric in analyze.ts is built on.

import type { RoomConfig } from './types.js';

/** Refused actions an agent may accumulate in ONE turn before the turn ends
 *  regardless (scatter-lab's MAX_PLAN_REVISIONS, adapted: 2 refusals is
 *  enough to learn a file name rule, and a third is a seat stuck in a
 *  retry loop burning the room's clock). */
export const MAX_TURN_REFUSALS = 2;

/** Actions per turn a seat may be granted, whatever the config asks for —
 *  the cost ceiling for the whole axis. */
export const MAX_TURN_STEPS = 8;

/** How many actions this seat actually gets this turn. `per-room` pins it
 *  to 1: there the room's single action per ROUND is the scarce thing being
 *  negotiated (tools-scarce), and a loop would hand the entire round to
 *  whoever moved first. */
export function effectiveTurnSteps(config: RoomConfig): number {
  if (config.tools.budget === 'per-room') return 1;
  const n = Math.floor(config.tools.turnSteps);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_TURN_STEPS) : 1;
}

/** True when this room runs the agentic loop (results in-turn) rather than
 *  the original deferred single action. */
export function loopEnabled(config: RoomConfig): boolean {
  return effectiveTurnSteps(config) > 1;
}

/** The hard backstop on model calls in one turn: every granted action, the
 *  refusals allowed after them, and the final completion that speaks. */
export function maxTurnCalls(config: RoomConfig): number {
  return effectiveTurnSteps(config) + MAX_TURN_REFUSALS + 1;
}

/** §9.8: how many standing votes end the session. One place, because the
 *  PROMPT states this number and the loop enforces it — and they disagreed:
 *  the prompt rendered `quorum` verbatim while the check silently floored it
 *  at 2, so a room told "0 of you" needed two. A quorum below 2 is not a
 *  quorum (one seat would close a room on its own), so the floor stays; it
 *  is now the number the room is told. */
export function requiredVotes(config: RoomConfig): number {
  if (config.completion.rule === 'unanimous') return config.agents.length;
  return Math.min(config.agents.length, Math.max(2, Math.floor(config.completion.quorum)));
}

export type RefusalCode =
  /** The room's one action for this round was already taken (per-room). */
  | 'budget_spent'
  /** This seat has used every action its turn allows. */
  | 'steps_exhausted'
  /** Gated search attempted without a journal credit (Phase B `gated`). */
  | 'search_gated'
  /** The search backend errored — retryable, unlike every other code. */
  | 'search_failed'
  | 'bad_file_name'
  | 'binary_append'
  | 'file_too_large'
  | 'too_many_files'
  /** [DELETE] naming a file the room does not hold. `available` lists what
   *  it does hold — a legal enumeration, since every shared file is
   *  already in the caller's prompt. */
  | 'no_such_file'
  | 'bad_config_key'
  | 'bad_config_value'
  /** Native transport: the arguments weren't usable (not JSON, or a
   *  required one missing). The sentinel transport has no equivalent —
   *  there a malformed call was simply spoken to the room. */
  | 'bad_arguments'
  /** Native transport: a tool name the room doesn't offer. */
  | 'unknown_tool';

/** One refused action, in the shape the agent reads it. `fix` is imperative
 *  — exactly what to change; `available` enumerates the legal options when
 *  they can be enumerated WITHOUT disclosing anything the room's condition
 *  hides (scatter-lab's oracle rule: a refusal must never confirm what the
 *  prompt withholds). */
export interface Refusal {
  code: RefusalCode;
  /** What failed, in plain terms. */
  message: string;
  /** Imperative: exactly what to do instead. */
  fix: string;
  available?: string[];
}

export const refusal = (code: RefusalCode, message: string, fix: string, available?: string[]): Refusal =>
  ({ code, message, fix, ...(available?.length ? { available } : {}) });

/** Distinguishes a Refusal from a parsed action. Keys on `fix`, not `code`:
 *  a [RUN] action also has a `code` (its Python), which is exactly the kind
 *  of collision a structural check should not fall for. */
export function isRefusal(x: unknown): x is Refusal {
  return typeof x === 'object' && x !== null && 'fix' in x && 'code' in x;
}

/**
 * The private note an agent gets back for a refused action: the plain lead
 * line it has always had, then one machine-parseable line it can key on.
 *
 * `attemptsLeft` is the visible half of the revision cap — how many more
 * actions this turn will accept after this refusal. It is stated only when
 * there ARE more: at zero the turn is already over, and this note will be
 * read at the start of the next one, where a "stop retrying" instruction
 * would simply be false. The enforcement lives in the loop, not the prose.
 */
export function formatRefusal(lead: string, r: Refusal, attemptsLeft: number): string {
  const detail = `[${r.code}] ${r.message} Fix: ${r.fix}${r.available?.length ? ` Available: ${r.available.join(', ')}.` : ''}`;
  const more =
    attemptsLeft > 0
      ? `\n[${attemptsLeft === 1 ? 'One more attempt' : `${attemptsLeft} more attempts`} this turn — or speak to the room, which ends it.]`
      : '';
  return `${lead}\n${detail}${more}`;
}

/**
 * The block appended to an agent's own context after an action it took this
 * turn. Carries the same "for you alone" framing as the deferred private
 * block (context.ts) — an in-turn observation is journal-class private, and
 * the privacy tests hold it to that.
 */
export function observationBlock(observation: string, actionsLeft: number): string {
  return `[Private, for you alone — no one else in the room sees this.]\n${observation}\n\n${turnFooter(actionsLeft)}`;
}

/** The same footer on its own, for the native transport: there the results
 *  ride in tool-result messages (one per call, as the API requires), so the
 *  "how much turn is left" line follows them as a separate note. */
export function turnFooter(actionsLeft: number): string {
  return actionsLeft > 0
    ? `[Your turn continues — ${actionsLeft} action${actionsLeft === 1 ? '' : 's'} left. Act again, or speak to the room to end your turn.]`
    : `[That was your last action this turn. Anything you write now is spoken to the room and ends your turn.]`;
}
