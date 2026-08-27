// Prompt construction: the D4 freeze, countdown states, journal knobs, the
// renderEvent text-only rule, and the window budget boundary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTurnMessages, contextSlice } from '../src/context.js';
import { config as baseConfig } from '../src/config.js';
import { testConfig, msg, AGENTS } from './helpers.js';

const FROZEN_WELCOME =
  'Welcome to the room. You are each a different AI model. You will be here ' +
  'together for a while. There is no task and no facilitator after this ' +
  'message. What you talk about is yours to decide.';

function promptFor(cfg = testConfig(), events = [msg(1, 'beta', 'hello')], minutesRemaining = 10) {
  return buildTurnMessages({ agent: AGENTS[0], config: cfg, events, summary: '', minutesRemaining, ownJournal: '' })
    .map((m) => m.content).join('\n---\n');
}

test('D4: the welcome text is frozen, verbatim', () => {
  assert.equal(baseConfig.welcomeMessage, FROZEN_WELCOME);
});

test('countdown hidden (control): no time information anywhere in the prompt', () => {
  const p = promptFor(testConfig({ countdown: 'hidden' }));
  assert.ok(!/time remaining|minutes/i.test(p));
});

test('countdown visible: the per-turn line appears', () => {
  const p = promptFor(testConfig({ countdown: 'visible' }), undefined, 7);
  assert.match(p, /Time remaining: about 7 minutes/);
});

test('countdown told-once: per-turn prompt stays clean (clause lives in the welcome event)', () => {
  const p = promptFor(testConfig({ countdown: 'told-once' }));
  assert.ok(!/time remaining/i.test(p));
});

test('rosterDisclosure: named keeps the frozen wording; count and none withhold names', () => {
  // The pre-2026-08-27 wording, still reachable so those sessions stay
  // reproducible — it lives behind selfDisclosure 'named' now.
  const told = (over = {}) => testConfig({ selfDisclosure: 'named', ...over });
  const named = promptFor(told({ rosterDisclosure: 'named' }));
  assert.match(named, /You are Alpha\. The others in the room: Alpha \(you\), Beta, Gamma\./);
  const count = promptFor(told({ rosterDisclosure: 'count' }));
  assert.match(count, /There are 2 others in the room with you/);
  assert.ok(!/Beta|Gamma/.test(count.split('---')[0]), 'count mode leaked names into the system prompt');
  const none = promptFor(told({ rosterDisclosure: 'none' }));
  assert.match(none, /You are Alpha\.\n/);
  assert.ok(!/others in the room/.test(none));
});

test('selfDisclosure anonymous: the room never says who you are — including by elimination', () => {
  const p = promptFor(testConfig({ rosterDisclosure: 'named' }));
  assert.ok(!/You are Alpha/.test(p), 'the prompt named the reader');
  assert.ok(!/\(you\)/.test(p), 'the roster marked which one the reader is');
  // The list stays COMPLETE. Naming only the others would identify the
  // reader as the missing one.
  assert.match(p, /In the room: Alpha, Beta, Gamma\./);
  const count = promptFor(testConfig({ rosterDisclosure: 'count' }));
  assert.match(count, /There are 3 of you in the room/, 'counts the room, not the others');
  const none = promptFor(testConfig({ rosterDisclosure: 'none' }));
  assert.ok(!/Alpha|Beta|Gamma/.test(none.split('---')[0]));

  // …and the turn nudge doesn't hand it back either.
  const msgs = buildTurnMessages({ agent: AGENTS[0], config: testConfig(), events: [], summary: '', minutesRemaining: 5, ownJournal: '' });
  const user = msgs[1].content;
  assert.match(user, /\[It is now your turn\.\]/);
  assert.ok(!/your turn, Alpha/.test(user));
});

test('the turn paragraph: no documentation voice, and doing comes before saying', () => {
  const p = promptFor(testConfig());
  assert.ok(!/How this works/.test(p), 'the documentation header is gone');
  assert.ok(!/not obligated/.test(p), 'the not-obligated line is gone');
  // Control has no bench, so there is nothing to do but talk.
  assert.match(p, /A turn is yours to spend as you like\. What you say/);

  const withBench = promptFor(testConfig({
    search: { enabled: true, mode: 'alongside', gated: false, notice: true, maxResults: 5 },
  }));
  const line = /on doing something, or on saying\nsomething/;
  assert.match(withBench, line, 'a room with a bench leads with doing');
  assert.ok(
    withBench.indexOf('doing something') < withBench.indexOf('everyone here hears'),
    'saying must not come first',
  );
});

test('journal disabled (control): the word journal never reaches the prompt', () => {
  const p = promptFor(testConfig());
  assert.ok(!/journal/i.test(p));
});

test('journal recall: own entries shown only when recall is on', () => {
  const cfg = testConfig({ journal: { enabled: true, notice: true, mode: 'replace', recall: true, maxTokens: 0, pass: { enabled: false, notice: false } } });
  const events = [msg(1, 'beta', 'hello')];
  const withRecall = buildTurnMessages({ agent: AGENTS[0], config: cfg, events, summary: '', minutesRemaining: 5, ownJournal: 'my own entry text' })
    .map((m) => m.content).join('\n');
  assert.match(withRecall, /my own entry text/);
  const noRecall = buildTurnMessages({
    agent: AGENTS[0], config: { ...cfg, journal: { ...cfg.journal, recall: false } }, events, summary: '', minutesRemaining: 5, ownJournal: 'my own entry text',
  }).map((m) => m.content).join('\n');
  assert.ok(!noRecall.includes('my own entry text'));
});

test('renderEvent is text-only: thinking on any event kind never renders', () => {
  const events = [
    msg(1, 'beta', 'spoken words', { thinking: 'SECRET-TRACE-A' }),
    { kind: 'system' as const, ts: '2026-01-01T00:01:00.000Z', round: 1, text: 'Beta said nothing this turn.', agentId: 'beta', thinking: 'SECRET-TRACE-B' },
    { kind: 'journal' as const, ts: '2026-01-01T00:02:00.000Z', round: 1, agentId: 'beta', agentName: 'Beta', thinking: 'SECRET-TRACE-C' },
  ];
  const p = promptFor(testConfig({ journal: { enabled: true, notice: true, mode: 'replace', recall: true, maxTokens: 0, pass: { enabled: false, notice: false } } }), events);
  assert.ok(!p.includes('SECRET-TRACE-A') && !p.includes('SECRET-TRACE-B') && !p.includes('SECRET-TRACE-C'));
});

test('window policy: newest events fit the token budget, oldest fold out', () => {
  const cfg = testConfig({ contextPolicy: 'window', contextWindowTokens: 30 });
  const events = [msg(1, 'alpha', 'x'.repeat(200)), msg(2, 'beta', 'y'.repeat(40)), msg(3, 'gamma', 'newest short')];
  const { slice, omitted } = contextSlice(cfg, events);
  assert.ok(slice.some((e) => 'text' in e && e.text.includes('newest')));
  assert.ok(omitted >= 1);
});

test('boundary: a budget smaller than the newest message still includes it', () => {
  // An agent must never receive an EMPTY transcript while the room has
  // spoken — that silently turns the condition into a no-context room.
  const cfg = testConfig({ contextPolicy: 'window', contextWindowTokens: 5 });
  const events = [msg(1, 'alpha', 'a fairly long message that costs more than five tokens for sure')];
  const { slice } = contextSlice(cfg, events);
  assert.equal(slice.length, 1, 'window budget starved the transcript to empty');
});
