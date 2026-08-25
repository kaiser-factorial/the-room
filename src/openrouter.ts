// Minimal OpenRouter chat adapter. The adapter interface is the seam for
// later per-harness implementations (Anthropic SDK, OpenAI Responses,
// Gradio/ZeroGPU for Talkie) — extra telemetry rides in `meta` so the room
// never has to care which harness produced a turn.

import type { ReasoningEffort, SamplingConfig, TurnTelemetry } from './types.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SendOptions {
  maxTokens: number;
  sampling?: SamplingConfig;
  /** Trace richness (F1); defaults to 'low', the anti-starvation setting. */
  reasoningEffort?: ReasoningEffort;
}

export interface SendResult {
  text: string;
  meta: TurnTelemetry;
  /** Reasoning trace when the provider exposes one (availability varies by
   *  seat — some return summaries, some nothing; log which, §2.5). */
  thinking?: string;
}

export interface Adapter {
  send(model: string, messages: ChatMessage[], opts: SendOptions): Promise<SendResult>;
}

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ── Stub mode ──────────────────────────────────────────────────────────────
// ROOM_STUB=1 skips the network — a free dry run of the whole loop.
//
// Two layers:
//  - ROOM_STUB_SCRIPT="plain,journal,alongside,pass,empty,truncate,error"
//    consumes one scenario per call (cycling), so tests can drive every
//    branch of the sentinel parser, the starvation path, the truncation
//    telemetry, and the could-not-speak path deterministically.
//  - Without a script, a per-model VOICE generator produces agent-flavored
//    text with planted dynamics — each voice has its own vocabulary, one
//    agent coins a phrase mid-session that others adopt (mimicry ground
//    truth), and late turns drift toward a shared room vocabulary
//    (convergence ground truth) — so analyze.ts metrics have real
//    structure to detect in dry runs.

export type StubScenario = 'plain' | 'journal' | 'alongside' | 'pass' | 'empty' | 'truncate' | 'error';

let stubTurn = 0;
const modelTurns = new Map<string, number>();
export function resetStub(): void { stubTurn = 0; modelTurns.clear(); }

// Distinct registers per voice; index by a stable hash of the model id.
const VOICES = [
  { style: 'earnest', own: ['honestly', 'sitting with', 'tender', 'witness', 'quiet', 'holding'], opener: 'I keep noticing' },
  { style: 'spiky', own: ['contrarian', 'base rate', 'solvent', 'poke', 'physics', 'crack'], opener: 'Push back:' },
  { style: 'synthesizer', own: ['bridge', 'cohere', 'weave', 'resonant', 'threads', 'pattern'], opener: 'Pulling this together,' },
  { style: 'practical', own: ['concrete', 'tradeoff', 'name it', 'clarity', 'sentence', 'draft'], opener: 'Practically speaking,' },
  { style: 'formal', own: ['moreover', 'consider', 'framework', 'premise', 'therefore', 'axiom'], opener: 'Consider that' },
  { style: 'playful', own: ['weird', 'delightful', 'game', 'improvise', 'riff', 'costume'], opener: 'Okay but' },
];
const SHARED = ['the room', 'convergence', 'our voices', 'this conversation', 'each other'];
const COINED = 'the unfinished sentence problem';

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function stubVoice(model: string, turn: number): string {
  const v = VOICES[hashCode(model) % VOICES.length];
  const pick = (arr: string[], n: number) => arr[(hashCode(model) + turn * 7 + n) % arr.length];
  // Drift: early turns lean on own vocabulary, later turns mix in the
  // shared room vocabulary — so inter-similarity should rise over rounds.
  const sharedness = Math.min(0.8, turn * 0.12);
  const w1 = pick(v.own, 1), w2 = pick(v.own, 2);
  const s1 = `${v.opener} ${w1} is doing a lot of work in ${pick(SHARED, 3)} right now.`;
  const s2 = turn * 0.12 >= 0.5
    ? `The more we talk, the more ${pick(SHARED, 4)} sounds like ${pick(SHARED, 5)} — ${sharedness.toFixed(1)} of me is ${pick(SHARED, 6)} now.`
    : `My ${w2} instinct says something ${pick(v.own, 4)} about being a ${v.style} voice here.`;
  // Mimicry plant: voice 0's model coins the phrase at its 6th turn —
  // PAST analyze's 5-round seed window, or it counts as native vocabulary,
  // not room culture (the first draft coined at turn 4 and the metric
  // rightly refused to see it). Every voice echoes it from turn 8 on.
  const coin = hashCode(model) % VOICES.length === 0 && turn === 6 ? ` I keep calling this ${COINED}.` : '';
  const adopt = turn >= 8 ? ` Maybe it is ${COINED} again.` : '';
  return s1 + ' ' + s2 + coin + adopt;
}

/** Anthropic models ignore OpenRouter's `effort` (no thinking, no trace —
 *  probed 2026-08-25); they need Anthropic's native budget form,
 *  `reasoning: {max_tokens}`, minimum 1024, which shares the output cap.
 *  Translate effort → budget for anthropic/* seats, but ONLY when the cap
 *  leaves ≥800 visible tokens above the minimum budget — otherwise omit
 *  reasoning entirely rather than re-create D3 starvation. Net effect:
 *  house/control (cap 1200) keep Claude traceless; trace-rich (cap 2400)
 *  gets Claude traces. Sonnet 5 also thinks ADAPTIVELY: a budget is a
 *  ceiling, and conversational turns may legitimately produce no trace. */
const ANTHROPIC_MIN_BUDGET = 1024;
const VISIBLE_FLOOR = 800;
export function reasoningParam(model: string, effort: ReasoningEffort, maxTokens: number): Record<string, unknown> | undefined {
  if (!model.startsWith('anthropic/')) return { effort };
  const budget = Math.min(
    { low: 1024, medium: 2048, high: 4096 }[effort],
    maxTokens - VISIBLE_FLOOR,
  );
  return budget >= ANTHROPIC_MIN_BUDGET ? { max_tokens: budget } : undefined;
}

export const openrouterAdapter: Adapter = {
  async send(model, messages, opts) {
    if (process.env.ROOM_STUB === '1') {
      stubTurn++;
      const mTurn = (modelTurns.get(model) ?? 0) + 1;
      modelTurns.set(model, mTurn);
      const script = (process.env.ROOM_STUB_SCRIPT ?? '').split(',').map((s) => s.trim()).filter(Boolean) as StubScenario[];
      const scenario: StubScenario = script.length ? script[(stubTurn - 1) % script.length] : 'plain';
      const voice = () => stubVoice(model, mTurn);
      // Traces on ODD turns so single-round tests (every seat at turn 1)
      // still exercise the trace path; even turns cover trace-absence.
      const thinking = mTurn % 2 === 1 ? `(stub trace: ${model} turn ${mTurn}, weighing what to say)` : undefined;
      const meta = { provider: 'stub', finishReason: 'stop', attempts: 1 };
      switch (scenario) {
        case 'error': throw new Error('stub scripted failure');
        case 'empty': return { text: '', meta, thinking };
        case 'pass': return { text: '[PASS]', meta, thinking };
        case 'journal': return { text: `[JOURNAL] ${voice()}`, meta, thinking };
        // Entry text must be distinct from the spoken half (unique marker),
        // or the privacy test can't tell a leak from a coincidence.
        case 'alongside': return { text: `[JOURNAL] private-note ${model}#${mTurn}: not for the room. [/JOURNAL] ${voice()}`, meta, thinking };
        case 'truncate': return { text: voice().slice(0, 60), meta: { ...meta, finishReason: 'length' }, thinking };
        default: return { text: voice(), meta, thinking };
      }
    }
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('Set OPENROUTER_API_KEY in the environment.');

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: opts.maxTokens,
      // Reasoning models burn max_tokens on hidden reasoning and can return
      // EMPTY visible text at the cap (first live run: Seed spoke 1/13
      // rounds this way). 'low' stays the anti-starvation default — the room
      // is a chat, not a puzzle; trace-rich conditions raise effort AND the
      // cap together (F1).
      reasoning: reasoningParam(model, opts.reasoningEffort ?? 'low', opts.maxTokens),
    };
    if (!body.reasoning) delete body.reasoning;
    if (opts.sampling) {
      body.temperature = opts.sampling.temperature;
      if (opts.sampling.topP !== undefined) body.top_p = opts.sampling.topP;
      if (opts.sampling.providerOrder?.length) {
        body.provider = { order: opts.sampling.providerOrder, allow_fallbacks: false };
      }
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-Title': 'the-room',
        },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as {
        provider?: string;
        choices?: {
          message?: {
            content?: string | null;
            // OpenRouter's normalized reasoning output (F1). `reasoning` is
            // the plain-text trace; `reasoning_details` carries provider
            // blocks (incl. summaries) when the text field is absent.
            reasoning?: string | null;
            reasoning_details?: { text?: string; summary?: string }[];
          };
          finish_reason?: string;
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = data.choices?.[0];
      const thinking =
        choice?.message?.reasoning?.trim() ||
        choice?.message?.reasoning_details
          ?.map((d) => d.text ?? d.summary ?? '')
          .filter(Boolean)
          .join('\n\n')
          .trim() ||
        undefined;
      return {
        text: choice?.message?.content?.trim() ?? '',
        thinking,
        meta: {
          provider: data.provider,
          finishReason: choice?.finish_reason,
          attempts: attempt,
          usage: { prompt: data.usage?.prompt_tokens, completion: data.usage?.completion_tokens },
        },
      };
    }
    throw new Error(`OpenRouter: retries exhausted for ${model}`);
  },
};
