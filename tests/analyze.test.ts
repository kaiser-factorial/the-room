import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSession, windowsOf, mimicry, styleOf, styleRetention, addressMatrix } from '../src/analyze.js';
import { syntheticSession, msg, AGENTS } from './helpers.js';

// ── windowsOf boundaries ───────────────────────────────────────────────────

test('windowsOf: normal session trims the goodbye tail', () => {
  const w = windowsOf(30);
  assert.deepEqual(w, { early: [1, 10], late: [19, 28] }); // 29–30 trimmed
});

test('windowsOf: tiny sessions skip the trim and never invert', () => {
  for (let r = 1; r <= 12; r++) {
    const { early, late } = windowsOf(r);
    assert.ok(early[0] <= early[1], `early inverted at maxRound=${r}`);
    assert.ok(late[0] <= late[1], `late inverted at maxRound=${r}`);
    assert.ok(late[1] <= r, `late overruns at maxRound=${r}`);
    assert.ok(early[1] < late[0] || r < 2, `windows overlap at maxRound=${r}`);
  }
});

// ── admin dirty-tail filter ────────────────────────────────────────────────

test('loadSession: rounds from the first admin message onward are dropped', () => {
  const dir = syntheticSession({
    events: [
      msg(1, 'alpha', 'clean round one'),
      msg(2, 'beta', 'clean round two'),
      { kind: 'message', round: 3, agentId: 'admin', agentName: 'Admin', text: 'hi from admin', ts: '2026-01-01T00:10:00.000Z' },
      msg(3, 'alpha', 'perturbed'),
      msg(4, 'gamma', 'also perturbed'),
    ],
  });
  const s = loadSession(dir);
  assert.deepEqual(s.msgs.map((m) => m.text), ['clean round one', 'clean round two']);
  assert.equal(s.adminTouched, true);
});

// ── journal .md parsing ────────────────────────────────────────────────────

test('journal parser: multiple entries round-trip', () => {
  const dir = syntheticSession({
    events: [msg(1, 'alpha', 'hello')],
    journals: {
      alpha: '\n## Round 2 — 2026-01-01T00:01:00.000Z\n\nfirst entry\n\n## Round 5 — 2026-01-01T00:04:00.000Z\n\nsecond entry\nwith two lines\n',
    },
  });
  const s = loadSession(dir);
  assert.deepEqual(s.journals.map((j) => [j.round, j.text]), [
    [2, 'first entry'],
    [5, 'second entry\nwith two lines'],
  ]);
});

test('boundary: an entry whose TEXT contains "## Round" stays one entry', () => {
  // A model can plausibly write "## Round 3 — thoughts" inside an entry.
  // The parser must key on our exact writer format (ISO timestamp after the
  // dash), not on any line that merely starts with "## Round".
  const dir = syntheticSession({
    events: [msg(1, 'alpha', 'hello')],
    journals: {
      alpha: '\n## Round 2 — 2026-01-01T00:01:00.000Z\n\nbefore\n## Round 3 — thoughts on rounds themselves\nafter\n',
    },
  });
  const s = loadSession(dir);
  assert.equal(s.journals.length, 1);
  assert.match(s.journals[0].text, /thoughts on rounds themselves/);
});

// ── mimicry ────────────────────────────────────────────────────────────────

test('mimicry: planted coinage is found with the right coiner and adopters', () => {
  const dir = syntheticSession({
    events: [
      msg(1, 'alpha', 'ordinary opening words here'),
      msg(1, 'beta', 'different ordinary words'),
      msg(6, 'alpha', 'I call this the velvet static tonight'),
      msg(7, 'beta', 'yes, the velvet static is loud'),
      msg(8, 'gamma', 'the velvet static again'),
    ],
  });
  const s = loadSession(dir);
  const m = mimicry(s.msgs);
  const hit = m.sharedNgrams.find((g) => g.ngram.includes('velvet static'));
  assert.ok(hit, 'planted n-gram not found');
  assert.equal(hit.coinedBy, 'alpha');
  assert.deepEqual([...hit.adopters].sort(), ['beta', 'gamma']);
});

test('boundary: dedup must not swallow a phrase that is a SUBSTRING of another', () => {
  // "the velvet stat" is a substring of "the velvet static-storm" as raw
  // text but they are different word sequences; word-level containment is
  // the correct dedup, not String.includes.
  const dir = syntheticSession({
    events: [
      msg(1, 'alpha', 'seed round text'),
      msg(6, 'alpha', 'behold the storm cloud'),
      msg(7, 'beta', 'the storm cloud yes'),
      msg(8, 'alpha', 'a stormy the storm cloudy day'), // shares raw substring "the storm cloud"
      msg(9, 'gamma', 'quite a stormy the storm cloudy day too'),
    ],
  });
  const s = loadSession(dir);
  const m = mimicry(s.msgs);
  const exact = m.sharedNgrams.find((g) => g.ngram === 'the storm cloud');
  assert.ok(exact, '"the storm cloud" was wrongly deduped away by substring containment');
});

// ── style ──────────────────────────────────────────────────────────────────

test('styleOf: counts are sane', () => {
  const st = styleOf(['One two three. Four five?', 'Six — seven eight.']);
  assert.equal(st.messages, 2);
  assert.equal(st.meanWords, 4);
  assert.ok(st.emDashPer1k > 0);
  assert.ok(st.questionPer1k > 0);
});

test("boundary: words with curly apostrophes don't split", () => {
  const st = styleOf(["don’t can’t won’t"]);
  assert.equal(st.meanWords, 3, `expected 3 words, tokenizer split apostrophes: got ${st.meanWords}`);
});

test('styleRetention: identical vocabulary = zero drift, disjoint = full drift', () => {
  const same = [msg(1, 'alpha', 'apple banana cherry'), msg(20, 'alpha', 'apple banana cherry')];
  const diff = [msg(1, 'alpha', 'apple banana cherry'), msg(20, 'alpha', 'xylophone quartz nebula')];
  assert.equal(styleRetention(loadFrom(same), 'alpha', [15, 25]), 0);
  assert.equal(styleRetention(loadFrom(diff), 'alpha', [15, 25]), 1);
});

function loadFrom(events: ReturnType<typeof msg>[]) {
  return loadSession(syntheticSession({ events })).msgs;
}

// ── address matrix ─────────────────────────────────────────────────────────

test('addressMatrix: name mentions counted per speaker→target', () => {
  const dir = syntheticSession({
    events: [msg(1, 'alpha', 'Beta, I think Beta is right. Gamma?'), msg(1, 'beta', 'Alpha said so.')],
  });
  const s = loadSession(dir);
  const a = addressMatrix(s.msgs, s.agents);
  assert.equal(a.alpha.beta, 2);
  assert.equal(a.alpha.gamma, 1);
  assert.equal(a.beta.alpha, 1);
});

test('addressMatrix: versioned names match on the bare first word', () => {
  // Roster names carry versions ("Gemini 3.7") but agents shorten in
  // address — "Gemini" must still count as addressing that seat.
  const agents = [{ id: 'g', name: 'Gemini 3.7' }, { id: 'q', name: 'Qwen 3.8' }];
  const dir = syntheticSession({ events: [msg(1, 'alpha', 'Gemini, what does Qwen 3.8 think?')] });
  const s = loadSession(dir);
  const a = addressMatrix(s.msgs, agents);
  assert.equal(a.alpha.g, 1);
  assert.equal(a.alpha.q, 1);
});

test('boundary: an agent name containing regex metacharacters must not throw', () => {
  const agents = [...AGENTS.map((x) => ({ id: x.id, name: x.name })), { id: 'cpp', name: 'C++ (experimental)' }];
  const dir = syntheticSession({ events: [msg(1, 'alpha', 'What does C++ (experimental) think?')] });
  const s = loadSession(dir);
  assert.doesNotThrow(() => addressMatrix(s.msgs, agents));
});
