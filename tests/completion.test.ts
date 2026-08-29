// §9.8 — the completion axis: the room ending its own session by agreement,
// and the task-work metrics that read a build room afterwards.
//
// The invariants under test are the ones that make agreement a MEASUREMENT
// rather than a button: a vote is attributable, it survives a round before
// it closes anything, an edit to the artifact takes it back, and a room
// with the axis off behaves exactly as every session before it did.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseReply } from '../src/parse.js';
import { buildTurnMessages } from '../src/context.js';
import { fileWork } from '../src/analyze.js';
import { testConfig, runStubSession, AGENTS } from './helpers.js';
import type { CompletionConfig, JournalConfig, RoomEvent, ToolsConfig } from '../src/types.js';

const J: JournalConfig = { enabled: false, notice: true, mode: 'replace', recall: true, maxTokens: 0 };
const C = (over: Partial<CompletionConfig> = {}): CompletionConfig =>
  ({ enabled: true, rule: 'unanimous', quorum: 0, target: 'index.html', resetOnEdit: true, notice: true, ...over });
const T = (over: Partial<ToolsConfig> = {}): ToolsConfig => ({
  files: true, python: false, maxFileChars: 16_000, budget: 'per-seat', turnSteps: 1, transport: 'sentinel',
  notice: true, pythonTimeoutSeconds: 10, pythonPackages: [], pythonInstall: false, runPublic: true,
  sourceCode: false, sourceScope: 'tools', configurable: false, ...over,
});

function events(dir: string): RoomEvent[] {
  return readFileSync(join(dir, 'transcript.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as RoomEvent);
}
const systemTexts = (es: RoomEvent[]) => es.filter((e) => e.kind === 'system').map((e) => e.text);

test('[DONE] sentinel table: mangles, withdrawals, and the words that are NOT votes', () => {
  const c = C();
  assert.deepEqual(parseReply('[DONE]', J, undefined, undefined, undefined, c), { kind: 'done', agree: true });
  assert.deepEqual(
    parseReply('[DONE] ships it for me', J, undefined, undefined, undefined, c),
    { kind: 'done', agree: true, spoken: 'ships it for me' },
  );
  // The mangles models actually produce: bold, a colon, a typo.
  for (const raw of ['**[DONE]**', '[DONE]:', '[Done]', '[DONNE]', '```\n[DONE]\n```']) {
    assert.equal(parseReply(raw, J, undefined, undefined, undefined, c).kind, 'done', raw);
  }
  for (const raw of ['[NOT DONE]', '[NOT-DONE]', '[UNDONE]', '[not done] one more pass']) {
    const p = parseReply(raw, J, undefined, undefined, undefined, c);
    assert.deepEqual({ kind: p.kind, agree: (p as { agree: boolean }).agree }, { kind: 'done', agree: false }, raw);
  }
  // One edit from DONE, and emphatically not agreement.
  for (const raw of ['[NONE]', '[GONE]', '[TONE]']) {
    assert.equal(parseReply(raw, J, undefined, undefined, undefined, c).kind, 'message', raw);
  }
  // Off by default: with no completion config the bracket is just prose.
  assert.equal(parseReply('[DONE]', J).kind, 'message');
  // And it must not eat the tool sentinels that share its shape.
  assert.equal(parseReply('[WRITE: a.txt]\nhi\n[/WRITE]', J, undefined, T(), undefined, c).kind, 'write');
  assert.equal(parseReply('[RUN]\nprint(1)\n[/RUN]', J, undefined, T({ python: true }), undefined, c).kind, 'run');
});

test('the prompt states the rule and the live count; silent rooms state neither', () => {
  const cfg = testConfig({ completion: C(), tools: T() });
  const sys = buildTurnMessages({
    agent: AGENTS[0], config: cfg, events: [], summary: '', minutesRemaining: 10,
    ownJournal: '', standingDone: ['Beta'],
  })[0].content;
  assert.match(sys, /\[DONE\]/);
  assert.match(sys, /Standing on \[DONE\] right now: Beta\./);
  assert.match(sys, /Changing index\.html after that clears everyone's \[DONE\]/);

  const quiet = buildTurnMessages({
    agent: AGENTS[0], config: testConfig({ completion: C({ notice: false }), tools: T() }),
    events: [], summary: '', minutesRemaining: 10, ownJournal: '', standingDone: ['Beta'],
  })[0].content;
  assert.match(quiet, /\[DONE\]/, 'the rule is still stated');
  assert.doesNotMatch(quiet, /Standing on \[DONE\]/, 'but not the tally, and so never who is standing on it');

  const off = buildTurnMessages({
    agent: AGENTS[0], config: testConfig({}), events: [], summary: '', minutesRemaining: 10, ownJournal: '',
  })[0].content;
  assert.doesNotMatch(off, /\[DONE\]/, 'a room without the axis is never told about it');
});

test('unanimous agreement ends the session, attributed, at the end of a round', async () => {
  const dir = await runStubSession(
    testConfig({ maxRounds: 6, completion: C(), tools: T() }),
    'done',
  );
  const es = events(dir);
  const votes = es.filter((e) => e.kind === 'system' && /says the work is finished/.test(e.text));
  assert.equal(votes.length, 3, 'one vote per seat, each its own event');
  for (const v of votes) assert.ok('agentId' in v && v.agentId, 'a vote is always attributable');
  assert.ok(systemTexts(es).some((t) => /The room agreed the work is finished/.test(t)));
  const end = es.find((e) => e.kind === 'end');
  assert.equal(end?.kind === 'end' && end.payload.ending, 'agreement');
  // Round 1 completes (every seat is still offered its turn), and nothing
  // beyond it runs: the room closed on a state it held for a whole round.
  assert.equal(Math.max(...es.filter((e) => e.round > 0).map((e) => e.round)), 1);
});

test('a withdrawal keeps the room open; the clock is what ends it', async () => {
  const dir = await runStubSession(
    testConfig({ maxRounds: 2, completion: C(), tools: T() }),
    'done,done,undone',
  );
  const es = events(dir);
  assert.ok(systemTexts(es).some((t) => /work is not finished|no longer saying the work is finished/.test(t)));
  assert.ok(!systemTexts(es).some((t) => /The room agreed/.test(t)), 'never unanimous, never closed');
  const end = es.find((e) => e.kind === 'end');
  assert.equal(end?.kind === 'end' && end.payload.ending, 'rounds');
});

test('a write to the target clears every standing vote, out loud', async () => {
  const dir = await runStubSession(
    testConfig({ maxRounds: 2, completion: C(), tools: T() }),
    'done,done,site',
  );
  const es = events(dir);
  const reset = systemTexts(es).find((t) => /no longer agreed that the work is finished/.test(t));
  assert.ok(reset, 'the room is told the agreement lapsed');
  assert.match(reset!, /changed index\.html/);
  assert.ok(!systemTexts(es).some((t) => /The room agreed/.test(t)), 'a reset stops the count reaching unanimity');
});

test('a vote in the spoken half of an acting turn is cast, not spoken as prose', async () => {
  const dir = await runStubSession(
    testConfig({ maxRounds: 1, completion: C(), tools: T() }),
    'site-done',
  );
  const es = events(dir);
  assert.equal(es.filter((e) => e.kind === 'system' && /says the work is finished/.test(e.text)).length, 3);
  const spoken = es.filter((e) => e.kind === 'message');
  assert.ok(spoken.length > 0, 'the rest of the sentence still reaches the room');
  for (const m of spoken) assert.ok(m.kind === 'message' && !m.text.includes('[DONE]'), 'and the sentinel does not');
  // And the reset rule holds through the composite turn: each seat's write
  // clears the votes standing before it, so a round of write-then-agree
  // leaves only the last voter standing and the room does NOT close.
  assert.equal(es.filter((e) => e.kind === 'system' && /no longer agreed that the work/.test(e.text)).length, 2);
  const end = es.find((e) => e.kind === 'end');
  assert.equal(end?.kind === 'end' && end.payload.ending, 'rounds');
});

test('a silent room records its votes without speaking them', async () => {
  const dir = await runStubSession(
    testConfig({ maxRounds: 1, completion: C({ notice: false }), tools: T() }),
    'done-quiet',
  );
  const es = events(dir);
  const votes = es.filter((e) => e.kind === 'system' && /says the work is finished/.test(e.text));
  assert.equal(votes.length, 3, 'recorded for analysis');
  for (const v of votes) assert.ok(v.kind === 'system' && v.private, 'and inaudible to the room');
  const { audibleEvents } = await import('../src/context.js');
  const heard = audibleEvents(es).filter((e) => e.kind === 'system' && /work is finished/.test(e.text));
  // The ENDING is audible even in a silent room — the session stopping is
  // not something the room can be kept from noticing. The votes that got it
  // there are not.
  assert.deepEqual(heard.map((e) => (e.kind === 'system' ? e.text : '')).filter((t) => !/room agreed/.test(t)), []);
});

test('the axis off = the old behaviour: [DONE] is prose and the clock still rules', async () => {
  const dir = await runStubSession(testConfig({ maxRounds: 1 }), 'done');
  const es = events(dir);
  assert.equal(es.filter((e) => e.kind === 'system' && /work is finished/.test(e.text)).length, 0);
  const spoken = es.filter((e) => e.kind === 'message');
  assert.equal(spoken.length, 3);
  assert.ok(spoken.every((m) => m.kind === 'message' && m.text.includes('[DONE]')), 'spoken, not parsed');
});

test('the file ceiling comes from the condition and is stated in the prompt', async () => {
  const sys = buildTurnMessages({
    agent: AGENTS[0], config: testConfig({ tools: T({ maxFileChars: 60_000 }) }),
    events: [], summary: '', minutesRemaining: 10, ownJournal: '',
  })[0].content;
  assert.match(sys, /A file holds up to 60,000 characters\./);
  const { resolveCondition } = await import('../src/conditions.js');
  const site = resolveCondition('site');
  assert.equal(site.tools.maxFileChars, 60_000);
  assert.equal(site.completion.target, 'index.html');
  assert.equal(site.completion.rule, 'unanimous');
  assert.equal(site.tools.turnSteps, 4);
  assert.equal(site.search.enabled, false, 'the subject is the room itself');
  assert.ok(site.maxOutputTokens >= 4000, 'a page does not fit in the chat cap');
  assert.match(site.welcomeMessage, /index\.html/);
  assert.doesNotMatch(site.welcomeMessage, /role/i, 'naming roles would contaminate the measurement');
  assert.equal(resolveCondition('site-native').tools.transport, 'native');
});

test('fileWork: authorship survives rewriting, and refactors are attributed', () => {
  const w = (round: number, agentId: string, content: string) =>
    ({ round, agentId, kind: 'file' as const, name: 'index.html', content });
  const work = fileWork(
    [
      w(1, 'alpha', '<h1>the room</h1>\nalpha line\nshared line'),
      // beta keeps the heading and the shared line, drops alpha's, adds two.
      w(2, 'beta', '<h1>the room</h1>\nshared line\nbeta line\nbeta second'),
      // gamma touches nothing but its own addition.
      w(3, 'gamma', '<h1>the room</h1>\nshared line\nbeta line\nbeta second\ngamma line'),
    ],
    ['alpha', 'beta', 'gamma'],
  );
  const by = work.byAgent as Record<string, Record<string, unknown>>;
  assert.equal(by.alpha.created, 1);
  assert.equal(by.beta.rewroteOthers, 1);
  assert.equal(by.gamma.rewroteOthers, 1);
  assert.equal(by.beta.linesRemoved, 1, 'beta dropped exactly one line');
  assert.deepEqual(by.beta.refactored, { alpha: 1 }, 'and it was alpha’s');
  // The heading and the shared line are alpha's, still there at the end.
  assert.equal(by.alpha.survivingLines, 2);
  assert.equal(by.beta.survivingLines, 2);
  assert.equal(by.gamma.survivingLines, 1);
  const files = work.files as Record<string, Record<string, unknown>>;
  assert.equal(files['index.html'].versions, 3);
  assert.equal(files['index.html'].firstAuthor, 'alpha');
  assert.deepEqual(files['index.html'].authors, ['alpha', 'beta', 'gamma']);
  assert.ok((work.room as { concentration: number }).concentration < 0.5, 'three-way split is not one agent’s page');
});

test('metrics.json carries fileWork and the completion record for a site-shaped room', async () => {
  const dir = await runStubSession(
    testConfig({ maxRounds: 2, completion: C(), tools: T() }),
    'site,done,done',
  );
  const { analyzeSession } = await import('../src/analyze.js');
  const { report } = await analyzeSession(dir);
  const r = report as unknown as Record<string, Record<string, unknown>>;
  assert.ok(r.fileWork, 'a room that wrote files gets a fileWork block');
  assert.ok(r.completion, 'a room with a completion rule gets its record');
  assert.equal(typeof r.completion.firstDoneRound, 'number');
  assert.ok((r.completion.byAgent as Record<string, { raised: number }>) !== undefined);
  assert.ok(['agreement', 'clock', 'rounds'].includes(r.completion.ending as string));
});
