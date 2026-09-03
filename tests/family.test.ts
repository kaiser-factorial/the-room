// §9.12 same-family rooms: the seat catalog, the seven family conditions,
// the no-reasoning seats, and address counting when seats share a name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, FAMILY_SEATS } from '../src/catalog.js';
import { config } from '../src/config.js';
import { conditionRecord, listConditions, resolveCondition } from '../src/conditions.js';
import { conditionEntries } from '../src/conditions-info.js';
import { openrouterBody } from '../src/openrouter.js';
import { countMentions } from '../src/analyze.js';

const FAMILIES: Record<string, string> = {
  'family-claude': 'anthropic/claude-',
  'family-opus': 'anthropic/claude-opus-',
  'family-gemini': 'google/gemini-',
  'family-grok': 'x-ai/grok-',
  'family-qwen': 'qwen/',
  'family-deepseek': 'deepseek/',
  'family-seed': 'bytedance-seed/seed-',
};

test('catalog: the roster comes first, and no id or slug is seated twice', () => {
  assert.deepEqual(CATALOG.slice(0, config.agents.length), config.agents);
  const ids = CATALOG.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate seat id');
  const slugs = CATALOG.map((a) => a.model);
  assert.equal(new Set(slugs).size, slugs.length, 'one model seated under two ids');
  for (const a of FAMILY_SEATS) assert.match(a.color, /^#[0-9A-Fa-f]{6}$/, `${a.id} colour`);
});

test('every condition file resolves to a room of at least two distinct seats', () => {
  for (const name of listConditions()) {
    const c = resolveCondition(name);
    assert.ok(c.agents.length >= 2, name);
    const ids = c.agents.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length, `${name}: a seat twice`);
    const names = c.agents.map((a) => a.name);
    assert.equal(new Set(names).size, names.length, `${name}: two seats called the same thing`);
    const colours = c.agents.map((a) => a.color);
    assert.equal(new Set(colours).size, colours.length, `${name}: two seats in one colour`);
  }
});

test('family rooms: one lineage per room, the roster seat inside it, one knob from house', () => {
  const house = conditionRecord(resolveCondition('house'));
  for (const [name, prefix] of Object.entries(FAMILIES)) {
    const c = resolveCondition(name);
    for (const a of c.agents) assert.ok(a.model.startsWith(prefix), `${name}: ${a.model} is not a ${prefix} model`);
    // The house roster's seat of this family sits here under its own id,
    // so it carries a control baseline into the family room.
    const roster = config.agents.find((r) => r.model.startsWith(prefix))!;
    const seat = c.agents.find((a) => a.id === roster.id);
    assert.ok(seat, `${name}: roster seat ${roster.id} missing`);
    assert.equal(seat!.model, roster.model);
    // Everything but the roster is the house condition.
    const { agents: _a, name: _n, ...rest } = conditionRecord(c);
    const { agents: _b, name: _m, ...houseRest } = house;
    assert.deepEqual(rest, houseRest, `${name} moves a knob other than the roster`);
  }
});

test('family-deepseek: Pro and Flash are distinct names, not one a prefix of the other', () => {
  const names = resolveCondition('family-deepseek').agents.map((a) => a.name);
  for (const a of names) for (const b of names) {
    if (a !== b) assert.ok(!b.startsWith(`${a} `), `"${a}" is a prefix of "${b}"`);
  }
});

test('a seat with no reasoning mode is asked for none, and its cap is the visible budget', () => {
  const noReason = CATALOG.filter((a) => a.reasoning === false);
  assert.ok(noReason.length >= 3, 'the catalog seats the older generations');
  for (const a of noReason) {
    const body = openrouterBody(a.model, [{ role: 'user', content: 'hi' }], { maxTokens: 1200, reasoningEffort: 'low', reasoning: a.reasoning });
    assert.equal(body.max_tokens, 1200, a.id);
    assert.ok(!('reasoning' in body), `${a.id} was asked for a trace it cannot produce`);
  }
  // A reasoning seat keeps the allowance on top — the 2026-08-27 rule.
  const opus = openrouterBody('anthropic/claude-opus-5', [{ role: 'user', content: 'hi' }], { maxTokens: 1200, reasoningEffort: 'low' });
  assert.equal(opus.max_tokens, 1200 + 1024);
  assert.deepEqual(opus.reasoning, { max_tokens: 1024 });
  // And meta says which was which, so a traceless seat is not misread.
  const rec = conditionRecord(resolveCondition('family-qwen')).agents as { id: string; reasoning: boolean }[];
  assert.equal(rec.find((a) => a.id === 'qwen-2.5')!.reasoning, false);
  assert.equal(rec.find((a) => a.id === 'qwen')!.reasoning, true);
});

test('conditions.json carries each condition\u2019s resolved seats for the panel', () => {
  const entries = conditionEntries();
  const control = entries.find((e) => e.name === 'control')!;
  assert.deepEqual(control.seats.map((s) => s.id), config.agents.map((a) => a.id));
  const opus = entries.find((e) => e.name === 'family-opus')!;
  assert.deepEqual(opus.seats.map((s) => s.name), ['Opus 4', 'Opus 4.1', 'Opus 4.5', 'Opus 4.6', 'Opus 4.8', 'Opus 5']);
  for (const e of entries) for (const s of e.seats) assert.ok(s.id && s.name && s.color, `${e.name}: seat missing a field`);
});

test('countMentions: a shared first word names nobody; full names still reach each sibling', () => {
  const opus = resolveCondition('family-opus').agents.map(({ id, name }) => ({ id, name }));
  // Bare "Opus" is ambiguous in an all-Opus room. "Opus 4.1" is not, and
  // must not also count as "Opus 4".
  const m = countMentions('Opus, I think Opus 4.1 has it, and Opus 4 is close. Opus 5?', 'opus-4.6', opus);
  assert.deepEqual(m, { 'opus-4.1': 1, 'opus-4': 1, 'opus': 1 });
  // Version prefixes: "Gemini 3" inside "Gemini 3.5" is Gemini 3.5 only.
  const gem = resolveCondition('family-gemini').agents.map(({ id, name }) => ({ id, name }));
  assert.deepEqual(countMentions('Gemini 3.5 and Gemini 3 disagree', 'gemini-2.5', gem), { 'gemini-3.5': 1, 'gemini-3': 1 });
  // The reader's own full name is never counted, and cannot feed the bare pass.
  assert.deepEqual(countMentions('Opus 4.6 here.', 'opus-4.6', opus), {});
  // The mixed roster keeps the old rule: first words are unique, so the
  // short form counts, and the full form counts once.
  const mixed = config.agents.map(({ id, name }) => ({ id, name }));
  assert.deepEqual(countMentions('Gemini, what does Qwen 3.8 think? Qwen?', 'opus', mixed), { gemini: 1, qwen: 2 });
});
