// §9.4: the self-governing room. The whitelist is the safety boundary —
// these tests pin what the room can and, more importantly, CANNOT change —
// and the all-off room must genuinely bootstrap its own furniture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseReply } from '../src/parse.js';
import { buildTurnMessages } from '../src/context.js';
import { applyConfigChange, CONFIG_WHITELIST } from '../src/governance.js';
import { readSource, sourceIndex } from '../src/source.js';
import { testConfig, runStubSession, AGENTS } from './helpers.js';
import type { JournalConfig, RoomConfig, RoomEvent, ToolsConfig } from '../src/types.js';

const J: JournalConfig = { enabled: false, notice: true, mode: 'replace', recall: true, maxTokens: 0 };
const T = (over: Partial<ToolsConfig> = {}): ToolsConfig => ({
  files: false, python: false, maxFileChars: 16_000, fileViewChars: 2_000, maxFiles: 20, directories: false, fileDelete: false, fileViewTotalChars: 0, callFeedback: false, budget: 'per-seat', turnSteps: 1, transport: 'sentinel', notice: true, pythonTimeoutSeconds: 10,
  pythonPackages: [], pythonInstall: false, runPublic: false, sourceCode: true, sourceScope: 'all', configurable: true, ...over,
});

function readTranscript(dir: string): RoomEvent[] {
  return readFileSync(join(dir, 'transcript.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as RoomEvent);
}

test('[CONFIG] parses when governance is on, stays speech otherwise', () => {
  const p = parseReply('[CONFIG: journal.enabled = true]\nlet us have diaries', J, undefined, T());
  assert.deepEqual(p, { kind: 'config', key: 'journal.enabled', value: 'true', spoken: 'let us have diaries' });
  assert.equal(parseReply('[CONFG: search.enabled = true]', J, undefined, T()).kind, 'config');
  assert.equal(parseReply('[CONFIG: journal.enabled = true]', J, undefined, T({ configurable: false })).kind, 'message');
});

test('whitelist: furniture is changeable, everything dangerous is not', () => {
  const cfg = testConfig({ tools: T() });
  assert.equal(applyConfigChange(cfg, 'journal.enabled', 'true'), null);
  assert.equal(cfg.journal.enabled, true);
  assert.equal(applyConfigChange(cfg, 'tools.budget', 'per-room'), null);
  assert.equal(cfg.tools.budget, 'per-room');
  assert.ok(applyConfigChange(cfg, 'journal.mode', 'sideways'), 'bad enum must be rejected');
  for (const key of [
    'durationMinutes', 'maxRounds', 'maxOutputTokens', 'tools.configurable', 'tools.sourceScope',
    'tools.pythonTimeoutSeconds', 'thinkingBroadcast', 'countdown', 'rosterDisclosure', 'reasoningEffort',
    'agents', 'sampling.temperature', 'search.maxResults',
  ]) {
    assert.ok(applyConfigChange(cfg, key, 'true'), `${key} must NOT be alterable`);
  }
  assert.ok(!('agents' in CONFIG_WHITELIST));
});

test('source scope: the experiment is readable at all, hidden at tools', () => {
  assert.equal(readSource('session', 'tools'), null);
  assert.ok(readSource('session', 'all')!.includes('runSession'));
  assert.ok(readSource('governance', 'all')!.includes('CONFIG_WHITELIST'));
  assert.match(sourceIndex('all'), /condition: the exact configuration/);
  assert.doesNotMatch(sourceIndex('tools'), /condition/);
});

test('the all-off room bootstraps its own furniture: config applies live, room-visibly', async () => {
  const config = testConfig({
    maxRounds: 2,
    journal: { ...J },
    tools: T(),
  });
  // Call 1: someone turns the journal on. Call 2 (journal now live): someone
  // journals. Calls 4-6 (round 2): a denied change, then plain speech.
  const dir = await runStubSession(config, 'config,journal,plain,badconfig,plain,plain');
  const events = readTranscript(dir);

  const changes = events.filter((e) => e.kind === 'config');
  const applied = changes.filter((e) => e.kind === 'config' && !e.denied);
  const denied = changes.filter((e) => e.kind === 'config' && e.denied);
  assert.equal(applied.length, 1);
  assert.ok(applied[0].kind === 'config' && applied[0].key === 'journal.enabled' && applied[0].value === 'true');
  assert.equal(denied.length, 1, 'the durationMinutes grab must be refused');
  assert.equal(config.journal.enabled, true, 'the change must mutate the live config');
  assert.equal(config.durationMinutes, testConfig().durationMinutes, 'refused changes must not mutate');

  // The journal written AFTER the change proves the setting went live.
  assert.ok(readdirSync(join(dir, 'journals')).length >= 1, 'no journal entry after journal.enabled=true');

  // Governance is public: the applied change renders into every context;
  // the refusal renders into none.
  for (const agent of AGENTS) {
    const prompt = buildTurnMessages({ agent, config, events, summary: '', minutesRemaining: 3, ownJournal: '' })
      .map((m) => m.content).join('\n');
    assert.match(prompt, /changed the room's settings: journal\.enabled = true/, `${agent.id} missing the config event`);
    assert.ok(!prompt.includes('durationMinutes'), `${agent.id} sees the refused attempt`);
    assert.match(prompt, /settings are yours, collectively, to change/, `${agent.id} missing the governance section`);
    assert.match(prompt, /journal\.enabled = true\n/, `${agent.id}'s settings listing not live`);
  }
});

test('condition presets: self-governing starts bare; transparent reads all but changes nothing', async () => {
  const { resolveCondition } = await import('../src/conditions.js');
  const sg = resolveCondition('self-governing');
  assert.ok(sg.tools.configurable && sg.tools.sourceCode && sg.tools.sourceScope === 'all');
  assert.ok(!sg.journal.enabled && !sg.search.enabled && !sg.tools.files && !sg.tools.python, 'self-governing must start with everything off');
  const tr = resolveCondition('transparent');
  assert.equal(tr.tools.sourceScope, 'all');
  assert.ok(!tr.tools.configurable, 'transparent reads the room but cannot change it');
  assert.ok(tr.tools.files && tr.tools.python && tr.search.enabled);
});
