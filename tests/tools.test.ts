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
const T = (over: Partial<ToolsConfig> = {}): ToolsConfig => ({ files: true, python: true, budget: 'per-seat', turnSteps: 1, transport: 'sentinel', notice: true, pythonTimeoutSeconds: 10, pythonPackages: ['numpy', 'pandas', 'sympy', 'networkx', 'matplotlib'], pythonInstall: true, runPublic: false, sourceCode: true, sourceScope: 'tools', configurable: false, ...over });

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

test('append + run-capture sentinels parse as intended', () => {
  const a = parseReply('[APPEND: log.md]\nmore\n[/APPEND]\nand speech', J, S, T());
  assert.deepEqual(a, { kind: 'write', name: 'log.md', content: 'more', append: true, spoken: 'and speech' });
  // Mixed closing tag still splits; typo'd APPEND still counts.
  assert.equal(parseReply('[APPEND: a.md] x [/WRITE] talk', J, S, T()).kind, 'write');
  const typo = parseReply('[APEND: a.md] x [/APEND]', J, S, T());
  assert.ok(typo.kind === 'write' && typo.append);
  const save = parseReply('[RUN > out.txt]\nprint(1)\n[/RUN]\nspeech', J, S, T());
  assert.deepEqual(save, { kind: 'run', code: 'print(1)', saveTo: { name: 'out.txt', append: false }, spoken: 'speech' });
  const saveAppend = parseReply('[RUN >> log.txt]\nprint(1)\n[/RUN]', J, S, T());
  assert.deepEqual(saveAppend, { kind: 'run', code: 'print(1)', saveTo: { name: 'log.txt', append: true } });
  const plain = parseReply('[RUN]\nprint(1)\n[/RUN]', J, S, T());
  assert.deepEqual(plain, { kind: 'run', code: 'print(1)' });
});

test('append composes onto the existing file; run >> captures output into a shared file', async () => {
  const config = testConfig({ maxRounds: 2, tools: T() });
  // Round 1: everyone writes notes.md; round 2: everyone appends to it.
  const dir = await runStubSession(config, 'write,write,write,append,append,append');
  const events = readTranscript(dir);
  const fileEvents = events.filter((e) => e.kind === 'file' && !e.denied);
  assert.equal(fileEvents.length, 6);
  const last = fileEvents[fileEvents.length - 1];
  assert.ok(last.kind === 'file' && last.content.includes('shared-note') && last.content.includes('appended-line'),
    'append should keep the original write and add the new line');
  const onDisk = readFileSync(join(dir, 'shared', 'notes.md'), 'utf8');
  assert.ok(onDisk.includes('shared-note') && onDisk.includes('appended-line'));

  const config2 = testConfig({ maxRounds: 1, tools: T() });
  const dir2 = await runStubSession(config2, 'run-save');
  const events2 = readTranscript(dir2);
  const runs = events2.filter((e) => e.kind === 'run' && !e.denied);
  const logs = events2.filter((e) => e.kind === 'file' && !e.denied);
  assert.equal(runs.length, 3);
  assert.equal(logs.length, 3, 'each run should publish its captured output');
  const lastLog = logs[logs.length - 1];
  assert.ok(lastLog.kind === 'file' && lastLog.name === 'runlog.txt');
  const outputs = (lastLog.kind === 'file' ? lastLog.content : '').split('\n').filter((l) => l.includes('stub-python-output'));
  assert.equal(outputs.length, 3, '>> should accumulate all three runs\' outputs');
});

test('[SOURCE]: parses, delivers privately, never spends the budget, contents stay out of contexts', async () => {
  const p = parseReply('[SOURCE: sandbox]\nand speech', J, S, T());
  assert.deepEqual(p, { kind: 'source', name: 'sandbox', spoken: 'and speech' });
  assert.deepEqual(parseReply('[SOURCE]', J, S, T()), { kind: 'source' });
  assert.equal(parseReply('[SOURCE: x]', J, S, T({ sourceCode: false })).kind, 'message');
  const { readSource, sourceIndex } = await import('../src/source.js');
  assert.ok(readSource('sandbox')!.includes('WORKER_SRC'), 'sandbox source should be readable');
  assert.equal(readSource('session'), null, 'condition machinery must stay unreadable');
  assert.match(sourceIndex(), /\[SOURCE: name\]/);

  // Per-room budget: a source read never takes the round's slot.
  const config = testConfig({ maxRounds: 1, tools: T({ budget: 'per-room' }) });
  const dir = await runStubSession(config, 'source,run,run');
  const events = readTranscript(dir);
  assert.equal(events.filter((e) => e.kind === 'source').length, 1);
  assert.equal(events.filter((e) => e.kind === 'run' && !e.denied).length, 1, 'the slot should survive a source read');
  // Source CONTENTS never enter the transcript or any context.
  for (const e of events) {
    if ('text' in e && e.text) assert.ok(!e.text.includes('WORKER_SRC'), 'source code leaked into transcript');
  }
  for (const agent of AGENTS) {
    const prompt = buildTurnMessages({ agent, config, events, summary: '', minutesRemaining: 3, ownJournal: '' })
      .map((m) => m.content).join('\n');
    assert.ok(!prompt.includes('WORKER_SRC'), `source code leaked into ${agent.id}'s context`);
    assert.match(prompt, /read the room's source code/, `${agent.id} missing the source notice`);
  }
});

test('runPublic: code and output are spoken to the room; caller still gets output privately', async () => {
  const config = testConfig({ maxRounds: 1, tools: T({ runPublic: true }) });
  const dir = await runStubSession(config, 'run');
  const events = readTranscript(dir);
  const runs = events.filter((e) => e.kind === 'run');
  assert.equal(runs.length, 3);
  for (const r of runs) assert.ok(r.kind === 'run' && r.public, 'run event not stamped public');
  // Everyone's context carries everyone's code + output (incl. their own
  // event's rendering — public means public).
  for (const agent of AGENTS) {
    const prompt = buildTurnMessages({ agent, config, events, summary: '', minutesRemaining: 3, ownJournal: '' })
      .map((m) => m.content).join('\n');
    assert.match(prompt, /ran code:/, `${agent.id} missing public run rendering`);
    assert.match(prompt, /private-code/, `${agent.id} missing the code text`);
    assert.match(prompt, /stub-python-output/, `${agent.id} missing the output`);
  }
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
  assert.deepEqual(full.tools, { files: true, python: true, budget: 'per-seat', turnSteps: 1, transport: 'sentinel', notice: true, pythonTimeoutSeconds: 30, pythonPackages: ['numpy', 'pandas', 'sympy', 'networkx', 'matplotlib'], pythonInstall: true, runPublic: true, sourceCode: true, sourceScope: 'tools', configurable: false });
  assert.equal(full.search.mode, 'alongside');
  assert.equal(full.journal.enabled, false);
  const scarce = resolveCondition('tools-scarce');
  assert.equal(scarce.tools.budget, 'per-room');
  assert.deepEqual(conditionRecord(scarce).tools, scarce.tools, 'tools must be stamped into meta');
});
