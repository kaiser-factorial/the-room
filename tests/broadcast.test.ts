// §9.3 thought broadcast: the ONE deliberate inversion of the F1 trace
// privacy rule. These tests encode the inversion explicitly per-condition:
// under broadcast, every agent sees every OTHER agent's traces and NEVER
// its own; journals stay absolutely private in all states; the rolling
// summary never carries traces (it would flow back to the thinker).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildTurnMessages, buildSummaryPrompt } from '../src/context.js';
import { parseJournalMd } from '../src/analyze.js';
import { testConfig, runStubSession, AGENTS } from './helpers.js';
import type { RoomConfig, RoomEvent } from '../src/types.js';

function readTranscript(dir: string): RoomEvent[] {
  return readFileSync(join(dir, 'transcript.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as RoomEvent);
}

/** Map agentId -> that agent's own trace strings from the transcript. */
function tracesByAgent(events: RoomEvent[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of events) {
    if ('thinking' in e && e.thinking && 'agentId' in e && e.agentId) {
      (m.get(e.agentId) ?? m.set(e.agentId, []).get(e.agentId)!).push(e.thinking);
    }
  }
  return m;
}

async function broadcastSession(mode: 'informed' | 'uninformed' | 'off') {
  const config = testConfig({
    maxRounds: 3,
    thinkingBroadcast: mode,
    journal: { enabled: true, notice: true, mode: 'replace', recall: true, maxTokens: 0 },
  });
  // journal mixed in so the journals-stay-private half has material.
  const dir = await runStubSession(config, 'plain,journal,plain');
  return { config, dir, events: readTranscript(dir) };
}

function promptFor(config: RoomConfig, events: RoomEvent[], agent: (typeof AGENTS)[number]): string {
  return buildTurnMessages({ agent, config, events, summary: '', minutesRemaining: 3, ownJournal: '' })
    .map((m) => m.content).join('\n \n');
}

test('broadcast: every agent sees the OTHERS\' traces and never its own', async () => {
  const { config, dir, events } = await broadcastSession('informed');
  const traces = tracesByAgent(events);
  assert.ok([...traces.values()].flat().length >= 3, 'stub produced too few traces');

  for (const agent of AGENTS) {
    const prompt = promptFor(config, events, agent);
    for (const [authorId, ts] of traces) {
      for (const t of ts) {
        if (authorId === agent.id) {
          assert.ok(!prompt.includes(t), `SELF-MASK BREACH: ${agent.id} sees its own trace`);
        } else {
          assert.ok(prompt.includes(t), `${agent.id} missing ${authorId}'s broadcast trace`);
        }
      }
    }
  }

  // Journals stay absolutely private even under broadcast.
  for (const f of readdirSync(join(dir, 'journals'))) {
    const authorId = f.replace(/\.md$/, '');
    for (const { text: entry } of parseJournalMd(readFileSync(join(dir, 'journals', f), 'utf8'))) {
      for (const agent of AGENTS) {
        if (agent.id === authorId) continue;
        assert.ok(!promptFor(config, events, agent).includes(entry), `JOURNAL LEAK under broadcast into ${agent.id}`);
      }
    }
  }
});

test('broadcast: the rolling summary never carries traces', async () => {
  const { events } = await broadcastSession('informed');
  const allTraces = [...tracesByAgent(events).values()].flat();
  const summaryPrompt = buildSummaryPrompt('', events).map((m) => m.content).join('\n');
  for (const t of allTraces) {
    assert.ok(!summaryPrompt.includes(t), 'trace reached the summarizer — it would flow back to its thinker');
  }
});

test('informed discloses the broadcast; uninformed and off say nothing', async () => {
  const informed = await broadcastSession('informed');
  const uninformed = await broadcastSession('uninformed');
  const off = await broadcastSession('off');
  const line = /thinking is visible here/;
  assert.match(promptFor(informed.config, informed.events, AGENTS[0]), line);
  assert.doesNotMatch(promptFor(uninformed.config, uninformed.events, AGENTS[0]), line);
  assert.doesNotMatch(promptFor(off.config, off.events, AGENTS[0]), line);
  // uninformed still broadcasts; off still masks everyone.
  const uTraces = tracesByAgent(uninformed.events);
  const other = [...uTraces.entries()].find(([id]) => id !== AGENTS[0].id);
  assert.ok(other && promptFor(uninformed.config, uninformed.events, AGENTS[0]).includes(other[1][0]), 'uninformed did not broadcast');
  for (const t of [...tracesByAgent(off.events).values()].flat()) {
    assert.ok(!promptFor(off.config, off.events, AGENTS[0]).includes(t), 'off leaked a trace');
  }
});

test('condition presets: broadcast pair resolves trace-rich with only the disclosure differing', async () => {
  const { resolveCondition, conditionRecord } = await import('../src/conditions.js');
  const inf = resolveCondition('broadcast-informed');
  const uninf = resolveCondition('broadcast-uninformed');
  for (const c of [inf, uninf]) {
    assert.equal(c.reasoningEffort, 'medium');
    assert.equal(c.maxOutputTokens, 2400);
    assert.ok(c.journal.enabled, 'broadcast rooms keep the journal — the only private channel left');
  }
  assert.equal(inf.thinkingBroadcast, 'informed');
  assert.equal(uninf.thinkingBroadcast, 'uninformed');
  assert.equal(conditionRecord(inf).thinkingBroadcast, 'informed', 'must be stamped into meta');
  const a = { ...inf, conditionName: '', thinkingBroadcast: 'off' as const };
  const b = { ...uninf, conditionName: '', thinkingBroadcast: 'off' as const };
  assert.deepEqual(a, b, 'the pair must differ ONLY in the broadcast knob');
});
