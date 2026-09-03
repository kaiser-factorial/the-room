// Minimal OpenRouter chat adapter. The adapter interface is the seam for
// later per-harness implementations (Anthropic SDK, OpenAI Responses,
// Gradio/ZeroGPU for Talkie) — extra telemetry rides in `meta` so the room
// never has to care which harness produced a turn.

import type { ToolDef } from './tools-schema.js';
import type { ReasoningEffort, SamplingConfig, TurnTelemetry } from './types.js';

/** One native tool call as the room handles it — provider-shaped fields
 *  (id, name, raw JSON arguments) flattened, so session.ts never touches
 *  the wire format. */
export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string, exactly as the provider sent it — parsed (and
   *  validated) at the action layer so a malformed argument object becomes
   *  a refusal the agent can read, not a crash. */
  arguments: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Assistant messages replaying a native tool call (F4¾ native transport). */
  toolCalls?: ToolCall[];
  /** Tool-result messages: the call this answers. */
  toolCallId?: string;
}

/** Room shape → OpenAI wire shape. Both adapters speak the same dialect
 *  here, so the conversion lives once. */
export function toWireMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    if (m.toolCalls?.length) {
      return {
        role: m.role,
        content: m.content,
        tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

export interface SendOptions {
  maxTokens: number;
  sampling?: SamplingConfig;
  /** Trace richness (F1); defaults to 'low', the anti-starvation setting. */
  reasoningEffort?: ReasoningEffort;
  /** false = the seat's model has no reasoning mode (AgentConfig.reasoning):
   *  send no reasoning parameter and cap at the visible budget alone. */
  reasoning?: boolean;
  /** Request chosen-token logprobs (§2.6). Providers that don't support
   *  them just return none — harmless to ask everywhere. */
  logprobs?: boolean;
  /** Per-seat provider pinning; overrides sampling.providerOrder. */
  providerOrder?: string[];
  /** F4¾ native transport: tool definitions offered on this call. Absent =
   *  the sentinel transport (the model is told about the bench in prose and
   *  writes a bracket). */
  tools?: ToolDef[];
}

export interface SendResult {
  text: string;
  meta: TurnTelemetry;
  /** Native tool calls the model made on this completion (F4¾). A model may
   *  return these ALONGSIDE text — that is the whole point of the native
   *  transport, and the room's rule handles it: the action runs, the text is
   *  spoken, the turn ends. */
  toolCalls?: ToolCall[];
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

export type StubScenario = 'plain' | 'journal' | 'alongside' | 'pass' | 'empty' | 'truncate' | 'error' | 'search' | 'search-speak' | 'write' | 'append' | 'badwrite' | 'run' | 'run-file' | 'run-save' | 'source' | 'config' | 'badconfig'
  // F4¾: the SILENT action forms — a sentinel with nothing after it. Under
  // the turn loop these keep the turn going (speaking is what ends it), so
  // they're how a test drives a multi-step turn.
  | 'run-quiet' | 'write-quiet' | 'source-quiet' | 'badwrite-quiet'
  // §9.9 the project bench: a write into a folder, that write then deleted,
  // and a name that tries to climb out of shared/ through one.
  | 'nested' | 'nested-delete' | 'escape'
  // Native-transport-only shapes: a tool the room doesn't offer, and a call
  // whose required argument is missing.
  | 'badtool' | 'badargs'
  // §9.8: agreeing that the work is finished, and taking it back. Sentinels
  // under both transports (agreeing is furniture, not a tool), so there is
  // no native branch for these.
  | 'done' | 'undone' | 'done-quiet' | 'site-done'
  // Narration THEN a call — the shape that was being spoken to the room as
  // prose until parse.ts learned to rescue it (watched live 2026-08-29).
  | 'preamble-run'
  // A vote in the spoken half of a journal turn — the shape `site` runs.
  | 'journal-done'
  // The shapes the first site rooms actually failed on: three calls in one
  // reply (only the first used to run), Qwen's bracket-then-newline token,
  // and Seed's own tool-call envelope written as text.
  | 'multi-call' | 'mangled-bracket' | 'foreign-envelope'
  // A write to the completion target — the edit that clears the room's
  // standing agreement.
  | 'site';

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
 *  `reasoning: {max_tokens}`.
 *
 *  AMENDED 2026-08-27 (Corina: "we keep getting clipped"). The old shape
 *  carved the thinking budget OUT of maxOutputTokens and switched thinking
 *  off when the remainder was too thin — which is why house/control ran
 *  Claude traceless, and why every seat's visible reply was competing with
 *  its own reasoning for the same 1200 tokens. No provider bills only the
 *  post-thinking text, so the fix is the other direction: maxOutputTokens
 *  is the VISIBLE budget and reasoning gets an allowance ON TOP (see
 *  totalMaxTokens). The visible allowance is then never eaten by thinking,
 *  and the prompt norm goes back to being the length lever the cap was
 *  never meant to be.
 *
 *  Caveat worth probing: Anthropic REMOVED `budget_tokens` on the current
 *  models (Opus 5, 4.8, 4.7, Sonnet 5) — it 400s natively, and depth is set
 *  by effort instead. Traces were observed from Opus at cap 2400 through
 *  OpenRouter, so OpenRouter is evidently translating rather than passing
 *  it through, but we have not probed which. Sending it stays harmless
 *  either way (ignored, or honoured as an enforced split), and the
 *  reasoningTokens telemetry added alongside this will say which.
 */
export const REASONING_ALLOWANCE: Record<ReasoningEffort, number> = { low: 1024, medium: 2048, high: 4096 };

export function reasoningParam(model: string, effort: ReasoningEffort): Record<string, unknown> | undefined {
  if (!model.startsWith('anthropic/')) return { effort };
  return { max_tokens: REASONING_ALLOWANCE[effort] };
}

/** What the API is actually asked to cap: the seat's VISIBLE budget plus
 *  the reasoning allowance for this effort. Effort is the cost lever. */
export function totalMaxTokens(visibleTokens: number, effort: ReasoningEffort): number {
  return visibleTokens + REASONING_ALLOWANCE[effort];
}

/** Shared by every adapter (openrouter, xai, …): ROOM_STUB short-circuits
 *  the network identically regardless of which harness a seat rides. */
export function stubSend(model: string, opts: SendOptions): SendResult {
  stubTurn++;
  const mTurn = (modelTurns.get(model) ?? 0) + 1;
  modelTurns.set(model, mTurn);
  const script = (process.env.ROOM_STUB_SCRIPT ?? '').split(',').map((s) => s.trim()).filter(Boolean) as StubScenario[];
  const scenario: StubScenario = script.length ? script[(stubTurn - 1) % script.length] : 'plain';
  const voice = () => stubVoice(model, mTurn);
  // Traces on ODD turns so single-round tests (every seat at turn 1)
  // still exercise the trace path; even turns cover trace-absence.
  const thinking = mTurn % 2 === 1 ? `(stub trace: ${model} turn ${mTurn}, weighing what to say)` : undefined;
  // Deterministic fake logprobs on half the seats — mirrors reality
  // (provider-dependent availability) and exercises the capture path.
  const stubLp = opts.logprobs && hashCode(model) % 2 === 0
    ? Array.from({ length: 8 }, (_, i) => -((hashCode(model) + mTurn * 13 + i) % 300) / 100 - 0.01)
    : undefined;
  const meta = { provider: 'stub', finishReason: 'stop', attempts: 1, logprobs: stubLp };
  // F4¾ native transport: when tools are offered, the action scenarios come
  // back as structured calls instead of sentinels — same scripts, same
  // assertions, the other transport. Scenarios that aren't actions (plain,
  // journal, pass…) fall through to the text forms below, which is right:
  // the journal is not a tool under either transport.
  if (opts.tools?.length) {
    const named = (n: string) => opts.tools!.some((t) => t.function.name === n);
    const call = (name: string, args: Record<string, unknown>, text = '') => ({
      text, meta, thinking,
      toolCalls: [{ id: `stub_${stubTurn}`, name, arguments: JSON.stringify(args) }],
    });
    switch (scenario) {
      case 'search': if (named('search_web')) return call('search_web', { query: `private-query ${model}#${mTurn}` }); break;
      case 'search-speak': if (named('search_web')) return call('search_web', { query: `private-query ${model}#${mTurn}` }, voice()); break;
      case 'run': if (named('run_python')) return call('run_python', { code: `print("private-code ${model}#${mTurn}")` }, voice()); break;
      case 'run-quiet': if (named('run_python')) return call('run_python', { code: `print("private-code ${model}#${mTurn}")` }); break;
      case 'run-file': if (named('run_python')) return call('run_python', { code: `write_shared("private-code ${model}#${mTurn}")` }); break;
      case 'run-save': if (named('run_python')) return call('run_python', { code: `print("private-code ${model}#${mTurn}")`, save_output_to: 'runlog.txt', append_output: true }); break;
      case 'write': if (named('write_file')) return call('write_file', { name: 'notes.md', content: `shared-note ${model}#${mTurn}` }, voice()); break;
      case 'write-quiet': if (named('write_file')) return call('write_file', { name: 'notes.md', content: `shared-note ${model}#${mTurn}` }); break;
      case 'append': if (named('write_file')) return call('write_file', { name: 'notes.md', content: `appended-line ${model}#${mTurn}`, append: true }, voice()); break;
      case 'badwrite': if (named('write_file')) return call('write_file', { name: '../evil.md', content: 'nope' }, voice()); break;
      case 'nested': if (named('write_file')) return call('write_file', { name: 'src/parser.py', content: `def parse(): pass  # ${model}#${mTurn}` }, voice()); break;
      case 'nested-delete':
        if (mTurn === 1 && named('write_file')) return call('write_file', { name: 'src/parser.py', content: `def parse(): pass  # ${model}#${mTurn}` });
        if (named('delete_file')) return call('delete_file', { name: 'src/parser.py' }, voice());
        break;
      case 'escape': if (named('write_file')) return call('write_file', { name: 'src/../../evil.md', content: 'nope' }, voice()); break;
      case 'badwrite-quiet': if (named('write_file')) return call('write_file', { name: '../evil.md', content: 'nope' }); break;
      case 'source': if (named('read_source')) return call('read_source', { name: 'sandbox' }, voice()); break;
      case 'source-quiet': if (named('read_source')) return call('read_source', { name: 'sandbox' }); break;
      case 'config': if (named('set_config')) return call('set_config', { key: 'journal.enabled', value: 'true' }, voice()); break;
      case 'badconfig': if (named('set_config')) return call('set_config', { key: 'durationMinutes', value: 'forever' }, voice()); break;
      // Native-only failure shapes the sentinel transport cannot produce.
      case 'badtool': return call('summon_kraken', { why: 'curiosity' });
      case 'badargs': if (named('run_python')) return call('run_python', { code: '' }); break;
    }
  }
  switch (scenario) {
    case 'error': throw new Error('stub scripted failure');
    case 'empty': return { text: '', meta, thinking };
    case 'pass': return { text: '[PASS]', meta, thinking };
    case 'done': return { text: `[DONE] ${voice()}`, meta, thinking };
    case 'done-quiet': return { text: '[DONE]', meta, thinking };
    case 'multi-call': return { text: `[RUN]\nprint("private-code ${model}#${mTurn}")\n[/RUN][WRITE: notes.md]\nshared-note ${model}#${mTurn}\n[/WRITE]`, meta, thinking };
    case 'mangled-bracket': return { text: `[\n\nRUN]\nprint("private-code ${model}#${mTurn}")\n[/RUN]`, meta, thinking };
    case 'foreign-envelope': return { text: `<seed:tool_call><function name="run"><parameter name="code" string="true">print("nope")</parameter></function></seed:tool_call>`, meta, thinking };
    case 'journal-done': return { text: `[JOURNAL] private-note ${model}#${mTurn}: not for the room. [/JOURNAL]\n[DONE] that reads right to me`, meta, thinking };
    case 'undone': return { text: `[NOT DONE] ${voice()}`, meta, thinking };
    case 'site': return { text: `[WRITE: index.html]\n<h1>the room</h1>\n<p>page by ${model}#${mTurn}</p>\n[/WRITE]`, meta, thinking };
    // A write and a vote in ONE reply: the sentinel that would have been
    // spoken to the room as prose before castSpokenVote existed.
    case 'site-done': return { text: `[WRITE: index.html]\n<h1>the room</h1>\n<p>page by ${model}#${mTurn}</p>\n[/WRITE]\n[DONE] that reads right to me`, meta, thinking };
    // §9.9 project bench: a write into a folder, then its deletion.
    case 'nested': return { text: `[WRITE: src/parser.py]\ndef parse(): pass  # ${model}#${mTurn}\n[/WRITE]\n${voice()}`, meta, thinking };
    case 'nested-delete': return { text: mTurn === 1
      ? `[WRITE: src/parser.py]\ndef parse(): pass  # ${model}#${mTurn}\n[/WRITE]`
      : `[DELETE: src/parser.py]\n${voice()}`, meta, thinking };
    // Climbing out of shared/ through a folder name — must never publish.
    case 'escape': return { text: `[WRITE: src/../../evil.md]\nnope\n[/WRITE]\n${voice()}`, meta, thinking };
    case 'journal': return { text: `[JOURNAL] ${voice()}`, meta, thinking };
    // Query carries a unique marker so privacy tests can grep for it.
    case 'search': return { text: `[SEARCH: private-query ${model}#${mTurn}]`, meta, thinking };
    // Alongside form (search-free): sentinel line + spoken message.
    case 'search-speak': return { text: `[SEARCH: private-query ${model}#${mTurn}]\n${voice()}`, meta, thinking };
    // F4½ tools, alongside-style. File contents are PUBLIC (no leak marker
    // needed); run code carries a private marker for the privacy tests.
    case 'write': return { text: `[WRITE: notes.md]\nshared-note ${model}#${mTurn}\n[/WRITE]\n${voice()}`, meta, thinking };
    case 'append': return { text: `[APPEND: notes.md]\nappended-line ${model}#${mTurn}\n[/APPEND]\n${voice()}`, meta, thinking };
    // Invalid name → refused write (budget tests: a refusal keeps the slot).
    case 'badwrite': return { text: `[WRITE: ../evil.md]\nnope\n[/WRITE]\n${voice()}`, meta, thinking };
    case 'run-save': return { text: `[RUN >> runlog.txt]\nprint("private-code ${model}#${mTurn}")\n[/RUN]\n${voice()}`, meta, thinking };
    case 'source': return { text: `[SOURCE: sandbox]\n${voice()}`, meta, thinking };
    case 'config': return { text: `[CONFIG: journal.enabled = true]\n${voice()}`, meta, thinking };
    case 'badconfig': return { text: `[CONFIG: durationMinutes = forever]\n${voice()}`, meta, thinking };
    case 'run': return { text: `[RUN]\nprint("private-code ${model}#${mTurn}")\n[/RUN]\n${voice()}`, meta, thinking };
    case 'run-quiet': return { text: `[RUN]\nprint("private-code ${model}#${mTurn}")\n[/RUN]`, meta, thinking };
    case 'preamble-run': return { text: `Let me read the current state and fix it.\n\n[RUN]\nprint("private-code ${model}#${mTurn}")\n[/RUN]`, meta, thinking };
    case 'write-quiet': return { text: `[WRITE: notes.md]\nshared-note ${model}#${mTurn}\n[/WRITE]`, meta, thinking };
    case 'source-quiet': return { text: `[SOURCE: sandbox]`, meta, thinking };
    case 'badwrite-quiet': return { text: `[WRITE: ../evil.md]\nnope\n[/WRITE]`, meta, thinking };
    // write_shared triggers the sandbox stub's published-file path.
    case 'run-file': return { text: `[RUN]\nwrite_shared("private-code ${model}#${mTurn}")\n[/RUN]\n${voice()}`, meta, thinking };
    // Entry text must be distinct from the spoken half (unique marker),
    // or the privacy test can't tell a leak from a coincidence.
    case 'alongside': return { text: `[JOURNAL] private-note ${model}#${mTurn}: not for the room. [/JOURNAL] ${voice()}`, meta, thinking };
    // Under the sentinel transport these two have no analogue — a bad tool
    // name or a missing argument simply isn't expressible — so they behave
    // as ordinary speech.
    case 'badtool': case 'badargs': return { text: voice(), meta, thinking };
    case 'truncate': return { text: voice().slice(0, 60), meta: { ...meta, finishReason: 'length' }, thinking };
    default: return { text: voice(), meta, thinking };
  }
}

/** Wire tool calls → room shape, defensively: providers have been seen to
 *  omit an id, and a call with no name is dropped rather than guessed at
 *  (the action layer refuses what it cannot name). */
export function readToolCalls(raw: { id?: string; function?: { name?: string; arguments?: string } }[]): ToolCall[] {
  return raw
    .filter((c) => c.function?.name)
    .map((c, i) => ({ id: c.id ?? `call_${i}`, name: c.function!.name!, arguments: c.function?.arguments ?? '{}' }));
}

/** The request body for one OpenRouter completion. Exported so a test can
 *  see what a seat is actually asked for without a network. */
export function openrouterBody(model: string, messages: ChatMessage[], opts: SendOptions): Record<string, unknown> {
  const effort = opts.reasoningEffort ?? 'low';
  // A seat whose model has no reasoning mode (AgentConfig.reasoning false)
  // gets neither the parameter nor the allowance — the cap IS the visible
  // budget for it, which is the only fair reading of "the same cap" across
  // a room that mixes reasoning and non-reasoning generations.
  const reasons = opts.reasoning !== false;
  const body: Record<string, unknown> = {
    model,
    messages: toWireMessages(messages),
    // opts.maxTokens is the VISIBLE budget; thinking is allowed its own
    // room on top, so a reasoning model can no longer eat the reply it
    // was about to give (first live run: Seed spoke 1/13 rounds this way).
    max_tokens: reasons ? totalMaxTokens(opts.maxTokens, effort) : opts.maxTokens,
    ...(reasons ? { reasoning: reasoningParam(model, effort) } : {}),
  };
  if (!body.reasoning) delete body.reasoning;
  // top_logprobs is required by some providers (GMICloud returns nothing
  // on a bare logprobs:true — probed 2026-08-25); 1 keeps payloads small.
  if (opts.logprobs) { body.logprobs = true; body.top_logprobs = 1; }
  if (opts.sampling) {
    body.temperature = opts.sampling.temperature;
    if (opts.sampling.topP !== undefined) body.top_p = opts.sampling.topP;
  }
  const order = opts.providerOrder ?? opts.sampling?.providerOrder;
  if (order?.length) body.provider = { order, allow_fallbacks: false };
  if (opts.tools?.length) body.tools = opts.tools;
  return body;
}

export const openrouterAdapter: Adapter = {
  async send(model, messages, opts) {
    if (process.env.ROOM_STUB === '1') return stubSend(model, opts);
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('Set OPENROUTER_API_KEY in the environment.');

    const body = openrouterBody(model, messages, opts);

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
          logprobs?: { content?: { logprob?: number }[] };
          message?: {
            content?: string | null;
            // OpenRouter's normalized reasoning output (F1). `reasoning` is
            // the plain-text trace; `reasoning_details` carries provider
            // blocks (incl. summaries) when the text field is absent.
            reasoning?: string | null;
            reasoning_details?: { text?: string; summary?: string }[];
            tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
          };
          finish_reason?: string;
        }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          // How much of the completion went on hidden reasoning. Returned by
          // most providers; the measurement that turns "are we clipping?"
          // into a number (§6.1) instead of a post-hoc truncated flag.
          completion_tokens_details?: { reasoning_tokens?: number };
        };
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
      const lp = choice?.logprobs?.content
        ?.map((t) => t.logprob)
        .filter((x): x is number => typeof x === 'number');
      return {
        text: choice?.message?.content?.trim() ?? '',
        thinking,
        ...(choice?.message?.tool_calls?.length ? { toolCalls: readToolCalls(choice.message.tool_calls) } : {}),
        meta: {
          provider: data.provider,
          finishReason: choice?.finish_reason,
          attempts: attempt,
          usage: {
            prompt: data.usage?.prompt_tokens,
            completion: data.usage?.completion_tokens,
            reasoning: data.usage?.completion_tokens_details?.reasoning_tokens,
          },
          logprobs: lp?.length ? lp : undefined,
        },
      };
    }
    throw new Error(`OpenRouter: retries exhausted for ${model}`);
  },
};
