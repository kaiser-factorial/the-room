// Direct xAI API adapter (F1/§2.5 fix, 2026-08-26). Through OpenRouter,
// Grok's "trace" is a ~200-char reasoning SUMMARY ending in "…" — xAI's own
// API returns the full `reasoning_content`, plus logprobs, so the Grok seat
// rides here whenever XAI_API_KEY is set (config.ts flips the seat's
// adapter on that env; without the key the seat stays on OpenRouter and the
// summary-class caveat applies).

import { readToolCalls, reasoningParam, stubSend, toWireMessages, type Adapter } from './openrouter.js';

const API_URL = 'https://api.x.ai/v1/chat/completions';

export const xaiAdapter: Adapter = {
  async send(model, messages, opts) {
    if (process.env.ROOM_STUB === '1') return stubSend(model, opts);
    const key = process.env.XAI_API_KEY;
    if (!key) throw new Error('Set XAI_API_KEY in the environment.');

    const body: Record<string, unknown> = {
      // The catalog keeps OpenRouter-style slugs; xAI wants them bare.
      model: model.replace(/^x-ai\//, ''),
      messages: toWireMessages(messages),
      max_tokens: opts.maxTokens,
    };
    // xAI speaks the same OpenAI tool dialect (F4¾ native transport).
    if (opts.tools?.length) body.tools = opts.tools;
    // xAI's reasoning knob is `reasoning_effort` (low|high, no medium) on
    // models that support it; reuse the same effort source as OpenRouter.
    const reasoning = reasoningParam(model, opts.reasoningEffort ?? 'low', opts.maxTokens);
    if (reasoning && 'effort' in reasoning) {
      body.reasoning_effort = reasoning.effort === 'low' ? 'low' : 'high';
    }
    if (opts.logprobs) { body.logprobs = true; body.top_logprobs = 1; }
    if (opts.sampling) {
      body.temperature = opts.sampling.temperature;
      if (opts.sampling.topP !== undefined) body.top_p = opts.sampling.topP;
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      if (!res.ok) throw new Error(`xAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as {
        choices?: {
          logprobs?: { content?: { logprob?: number }[] };
          // xAI returns the FULL trace as reasoning_content (the whole
          // point of this adapter vs. OpenRouter's truncated summary).
          message?: {
            content?: string | null;
            reasoning_content?: string | null;
            tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
          };
          finish_reason?: string;
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = data.choices?.[0];
      const lp = choice?.logprobs?.content
        ?.map((t) => t.logprob)
        .filter((x): x is number => typeof x === 'number');
      return {
        text: choice?.message?.content?.trim() ?? '',
        thinking: choice?.message?.reasoning_content?.trim() || undefined,
        ...(choice?.message?.tool_calls?.length ? { toolCalls: readToolCalls(choice.message.tool_calls) } : {}),
        meta: {
          provider: 'xai-direct',
          finishReason: choice?.finish_reason,
          attempts: attempt,
          usage: { prompt: data.usage?.prompt_tokens, completion: data.usage?.completion_tokens },
          logprobs: lp?.length ? lp : undefined,
        },
      };
    }
    throw new Error(`xAI: retries exhausted for ${model}`);
  },
};
