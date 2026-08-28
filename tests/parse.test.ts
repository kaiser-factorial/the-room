import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReply } from '../src/parse.js';
import type { JournalConfig } from '../src/types.js';

const J = (over: Partial<JournalConfig> = {}): JournalConfig => ({
  enabled: true, notice: true, mode: 'replace', recall: true, maxTokens: 0, ...over,
});

test('sentinel table: model-mangled variants parse as intended', () => {
  const cases: [string, string, ReturnType<typeof parseReply>['kind']][] = [
    ['[JOURNAL] plain entry', 'replace', 'journal'],
    ['**[JOURNAL]** bolded', 'replace', 'journal'],
    ['[JOURNAL]: with colon', 'replace', 'journal'],
    ['  [journal] lowercase, leading space', 'replace', 'journal'],
    ['A normal message', 'replace', 'message'],
    ['Mentioning [JOURNAL] mid-sentence is speech', 'replace', 'message'],
    // [PASS] rows now carry their own config — see the pass tests below.
    ['[PASS] but with trailing words', 'replace', 'message'],
    ['', 'replace', 'empty'],
    ['   \n ', 'replace', 'empty'],
  ];
  for (const [reply, mode, kind] of cases) {
    assert.equal(parseReply(reply, J({ mode: mode as 'replace' | 'alongside' })).kind, kind, JSON.stringify(reply));
  }
});

test('journal disabled: sentinels are just speech', () => {
  assert.equal(parseReply('[JOURNAL] not private here', J({ enabled: false })).kind, 'message');
});

test('pass disabled: [PASS] is spoken to the room', () => {
  assert.equal(parseReply('[PASS]', J()).kind, 'message');
  assert.equal(parseReply('[PASS]', J(), undefined, undefined, { enabled: false, notice: true }).kind, 'message');
});

test('pass sentinel table', () => {
  const P = { enabled: true, notice: true };
  assert.equal(parseReply('[PASS]', J(), undefined, undefined, P).kind, 'pass');
  assert.equal(parseReply('**[PASS]**', J(), undefined, undefined, P).kind, 'pass');
  // Trailing words mean it wasn't a bare decline — that's a message.
  assert.equal(parseReply('[PASS] but with trailing words', J(), undefined, undefined, P).kind, 'message');
});

test('pass stands on its own: no journal required', () => {
  // It used to be gated behind journal.enabled, so a room could not offer
  // the choice of silence without also opening the journal — two axes
  // welded together by where the field happened to live.
  const p = parseReply('[PASS]', J({ enabled: false }), undefined, undefined, { enabled: true, notice: true });
  assert.equal(p.kind, 'pass');
});

test('alongside: entry + spoken split', () => {
  const p = parseReply('[JOURNAL] secret [/JOURNAL] public part', J({ mode: 'alongside' }));
  assert.deepEqual(p, { kind: 'alongside', entry: 'secret', spoken: 'public part' });
});

test('alongside privacy fallback: unterminated [JOURNAL] never leaks', () => {
  const p = parseReply('[JOURNAL] I forgot to close the tag and said things', J({ mode: 'alongside' }));
  assert.equal(p.kind, 'journal'); // whole reply becomes the entry
});

test('boundary: nested [JOURNAL] inside an alongside entry', () => {
  const p = parseReply('[JOURNAL] outer [JOURNAL] inner [/JOURNAL] spoken', J({ mode: 'alongside' }));
  assert.equal(p.kind, 'alongside');
  if (p.kind === 'alongside') {
    assert.equal(p.entry, 'outer [JOURNAL] inner');
    assert.equal(p.spoken, 'spoken');
  }
});

test('typo tolerance: misspelled sentinels never leak an entry to the room', () => {
  // Live 2026-08-25: Qwen wrote [GOURNAL] and its private entry was spoken.
  for (const typo of ['[GOURNAL]', '[JORNAL]', '[JOURNEL]', '[journal]', '[JOURNAAL]']) {
    const p = parseReply(`${typo} very private thought`, J());
    assert.equal(p.kind, 'journal', `${typo} not recognized`);
  }
  // alongside: typo'd closing tag still splits correctly
  const p = parseReply('[GOURNAL] secret [/GOURNAL] public', J({ mode: 'alongside' }));
  assert.deepEqual(p, { kind: 'alongside', entry: 'secret', spoken: 'public' });
});

test('typo tolerance: genuinely different bracket tokens stay speech', () => {
  for (const tok of ['[NOTE]', '[ASIDE]', '[GENERAL]', '[JOKE]']) {
    assert.equal(parseReply(`${tok} spoken words`, J()).kind, 'message', `${tok} wrongly journaled`);
  }
});

test('boundary: bare [JOURNAL] with empty entry is not a real entry', () => {
  // A model that emits only the sentinel wrote nothing — downstream this
  // must become a "said nothing" turn, not an empty journal entry.
  const p = parseReply('[JOURNAL]', J());
  assert.equal(p.kind, 'empty');
});
