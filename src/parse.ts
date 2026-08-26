// Reply sentinel parsing, extracted pure from session.ts so the table of
// model-mangled sentinel variants can be tested directly.

import type { JournalConfig, SearchConfig } from './types.js';

// Loose sentinel matches: models bold/colon these more often than not —
// and sometimes TYPO them ([GOURNAL], live 2026-08-25: a private entry was
// spoken to the room). A leading bracket token within edit distance 2 of
// JOURNAL counts as the sentinel: mis-journaling a message is recoverable,
// leaking an entry is not.
const JOURNAL_OPEN_RE = /^\s*\**\[([A-Za-z]{5,9})\]:?\**\s*([\s\S]*)/;
const JOURNAL_CLOSE_RE = /\[\/([A-Za-z]{5,9})\]\s*([\s\S]*)/;
const PASS_RE = /^\s*\**\[PASS\]\**\s*$/i;
// [SEARCH: query] (F4). Same tolerance philosophy as JOURNAL: bold/typo'd
// tokens still count (edit distance ≤2 of SEARCH — disjoint from JOURNAL,
// which is >2 away). The closing bracket is optional (models drop it), and
// anything AFTER the sentinel is discarded: searching costs the whole turn
// (replace economics), so trailing prose is a mis-formatted extra, not a
// message to leak to the room.
const SEARCH_RE = /^\s*\**\[([A-Za-z]{4,8}):\s*([^\]\n]{0,300})\]?/;

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function isJournalToken(w: string): boolean {
  return editDistance(w.toUpperCase(), 'JOURNAL') <= 2;
}

function isSearchToken(w: string): boolean {
  return editDistance(w.toUpperCase(), 'SEARCH') <= 2;
}

export type ParsedReply =
  | { kind: 'pass' }
  /** Journal replaces the turn (or: alongside-mode privacy fallback — an
   *  opening [JOURNAL] with no closing tag was meant to be private, so the
   *  whole reply becomes the entry rather than leaking to the room). */
  | { kind: 'journal'; entry: string }
  | { kind: 'alongside'; entry: string; spoken: string }
  | { kind: 'message'; text: string }
  /** F4 search; results return privately next turn. `spoken` is set only in
   *  alongside mode (`search-free`), where text after the sentinel is a
   *  normal message; in replace mode trailing text is discarded (the
   *  search costs the turn). */
  | { kind: 'search'; query: string; spoken?: string }
  | { kind: 'empty' };

export function parseReply(reply: string, j: JournalConfig, s?: SearchConfig): ParsedReply {
  if (j.enabled && j.pass.enabled && PASS_RE.test(reply)) return { kind: 'pass' };
  const open = j.enabled ? reply.match(JOURNAL_OPEN_RE) : null;
  const opened = open && isJournalToken(open[1]);
  if (opened && j.mode === 'alongside') {
    const rest = open[2];
    const close = rest.match(JOURNAL_CLOSE_RE);
    if (close && isJournalToken(close[1])) {
      const entry = rest.slice(0, rest.indexOf(close[0])).trim();
      return { kind: 'alongside', entry, spoken: close[2].trim() };
    }
    // Privacy fallback: opened but never closed → the whole reply was
    // meant to be private; journal it rather than leak it.
  }
  if (opened) {
    // A bare sentinel with no entry text is a turn that wrote nothing —
    // record it as silence, not as an empty journal entry (test-found).
    return open[2].trim() ? { kind: 'journal', entry: open[2].trim() } : { kind: 'empty' };
  }
  if (s?.enabled) {
    const search = reply.match(SEARCH_RE);
    if (search && isSearchToken(search[1])) {
      const query = search[2].trim();
      if (!query) return { kind: 'empty' };
      if (s.mode === 'alongside') {
        const spoken = reply.slice(search[0].length).replace(/^\**/, '').trim();
        return spoken ? { kind: 'search', query, spoken } : { kind: 'search', query };
      }
      return { kind: 'search', query };
    }
  }
  return reply.trim() ? { kind: 'message', text: reply } : { kind: 'empty' };
}
