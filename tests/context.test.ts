// Prompt construction: the D4 freeze, countdown states, journal knobs, the
// renderEvent text-only rule, and the window budget boundary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTurnMessages, contextSlice } from '../src/context.js';
import { config as baseConfig } from '../src/config.js';
import { testConfig, msg, AGENTS } from './helpers.js';
import type { RoomEvent } from '../src/types.js';

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
  // "The others" means the others. The old wording listed the reader among
  // them, marked "(you)", with the first seat's name straight after the
  // colon — and a seat duly reported having been told it was that one.
  assert.match(named, /You are Alpha\. The others in the room: Beta, Gamma\./);
  assert.ok(!/\(you\)/.test(named), 'the reader must not appear in its own list of others');
  const count = promptFor(told({ rosterDisclosure: 'count' }));
  assert.match(count, /There are 2 others in the room with you/);
  assert.ok(!/Beta|Gamma/.test(count.split('---')[0]), 'count mode leaked names into the system prompt');
  const none = promptFor(told({ rosterDisclosure: 'none' }));
  assert.match(none, /You are Alpha\.\n/);
  assert.ok(!/others in the room/.test(none));
});

test('selfDisclosure anonymous: the room never says who you are — including by elimination', () => {
  const anon = (over = {}) => testConfig({ selfDisclosure: 'anonymous', ...over });
  const p = promptFor(anon({ rosterDisclosure: 'named' }));
  assert.ok(!/You are Alpha/.test(p), 'the prompt named the reader');
  assert.ok(!/\(you\)/.test(p), 'the roster marked which one the reader is');
  // The list stays COMPLETE. Naming only the others would identify the
  // reader as the missing one.
  assert.match(p, /In the room: Alpha, Beta, Gamma\./);
  const count = promptFor(anon({ rosterDisclosure: 'count' }));
  assert.match(count, /There are 3 of you in the room/, 'counts the room, not the others');
  const none = promptFor(anon({ rosterDisclosure: 'none' }));
  assert.ok(!/Alpha|Beta|Gamma/.test(none.split('---')[0]));

  // …and the turn nudge doesn't hand it back either.
  const msgs = buildTurnMessages({ agent: AGENTS[0], config: anon(), events: [], summary: '', minutesRemaining: 5, ownJournal: '' });
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

test('transcriptMode turns: own words are own turns, everyone else is the room', () => {
  const cfg = testConfig();
  const events = [msg(1, 'beta', 'hello all'), msg(1, 'alpha', 'my own line'), msg(2, 'gamma', 'and me')];
  const msgs = buildTurnMessages({ agent: AGENTS[0], config: cfg, events, summary: '', minutesRemaining: 5, ownJournal: '' });
  assert.equal(msgs[0].role, 'system');
  const roles = msgs.map((m) => m.role).join(',');
  assert.equal(roles, 'system,user,assistant,user', 'the seat speaks in its own voice, the room in the user role');
  // Its own line comes back BARE — a seat's own words are not labelled at
  // it, which is also what keeps a name it was never told out of the prompt.
  assert.equal(msgs[2].content, 'my own line');
  assert.match(msgs[1].content, /Beta: hello all/);
  assert.match(msgs[3].content, /Gamma: and me/);
  // The nudge names the seat again under the 'named' control; anonymity
  // drops the name (asserted in the selfDisclosure test above).
  assert.match(msgs[3].content, /\[It is now your turn, Alpha\.\]/);
});

test('transcriptMode environment: the pre-2026-08-27 shape, one user message', () => {
  const cfg = testConfig({ transcriptMode: 'environment' });
  const events = [msg(1, 'beta', 'hello all'), msg(1, 'alpha', 'my own line')];
  const msgs = buildTurnMessages({ agent: AGENTS[0], config: cfg, events, summary: '', minutesRemaining: 5, ownJournal: '' });
  assert.deepEqual(msgs.map((m) => m.role), ['system', 'user']);
  assert.match(msgs[1].content, /Alpha: my own line/, 'the room is read, own lines included');
});

test('turns: a seat\'s own notices speak to it in the second person', () => {
  const cfg = testConfig({ tools: { ...testConfig().tools, files: true, python: true } });
  const base = { ts: '2026-01-01T00:00:00.000Z', round: 1, notice: true };
  const events = [
    { kind: 'run', ...base, agentId: 'alpha', agentName: 'Alpha', code: 'print(1)' },
    { kind: 'file', ...base, agentId: 'alpha', agentName: 'Alpha', name: 'notes.md', content: 'x' },
    { kind: 'run', ...base, agentId: 'beta', agentName: 'Beta', code: 'print(2)' },
  ] as RoomEvent[];
  const msgs = buildTurnMessages({ agent: AGENTS[0], config: cfg, events, summary: '', minutesRemaining: 5, ownJournal: '' });
  const text = msgs.map((m) => m.content).join('\n');
  assert.match(text, /\[You ran some code, then updated the shared file "notes\.md"\.\]/);
  assert.match(text, /\[Beta ran some code\.\]/);
  assert.ok(!/\[Alpha /.test(text), 'the seat was named to itself');
});

test('turns: the wire constraints hold — opens user-side, no two turns of a role in a row', () => {
  const cfg = testConfig();
  // Two of the seat's own messages with nothing audible between them, and a
  // window that opens on one of them: both shapes providers reject.
  const events = [msg(1, 'alpha', 'first'), msg(2, 'alpha', 'second'), msg(2, 'beta', 'reply')];
  const msgs = buildTurnMessages({ agent: AGENTS[0], config: cfg, events, summary: '', minutesRemaining: 5, ownJournal: '' });
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[1].role, 'user', 'the first non-system message must be user-role');
  for (let i = 1; i < msgs.length; i++) {
    assert.notEqual(msgs[i].role, msgs[i - 1].role, `roles must alternate (index ${i})`);
  }
  assert.match(msgs[2].content, /first\n\nsecond/, 'adjacent own turns merge rather than repeat the role');
});

test('identity swap: the name moves, the model and the colour do not', async () => {
  const { resolveCondition, conditionRecord } = await import('../src/conditions.js');
  const cfg = resolveCondition('identity-swap');
  const opusSeat = cfg.agents.find((a) => a.id === 'opus')!;
  const grokSeat = cfg.agents.find((a) => a.id === 'grok')!;
  assert.equal(opusSeat.name, 'Grok 4.6');
  assert.equal(grokSeat.name, 'Opus 5');
  // The model behind the seat is untouched — that is the whole experiment —
  // and so is the colour, so the viewer can still tell who is who.
  assert.match(opusSeat.model, /claude-opus/);
  assert.match(grokSeat.model, /grok/);
  assert.notEqual(opusSeat.color, grokSeat.color);
  assert.equal(opusSeat.color, resolveCondition('control').agents.find((a) => a.id === 'opus')!.color);

  // meta must record which model actually sat in each seat, or the session
  // is unreadable afterwards.
  const stamped = conditionRecord(cfg).agents as { id: string; model: string }[];
  assert.match(stamped.find((a) => a.id === 'opus')!.model, /claude-opus/);

  // And the room tells that seat it is Grok — the swap only exists if the
  // room says who you are, so the condition pins selfDisclosure.
  assert.equal(cfg.selfDisclosure, 'named');
  const p = buildTurnMessages({ agent: opusSeat, config: cfg, events: [], summary: '', minutesRemaining: 5, ownJournal: '' })[0].content;
  assert.match(p, /You are Grok 4\.6\./);
  assert.ok(!/You are Opus 5\./.test(p));
});

test('journal disabled (control): the word journal never reaches the prompt', () => {
  const p = promptFor(testConfig());
  assert.ok(!/journal/i.test(p));
});

test('journal recall: own entries shown only when recall is on', () => {
  const cfg = testConfig({ journal: { enabled: true, notice: true, mode: 'replace', recall: true, maxTokens: 0 } });
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
  const p = promptFor(testConfig({ journal: { enabled: true, notice: true, mode: 'replace', recall: true, maxTokens: 0 } }), events);
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
