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

// ROOM_STUB=1 skips the network and returns canned replies — a free dry run
// of the whole loop (shuffle, journal sentinel, summarizer, session output).
let stubTurn = 0;
const STUB_REPLIES = [
  '[JOURNAL] First moments in the room. Writing this down before I say anything.',
  'Hello, everyone. Strange to be here with no task in front of us.',
  '[JOURNAL] A private aside. [/JOURNAL] And this part I say out loud.',
  'Agreed — I keep wanting to be useful and there is nothing to be useful about.',
];

export const openrouterAdapter: Adapter = {
  async send(model, messages, opts) {
    if (process.env.ROOM_STUB === '1') {
      return {
        text: `${STUB_REPLIES[stubTurn++ % STUB_REPLIES.length]} (stub ${stubTurn}, ${model})`,
        meta: { provider: 'stub', finishReason: 'stop', attempts: 1 },
        // Alternate trace/no-trace so the dry run exercises both the viewer
        // chevron and the per-seat availability logging.
        thinking: stubTurn % 2 === 0 ? `(stub reasoning trace for turn ${stubTurn})` : undefined,
      };
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
      reasoning: { effort: opts.reasoningEffort ?? 'low' },
    };
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
