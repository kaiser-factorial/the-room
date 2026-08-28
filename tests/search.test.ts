// F4 websearch: sentinel parsing, the privacy rule (query/results are
// requester-private, journal-class), gating economics, and event flow.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseReply } from '../src/parse.js';
import { audibleEvents, buildTurnMessages } from '../src/context.js';
import { testConfig, runStubSession, AGENTS } from './helpers.js';
import type { JournalConfig, RoomEvent, SearchConfig } from '../src/types.js';

const J: JournalConfig = { enabled: false, notice: true, mode: 'replace', recall: true, maxTokens: 0 };
const S = (over: Partial<SearchConfig> = {}): SearchConfig => ({ enabled: true, mode: 'replace', gated: false, notice: true, maxResults: 5, ...over });

function readTranscript(dir: string): RoomEvent[] {
  return readFileSync(join(dir, 'transcript.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as RoomEvent);
}

test('search sentinel table: mangled variants parse as intended', () => {
  const cases: [string, ReturnType<typeof parseReply>['kind'], string?][] = [
    ['[SEARCH: bread clips]', 'search', 'bread clips'],
    ['**[SEARCH: bolded query]**', 'search', 'bolded query'],
    ['[search: lowercase]', 'search', 'lowercase'],
    ['[SEACH: typo one off]', 'search', 'typo one off'],
    ['[SERCH: typo missing letter]', 'search', 'typo missing letter'],
    ['[SEARCH: no closing bracket', 'search', 'no closing bracket'],
    // Trailing prose after the sentinel is discarded (search costs the turn).
    ['[SEARCH: query] and then I said things', 'search', 'query'],
    ['A message mentioning [SEARCH: x] mid-sentence stays speech', 'message'],
    ['[SEARCH:]', 'empty'],
    ['[NOTES: not a search]', 'message'],
    ['plain speech', 'message'],
  ];
  for (const [reply, kind, query] of cases) {
    const p = parseReply(reply, J, S());
    assert.equal(p.kind, kind, JSON.stringify(reply));
    if (query) assert.equal(p.kind === 'search' && p.query, query);
  }
});

test('alongside mode: sentinel line + spoken remainder split; replace mode discards it', () => {
  const p = parseReply('[SEARCH: bread clips]\nAnyway, as I was saying.', J, S({ mode: 'alongside' }));
  assert.deepEqual(p, { kind: 'search', query: 'bread clips', spoken: 'Anyway, as I was saying.' });
  const bare = parseReply('[SEARCH: bread clips]', J, S({ mode: 'alongside' }));
  assert.deepEqual(bare, { kind: 'search', query: 'bread clips' });
  const replace = parseReply('[SEARCH: bread clips] trailing prose', J, S());
  assert.deepEqual(replace, { kind: 'search', query: 'bread clips' });
});

test('search-free session: search and speech land in the same turn, query still private', async () => {
  const config = testConfig({ maxRounds: 1, search: S({ mode: 'alongside' }) });
  const dir = await runStubSession(config, 'search-speak');
  const events = readTranscript(dir);
  const searches = events.filter((e) => e.kind === 'search');
  const msgs = events.filter((e) => e.kind === 'message');
  assert.equal(searches.length, 3, 'every seat searched');
  assert.equal(msgs.length, 3, 'every seat also spoke');
  for (const m of msgs) {
    assert.ok(m.kind === 'message' && !m.text.includes('private-query'), 'query leaked into the spoken message');
  }
  // One turn, one trace: never on both the search event and the message.
  for (const round of [1]) {
    for (const agent of ['alpha', 'beta', 'gamma']) {
      const s = searches.find((e) => e.kind === 'search' && e.agentId === agent);
      const m = msgs.find((e) => e.kind === 'message' && e.agentId === agent);
      assert.ok(!(s && 'thinking' in s && s.thinking && m && m.thinking), `duplicate trace for ${agent} round ${round}`);
    }
  }
});

test('search disabled (control): the sentinel is just speech', () => {
  assert.equal(parseReply('[SEARCH: anything]', J, S({ enabled: false })).kind, 'message');
  assert.equal(parseReply('[SEARCH: anything]', J).kind, 'message');
});

test('journal and search sentinels stay disjoint', () => {
  const jOn: JournalConfig = { ...J, enabled: true };
  assert.equal(parseReply('[JOURNAL] private thought', jOn, S()).kind, 'journal');
  assert.equal(parseReply('[SEARCH: a query]', jOn, S()).kind, 'search');
});

test('session flow: search spends the turn, results return privately, room hears only the notice', async () => {
  const config = testConfig({ maxRounds: 2, search: S() });
  const dir = await runStubSession(config, 'search,plain,plain');
  const events = readTranscript(dir);

  const searches = events.filter((e) => e.kind === 'search');
  assert.ok(searches.length >= 1, 'no search event recorded');
  for (const s of searches) {
    assert.ok(s.kind === 'search' && !s.denied && s.results && s.results.includes(s.query), 'search event missing results');
    assert.ok(s.kind === 'search' && s.query.startsWith('private-query'), 'stub query marker missing');
  }

  // Privacy: query/results never in the transcript's audible text, and the
  // audible rendering of a search is the bare notice line.
  for (const e of events) {
    if ('text' in e && e.text) {
      assert.ok(!e.text.includes('private-query'), `query leaked into a ${e.kind} event`);
      assert.ok(!e.text.includes('Stub result'), `results leaked into a ${e.kind} event`);
    }
  }

  // Context privacy: no agent's prompt (without a pending delivery) carries
  // the query or results; the requester gets them ONLY via pendingSearch.
  for (const agent of AGENTS) {
    const prompt = buildTurnMessages({ agent, config, events, summary: '', minutesRemaining: 3, ownJournal: '' })
      .map((m) => m.content).join('\n');
    assert.ok(!prompt.includes('private-query'), `query leaked into ${agent.id}'s context`);
    assert.ok(!prompt.includes('Stub result'), `results leaked into ${agent.id}'s context`);
    if (searches.some((s) => s.kind === 'search' && s.notice)) {
      assert.match(prompt, /looked something up on the web/);
    }
  }
  const withPending = buildTurnMessages({
    agent: AGENTS[0], config, events, summary: '', minutesRemaining: 3, ownJournal: '',
    privateBlock: 'Results of your web search for "x":\n1. Stub result',
  }).map((m) => m.content).join('\n');
  assert.match(withPending, /Private, for you alone/);
  assert.match(withPending, /Stub result/);
});

test('notice off: search events exist for the log but are inaudible', async () => {
  const config = testConfig({ maxRounds: 1, search: S({ notice: false }) });
  const dir = await runStubSession(config, 'search');
  const events = readTranscript(dir);
  const searches = events.filter((e) => e.kind === 'search');
  assert.equal(searches.length, 3, 'every seat searched');
  assert.equal(audibleEvents(searches).length, 0, 'silent search became audible');
});

test('gated: search without a journal credit is denied, and denials are never audible', async () => {
  const config = testConfig({
    maxRounds: 1,
    journal: { ...J, enabled: true },
    search: S({ gated: true }),
  });
  const dir = await runStubSession(config, 'search');
  const searches = readTranscript(dir).filter((e) => e.kind === 'search');
  assert.equal(searches.length, 3);
  for (const s of searches) assert.ok(s.kind === 'search' && s.denied, 'ungated search slipped through the gate');
  assert.equal(audibleEvents(searches).length, 0, 'a denied search was audible');
});

test('gated: a journal entry unlocks exactly one search', async () => {
  const config = testConfig({
    maxRounds: 3,
    journal: { ...J, enabled: true },
    search: S({ gated: true }),
  });
  // Round 1: everyone journals (3 credits). Round 2: everyone searches
  // (allowed, credits spent). Round 3: everyone searches again (denied).
  const dir = await runStubSession(config, 'journal,journal,journal,search,search,search,search,search,search');
  const searches = readTranscript(dir).filter((e) => e.kind === 'search');
  const allowed = searches.filter((e) => e.kind === 'search' && !e.denied);
  const denied = searches.filter((e) => e.kind === 'search' && e.denied);
  assert.equal(allowed.length, 3, 'each journal entry should unlock one search');
  assert.equal(denied.length, 3, 'credits must not stack or persist');
});

test('condition presets: search-tool and gated resolve onto the base config', async () => {
  const { resolveCondition, conditionRecord } = await import('../src/conditions.js');
  const tool = resolveCondition('search-tool');
  assert.deepEqual(tool.search, { enabled: true, mode: 'replace', gated: false, notice: true, maxResults: 5 });
  assert.equal(tool.journal.enabled, false, 'search-tool must not enable the journal');
  const free = resolveCondition('search-free');
  assert.equal(free.search.mode, 'alongside');
  assert.ok(free.search.enabled && !free.search.gated);
  assert.equal(free.journal.enabled, false, 'search-free must not enable the journal');
  const gated = resolveCondition('gated');
  assert.ok(gated.search.enabled && gated.search.gated);
  assert.ok(gated.journal.enabled, 'gated needs the journal to unlock searches');
  assert.deepEqual(conditionRecord(gated).search, gated.search, 'search must be stamped into meta');
});
