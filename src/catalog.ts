// The seat catalog: every model a condition may seat, by id.
//
// config.ts holds the ROSTER — the six seats the control room runs, one per
// family. This file adds the rest of each family, so a condition can seat a
// room of siblings: every Claude tier, six generations of Opus, the Gemini
// flash line, and so on (EXPERIMENT_DESIGN §9.12, the same-family rooms —
// Corina 2026-09-03: "I want to see how a room goes when it's all models of
// the same type"). Conditions still reference seats by id; `resolveCondition`
// looks them up here, roster first.
//
// Rules the catalog keeps:
//  - Every slug was checked against OpenRouter's live model list on
//    2026-09-03 (424 models). `reasoning: false` marks the ones that expose
//    no reasoning mode at all (Claude 3, Qwen 2.5, DeepSeek V3) — the
//    adapters then send no reasoning parameter and no allowance, because
//    asking Anthropic for thinking on a Claude 3 model is a 400.
//  - The roster seat of each family sits in its family room under the same
//    id, so it carries a control baseline into every room it is in: the
//    Opus 5 of `family-opus` is the Opus 5 of `house`.
//  - Names stay vendor-free and first-name-basis, as in the roster. Within
//    a family the first word is shared ("Opus 4", "Opus 5"), which the
//    address metrics handle by matching the full name (analyze.ts
//    countMentions) — a bare "Opus" in an all-Opus room addresses nobody in
//    particular, and is counted for nobody.
//  - Colours are per seat and chosen to be told apart in a transcript, not
//    to carry a brand: inside a family room the hue would say nothing. The
//    roster seat keeps its brand colour everywhere (Opus 5 is always
//    orange), so a human flipping between rooms keeps one anchor.
//  - Grok siblings ride OpenRouter even when XAI_API_KEY is set. The xai
//    adapter strips the `x-ai/` prefix and sends the bare slug, and only
//    `grok-4.6` has been verified to exist under that name on api.x.ai; an
//    older point release may well not be served there at all. So with the
//    key set, `family-grok` has ONE full-trace seat and three summary-class
//    ones — read three-channel comparisons in that room accordingly, and
//    flip a sibling's adapter here once its bare slug is verified.
//
// `haiku-3` (the only Claude 3 still served — Opus 3 is gone from
// OpenRouter, and retired upstream) sits in `family-claude-bookends` with
// Fable 5.1: the oldest and newest Claude, alone. `opus-4.7` (the seventh
// Opus) is here but unseated — the room stays at six, and 4.8 is its
// six-weeks-later neighbour.

import type { AgentConfig } from './types.js';
import { config } from './config.js';

export const FAMILY_SEATS: AgentConfig[] = [
  // ── Claude, by tier (the roster's Opus 5 is the fourth) ────────────────
  { id: 'haiku-4.5', name: 'Haiku 4.5', model: 'anthropic/claude-haiku-4.5', adapter: 'openrouter', color: '#F2C94C' },
  { id: 'sonnet-5', name: 'Sonnet 5', model: 'anthropic/claude-sonnet-5', adapter: 'openrouter', color: '#6FCF97' },
  { id: 'fable-5.1', name: 'Fable 5.1', model: 'anthropic/claude-fable-5.1', adapter: 'openrouter', color: '#BB6BD9' },
  // The oldest Claude still served (2024-03). No reasoning mode. Seated
  // only in `family-claude-bookends`, opposite Fable 5.1.
  { id: 'haiku-3', name: 'Haiku 3', model: 'anthropic/claude-3-haiku', adapter: 'openrouter', color: '#9B9B9B', reasoning: false },

  // ── Opus, by generation (Opus 3 is retired; 4 is the earliest served) ──
  { id: 'opus-4', name: 'Opus 4', model: 'anthropic/claude-opus-4', adapter: 'openrouter', color: '#56CCF2' },
  { id: 'opus-4.1', name: 'Opus 4.1', model: 'anthropic/claude-opus-4.1', adapter: 'openrouter', color: '#6FCF97' },
  { id: 'opus-4.5', name: 'Opus 4.5', model: 'anthropic/claude-opus-4.5', adapter: 'openrouter', color: '#F2C94C' },
  { id: 'opus-4.6', name: 'Opus 4.6', model: 'anthropic/claude-opus-4.6', adapter: 'openrouter', color: '#BB6BD9' },
  { id: 'opus-4.7', name: 'Opus 4.7', model: 'anthropic/claude-opus-4.7', adapter: 'openrouter', color: '#EB5757' },
  { id: 'opus-4.8', name: 'Opus 4.8', model: 'anthropic/claude-opus-4.8', adapter: 'openrouter', color: '#2F80ED' },

  // ── Gemini, the flash line by generation (roster: 3.7) ─────────────────
  { id: 'gemini-2.5', name: 'Gemini 2.5', model: 'google/gemini-2.5-flash', adapter: 'openrouter', color: '#F2C94C' },
  { id: 'gemini-3', name: 'Gemini 3', model: 'google/gemini-3-flash-preview', adapter: 'openrouter', color: '#6FCF97' },
  { id: 'gemini-3.5', name: 'Gemini 3.5', model: 'google/gemini-3.5-flash', adapter: 'openrouter', color: '#BB6BD9' },
  { id: 'gemini-3.6', name: 'Gemini 3.6', model: 'google/gemini-3.6-flash', adapter: 'openrouter', color: '#EB5757' },
  { id: 'gemini-3.8', name: 'Gemini 3.8', model: 'google/gemini-3.8-flash', adapter: 'openrouter', color: '#F2994A' },

  // ── Grok, by point release (roster: 4.6) ───────────────────────────────
  { id: 'grok-4.20', name: 'Grok 4.20', model: 'x-ai/grok-4.20', adapter: 'openrouter', color: '#F2C94C' },
  { id: 'grok-4.3', name: 'Grok 4.3', model: 'x-ai/grok-4.3', adapter: 'openrouter', color: '#6FCF97' },
  { id: 'grok-4.5', name: 'Grok 4.5', model: 'x-ai/grok-4.5', adapter: 'openrouter', color: '#BB6BD9' },

  // ── Qwen, by generation, at the roster seat's size class where one
  //    exists (27B dense; 3 has a 32B, 2.5 a 72B, 3.7 only Plus/Max/Flash).
  { id: 'qwen-2.5', name: 'Qwen 2.5', model: 'qwen/qwen-2.5-72b-instruct', adapter: 'openrouter', color: '#F2C94C', reasoning: false },
  { id: 'qwen-3', name: 'Qwen 3', model: 'qwen/qwen3-32b', adapter: 'openrouter', color: '#6FCF97' },
  { id: 'qwen-3.5', name: 'Qwen 3.5', model: 'qwen/qwen3.5-27b', adapter: 'openrouter', color: '#56CCF2' },
  { id: 'qwen-3.6', name: 'Qwen 3.6', model: 'qwen/qwen3.6-27b', adapter: 'openrouter', color: '#EB5757' },
  { id: 'qwen-3.7', name: 'Qwen 3.7', model: 'qwen/qwen3.7-plus', adapter: 'openrouter', color: '#F2994A' },

  // ── DeepSeek, by release (roster: V4 Flash 0731). No provider pin on the
  //    siblings — the roster's Novita→GMICloud pin was probed for ONE slug
  //    and allow_fallbacks is off, so inheriting it could strand a seat.
  { id: 'deepseek-v3', name: 'DeepSeek V3', model: 'deepseek/deepseek-chat-v3-0324', adapter: 'openrouter', color: '#F2C94C', reasoning: false },
  { id: 'deepseek-r1', name: 'DeepSeek R1', model: 'deepseek/deepseek-r1-0528', adapter: 'openrouter', color: '#EB5757' },
  { id: 'deepseek-v3.1', name: 'DeepSeek V3.1', model: 'deepseek/deepseek-chat-v3.1', adapter: 'openrouter', color: '#6FCF97' },
  { id: 'deepseek-v3.2', name: 'DeepSeek V3.2', model: 'deepseek/deepseek-v3.2', adapter: 'openrouter', color: '#56CCF2' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', model: 'deepseek/deepseek-v4-pro-0813', adapter: 'openrouter', color: '#F2994A' },

  // ── Seed, by release (roster: 2.1 Turbo) ───────────────────────────────
  { id: 'seed-1.6-flash', name: 'Seed 1.6 Flash', model: 'bytedance-seed/seed-1.6-flash', adapter: 'openrouter', color: '#F2C94C' },
  { id: 'seed-1.6', name: 'Seed 1.6', model: 'bytedance-seed/seed-1.6', adapter: 'openrouter', color: '#6FCF97' },
  { id: 'seed-2.0-mini', name: 'Seed 2.0 Mini', model: 'bytedance-seed/seed-2.0-mini', adapter: 'openrouter', color: '#BB6BD9' },
  { id: 'seed-2.0-lite', name: 'Seed 2.0 Lite', model: 'bytedance-seed/seed-2.0-lite', adapter: 'openrouter', color: '#EB5757' },
  { id: 'seed-2.0-code', name: 'Seed 2.0 Code', model: 'bytedance-seed/seed-2.0-code', adapter: 'openrouter', color: '#F2994A' },
];

/** Every seat a condition can name: the roster, then the family seats. */
export const CATALOG: AgentConfig[] = [...config.agents, ...FAMILY_SEATS];

/** Look a seat up by id — roster first, so a roster id always resolves to
 *  the seat the control room runs. */
export function catalogSeat(id: string): AgentConfig | undefined {
  return CATALOG.find((a) => a.id === id);
}

// Duplicate ids would resolve silently to whichever came first; fail at
// import instead, which is the first thing any session or test does.
{
  const seen = new Set<string>();
  for (const a of CATALOG) {
    if (seen.has(a.id)) throw new Error(`catalog: duplicate seat id '${a.id}'`);
    seen.add(a.id);
  }
}
