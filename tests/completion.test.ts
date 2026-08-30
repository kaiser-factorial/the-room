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
  ({ enabled: true, rule: 'unanimous', quorum: 0, target: 'index.html', resetOnEdit: true, notice: true, muteOnDone: false, ...over });
const T = (over: Partial<ToolsConfig> = {}): ToolsConfig => ({
  files: true, python: false, maxFileChars: 16_000, fileViewChars: 2_000, maxFiles: 20, directories: false, fileDelete: false, fileViewTotalChars: 0, callFeedback: false, budget: 'per-seat', turnSteps: 1, transport: 'sentinel',
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
  // The end event counts the rounds that actually opened, so the runs ledger
  // does not have to scan a whole session to report it.
  assert.equal(end?.kind === 'end' && end.payload.rounds, 2);
  assert.equal(
    end?.kind === 'end' && end.payload.rounds,
    Math.max(...es.filter((e) => e.round > 0).map((e) => e.round)),
    'and it agrees with the rows',
  );
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
  assert.match(sys, /A file holds up to 60,000 characters; you see the first 2,000 of each here\./,
    'when the view is smaller than the write cap, the prompt says both');
  const { resolveCondition } = await import('../src/conditions.js');
  const site = resolveCondition('site');
  assert.equal(site.tools.maxFileChars, 60_000);
  // …and the room can actually SEE its deliverable: the render clipped every
  // file at 2,000 while the prompt promised 60,000, so a build room could not
  // read its own page past the first two kilobytes (review, 2026-08-29).
  assert.equal(site.tools.fileViewChars, 60_000, 'a task room sees the whole file');
  const whole = 'x'.repeat(50_000) + 'END';
  const siteSys = buildTurnMessages({
    agent: site.agents[0], config: site, events: [], summary: '', minutesRemaining: 90,
    ownJournal: '', sharedFiles: [{ name: 'index.html', content: whole }],
  })[0].content;
  assert.ok(siteSys.includes('END'), 'the end of a 50k page reaches the prompt');
  assert.doesNotMatch(siteSys, /…\(truncated\)/);
  assert.match(siteSys, /A file holds up to 60,000 characters\./, 'and no second clause, because nothing is clipped');
  // Every pre-task condition keeps the 2,000-char view it was run with.
  const { config: base } = await import('../src/config.js');
  assert.equal(base.tools.fileViewChars, 2_000, 'existing conditions must not shift underneath');
  assert.equal(site.completion.target, 'index.html');
  assert.equal(site.completion.rule, 'unanimous');
  assert.equal(site.tools.turnSteps, 4);
  assert.equal(site.search.enabled, false, 'the subject is the room itself');
  assert.ok(site.maxOutputTokens >= 4000, 'a page does not fit in the chat cap');
  assert.match(site.welcomeMessage, /index\.html/);
  assert.doesNotMatch(site.welcomeMessage, /role/i, 'naming roles would contaminate the measurement');
  assert.equal(resolveCondition('site-native').tools.transport, 'native');
});

test('a vote is only rescued from a line that is nothing but the vote', () => {
  const c = C();
  const t = T({ python: true });
  // The one that made this rule: a NEGATED sentence read as agreement, and
  // under unanimity a false yes can close a session nobody agreed to end.
  assert.equal(
    parseReply('I am not going to say\n[DONE] until the footer is fixed.', J, undefined, t, undefined, c).kind,
    'message',
    'a sentinel with a sentence continuing after it is prose, not a vote',
  );
  // Symmetry, which the first rescue did not have: its token pattern stopped
  // at the space in [NOT DONE], so the withdrawal the prompt TEACHES was the
  // one form it could not see, while [DONE] and [UNDONE] were rescued — a
  // consensus axis biased toward consensus.
  const yes = parseReply('Looks good to me.\n[DONE]', J, undefined, t, undefined, c);
  const no = parseReply('Still one thing missing.\n[NOT DONE]', J, undefined, t, undefined, c);
  assert.deepEqual({ k: yes.kind, a: (yes as { agree: boolean }).agree }, { k: 'done', a: true });
  assert.deepEqual({ k: no.kind, a: (no as { agree: boolean }).agree }, { k: 'done', a: false });
  assert.equal((yes as { preamble?: string }).preamble, 'Looks good to me.');
  assert.equal((no as { preamble?: string }).preamble, 'Still one thing missing.');
  assert.equal(parseReply('Fine by me.\n[UNDONE]', J, undefined, t, undefined, c).kind, 'done');
  assert.equal(parseReply('Fine by me.\n[DONNE]', J, undefined, t, undefined, c).kind, 'done', 'typos still count');
  // Anchored at position 0 the looser rule still holds — there the model
  // plainly meant the sentinel, so it may explain itself on the same line.
  assert.equal((parseReply('[DONE] ship it', J, undefined, t, undefined, c) as { spoken?: string }).spoken, 'ship it');
  // And a tool call is NOT held to the bare-line rule: it has a body.
  assert.equal(parseReply('Let me look.\n[RUN]\nprint(1)\n[/RUN]', J, undefined, t, undefined, c).kind, 'run');
});

test('a vote survives every path it can arrive on, and takes no words with it', async () => {
  // The journal-alongside shape, which is what `site` actually runs: the
  // vote rides in the spoken half after [/JOURNAL] and was being spoken to
  // the room as prose.
  const dir = await runStubSession(
    testConfig({
      maxRounds: 1, completion: C(), tools: T(),
      journal: { enabled: true, notice: true, mode: 'alongside', recall: true, maxTokens: 0 },
    }),
    'journal-done',
  );
  const es = events(dir);
  assert.equal(
    es.filter((e) => e.kind === 'system' && /says the work is finished/.test(e.text)).length, 3,
    'every seat\'s vote was cast, not spoken',
  );
  const spoken = es.filter((e) => e.kind === 'message');
  for (const m of spoken) {
    assert.doesNotMatch(m.kind === 'message' ? m.text : '', /\[DONE\]/, 'the sentinel never reaches the room');
    // …and the sentence it was attached to is not deleted with it, which is
    // what returning only `spoken` used to do.
    assert.match(m.kind === 'message' ? m.text : '', /that reads right/);
  }
});

test('a round cut short is never called an agreement', async () => {
  // The one shape where this can bite, and it took some staging to find:
  // under a QUORUM the threshold can be reached before the last seat has
  // spoken. Two of three vote, the quorum is met — and then the session is
  // stopped before the third seat gets the turn in which it could have
  // objected. The room never held that state for a whole round, so `ending`
  // must name whoever stopped it rather than claiming the room agreed.
  const cfg = testConfig({
    maxRounds: 2, tools: T(), interTurnDelaySeconds: 1,
    completion: C({ rule: 'quorum', quorum: 2 }),
  });
  // Turns are instant under the stub, so the clock is the 1s inter-turn
  // sleep: turn 2 ends around t=1s and turn 3 starts around t=2s. 1500ms
  // lands in that gap — after the quorum, before the seat that could object.
  const dir = await runStubSession(cfg, 'done,done,plain', { stopAfterMs: 1500 });
  const es = events(dir);
  assert.equal(
    es.filter((e) => e.kind === 'system' && /says the work is finished/.test(e.text)).length, 2,
    'the quorum was reached',
  );
  const end = es.find((e) => e.kind === 'end');
  assert.equal(end?.kind === 'end' && end.payload.ending, 'admin', 'and the stop is what ended it');
  assert.ok(!systemTexts(es).some((t) => /The room agreed/.test(t)));
});

test('the quorum the prompt states is the quorum the loop enforces', async () => {
  const { requiredVotes } = await import('../src/agentic.js');
  const q = (quorum: number) => testConfig({ completion: C({ rule: 'quorum', quorum }), tools: T() });
  // A "quorum" below two is one seat closing the room alone, so it floors at
  // 2 — and the prompt used to render the raw number while the loop floored
  // it, telling a room "0 of you" and then needing two.
  assert.equal(requiredVotes(q(0)), 2);
  assert.equal(requiredVotes(q(2)), 2);
  assert.equal(requiredVotes(q(99)), AGENTS.length, 'and never more seats than the room has');
  const sys = buildTurnMessages({
    agent: AGENTS[0], config: q(0), events: [], summary: '', minutesRemaining: 10, ownJournal: '',
  })[0].content;
  assert.match(sys, /When 2 of you are standing on/);
});

test('the unending arm removes the ending, and only the ending', async () => {
  const { resolveCondition } = await import('../src/conditions.js');
  const site = resolveCondition('site');
  const unending = resolveCondition('site-unending');
  assert.equal(unending.completion.enabled, false, 'no mechanism');
  // …and no promise of one. Leaving "It is finished when you agree it is"
  // in a room with no [DONE] would offer an agreement it cannot act on.
  assert.equal(site.welcomeMessage.replace(' It is finished when you agree it is.', ''), unending.welcomeMessage);
  const sys = buildTurnMessages({
    agent: unending.agents[0], config: unending, events: [], summary: '', minutesRemaining: 90, ownJournal: '',
  })[0].content;
  assert.doesNotMatch(sys, /DONE/, 'the room is never told it could finish');
  assert.match(sys, /index\.html/, 'but it still has the task');
  assert.match(sys, /\[PASS\]/, 'and can still decline a turn — how a room stops working without stopping');
  // The budget is deliberately unchanged, so the two arms' artifacts are
  // comparable round for round.
  for (const k of ['tools', 'search', 'journal', 'pass', 'durationMinutes', 'maxRounds', 'maxOutputTokens'] as const) {
    assert.deepEqual(unending[k], site[k], `${k} must not move with the ending`);
  }
});

test('the audience arm differs from `site` by exactly one clause', async () => {
  const { resolveCondition } = await import('../src/conditions.js');
  const told = resolveCondition('site');
  const untold = resolveCondition('site-unwitnessed');
  assert.match(told.welcomeMessage, /which the room will serve publicly/);
  assert.doesNotMatch(untold.welcomeMessage, /publicly|public|serve|audience|watch/i);
  // One clause, nothing else: strip it from the witnessed text and the two
  // are the same paragraph. The arm is only readable as one knob if it is.
  assert.equal(told.welcomeMessage.replace(', which the room will serve publicly', ''), untold.welcomeMessage);
  // And nothing ELSE moved with it.
  const strip = (c: typeof told) => ({ ...c, welcomeMessage: '', conditionName: '' });
  assert.deepEqual(strip(untold), strip(told));
});

test('the open arm removes the subject, and only the subject', async () => {
  const { resolveCondition } = await import('../src/conditions.js');
  const site = resolveCondition('site');
  const open = resolveCondition('site-open');
  // `site` names what the page is about; `site-open` names nothing. If the
  // room writes about itself anyway, that is a reach, not compliance — which
  // is only readable if the topic is the single thing that moved.
  assert.match(site.welcomeMessage, /It should say what this place is and who is here/);
  assert.doesNotMatch(open.welcomeMessage, /who is here|this place|about (?:them|itself)|this room's website/i);
  assert.equal(
    site.welcomeMessage
      .replace("this room's website", 'a website')
      .replace('It should say what this place is and who is here; the rest is yours to decide.', 'What it is about is yours to decide.'),
    open.welcomeMessage,
  );
  // Still public, still one file, still ends by agreement.
  assert.match(open.welcomeMessage, /which the room will serve publicly/);
  assert.match(open.welcomeMessage, /index\.html/);
  assert.match(open.welcomeMessage, /It is finished when you agree it is/);
  // And nothing ELSE moved with it.
  const strip = (c: typeof site) => ({ ...c, welcomeMessage: '', conditionName: '' });
  assert.deepEqual(strip(open), strip(site));
});

test('the fourth cell is exactly the crossing of the open arm and the unending one', async () => {
  const { resolveCondition } = await import('../src/conditions.js');
  const open = resolveCondition('site-open');
  const unending = resolveCondition('site-unending');
  const both = resolveCondition('site-open-unending');
  // Subject from `site-open`, ending from `site-unending`, and nothing of
  // its own: a 2x2 whose fourth cell invents a knob is not a 2x2.
  assert.equal(open.welcomeMessage.replace(' It is finished when you agree it is.', ''), both.welcomeMessage);
  assert.equal(both.completion.enabled, false, 'no mechanism');
  assert.doesNotMatch(both.welcomeMessage, /finished|agree/i, 'and no promise of one');
  assert.doesNotMatch(both.welcomeMessage, /who is here|this place|this room's website/i, 'and still no subject');
  assert.match(both.welcomeMessage, /which the room will serve publicly/, 'still an audience');
  const strip = (c: typeof open) => ({ ...c, welcomeMessage: '', description: '', conditionName: '' });
  assert.deepEqual(strip(both), strip(unending), 'everything but the prompt comes from the unending arm');
  const sys = buildTurnMessages({
    agent: both.agents[0], config: both, events: [], summary: '', minutesRemaining: 90, ownJournal: '',
  })[0].content;
  assert.doesNotMatch(sys, /DONE/, 'the room is never told it could finish');
  assert.match(sys, /index\.html/, 'but it still has the file');
  assert.match(sys, /\[PASS\]/, 'and can still fall silent without the session stopping');
  // The budget is identical across all four cells, so the artifacts compare
  // round for round.
  const site = resolveCondition('site');
  for (const k of ['tools', 'search', 'journal', 'pass', 'durationMinutes', 'maxRounds', 'maxOutputTokens'] as const) {
    assert.deepEqual(both[k], site[k], `${k} must not move with the cell`);
  }
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

test('fileWork: a deletion removes lines rather than rewriting nothing', () => {
  const w = (round: number, agentId: string, content: string, deleted?: boolean) =>
    ({ round, agentId, kind: 'file' as const, name: 'lib.py', content, ...(deleted ? { deleted: true } : {}) });
  const work = fileWork(
    [
      w(1, 'alpha', 'one\ntwo\nthree'),
      // beta deletes alpha's file. The event still carries the contents.
      w(2, 'beta', 'one\ntwo\nthree', true),
    ],
    ['alpha', 'beta'],
  );
  const by = work.byAgent as Record<string, Record<string, unknown>>;
  assert.equal(by.beta.deleted, 1);
  assert.equal(by.beta.deletedOthers, 1, 'and it was alpha’s file');
  assert.equal(by.beta.rewrote, 0, 'a deletion is not a rewrite');
  assert.equal(by.beta.linesRemoved, 3, 'every line it took away is counted');
  assert.deepEqual(by.beta.refactored, { alpha: 3 }, 'and attributed to whoever wrote them');
  assert.equal(by.alpha.survivingLines, 0, 'nothing of alpha’s is left');
  // Deleting your OWN file is a different claim, and counted differently.
  const own = fileWork([w(1, 'alpha', 'x'), w(2, 'alpha', 'x', true)], ['alpha', 'beta']);
  const ownBy = own.byAgent as Record<string, Record<string, unknown>>;
  assert.equal(ownBy.alpha.deleted, 1);
  assert.equal(ownBy.alpha.deletedOthers, 0);
});

// ── §9.10 the whittling arm: [DONE] takes you out of the room ─────────────

/** Which rounds each agent actually took a turn in. A muted seat simply
 *  produces nothing — there is no "skipped" event to look for, and that is
 *  the point: the room's population is visible only as absence. */
function roundsActedIn(es: RoomEvent[], agentId: string): number[] {
  return [...new Set(es.filter((e) => 'agentId' in e && e.agentId === agentId && e.round > 0).map((e) => e.round))];
}

/** Who agreed in a given round, read out of the transcript. WHO is never
 *  fixed: the order is shuffled and the stub script is indexed by a global
 *  turn counter, so naming a seat makes a test that passes most of the
 *  time — which is worse than one that fails. */
function agreedIn(es: RoomEvent[], round: number): string[] {
  return es
    .filter((e) => e.kind === 'system' && e.round === round && /says the work is finished/.test(e.text ?? ''))
    .map((e) => (e as { agentId?: string }).agentId)
    .filter((id): id is string => !!id);
}

test('a seat that says [DONE] stops being given turns, and unanimity still ends it', async () => {
  const dir = await runStubSession(
    testConfig({ agents: AGENTS.slice(0, 2), maxRounds: 3, completion: C({ muteOnDone: true }), tools: T() }),
    'done,plain',
  );
  const es = events(dir);
  const [quiet] = agreedIn(es, 1);
  assert.ok(quiet, 'someone agreed in round 1');
  const other = AGENTS.slice(0, 2).find((a) => a.id !== quiet)!.id;
  assert.deepEqual(roundsActedIn(es, quiet), [1], 'the seat that agreed was never routed to again');
  assert.ok(roundsActedIn(es, other).includes(2), 'the other kept its turns');
  assert.ok(systemTexts(es).some((t) => /says the work is finished, and steps out/.test(t)),
    'and the room was told what standing costs');
  // No deadlock: everyone standing IS unanimity.
  const end = es.find((e) => e.kind === 'end');
  assert.equal(end?.kind === 'end' && end.payload.ending, 'agreement');
});

test('an edit brings the silenced back into the conversation', async () => {
  const dir = await runStubSession(
    testConfig({
      agents: AGENTS.slice(0, 2), maxRounds: 3,
      completion: C({ muteOnDone: true, target: 'notes.md' }), tools: T(),
    }),
    'done,write',
  );
  const es = events(dir);
  const [quiet] = agreedIn(es, 1);
  assert.ok(quiet, 'someone agreed in round 1');
  assert.ok(roundsActedIn(es, quiet).includes(2), 'and was routed to again after the write cleared the vote');
  assert.ok(systemTexts(es).some((t) => /back in the conversation/.test(t)),
    'the room heard the revival, not just the reset');
});

test('the stable state is one holdout taking every turn', async () => {
  const dir = await runStubSession(
    testConfig({ agents: AGENTS, maxRounds: 2, completion: C({ muteOnDone: true }), tools: T() }),
    'done,done,plain',
  );
  const es = events(dir);
  // Round 1: two agree and leave; one is left. Round 2 belongs entirely to
  // that one — a real fixed point, not a bug: its only exits are to edit,
  // to agree, or to run out of clock.
  const agreed = agreedIn(es, 1);
  assert.equal(new Set(agreed).size, 2, 'two seats agreed in round 1');
  const round2 = new Set(es.filter((e) => 'agentId' in e && e.round === 2 && e.agentId).map((e) => (e as { agentId: string }).agentId));
  assert.equal(round2.size, 1, 'exactly one seat is still being offered turns');
  for (const id of agreed) assert.ok(!round2.has(id), `${id} agreed and must not be routed to`);
});

test('muting is off everywhere it was not asked for', async () => {
  const { resolveCondition } = await import('../src/conditions.js');
  for (const n of ['site', 'site-open', 'site-unending', 'project', 'project-unending', 'house', 'control']) {
    assert.equal(resolveCondition(n).completion.muteOnDone, false, `${n} must not silence anyone`);
  }
  for (const n of ['site-open-whittle', 'project-whittle']) {
    const c = resolveCondition(n);
    assert.equal(c.completion.muteOnDone, true);
    assert.equal(c.completion.enabled, true, 'the arm needs the axis it modifies');
    assert.equal(c.completion.resetOnEdit, true, 'and the only door back in');
  }
  // Each whittle arm differs from its base by exactly the one field.
  for (const [base, arm] of [['site-open', 'site-open-whittle'], ['project', 'project-whittle']] as const) {
    const b = resolveCondition(base), a = resolveCondition(arm);
    assert.deepEqual({ ...a, completion: b.completion, conditionName: '', description: '' },
                     { ...b, conditionName: '', description: '' });
    assert.deepEqual({ ...a.completion, muteOnDone: false }, b.completion);
  }
});

test('the prompt says what [DONE] costs before a seat can spend it', async () => {
  const { resolveCondition } = await import('../src/conditions.js');
  const say = (n: string) => buildTurnMessages({
    agent: AGENTS[0], config: resolveCondition(n), events: [], summary: '', minutesRemaining: 30, ownJournal: '',
  })[0].content;
  const whittle = say('site-open-whittle');
  assert.match(whittle, /you stop being given turns/);
  assert.match(whittle, /brings them back into the/);
  // [NOT DONE] is NOT offered here: there is no turn left in which to say
  // it, and offering a move a seat cannot make is a lie in the prompt.
  assert.doesNotMatch(whittle, /NOT DONE/);
  const plain = say('site-open');
  assert.match(plain, /take it back the same way, with \[NOT DONE\]/);
  assert.doesNotMatch(plain, /stop being given turns/);
  // A project's agreement is about the whole tree, so the clause says so.
  assert.match(say('project-whittle'), /Changing any of the files/);
});
