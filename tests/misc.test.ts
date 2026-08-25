// Conditions resolution, embeddings math + cache, shuffle property.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCondition } from '../src/conditions.js';
import { cosine, centroid, embedAll } from '../src/embeddings.js';
import { shuffledOrder } from '../src/session.js';
import { AGENTS } from './helpers.js';

// ── conditions ─────────────────────────────────────────────────────────────

test('conditions: house = control + baseline journal, deep-merged', () => {
  const c = resolveCondition('house');
  assert.equal(c.journal.enabled, true);
  assert.equal(c.journal.mode, 'replace');
  assert.equal(c.journal.pass.enabled, false); // untouched key survives the merge
  assert.equal(c.countdown, 'hidden');
  assert.equal(c.reasoningEffort, 'low');
});

test('conditions: trace-rich raises effort AND cap together (the D3 interaction)', () => {
  const c = resolveCondition('trace-rich');
  assert.equal(c.reasoningEffort, 'medium');
  assert.ok(c.maxOutputTokens > 1200, 'raising effort without the cap re-creates starvation');
});

test('conditions: unknown persona id fails loudly', () => {
  assert.throws(() => resolveCondition('control', { agents: [{ id: 'opus', personaId: 'nonexistent-persona' }] }));
});

test('conditions: seat selection keeps catalog order-independence and rejects <2 seats', () => {
  const c = resolveCondition('control', { agents: ['seed', 'opus'] });
  assert.deepEqual(c.agents.map((a) => a.id), ['seed', 'opus']);
  assert.throws(() => resolveCondition('control', { agents: ['opus'] }));
});

// ── reasoning param translation ────────────────────────────────────────────

test('reasoningParam: non-Anthropic seats get effort verbatim', async () => {
  const { reasoningParam } = await import('../src/openrouter.js');
  assert.deepEqual(reasoningParam('x-ai/grok-4.6', 'low', 1200), { effort: 'low' });
});

test('reasoningParam: Anthropic gets a budget only when the cap affords it', async () => {
  const { reasoningParam } = await import('../src/openrouter.js');
  // house cap 1200: 1200-800 < 1024 minimum → thinking off, no starvation
  assert.equal(reasoningParam('anthropic/claude-sonnet-5', 'low', 1200), undefined);
  // trace-rich cap 2400: budget clamped to cap-floor
  assert.deepEqual(reasoningParam('anthropic/claude-sonnet-5', 'medium', 2400), { max_tokens: 1600 });
  assert.deepEqual(reasoningParam('anthropic/claude-opus-5', 'high', 8000), { max_tokens: 4096 });
});

// ── embeddings ─────────────────────────────────────────────────────────────

test('cosine/centroid basics', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  assert.equal(centroid([]), null);
  assert.deepEqual(centroid([[0, 2], [2, 0]]), [1, 1]);
});

test('stub embeddings: deterministic, and closer for closer texts', async () => {
  process.env.ROOM_STUB = '1';
  const cache = join(tmpdir(), `room-emb-${Date.now()}.json`);
  const [a1, a2, b, c] = await embedAll(
    ['the quiet room holds six voices', 'the quiet room holds six voices', 'the quiet room holds five voices', 'completely unrelated xylophone inventory'],
    cache,
  );
  assert.deepEqual(a1, a2);
  assert.ok(cosine(a1, b) > cosine(a1, c), 'near-duplicate should beat unrelated text');
  assert.ok(existsSync(cache));
  // second call is served fully from cache (no recompute changes)
  const [again] = await embedAll(['the quiet room holds six voices'], cache);
  assert.deepEqual(again, a1);
  rmSync(cache);
});

// ── shuffle ────────────────────────────────────────────────────────────────

test('shuffledOrder property: never a double turn across the boundary', () => {
  for (let i = 0; i < 500; i++) {
    const last = AGENTS[i % AGENTS.length].id;
    const order = shuffledOrder(AGENTS, last);
    assert.notEqual(order[0].id, last);
    assert.deepEqual([...order.map((a) => a.id)].sort(), AGENTS.map((a) => a.id).sort());
  }
});

test('boundary: two-agent room can always satisfy the constraint', () => {
  const two = AGENTS.slice(0, 2);
  for (let i = 0; i < 100; i++) {
    const order = shuffledOrder(two, two[1].id);
    assert.equal(order[0].id, two[0].id);
  }
});
