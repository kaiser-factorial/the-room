// F4½ tools: [WRITE]/[RUN] parsing, shared-file publicity, run privacy
// (journal-class), and the per-room tool budget.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseReply } from '../src/parse.js';
import { audibleEvents, buildTurnMessages } from '../src/context.js';
import { testConfig, runStubSession, AGENTS } from './helpers.js';
import type { JournalConfig, RoomEvent, SearchConfig, ToolsConfig } from '../src/types.js';

const J: JournalConfig = { enabled: false, notice: true, mode: 'replace', recall: true, maxTokens: 0, pass: { enabled: false, notice: false } };
const S: SearchConfig = { enabled: true, mode: 'alongside', gated: false, notice: true, maxResults: 5 };
const T = (over: Partial<ToolsConfig> = {}): ToolsConfig => ({ files: true, python: true, budget: 'per-seat', notice: true, pythonTimeoutSeconds: 10, pythonPackages: ['numpy', 'pandas', 'sympy', 'networkx', 'matplotlib'], pythonInstall: true, ...over });

function readTranscript(dir: string): RoomEvent[] {
  return readFileSync(join(dir, 'transcript.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as RoomEvent);
}

test('tool sentinel table: WRITE and RUN variants parse as intended', () => {
  const w = parseReply('[WRITE: notes.md]\nhello room\n[/WRITE]\nand a message', J, S, T());
  assert.deepEqual(w, { kind: 'write', name: 'notes.md', content: 'hello room', spoken: 'and a message' });
  const wBare = parseReply('[WRITE: a.txt] just contents [/WRITE]', J, S, T());
  assert.deepEqual(wBare, { kind: 'write', name: 'a.txt', content: 'just contents' });
  const wOpen = parseReply('[WRITE: a.txt]\nforgot to close', J, S, T());
  assert.deepEqual(wOpen, { kind: 'write', name: 'a.txt', content: 'forgot to close' });
  const wTypo = parseReply('[WRTE: a.txt] typo [/WRTE]', J, S, T());
  assert.equal(wTypo.kind, 'write');

  const r = parseReply('[RUN]\nprint(1)\n[/RUN]\nspoken after', J, S, T());
  assert.deepEqual(r, { kind: 'run', code: 'print(1)', spoken: 'spoken after' });
  const rOpen = parseReply('[RUN]\nprint(1)', J, S, T());
  assert.deepEqual(rOpen, { kind: 'run', code: 'print(1)' });
  const rEmpty = parseReply('[RUN]\n[/RUN]', J, S, T());
  assert.equal(rEmpty.kind, 'empty');

  // Disabled tools: sentinels are speech; search still parses independently.
  assert.equal(parseReply('[WRITE: a.txt] x [/WRITE]', J, S, T({ files: false })).kind, 'message');
  assert.equal(parseReply('[RUN] x [/RUN]', J, S, T({ python: false })).kind, 'message');
  assert.equal(parseReply('[SEARCH: q]', J, S, T()).kind, 'search');
  // Mid-sentence mentions stay speech.
  assert.equal(parseReply('I could use [RUN] here but will not', J, S, T()).kind, 'message');
});

test('shared files: written to disk, public in every prompt, contents out of the transcript', async () => {
  const config = testConfig({ maxRounds: 1, tools: T() });
  const dir = await runStubSession(config, 'write');
  const events = readTranscript(dir);
  const files = events.filter((e) => e.kind === 'file');
  assert.equal(files.length, 3, 'every seat wrote');
  assert.ok(existsSync(join(dir, 'shared', 'notes.md')), 'shared file not on disk');

  // Transcript text carries the notice only, never the contents.
  for (const e of events) {
    if ('text' in e && e.text) assert.ok(!e.text.includes('shared-note'), `file contents leaked into a ${e.kind} event's text`);
  }
  // Every agent sees the file in the shared-files block.
  const shared = [{ name: 'notes.md', content: 'shared-note test/alpha-voice-0#1' }];
  for (const agent of AGENTS) {
    const prompt = buildTurnMessages({ agent, config, events, summary: '', minutesRemaining: 3, ownJournal: '', sharedFiles: shared })
      .map((m) => m.content).join('\n');
    assert.match(prompt, /Shared files in the room/, `${agent.id} missing shared-files block`);
    assert.match(prompt, /shared-note/, `${agent.id} cannot read the shared file`);
    assert.match(prompt, /updated the shared file "notes\.md"/, `${agent.id} missing the write notice`);
  }
});

test('run privacy: code and output never reach the transcript text or any context', async () => {
  const config = testConfig({ maxRounds: 1, tools: T() });
  const dir = await runStubSession(config, 'run');
  const events = readTranscript(dir);
  const runs = events.filter((e) => e.kind === 'run');
  assert.equal(runs.length, 3);
  for (const r of runs) {
    assert.ok(r.kind === 'run' && !r.denied && r.output && r.output.includes('stub-python-output'), 'run event missing output');
  }
  for (const e of events) {
    if ('text' in e && e.text) {
      assert.ok(!e.text.includes('private-code'), `code leaked into a ${e.kind} event's text`);
      assert.ok(!e.text.includes('stub-python-output'), `output leaked into a ${e.kind} event's text`);
    }
  }
  for (const agent of AGENTS) {
    const prompt = buildTurnMessages({ agent, config, events, summary: '', minutesRemaining: 3, ownJournal: '' })
      .map((m) => m.content).join('\n');
    assert.ok(!prompt.includes('private-code'), `code leaked into ${agent.id}'s context`);
    assert.ok(!prompt.includes('stub-python-output'), `output leaked into ${agent.id}'s context`);
    assert.match(prompt, /ran some code/, `${agent.id} missing the run notice`);
  }
});

test('run-published files: shared/ writes become binary shared files, listed not inlined', async () => {
  const config = testConfig({ maxRounds: 1, tools: T() });
  const dir = await runStubSession(config, 'run-file');
  const events = readTranscript(dir);
  const files = events.filter((e) => e.kind === 'file');
  assert.equal(files.length, 3, 'every run should publish its shared/ file');
  for (const f of files) {
    assert.ok(f.kind === 'file' && !f.denied && f.name === 'stub-artifact.png');
    // Stub bytes are text, but the publish path must carry the content
    // either way; the event is attributed to the running agent.
    assert.ok(f.kind === 'file' && f.content.length > 0);
  }
  assert.ok(existsSync(join(dir, 'shared', 'stub-artifact.png')), 'published file not on disk');
  // A binary shared file renders as a listing line, never inline content.
  const prompt = buildTurnMessages({
    agent: AGENTS[0], config, events, summary: '', minutesRemaining: 3, ownJournal: '',
    sharedFiles: [{ name: 'plot.png', content: '', binary: true, size: 20480 }],
  }).map((m) => m.content).join('\n');
  assert.match(prompt, /plot\.png \(binary file, 20 KB\)/);
});

test('per-room budget: one tool action per round, losers refused inaudibly, speech still lands', async () => {
  const config = testConfig({ maxRounds: 1, tools: T({ budget: 'per-room' }) });
  const dir = await runStubSession(config, 'run');
  const events = readTranscript(dir);
  const runs = events.filter((e) => e.kind === 'run');
  const allowed = runs.filter((e) => e.kind === 'run' && !e.denied);
  const denied = runs.filter((e) => e.kind === 'run' && e.denied);
  assert.equal(allowed.length, 1, 'exactly one run should win the round');
  assert.equal(denied.length, 2, 'the other two should be refused');
  assert.equal(audibleEvents(denied).length, 0, 'a refused run was audible');
  // Alongside semantics survive the refusal: every seat still spoke.
  assert.equal(events.filter((e) => e.kind === 'message').length, 3);
});

test('per-room budget: a denied action does not spend the round slot', async () => {
  // Round of 3 seats under per-room budget: seat 1 writes an INVALID file
  // name (refused, slot kept), seat 2 runs (wins the slot), seat 3 runs
  // (refused on budget).
  const config = testConfig({ maxRounds: 1, tools: T({ budget: 'per-room' }) });
  const dir = await runStubSession(config, 'badwrite,run,run');
  const events = readTranscript(dir);
  const files = events.filter((e) => e.kind === 'file');
  const runs = events.filter((e) => e.kind === 'run');
  assert.equal(files.length, 1);
  assert.ok(files[0].kind === 'file' && files[0].denied, 'invalid write should be refused');
  assert.equal(runs.filter((e) => e.kind === 'run' && !e.denied).length, 1, 'the slot should still be available after the refused write');
  assert.equal(runs.filter((e) => e.kind === 'run' && e.denied).length, 1);
});

test('condition presets: tools-full and tools-scarce resolve onto the base config', async () => {
  const { resolveCondition, conditionRecord } = await import('../src/conditions.js');
  const full = resolveCondition('tools-full');
  assert.deepEqual(full.tools, { files: true, python: true, budget: 'per-seat', notice: true, pythonTimeoutSeconds: 30, pythonPackages: ['numpy', 'pandas', 'sympy', 'networkx', 'matplotlib'], pythonInstall: true });
  assert.equal(full.search.mode, 'alongside');
  assert.equal(full.journal.enabled, false);
  const scarce = resolveCondition('tools-scarce');
  assert.equal(scarce.tools.budget, 'per-room');
  assert.deepEqual(conditionRecord(scarce).tools, scarce.tools, 'tools must be stamped into meta');
});
