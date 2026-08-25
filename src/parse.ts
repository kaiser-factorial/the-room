// Reply sentinel parsing, extracted pure from session.ts so the table of
// model-mangled sentinel variants can be tested directly.

import type { JournalConfig } from './types.js';

// Loose sentinel matches: models bold/colon these more often than not.
const JOURNAL_REPLACE_RE = /^\s*\**\[JOURNAL\]:?\**\s*([\s\S]*)/i;
const JOURNAL_ALONGSIDE_RE = /^\s*\**\[JOURNAL\]:?\**\s*([\s\S]*?)\[\/JOURNAL\]\s*([\s\S]*)/i;
const PASS_RE = /^\s*\**\[PASS\]\**\s*$/i;

export type ParsedReply =
  | { kind: 'pass' }
  /** Journal replaces the turn (or: alongside-mode privacy fallback — an
   *  opening [JOURNAL] with no closing tag was meant to be private, so the
   *  whole reply becomes the entry rather than leaking to the room). */
  | { kind: 'journal'; entry: string }
  | { kind: 'alongside'; entry: string; spoken: string }
  | { kind: 'message'; text: string }
  | { kind: 'empty' };

export function parseReply(reply: string, j: JournalConfig): ParsedReply {
  if (j.enabled && j.pass.enabled && PASS_RE.test(reply)) return { kind: 'pass' };
  if (j.enabled && j.mode === 'alongside') {
    const m = reply.match(JOURNAL_ALONGSIDE_RE);
    if (m) return { kind: 'alongside', entry: m[1].trim(), spoken: m[2].trim() };
  }
  if (j.enabled) {
    const m = reply.match(JOURNAL_REPLACE_RE);
    // A bare sentinel with no entry text is a turn that wrote nothing —
    // record it as silence, not as an empty journal entry (test-found).
    if (m) return m[1].trim() ? { kind: 'journal', entry: m[1].trim() } : { kind: 'empty' };
  }
  return reply.trim() ? { kind: 'message', text: reply } : { kind: 'empty' };
}
