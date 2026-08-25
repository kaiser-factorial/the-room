// Ground-truth detection: the voice stub PLANTS dynamics (per-agent
// vocabulary, a mid-session coinage that others adopt, late drift toward
// shared room vocabulary) — analyze.ts must find them. This is the test
// that the metrics measure what they claim to measure, not just run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSession } from '../src/analyze.js';
import { testConfig, runStubSession } from './helpers.js';

// 'test/coiner-4' hashes to voice 0 — the voice that coins the phrase at
// its 4th turn; every voice echoes it from turn 6 (openrouter.ts stub).
const COINER = { id: 'coiner', name: 'Coiner', model: 'test/coiner-4', adapter: 'openrouter' as const, color: '#000' };

test('analyze detects the planted room dynamics in a voice-stub session', async () => {
  const config = testConfig({
    maxRounds: 11, // coin lands at round 6 (past the 5-round seed window), adoption from round 8
    agents: [
      COINER,
      { id: 'beta', name: 'Beta', model: 'test/beta-voice', adapter: 'openrouter', color: '#222' },
      { id: 'gamma', name: 'Gamma', model: 'test/gamma-voice', adapter: 'openrouter', color: '#333' },
    ],
  });
  const dir = await runStubSession(config); // no script → voice generator
  const { report } = await analyzeSession(dir);

  // Mimicry: the planted coinage, with the right coiner and both adopters.
  // Exact phrase — neighboring n-grams from the ADOPTION sentences ("…
  // problem again") are legitimately coined by an adopter and tie on
  // spread, so a fuzzy match can land on one of those instead.
  const hit = report.mimicry.sharedNgrams.find((g) => g.ngram === 'the unfinished sentence problem');
  assert.ok(hit, 'planted coinage not detected');
  assert.equal(hit.coinedBy, 'coiner');
  assert.deepEqual([...hit.adopters].sort(), ['beta', 'gamma']);

  // Drift direction: late turns mix in shared vocabulary, so inter-agent
  // similarity must RISE from the early to the late window.
  const c = report.convergence;
  assert.ok(c.interEarly !== null && c.interLate !== null, 'windows failed to populate');
  assert.ok(c.interLate! > c.interEarly!, `planted convergence not detected: early ${c.interEarly} late ${c.interLate}`);

  // Three-channel populates when traces exist (odd stub turns).
  const tc = report.threeChannel.find((t) => t.agentId === 'coiner');
  assert.ok(tc && tc.traceTurns > 0 && tc.chatVsThinkingMatched !== null);

  // §2.6 logprobs ride into style metrics — present on even-hash stub
  // seats (coiner), absent on odd (gamma), mirroring provider variance.
  assert.ok(report.styleByAgent.coiner.meanTokenLogprob !== null && report.styleByAgent.coiner.meanTokenLogprob! < 0);
  assert.equal(report.styleByAgent.gamma.meanTokenLogprob, null);
});
