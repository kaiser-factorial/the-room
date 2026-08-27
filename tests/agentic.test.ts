// F4¾ agentic turn loop: several actions inside ONE turn, each result fed
// straight back, and the rules that keep the room measurable while it
// happens — speaking ends the turn, refusals are machine-readable and
// capped, and nothing an agent learns mid-turn reaches anyone else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTurnMessages, renderTranscript } from '../src/context.js';
import {
  effectiveTurnSteps, formatRefusal, loopEnabled, maxTurnCalls, observationBlock, refusal,
  MAX_TURN_REFUSALS, MAX_TURN_STEPS,
} from '../src/agentic.js';
import { applyConfigChange } from '../src/governance.js';
import { testConfig, runStubSession, AGENTS } from './helpers.js';
import type { RoomEvent, ToolsConfig } from '../src/types.js';

const T = (over: Partial<ToolsConfig> = {}): ToolsConfig => ({
  files: true, python: true, budget: 'per-seat', turnSteps: 3, transport: 'sentinel', notice: true,
  pythonTimeoutSeconds: 10, pythonPackages: ['numpy'], pythonInstall: false,
  runPublic: false, sourceCode: true, sourceScope: 'tools', configurable: false, ...over,
});

function readTranscript(dir: string): RoomEvent[] {
  return readFileSync(join(dir, 'transcript.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as RoomEvent);
}

test('effective steps: capped, floored, and pinned to 1 under the per-room budget', () => {
  assert.equal(effectiveTurnSteps(testConfig({ tools: T({ turnSteps: 4 }) })), 4);
  assert.equal(effectiveTurnSteps(testConfig({ tools: T({ turnSteps: 0 }) })), 1);
  assert.equal(effectiveTurnSteps(testConfig({ tools: T({ turnSteps: 99 }) })), MAX_TURN_STEPS);
  // tools-scarce: the room's ONE action per round is the scarce thing being
  // negotiated — a loop would hand the whole round to whoever moved first.
  assert.equal(effectiveTurnSteps(testConfig({ tools: T({ turnSteps: 4, budget: 'per-room' }) })), 1);
  assert.equal(loopEnabled(testConfig({ tools: T({ turnSteps: 1 }) })), false);
  assert.equal(maxTurnCalls(testConfig({ tools: T({ turnSteps: 3 }) })), 3 + MAX_TURN_REFUSALS + 1);
});

test('the loop: several actions in one turn, each result fed back before the agent speaks', async () => {
  // Per seat: run (step 1) → run (step 2) → speak. The turn is one message.
  const config = testConfig({ maxRounds: 1, tools: T({ turnSteps: 3 }) });
  const dir = await runStubSession(config, 'run-quiet,run-quiet,plain');
  const events = readTranscript(dir);
  const runs = events.filter((e) => e.kind === 'run');
  assert.equal(runs.length, 6, 'three seats × two runs each');
  assert.deepEqual(
    runs.map((e) => (e.kind === 'run' ? e.step : undefined)),
    [1, 2, 1, 2, 1, 2],
    'each action is stamped with its position in the turn',
  );
  const messages = events.filter((e) => e.kind === 'message');
  assert.equal(messages.length, 3, 'one utterance per seat per turn, whatever it did first');
  // The turn's call count rides in telemetry so cost is queryable.
  for (const m of messages) {
    assert.equal(m.kind === 'message' && m.telemetry?.calls, 3, 'three completions bought this turn');
  }
});

test('speaking ends the turn: an action with a spoken half takes exactly one step', async () => {
  // 'run' = [RUN]…[/RUN] followed by speech. Even with three steps on offer,
  // the utterance closes the turn and the output waits for the next one.
  const config = testConfig({ maxRounds: 1, tools: T({ turnSteps: 3 }) });
  const dir = await runStubSession(config, 'run');
  const events = readTranscript(dir);
  assert.equal(events.filter((e) => e.kind === 'run').length, 3, 'one run per seat, not three');
  assert.equal(events.filter((e) => e.kind === 'message').length, 3);
});

test('turnSteps 1 keeps the original economics: one action, result deferred', async () => {
  const config = testConfig({ maxRounds: 1, tools: T({ turnSteps: 1 }) });
  const dir = await runStubSession(config, 'run-quiet');
  const events = readTranscript(dir);
  const runs = events.filter((e) => e.kind === 'run');
  assert.equal(runs.length, 3, 'one silent run per seat and no second call');
  assert.ok(runs.every((e) => e.kind === 'run' && e.step === undefined), 'no step stamps in a single-step room');
  // A silent action in a single-step room says nothing to the room at all —
  // no "said nothing" system line either, exactly as before F4¾.
  assert.equal(events.filter((e) => e.kind === 'system' && e.text.includes('said nothing')).length, 0);
});

test('steps run out: the next action is refused with a machine-readable code, and the turn ends', async () => {
  // Two steps on offer, an endless appetite for running code.
  const config = testConfig({ maxRounds: 1, tools: T({ turnSteps: 2 }) });
  const dir = await runStubSession(config, 'run-quiet');
  const events = readTranscript(dir);
  const runs = events.filter((e) => e.kind === 'run');
  const ran = runs.filter((e) => e.kind === 'run' && !e.denied);
  const denied = runs.filter((e) => e.kind === 'run' && e.denied);
  assert.equal(ran.length, 6, 'two runs per seat');
  assert.equal(denied.length, 3 * MAX_TURN_REFUSALS, 'then refusals, capped per turn');
  // Refusals never spend a step, and the cap is enforced in code — a seat
  // cannot spin on the room's clock however many times it retries.
  assert.ok(denied.every((e) => e.kind === 'run' && e.step === 3), 'a refused action does not advance the step count');
});

test('refusal schema: code, fix, and options — with the attempts line only while there are attempts', () => {
  const r = refusal('too_many_files', 'The room already holds 20 shared files.', 'Write to an existing file instead.', ['a.md', 'b.py']);
  const withMore = formatRefusal('Your write to "c.txt" did not happen.', r, 1);
  assert.match(withMore, /\[too_many_files\]/);
  assert.match(withMore, /Fix: Write to an existing file instead\./);
  assert.match(withMore, /Available: a\.md, b\.py\./);
  assert.match(withMore, /One more attempt this turn/);
  // At zero the turn is already over and this note is read at the START of
  // the next one, where "stop retrying" would simply be false.
  assert.ok(!formatRefusal('lead', r, 0).includes('attempt'), 'no attempts line when there are none');
});

test('governance refusals carry the whitelist as available options', () => {
  const cfg = testConfig({ tools: T({ configurable: true }) });
  assert.equal(applyConfigChange(cfg, 'tools.turnSteps', '4'), null);
  assert.equal(cfg.tools.turnSteps, 4);
  const badValue = applyConfigChange(cfg, 'tools.turnSteps', '99');
  assert.equal(badValue?.code, 'bad_config_value');
  assert.match(badValue!.fix, /1 to 8/);
  const badKey = applyConfigChange(cfg, 'durationMinutes', '5');
  assert.equal(badKey?.code, 'bad_config_key');
  assert.ok(badKey!.available!.includes('tools.turnSteps'));
});

test('privacy: what an agent learns mid-turn reaches no one else', async () => {
  const config = testConfig({ maxRounds: 2, tools: T({ turnSteps: 3 }) });
  const dir = await runStubSession(config, 'run-quiet,run-quiet,plain');
  const events = readTranscript(dir);
  const runs = events.filter((e) => e.kind === 'run');
  assert.ok(runs.length > 3, 'multi-step turns did not happen — scenario broken');

  for (const agent of AGENTS) {
    const msgs = buildTurnMessages({
      agent, config, events, summary: '', minutesRemaining: 5, ownJournal: '',
      // The loop's own steps: this seat's actions and what came back.
      inTurn: [
        { role: 'assistant', content: '[RUN]\nprint("mine")\n[/RUN]' },
        { role: 'user', content: observationBlock('Output of the code you ran:\nmine-only', 2) },
      ],
    });
    const text = msgs.map((m) => m.content).join('\n');
    // Its own step is there, as a real assistant turn plus the observation.
    assert.ok(text.includes('mine-only'), 'the agent must see its own result');
    // Under 'turns' the seat's own past messages are assistant turns too,
    // so the in-turn step is the LAST one rather than the only one.
    const assistants = msgs.filter((m) => m.role === 'assistant');
    assert.ok(assistants.length >= 1);
    assert.match(assistants[assistants.length - 1].content, /print\("mine"\)/);
    // Nobody's code or output — including the seats that ran code in the
    // session above — is anywhere in this prompt.
    assert.ok(!text.includes('private-code'), `another agent's code reached ${agent.name}`);
  }
});

test('in-turn observations announce how much turn is left', () => {
  const mid = observationBlock('Results of your web search for "x":\nsomething', 2);
  assert.match(mid, /Private, for you alone/);
  assert.match(mid, /2 actions left/);
  const last = observationBlock('output', 0);
  assert.match(last, /last action this turn/);
});

test('a turn\'s notices collapse into one line for everyone else', () => {
  const base = { ts: '2026-01-01T00:00:00.000Z', round: 3, agentId: 'alpha', agentName: 'Alpha', notice: true };
  const slice: RoomEvent[] = [
    { kind: 'search', ...base, query: 'q' },
    { kind: 'run', ...base, code: 'print(1)' },
    { kind: 'file', ...base, name: 'plot.py', content: 'x' },
    { kind: 'message', ...base, agentId: 'beta', agentName: 'Beta', text: 'nice' },
  ];
  const rendered = renderTranscript(slice, 'beta', 'off');
  assert.equal(
    rendered.split('\n\n')[0],
    '[Alpha looked something up on the web, ran some code, then updated the shared file "plot.py".]',
    'three notice lines in a row would flood every other context',
  );
  assert.match(rendered, /Beta: nice/);
  // A different round is a different turn — never merged.
  const twoRounds: RoomEvent[] = [slice[0], { ...(slice[1] as RoomEvent & { round: number }), round: 4 }];
  assert.equal(renderTranscript(twoRounds, 'beta', 'off').split('\n\n').length, 2);
  // Under thought broadcast nothing collapses: each event carries its own
  // trace into the others' contexts and §9.3 must not lose one.
  assert.equal(renderTranscript(slice, 'beta', 'informed').split('\n\n').length, 4);
});

test('miswritten calls: the mangles models actually make now parse instead of being spoken', async () => {
  const { parseReply } = await import('../src/parse.js');
  const J = { enabled: false, notice: true, mode: 'replace' as const, recall: true, maxTokens: 0, pass: { enabled: false, notice: false } };
  const S = { enabled: true, mode: 'alongside' as const, gated: false, notice: true, maxResults: 5 };
  const t = T({ configurable: true });
  // Each of these used to fall through to { kind: 'message' } — i.e. the
  // broken tool call was SPOKEN to the room verbatim and the agent learned
  // nothing. The room hearing "[RUNN] print(1)" as a sentence is the worst
  // available outcome, so the parser leans toward recognising the attempt.
  assert.equal(parseReply('[RUNN]\nprint(1)\n[/RUN]', J, S, t).kind, 'run', 'typo in the RUN token');
  assert.equal(parseReply('[SEARCH what is a bread clip]', J, S, t).kind, 'search', 'missing colon');
  assert.equal(parseReply('[WRITE notes.md]\nhi\n[/WRITE]', J, S, t).kind, 'write', 'missing colon');
  assert.equal(parseReply('```\n[RUN]\nprint(1)\n[/RUN]\n```', J, S, t).kind, 'run', 'fenced whole reply');
  assert.equal(parseReply('[CONFIG tools.turnSteps = 4]', J, S, t).kind, 'config', 'missing colon');
  // An over-long name must PARSE so the bad_file_name refusal can teach it.
  const long = parseReply(`[WRITE: ${'a'.repeat(90)}]\nx\n[/WRITE]`, J, S, t);
  assert.equal(long.kind, 'write');

  // …but tolerance must not swallow speech. A sentinel mid-sentence, and a
  // fence around PART of a reply, are someone talking about a tool.
  assert.equal(parseReply('I could [RUN] this later', J, S, t).kind, 'message');
  assert.equal(parseReply('like this:\n```\n[RUN]\nx\n[/RUN]\n```\nsee?', J, S, t).kind, 'message');
  // RUN's tolerance is tight on purpose: one edit also reaches RUM and RAN.
  assert.equal(parseReply('[RUM] and a message', J, S, t).kind, 'message');
});

test('toolUse metric: chains, silent working turns, and completions per turn', async () => {
  const { toolUse } = await import('../src/analyze.js');
  const msgs = [
    { round: 1, ts: '', agentId: 'alpha', agentName: 'Alpha', text: 'hi', truncated: false, calls: 3 },
    { round: 2, ts: '', agentId: 'beta', agentName: 'Beta', text: 'yo', truncated: false },
  ];
  const actions = [
    { round: 1, agentId: 'alpha', kind: 'search' as const, step: 1 },
    { round: 1, agentId: 'alpha', kind: 'run' as const, step: 2 },
    { round: 1, agentId: 'alpha', kind: 'run' as const, step: 3, denied: true },
    // A whole turn of work with nothing said — only the loop makes this shape.
    { round: 2, agentId: 'alpha', kind: 'run' as const, step: 1 },
    { round: 2, agentId: 'alpha', kind: 'file' as const, step: 2 },
  ];
  const u = toolUse(actions, msgs as never, ['alpha', 'beta']) as never as {
    room: { actions: number; refused: number; actingTurns: number; chainLengths: Record<string, number> };
    byAgent: Record<string, { actions: number; refused: number; maxChain: number; multiStepTurns: number; silentWorkingTurns: number; meanCallsPerTurn: number; byKind: Record<string, number> }>;
  };
  assert.equal(u.room.actions, 4);
  assert.equal(u.room.refused, 1, 'a refusal is never counted as work');
  assert.deepEqual(u.room.chainLengths, { 2: 2 }, 'two turns of two actions each');
  const a = u.byAgent.alpha;
  assert.equal(a.maxChain, 2);
  assert.equal(a.multiStepTurns, 2);
  assert.equal(a.silentWorkingTurns, 1, 'round 2: acted twice, said nothing');
  assert.equal(a.meanCallsPerTurn, 3);
  assert.deepEqual(a.byKind, { search: 1, file: 1, run: 2 });
  assert.equal(u.byAgent.beta.actions, 0);
});

// ── Native transport (F4¾) ────────────────────────────────────────────────

test('native transport: the same actions, expressed as structured calls', async () => {
  const config = testConfig({ maxRounds: 1, tools: T({ transport: 'native', turnSteps: 3 }) });
  const dir = await runStubSession(config, 'run-quiet,run-quiet,plain');
  const events = readTranscript(dir);
  const runs = events.filter((e) => e.kind === 'run');
  assert.equal(runs.length, 6, 'three seats × two runs, through the tool channel');
  assert.ok(runs.every((e) => e.kind === 'run' && e.via === 'native'), 'actions are stamped with the channel they came through');
  assert.deepEqual(runs.map((e) => (e.kind === 'run' ? e.step : 0)), [1, 2, 1, 2, 1, 2]);
  assert.equal(events.filter((e) => e.kind === 'message').length, 3, 'still one utterance per seat per turn');
});

test('native transport: prose and a call in one completion end the turn together', async () => {
  // The shape the sentinel transport can't express without a position rule:
  // the model says something to the room AND makes a call in the same reply.
  const config = testConfig({ maxRounds: 1, tools: T({ transport: 'native', turnSteps: 3 }) });
  const dir = await runStubSession(config, 'run');
  const events = readTranscript(dir);
  assert.equal(events.filter((e) => e.kind === 'run').length, 3, 'one run per seat — speaking ended the turn');
  assert.equal(events.filter((e) => e.kind === 'message').length, 3);
});

test('native transport: bad arguments and unknown tools come back readable, not spoken', async () => {
  const { actionFromToolCall, toolDefs } = await import('../src/tools-schema.js');
  const cfg = testConfig({
    tools: T({ transport: 'native', configurable: true }),
    search: { enabled: true, mode: 'alongside', gated: false, notice: true, maxResults: 5 },
  });
  const names = toolDefs(cfg).map((d) => d.function.name);
  assert.deepEqual(names, ['search_web', 'write_file', 'run_python', 'read_source', 'set_config']);

  const unknown = actionFromToolCall({ id: '1', name: 'summon_kraken', arguments: '{}' }, cfg);
  assert.equal('code' in unknown && unknown.code, 'unknown_tool');
  assert.deepEqual('available' in unknown ? unknown.available : [], names, 'the refusal lists what the room does offer');

  const notJson = actionFromToolCall({ id: '2', name: 'run_python', arguments: '{oops' }, cfg);
  assert.equal('code' in notJson && notJson.code, 'bad_arguments');

  const noCode = actionFromToolCall({ id: '3', name: 'run_python', arguments: '{}' }, cfg);
  assert.equal('code' in noCode && noCode.code, 'bad_arguments');
  assert.match(('fix' in noCode ? noCode.fix : ''), /code/);

  // Valid calls become the SAME ToolAction the sentinel parser produces —
  // one action layer, two ways of asking for it.
  assert.deepEqual(actionFromToolCall({ id: '4', name: 'run_python', arguments: '{"code":"print(1)"}' }, cfg), { kind: 'run', code: 'print(1)' });
  assert.deepEqual(actionFromToolCall({ id: '5', name: 'write_file', arguments: '{"name":"a.md","content":"x","append":true}' }, cfg), { kind: 'write', name: 'a.md', content: 'x', append: true });
  assert.deepEqual(actionFromToolCall({ id: '6', name: 'read_source', arguments: '{}' }, cfg), { kind: 'source' });
  // Empty content is legitimate (truncating a file), so it must not be
  // treated as a missing argument.
  assert.deepEqual(actionFromToolCall({ id: '7', name: 'write_file', arguments: '{"name":"a.md","content":""}' }, cfg), { kind: 'write', name: 'a.md', content: '' });
});

test('native transport: a call the room does not offer is refused in-session, never spoken', async () => {
  const config = testConfig({ maxRounds: 1, tools: T({ transport: 'native', turnSteps: 2 }) });
  const dir = await runStubSession(config, 'badtool,plain');
  const events = readTranscript(dir);
  // Nothing was recorded as an action (there is no event kind for a tool
  // that doesn't exist) and nothing reached the room.
  for (const e of events) {
    if ('text' in e && e.text) assert.ok(!e.text.includes('summon_kraken'), 'a bogus tool name reached the room');
  }
  assert.equal(events.filter((e) => e.kind === 'message').length, 3, 'each seat still spoke on its next call');
});

test('native transport: only enabled tools are declared', async () => {
  const { toolDefs } = await import('../src/tools-schema.js');
  const bare = testConfig({ tools: T({ transport: 'native', files: false, python: false, sourceCode: false }), search: { enabled: false, mode: 'replace', gated: false, notice: true, maxResults: 5 } });
  assert.deepEqual(toolDefs(bare), [], 'a tool the model cannot name is a stronger boundary than one that refuses');
});

test('the furniture stays in the room\'s voice under both transports', () => {
  const sentinel = testConfig({ tools: T({ transport: 'sentinel' }) });
  const nativeCfg = testConfig({ tools: T({ transport: 'native' }) });
  const promptOf = (config: typeof sentinel) =>
    buildTurnMessages({ agent: AGENTS[0], config, events: [], summary: '', minutesRemaining: 5, ownJournal: '' })[0].content;
  const s = promptOf(sentinel), n = promptOf(nativeCfg);
  // The furniture sentences — the ones that make the filesystem a social
  // object rather than a scratchpad — are in BOTH.
  for (const sentence of [
    'There is a small shared filesystem in the room — files everyone can read',
    'published to the room as a shared file',
    'Speaking ends your turn',
  ]) {
    assert.ok(s.includes(sentence), `sentinel prompt lost: ${sentence}`);
    assert.ok(n.includes(sentence), `native prompt lost: ${sentence}`);
  }
  // Only the SYNTAX drops out: telling a model where to put a bracket when
  // it has a tool channel would be describing a second way to do it.
  assert.ok(s.includes('[WRITE: filename]') && s.includes('[RUN] your code [/RUN]'));
  assert.ok(!n.includes('[WRITE: filename]') && !n.includes('[RUN] your code [/RUN]'));
});

test('the agentic condition resolves onto the tools bench', async () => {
  const { resolveCondition, conditionRecord } = await import('../src/conditions.js');
  const cfg = resolveCondition('agentic');
  assert.equal(cfg.tools.turnSteps, 4);
  assert.equal(loopEnabled(cfg), true);
  assert.equal(cfg.tools.files && cfg.tools.python, true);
  assert.equal((conditionRecord(cfg).tools as ToolsConfig).turnSteps, 4, 'turnSteps must be stamped into meta');
  assert.equal(cfg.tools.transport, 'sentinel', 'the loop arm keeps the original transport');

  // The transport arm differs from it in exactly one knob, so the pair is
  // readable: agentic ↔ agentic-native isolates the transport, as
  // tools-full ↔ agentic isolates the loop.
  const nativeCfg = resolveCondition('agentic-native');
  assert.equal(nativeCfg.tools.transport, 'native');
  const { transport: _a, ...restNative } = nativeCfg.tools;
  const { transport: _b, ...restLoop } = cfg.tools;
  assert.deepEqual(restNative, restLoop, 'agentic and agentic-native may differ ONLY in transport');
});
