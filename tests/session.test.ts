// Scripted-stub session tests: every branch the first live run hit the hard
// way — starvation, truncation telemetry, pass, adapter errors — plus the
// F1 traceSeats accounting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { testConfig, runStubSession } from './helpers.js';
import type { RoomEvent } from '../src/types.js';

function events(dir: string): RoomEvent[] {
  return readFileSync(join(dir, 'transcript.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as RoomEvent);
}

test('starvation path: empty replies become "said nothing" events, never silence', async () => {
  const dir = await runStubSession(testConfig({ maxRounds: 1 }), 'empty');
  const es = events(dir);
  const saidNothing = es.filter((e) => e.kind === 'system' && /said nothing/.test(e.text));
  assert.equal(saidNothing.length, 3, 'every seat should have a said-nothing event');
  // the turn's trace still rides on the event where present
  assert.ok(saidNothing.some((e) => e.kind === 'system' && e.thinking), 'trace lost on a starved turn');
});

test('truncation: finish_reason length lands in telemetry', async () => {
  const dir = await runStubSession(testConfig({ maxRounds: 1 }), 'truncate');
  const msgs = events(dir).filter((e) => e.kind === 'message');
  assert.equal(msgs.length, 3);
  for (const m of msgs) assert.equal(m.kind === 'message' && m.telemetry?.finishReason, 'length');
});

test('adapter error: turn degrades to "could not speak", session survives', async () => {
  const dir = await runStubSession(testConfig({ maxRounds: 1 }), 'error,plain,plain');
  const es = events(dir);
  assert.equal(es.filter((e) => e.kind === 'system' && /could not speak/.test(e.text)).length, 1);
  assert.equal(es.filter((e) => e.kind === 'message').length, 2);
  assert.ok(es.some((e) => e.kind === 'end'), 'session must still end cleanly');
});

test('[PASS] with notice: room hears chosen silence', async () => {
  const dir = await runStubSession(
    testConfig({ maxRounds: 1, journal: { enabled: true, notice: true, mode: 'replace', recall: true, maxTokens: 0, pass: { enabled: true, notice: true } } }),
    'pass',
  );
  assert.equal(events(dir).filter((e) => e.kind === 'system' && /chose to say nothing/.test(e.text)).length, 3);
});

test('bare [JOURNAL] with no entry: recorded as said-nothing, no empty journal entry', async () => {
  const dir = await runStubSession(
    testConfig({ maxRounds: 1, agents: [{ id: 'alpha', name: 'Alpha', model: 'test/alpha-voice-0', adapter: 'openrouter', color: '#111' }, { id: 'beta', name: 'Beta', model: 'test/beta-voice', adapter: 'openrouter', color: '#222' }], journal: { enabled: true, notice: true, mode: 'replace', recall: true, maxTokens: 0, pass: { enabled: false, notice: false } } }),
    'plain,plain', // placeholder; the real check is in parse.test.ts — here we assert no crash path
  );
  assert.ok(events(dir).some((e) => e.kind === 'end'));
});

test('traceSeats: end event lists exactly the seats that produced traces', async () => {
  const dir = await runStubSession(testConfig({ maxRounds: 4 }), 'plain');
  const es = events(dir);
  const end = es.find((e) => e.kind === 'end');
  const traced = [...new Set(es.filter((e) => e.kind === 'message' && e.thinking).map((e) => (e.kind === 'message' ? e.agentId : '')))].sort();
  assert.ok(end && end.kind === 'end');
  assert.deepEqual(end.payload.traceSeats, traced);
});

test('logprobs capture: telemetry carries them only where the provider returns them', async () => {
  // Stub emits fake logprobs on even-hash models: beta yes, alpha/gamma no.
  const dir = await runStubSession(testConfig({ maxRounds: 2 }), 'plain');
  const msgs = events(dir).filter((e) => e.kind === 'message');
  const withLp = msgs.filter((e) => e.kind === 'message' && e.telemetry?.logprobs?.length);
  const betaMsgs = msgs.filter((e) => e.kind === 'message' && e.agentId === 'beta');
  assert.ok(betaMsgs.length > 0);
  assert.deepEqual(withLp.map((e) => e.kind === 'message' && e.agentId), betaMsgs.map(() => 'beta'));
  for (const e of withLp) {
    assert.ok(e.kind === 'message' && e.telemetry!.logprobs!.every((x) => typeof x === 'number' && x <= 0));
  }
});

test('journal recall never leaks wall-clock time into agent context', async () => {
  // The .md writer stamps real ISO timestamps in entry headers; recall must
  // strip them or countdown-hidden conditions leak the actual time.
  const config = testConfig({
    maxRounds: 2,
    journal: { enabled: true, notice: true, mode: 'replace', recall: true, maxTokens: 0, pass: { enabled: false, notice: false } },
  });
  const dir = await runStubSession(config, 'journal,plain');
  const { buildTurnMessages } = await import('../src/context.js');
  const { readFileSync: rf, readdirSync: rd } = await import('node:fs');
  const { join: j } = await import('node:path');
  const raw = rf(j(dir, 'journals', rd(j(dir, 'journals'))[0]), 'utf8');
  assert.match(raw, /## Round \d+ — \d{4}-/, 'the .md file itself should keep timestamps for analysis');
  // Recall path: same sanitization runSession applies
  const recalled = raw.replace(/^(## Round \d+) — \d{4}-\d{2}-\d{2}T[^\n]*$/gm, '$1');
  const prompt = buildTurnMessages({
    agent: config.agents[0], config, events: [], summary: '', minutesRemaining: 5, ownJournal: recalled,
  }).map((m) => m.content).join('\n');
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(prompt), 'ISO timestamp leaked into the prompt');
  assert.match(prompt, /## Round \d+/);
});

test('batch identity is stamped into the meta event', async () => {
  const dir = await runStubSession(testConfig({ maxRounds: 1, batch: { name: 'pilot-x', index: 2, total: 10 } }), 'plain');
  const meta = events(dir).find((e) => e.kind === 'meta');
  assert.ok(meta && meta.kind === 'meta');
  assert.deepEqual(meta.payload.batch, { name: 'pilot-x', index: 2, total: 10 });
});

test('told-once countdown: duration in the round-0 welcome, absent per turn', async () => {
  const dir = await runStubSession(testConfig({ maxRounds: 1, countdown: 'told-once', durationMinutes: 5 }), 'plain');
  const es = events(dir);
  const welcome = es.find((e) => e.kind === 'system');
  assert.ok(welcome && welcome.kind === 'system' && /You have 5 minutes together/.test(welcome.text));
  // No other event ever mentions time again
  for (const e of es.slice(es.indexOf(welcome) + 1)) {
    if ('text' in e && e.text) assert.ok(!/minutes together|Time remaining/i.test(e.text));
  }
});
