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

const J: JournalConfig = { enabled: false, notice: true, mode: 'replace', recall: true, maxTokens: 0 };
const S: SearchConfig = { enabled: true, mode: 'alongside', gated: false, notice: true, maxResults: 5 };
const T = (over: Partial<ToolsConfig> = {}): ToolsConfig => ({ files: true, python: true, maxFileChars: 16_000, fileViewChars: 2_000, maxFiles: 20, directories: false, fileDelete: false, fileViewTotalChars: 0, callFeedback: false, budget: 'per-seat', turnSteps: 1, transport: 'sentinel', notice: true, pythonTimeoutSeconds: 10, pythonPackages: ['numpy', 'pandas', 'sympy', 'networkx', 'matplotlib'], pythonInstall: true, runPublic: false, sourceCode: true, sourceScope: 'tools', configurable: false, ...over });

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
  // The whole object, deliberately: this is the guard against a new tool
  // knob silently changing a condition that has already been RUN. The
  // project task added folders, deletion and a file cap — all three must
  // read as off/flat here, or `tools-full` is not the condition its
  // transcripts were recorded under.
  assert.deepEqual(full.tools, { files: true, python: true, maxFileChars: 16_000, fileViewChars: 2_000, maxFiles: 20, directories: false, fileDelete: false, fileViewTotalChars: 0, callFeedback: false, budget: 'per-seat', turnSteps: 1, transport: 'sentinel', notice: true, pythonTimeoutSeconds: 30, pythonPackages: ['numpy', 'pandas', 'sympy', 'networkx', 'matplotlib'], pythonInstall: true, runPublic: true, sourceCode: true, sourceScope: 'tools', configurable: false });
  assert.equal(full.search.mode, 'alongside');
  assert.equal(full.journal.enabled, false);
  const scarce = resolveCondition('tools-scarce');
  assert.equal(scarce.tools.budget, 'per-room');
  assert.deepEqual(conditionRecord(scarce).tools, scarce.tools, 'tools must be stamped into meta');
});

// ── §9.9 the project bench: folders, deletion, and the view budget ────────

test('folders: names carry paths only where the condition allows it', () => {
  const flat = T();
  const nested = T({ directories: true, fileDelete: true });
  // The PARSER takes any name; it is the session that validates. Both
  // transports produce the same action shape.
  assert.deepEqual(
    parseReply('[WRITE: src/parser.py]\ndef parse(): pass\n[/WRITE]', J, S, nested),
    { kind: 'write', name: 'src/parser.py', content: 'def parse(): pass' },
  );
  // [DELETE] exists only where fileDelete is on: with it off the line is
  // not a call at all, so the room simply hears it.
  assert.deepEqual(parseReply('[DELETE: notes.md]', J, S, nested), { kind: 'delete', name: 'notes.md' });
  assert.equal(parseReply('[DELETE: notes.md]', J, S, flat).kind, 'message');
  // Spoken text after the line still reaches the room.
  assert.deepEqual(
    parseReply('[DELETE: old.py]\nthat one was mine to remove', J, S, nested),
    { kind: 'delete', name: 'old.py', spoken: 'that one was mine to remove' },
  );
  // A typo'd token is still read as the call (the Levenshtein tolerance
  // every other sentinel gets).
  assert.equal(parseReply('[DELET: old.py]', J, S, nested).kind, 'delete');
});

test('a folder write lands, and a deletion removes it for everyone', async () => {
  const { resolveCondition } = await import('../src/conditions.js');
  const project = resolveCondition('project');
  const dir = await runStubSession(
    testConfig({ maxRounds: 2, tools: { ...project.tools, turnSteps: 1 }, completion: project.completion }),
    'nested-delete',
  );
  const es = readTranscript(dir);
  const files = es.filter((e) => e.kind === 'file') as Extract<RoomEvent, { kind: 'file' }>[];
  const wrote = files.filter((f) => !f.deleted && !f.denied);
  const removed = files.filter((f) => f.deleted && !f.denied);
  assert.ok(wrote.length, 'the folder write was published');
  assert.equal(wrote[0].name, 'src/parser.py');
  assert.ok(removed.length, 'and a later turn deleted it');
  assert.ok(removed[0].content.includes('def parse'), 'the removal event keeps the contents it took away');
  // Gone from the mirror too: a deletion the disk did not hear about would
  // leave the session directory disagreeing with the transcript.
  assert.ok(!existsSync(join(dir, 'shared', 'src', 'parser.py')), 'and the mirror no longer holds it');
});

test('a folder write is mirrored to disk under its folder', async () => {
  const { resolveCondition } = await import('../src/conditions.js');
  const project = resolveCondition('project');
  const dir = await runStubSession(
    testConfig({ maxRounds: 1, tools: { ...project.tools, turnSteps: 1 }, completion: project.completion }),
    'nested',
  );
  assert.ok(existsSync(join(dir, 'shared', 'src', 'parser.py')));
  assert.match(readFileSync(join(dir, 'shared', 'src', 'parser.py'), 'utf8'), /def parse/);
});

test('a name cannot climb out of shared/, folders or no folders', async () => {
  const { resolveCondition } = await import('../src/conditions.js');
  const project = resolveCondition('project');
  const dir = await runStubSession(
    testConfig({ maxRounds: 1, tools: { ...project.tools, turnSteps: 1 }, completion: project.completion }),
    'escape',
  );
  const es = readTranscript(dir);
  const files = es.filter((e) => e.kind === 'file') as Extract<RoomEvent, { kind: 'file' }>[];
  assert.ok(files.length, 'the attempt was recorded');
  assert.ok(files.every((f) => f.denied), 'and every one of them was refused');
  assert.ok(!existsSync(join(dir, 'evil.md')), 'nothing was written beside the session dir');
  assert.ok(!existsSync(join(dir, '..', 'evil.md')), 'nor above it');
});

test('the shared-file block has a total budget, and never hides a file silently', () => {
  const big = (n: string, c: string) => ({ name: n, content: c.repeat(400) });
  const files = [big('a.py', 'a'), big('b.py', 'b'), big('c.py', 'c')];
  const msgs = (total: number) => buildTurnMessages({
    agent: AGENTS[0],
    config: testConfig({ tools: T({ directories: true, fileViewChars: 1_000, fileViewTotalChars: total }) }),
    events: [], summary: '', minutesRemaining: 10, ownJournal: '', sharedFiles: files,
  })[0].content;
  const uncapped = msgs(0);
  for (const f of files) assert.match(uncapped, new RegExp(`--- ${f.name} ---`), 'no cap = every file inlined');
  // 900 fits one 400-char file, then stops inlining.
  const capped = msgs(900);
  assert.match(capped, /--- a\.py ---/, 'the first file is still shown in full');
  assert.doesNotMatch(capped, /--- c\.py ---\n/, 'the last is not inlined');
  // …but it is still NAMED, with its size. A file a seat cannot see must
  // never be a file a seat does not know exists.
  assert.match(capped, /not shown here/);
  assert.match(capped, /c\.py \(400 characters\)/);
});

test('the room is told the shape of its filesystem', async () => {
  const { resolveCondition } = await import('../src/conditions.js');
  const say = (name: string) => buildTurnMessages({
    agent: AGENTS[0], config: resolveCondition(name), events: [], summary: '', minutesRemaining: 30, ownJournal: '',
  })[0].content;
  const project = say('project');
  assert.match(project, /holds up to 40 files/);
  assert.match(project, /folders in them/);
  assert.match(project, /\[DELETE: filename\]/);
  // …and the conditions that were run without any of it still are not told.
  const site = say('site');
  assert.match(site, /holds up to 20 files/);
  assert.doesNotMatch(site, /folders in them/);
  assert.doesNotMatch(site, /DELETE/);
});

test('native: the write schema states the room’s real limits, and delete appears with it', async () => {
  const { toolDefs } = await import('../src/tools-schema.js');
  const { resolveCondition } = await import('../src/conditions.js');
  const site = resolveCondition('site');
  const defs = toolDefs({ ...site, tools: { ...site.tools, transport: 'native' } });
  const write = defs.find((d) => d.function.name === 'write_file');
  // Was hardcoded "20 files, 16000 characters each" — which told a native
  // task room the wrong ceiling while its own prose said 60,000.
  assert.match(write!.function.description, /60000 characters each/);
  assert.ok(!defs.some((d) => d.function.name === 'delete_file'), 'site cannot delete');
  const project = resolveCondition('project');
  const pdefs = toolDefs({ ...project, tools: { ...project.tools, transport: 'native' } });
  assert.ok(pdefs.some((d) => d.function.name === 'delete_file'), 'project can');
  assert.match(pdefs.find((d) => d.function.name === 'write_file')!.function.description, /folders/);
});

test('the viewer’s offline condition list matches conditions/', async () => {
  // conditions.json is generated at deploy time and is what the panel
  // normally reads; this hardcoded list is the fallback when that fetch
  // fails. It had silently drifted — `floor` existed as a condition for
  // days and could not be selected without a working fetch.
  const { readdirSync } = await import('node:fs');
  const html = readFileSync(join(process.cwd(), 'viewer', 'index.html'), 'utf8');
  const block = html.match(/const CONDITIONS = \[(.*?)\];/s);
  assert.ok(block, 'the viewer still declares a CONDITIONS list');
  const listed = new Set([...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const files = readdirSync(join(process.cwd(), 'conditions')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  for (const f of files) assert.ok(listed.has(f), `conditions/${f}.json is missing from the viewer list`);
  // 'control' is the base config and has no file of its own.
  for (const l of listed) assert.ok(l === 'control' || files.includes(l), `the viewer lists "${l}", which has no condition file`);
});

test('the journal is rescued mid-reply, in every arm that has one', async () => {
  const { resolveCondition } = await import('../src/conditions.js');
  // Corina's live shape (DeepSeek, site-unending 2026-08-30T17-58-49): a
  // paragraph to the room, then a journal block. It was spoken whole.
  const live = [
    "Let me do the one thing that's actually mine to do: read final state, then pass.",
    '',
    '[JOURNAL]',
    'I checked: `lastEdit` is frozen at 2026-08-30T18:34:09Z — build 22, by Opus.',
    '[/JOURNAL]',
  ].join('\n');
  const entry = /lastEdit` is frozen/;

  // One parse path, so this holds for every condition with a journal — the
  // two modes differ only in whether the room also hears the preamble as a
  // message or as the turn's whole utterance.
  const withJournal = ['house', 'journal-free', 'site', 'site-open', 'project', 'site-open-whittle', 'trace-rich'];
  for (const name of withJournal) {
    const c = resolveCondition(name);
    const r = parseReply(live, c.journal, c.search, c.tools, c.pass, c.completion) as
      { kind: string; entry?: string; preamble?: string };
    assert.ok(r.kind === 'journal' || r.kind === 'alongside', `${name}: journal must not be spoken (got ${r.kind})`);
    assert.match(r.entry ?? '', entry, `${name}: the entry is the private half`);
    assert.match(r.preamble ?? '', /^Let me do the one thing/, `${name}: the prose still reaches the room`);
  }
  // Where the journal is OFF, the bracket is just words — rescuing it would
  // invent a channel the condition deliberately withholds.
  for (const name of ['control', 'tools-full', 'agentic']) {
    const c = resolveCondition(name);
    assert.equal(parseReply(live, c.journal, c.search, c.tools, c.pass, c.completion).kind, 'message', name);
  }
});

test('a replace-mode entry does not keep its own closing tag', async () => {
  const { resolveCondition } = await import('../src/conditions.js');
  const c = resolveCondition('house');           // journal: enabled, replace
  const r = parseReply('[JOURNAL]\nthe entry\n[/JOURNAL]', c.journal) as { kind: string; entry: string };
  assert.equal(r.kind, 'journal');
  assert.equal(r.entry, 'the entry', 'the tag was being stored as part of the entry text');
});
