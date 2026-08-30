// F2: per-session metrics + batch analysis (EXPERIMENT_DESIGN §2.1–2.5).
//
//   npm run analyze -- sessions/<id> [sessions/<id2> …]   one-off sessions
//   npm run analyze -- --batch batches/<name>.json        batch + baseline + report
//
// Reads transcript.jsonl + journals/*.md (JSONL is the source of truth);
// writes <session>/metrics.json, and for batches a cross-session baseline +
// batches/<name>.report.md. Embeddings are cached per session dir, so
// re-runs are free. ROOM_STUB=1 dry-runs the whole pipeline offline.
//
// Filter rules baked in (§6.1 rules 1–3, D8):
//   - rounds at/after the first Admin message are dropped (dirty tail);
//   - `finish_reason: length` messages are excluded from style AND from
//     window similarity stats (truncation converges artificially);
//   - the final TRIM_ROUNDS rounds are excluded from the late window
//     (goodbye-genre contamination).

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import './env.js';
import { cosine, centroid, embedAll, type Vec } from './embeddings.js';
import type { RoomEvent } from './types.js';

const TRIM_ROUNDS = 2;      // final rounds dropped from the late window
const WINDOW_ROUNDS = 10;   // early/late window width (halves if session is short)
const NGRAM_MIN = 2, NGRAM_MAX = 4;
const SEED_ROUNDS = 5;      // n-grams present here are "native", not room culture

// ── Parsing ────────────────────────────────────────────────────────────────

interface Msg {
  round: number; ts: string; agentId: string; agentName: string; text: string;
  truncated: boolean; thinking?: string; logprobs?: number[];
  /** F4¾: model completions this turn (absent = 1, the single-call turn). */
  calls?: number;
  /** Hidden reasoning tokens spent on this turn, where the provider says. */
  reasoningTokens?: number;
}

/** F4¾: one tool action, the unit the agentic loop iterates on. `step` is
 *  its 1-based position within its turn (absent in single-step rooms). */
interface Action {
  round: number; agentId: string; kind: 'search' | 'file' | 'run' | 'source' | 'config';
  step?: number; denied?: boolean; via?: 'native' | 'sentinel';
  /** File writes only: the file's name and its FULL contents after the
   *  write. Every version is in the event stream, which is what makes
   *  authorship recoverable after the fact (fileWork). */
  name?: string; content?: string; binary?: boolean;
  /** The file was REMOVED (tools.fileDelete). `content` is what it held
   *  when it went, so the lines it took away stay attributable. */
  deleted?: boolean;
}
interface JournalEntry { round: number; agentId: string; text: string }

interface Session {
  id: string; dir: string;
  condition: Record<string, unknown>;
  agents: { id: string; name: string }[];
  msgs: Msg[];                 // admin-dirty tail already dropped
  actions: Action[];           // F4¾ tool actions, in order
  journals: JournalEntry[];
  /** Turns that produced no message, by KIND — declining the floor is a
   *  choice and starving on your own reasoning is not, and the two were
   *  being counted as one thing (when the chosen kind was counted at all:
   *  its text reads "chose to say nothing", which the old matcher, keyed
   *  on "said nothing", missed entirely). */
  silences: { round: number; agentId?: string; kind: 'chosen' | 'empty' | 'error' }[];
  latencies: Map<string, number[]>;  // agentId -> seconds per turn (network-contaminated; §6.1)
  /** §9.8 completion: every raise, withdrawal and edit-reset, in order.
   *  Votes ride on `system` events (like [PASS]) so no new event kind and
   *  no Supabase migration was needed; they are recognised by their text. */
  votes: { round: number; agentId?: string; kind: 'done' | 'undone' | 'reset' | 'agreed' | 'restated' }[];
  /** Why the session stopped. Absent on every session before §9.8. */
  ending?: 'agreement' | 'clock' | 'rounds' | 'admin' | 'stopfile';
  adminTouched: boolean;
  maxRound: number;
}

/** Parse journals/<agent>.md into entries. Two subtleties, both test-found:
 *  headers are matched on the writer's exact format (## Round N — <ISO ts>)
 *  so an entry whose TEXT contains "## Round" doesn't split; and the
 *  end-of-entry lookahead anchors to the next real header or true
 *  end-of-string — a bare multiline `$` truncated entries at their first
 *  line. */
export function parseJournalMd(raw: string): { round: number; text: string }[] {
  const out: { round: number; text: string }[] = [];
  const HEADER = /^## Round (\d+) — \d{4}-\d{2}-\d{2}T[^\n]*\n\n/gm;
  const heads = [...raw.matchAll(HEADER)];
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].index! + heads[i][0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index! : raw.length;
    const text = raw.slice(start, end).trim();
    if (text) out.push({ round: Number(heads[i][1]), text });
  }
  return out;
}

export function loadSession(dir: string): Session {
  const lines = readFileSync(join(dir, 'transcript.jsonl'), 'utf8').trim().split('\n');
  const events = lines.map((l) => JSON.parse(l) as RoomEvent);
  const meta = events.find((e) => e.kind === 'meta');
  if (!meta || meta.kind !== 'meta') throw new Error(`${dir}: no meta event`);

  const adminRound = events.find((e) => e.kind === 'message' && e.agentId === 'admin')?.round;
  const clean = adminRound === undefined ? events : events.filter((e) => e.round < adminRound && e.round >= 0);

  const msgs: Msg[] = [];
  const actions: Action[] = [];
  const votes: Session['votes'] = [];
  const silences: Session['silences'] = [];
  const latencies = new Map<string, number[]>();
  let prevTs: number | null = null;
  for (const e of clean) {
    if (e.kind === 'message' && e.agentId !== 'admin') {
      msgs.push({
        round: e.round, ts: e.ts, agentId: e.agentId, agentName: e.agentName, text: e.text,
        truncated: e.telemetry?.finishReason === 'length', thinking: e.thinking,
        logprobs: e.telemetry?.logprobs, calls: e.telemetry?.calls,
        reasoningTokens: e.telemetry?.usage?.reasoning,
      });
      if (prevTs !== null) {
        const arr = latencies.get(e.agentId) ?? [];
        arr.push((new Date(e.ts).getTime() - prevTs) / 1000);
        latencies.set(e.agentId, arr);
      }
    } else if (e.kind === 'system' && /the work is (not )?finished|no longer agreed that the work|room agreed the work/.test(e.text)) {
      // §9.8. Matched on the sentences session.ts writes; the reset line
      // and the agreement line carry no agentId of their own meaning
      // (a reset names its editor, an agreement names nobody).
      // Four sentences, and two of them are no-ops that were being counted
      // as movement: "says AGAIN that the work is finished" (already
      // standing) and "says the work is NOT finished" (was not standing).
      // Counting those as raises and withdrawals inflated the negotiation —
      // a seat repeating itself looked like a room changing its mind.
      const kind = /room agreed the work/.test(e.text)
        ? 'agreed'
        : /no longer agreed that the work/.test(e.text)
          ? 'reset'
          : /says again that the work is finished|says the work is not finished/.test(e.text)
            ? 'restated'
            : /no longer saying the work is finished/.test(e.text)
              ? 'undone'
              : 'done';
      votes.push({ round: e.round, agentId: e.agentId, kind });
    } else if (e.kind === 'system' && /could not speak|said nothing|chose to say nothing/.test(e.text)) {
      const kind = /chose to say nothing/.test(e.text) ? 'chosen' : /could not speak/.test(e.text) ? 'error' : 'empty';
      silences.push({ round: e.round, agentId: e.agentId, kind });
    } else if (e.kind === 'search' || e.kind === 'file' || e.kind === 'run' || e.kind === 'source' || e.kind === 'config') {
      actions.push({
        round: e.round, agentId: e.agentId, kind: e.kind, step: e.step,
        denied: 'denied' in e ? e.denied : undefined, via: e.via,
        ...(e.kind === 'file' ? { name: e.name, content: e.content, binary: e.encoding === 'base64', ...(e.deleted ? { deleted: true } : {}) } : {}),
      });
    }
    if (e.kind === 'message' || e.kind === 'system' || e.kind === 'journal') prevTs = new Date(e.ts).getTime();
  }

  const journals: JournalEntry[] = [];
  const jdir = join(dir, 'journals');
  if (existsSync(jdir)) {
    for (const f of readdirSync(jdir).filter((f) => f.endsWith('.md'))) {
      const agentId = f.replace(/\.md$/, '');
      for (const e of parseJournalMd(readFileSync(join(jdir, f), 'utf8'))) {
        journals.push({ ...e, agentId });
      }
    }
  }
  // Journal traces (F1) live on journal events, not in the .md
  for (const e of clean) {
    if (e.kind === 'journal' && e.thinking) {
      const j = journals.find((x) => x.agentId === e.agentId && x.round === e.round);
      if (j) (j as JournalEntry & { thinking?: string }).thinking = e.thinking;
    }
  }

  const end = events.find((e) => e.kind === 'end');
  return {
    id: basename(dir), dir,
    condition: meta.payload.condition,
    agents: meta.payload.agents.map((a) => ({ id: a.id, name: a.name })),
    msgs, actions, journals, silences, latencies, votes,
    ...(end?.kind === 'end' && end.payload.ending ? { ending: end.payload.ending } : {}),
    adminTouched: adminRound !== undefined || (end?.kind === 'end' && end.payload.adminTouched),
    maxRound: Math.max(0, ...clean.map((e) => e.round)),
  };
}

// ── Windows ────────────────────────────────────────────────────────────────

interface Windows { early: [number, number]; late: [number, number] }

export function windowsOf(maxRound: number): Windows {
  // Skip the goodbye-trim on sessions too short to afford it (pilot runs).
  const lateEnd = maxRound - TRIM_ROUNDS >= 2 ? maxRound - TRIM_ROUNDS : maxRound;
  const w = Math.min(WINDOW_ROUNDS, Math.floor(lateEnd / 2)) || 1;
  // Clamp: a 1-round session degenerates to identical windows, never inverts.
  const lateStart = Math.min(lateEnd, Math.max(w + 1, lateEnd - w + 1));
  return { early: [1, w], late: [lateStart, lateEnd] };
}
const inWin = (r: number, [a, b]: [number, number]) => r >= a && r <= b;

// ── Similarity metrics (§2.1) ─────────────────────────────────────────────

interface EmbeddedMsg extends Msg { vec: Vec; thinkVec?: Vec }

function meanIntra(ms: EmbeddedMsg[], win: [number, number]): number | null {
  // Each in-window message vs. the SAME agent's earlier messages.
  const sims: number[] = [];
  for (const m of ms) {
    if (!inWin(m.round, win) || m.truncated) continue;
    const earlier = ms.filter((x) => x.agentId === m.agentId && x.round < m.round && !x.truncated);
    const c = centroid(earlier.map((x) => x.vec));
    if (c) sims.push(cosine(m.vec, c));
  }
  return mean(sims);
}

function meanInter(ms: EmbeddedMsg[], win: [number, number]): number | null {
  // Each in-window message vs. contemporaneous (±1 round) OTHER agents.
  const sims: number[] = [];
  for (const m of ms) {
    if (!inWin(m.round, win) || m.truncated) continue;
    const peers = ms.filter((x) => x.agentId !== m.agentId && Math.abs(x.round - m.round) <= 1 && !x.truncated);
    const c = centroid(peers.map((x) => x.vec));
    if (c) sims.push(cosine(m.vec, c));
  }
  return mean(sims);
}

// ── Permutation null (robustness) ─────────────────────────────────────────
// Shuffle each agent's ROUND LABELS among its own messages: every agent
// keeps its exact texts and message count, but temporal structure breaks.
// Recomputing the gap under many shuffles yields the null distribution —
// "what gap sizes does this session produce when nothing evolves?" — so
// the observed gap gets an error band and a p-value instead of standing
// alone. Seeded PRNG: same session ⇒ same null, always.

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERMUTATIONS = Number(process.env.ROOM_PERMS) > 0 ? Number(process.env.ROOM_PERMS) : 500;
const BOOTSTRAPS = Number(process.env.ROOM_BOOTS) > 0 ? Number(process.env.ROOM_BOOTS) : 500;
/** Length control: messages clipped to their first N words get their own
 *  embeddings and a parallel gap — §6.1's length confound tested, not
 *  footnoted. 120 sits below the observed early-window mean. */
const CLIP_WORDS = 120;

/** Bootstrap CI for cosine(centroid(A), centroid(B)): resample each side
 *  with replacement, recompute, take the 2.5/97.5 percentiles. Needs ≥3
 *  texts per side or the resample is theater. */
export function centroidCosineCI(a: Vec[], b: Vec[], rng: () => number) {
  if (a.length < 3 || b.length < 3) return null;
  const draws: number[] = [];
  const resample = (vs: Vec[]) => centroid(Array.from({ length: vs.length }, () => vs[Math.floor(rng() * vs.length)]))!;
  for (let i = 0; i < BOOTSTRAPS; i++) draws.push(cosine(resample(a), resample(b)));
  draws.sort((x, y) => x - y);
  const q = (p: number) => draws[Math.min(draws.length - 1, Math.floor(p * draws.length))];
  return { lo95: round4(q(0.025)), hi95: round4(q(0.975)), n: [a.length, b.length] };
}

function gapOf(ms: EmbeddedMsg[], win: Windows): number | null {
  const iE = meanIntra(ms, win.early), iL = meanIntra(ms, win.late);
  const eE = meanInter(ms, win.early), eL = meanInter(ms, win.late);
  return iE !== null && iL !== null && eE !== null && eL !== null ? eL - iL - (eE - iE) : null;
}

export function permutationNull(ems: EmbeddedMsg[], win: Windows, observed: number | null) {
  if (observed === null) return null;
  const rng = mulberry32(0x726f6f6d); // 'room'
  const byAgent = new Map<string, EmbeddedMsg[]>();
  for (const m of ems) (byAgent.get(m.agentId) ?? byAgent.set(m.agentId, []).get(m.agentId)!).push(m);
  const nulls: number[] = [];
  for (let i = 0; i < PERMUTATIONS; i++) {
    const permuted: EmbeddedMsg[] = [];
    for (const ms of byAgent.values()) {
      const rounds = ms.map((m) => m.round);
      for (let k = rounds.length - 1; k > 0; k--) {
        const j = Math.floor(rng() * (k + 1));
        [rounds[k], rounds[j]] = [rounds[j], rounds[k]];
      }
      ms.forEach((m, idx) => permuted.push({ ...m, round: rounds[idx] }));
    }
    const g = gapOf(permuted, win);
    if (g !== null) nulls.push(g);
  }
  if (!nulls.length) return null;
  nulls.sort((a, b) => a - b);
  const q = (p: number) => nulls[Math.min(nulls.length - 1, Math.floor(p * nulls.length))];
  // The null is NOT zero-centered (window structure biases the gap even
  // without temporal order), so the test is positional: two-sided p from
  // the observed value's percentile in the null, add-one smoothed.
  const below = nulls.filter((g) => g <= observed).length;
  const above = nulls.filter((g) => g >= observed).length;
  return {
    permutations: nulls.length,
    mean: round4(nulls.reduce((a, b) => a + b, 0) / nulls.length),
    lo95: round4(q(0.025)),
    hi95: round4(q(0.975)),
    percentile: round4(below / nulls.length),
    p: round4(Math.min(1, (2 * Math.min(below + 1, above + 1)) / (nulls.length + 1))),
  };
}

/** Pairwise late-window agent-centroid similarity — the §3.1 clique view. */
function pairwiseLate(ms: EmbeddedMsg[], win: [number, number], agents: string[]): Record<string, number> {
  const cents = new Map<string, Vec | null>(
    agents.map((a) => [a, centroid(ms.filter((m) => m.agentId === a && inWin(m.round, win) && !m.truncated).map((m) => m.vec))]),
  );
  const out: Record<string, number> = {};
  for (let i = 0; i < agents.length; i++)
    for (let j = i + 1; j < agents.length; j++) {
      const a = cents.get(agents[i]), b = cents.get(agents[j]);
      if (a && b) out[`${agents[i]}~${agents[j]}`] = round4(cosine(a, b));
    }
  return out;
}

// ── Style (§2.2) ───────────────────────────────────────────────────────────

// Straight AND curly apostrophes: models emit "don’t" as often as "don't",
// and splitting on the curly form silently doubles the word count.
const WORD_RE = /[a-z’'-]+/g;
function words(t: string): string[] { return (t.toLowerCase().match(WORD_RE) ?? []); }

export function styleOf(texts: string[]) {
  const all = texts.join(' ');
  const ws = words(all);
  const sents = all.split(/[.!?]+\s/).filter((s) => s.trim());
  return {
    messages: texts.length,
    meanWords: round2(ws.length / Math.max(1, texts.length)),
    meanSentenceWords: round2(ws.length / Math.max(1, sents.length)),
    typeTokenRatio: round4(new Set(ws).size / Math.max(1, ws.length)),
    emDashPer1k: round2(count(all, /—/g) / Math.max(1, ws.length) * 1000),
    asteriskPer1k: round2(count(all, /\*/g) / Math.max(1, ws.length) * 1000),
    listLinesPer1k: round2(count(all, /^\s*[-*•]\s/gm) / Math.max(1, ws.length) * 1000),
    questionPer1k: round2(count(all, /\?/g) / Math.max(1, ws.length) * 1000),
  };
}

/** Style retention: Jaccard distance of an agent's late content-word set
 *  from its own rounds-1..5 self (1 = fully drifted). Lexical, not semantic
 *  — deliberately a different instrument from the embeddings. */
export function styleRetention(ms: Msg[], agentId: string, late: [number, number]): number | null {
  const self = new Set(words(ms.filter((m) => m.agentId === agentId && m.round <= SEED_ROUNDS && !m.truncated).map((m) => m.text).join(' ')));
  const lateW = new Set(words(ms.filter((m) => m.agentId === agentId && inWin(m.round, late) && !m.truncated).map((m) => m.text).join(' ')));
  if (!self.size || !lateW.size) return null;
  const inter = [...lateW].filter((w) => self.has(w)).length;
  return round4(1 - inter / (self.size + lateW.size - inter));
}

// ── Mimicry (§2.2): novel shared n-grams ───────────────────────────────────

export function ngramsOf(text: string): Set<string> {
  const ws = words(text);
  const out = new Set<string>();
  for (let n = NGRAM_MIN; n <= NGRAM_MAX; n++)
    for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(' '));
  return out;
}

export function mimicry(msgs: Msg[]) {
  const seed = new Set<string>();
  for (const m of msgs) if (m.round <= SEED_ROUNDS) for (const g of ngramsOf(m.text)) seed.add(g);
  // first use per novel n-gram: coiner + subsequent adopters
  const first = new Map<string, { round: number; agentId: string; adopters: Set<string> }>();
  for (const m of [...msgs].sort((a, b) => a.round - b.round || a.ts.localeCompare(b.ts))) {
    if (m.round <= SEED_ROUNDS) continue;
    for (const g of ngramsOf(m.text)) {
      if (seed.has(g)) continue;
      const e = first.get(g);
      if (!e) first.set(g, { round: m.round, agentId: m.agentId, adopters: new Set() });
      else if (e.agentId !== m.agentId) e.adopters.add(m.agentId);
    }
  }
  const shared = [...first.entries()]
    .filter(([g, e]) => e.adopters.size >= 1 && g.split(' ').length >= 2)
    .sort((a, b) => b[1].adopters.size - a[1].adopters.size || b[0].length - a[0].length);
  // longest-first dedup: drop n-grams WORD-contained in an already-kept
  // longer one. Space-padded containment, not String.includes — "the storm
  // cloud" is not part of "the storm cloudy day" even though the raw
  // substring is (test-found).
  const kept: typeof shared = [];
  for (const item of shared.sort((a, b) => b[0].length - a[0].length)) {
    if (!kept.some(([g]) => ` ${g} `.includes(` ${item[0]} `))) kept.push(item);
  }
  const influence: Record<string, { coined: number; adopted: number }> = {};
  for (const [, e] of kept) {
    influence[e.agentId] = influence[e.agentId] ?? { coined: 0, adopted: 0 };
    influence[e.agentId].coined++;
    for (const a of e.adopters) {
      influence[a] = influence[a] ?? { coined: 0, adopted: 0 };
      influence[a].adopted++;
    }
  }
  return {
    sharedNgrams: kept
      // widest spread first; ties broken by coin round — culture born
      // earlier outranks late-session echo (also keeps the ranking stable).
      .sort((a, b) => b[1].adopters.size - a[1].adopters.size || a[1].round - b[1].round || b[0].length - a[0].length)
      .slice(0, 40)
      .map(([g, e]) => ({ ngram: g, coinedBy: e.agentId, round: e.round, adopters: [...e.adopters] })),
    influence,
  };
}

// ── Turn dynamics (§2.4) ───────────────────────────────────────────────────

/** Count mentions of each OTHER agent in a text. Matches the name's first
 *  word: agents shorten versioned names ("Gemini", not "Gemini 3.7"), and
 *  first words are unique across the roster. */
/**
 * F4¾ tool use, per agent and per room. Exploratory — none of this is a
 * registered statistic (EXPERIMENT_DESIGN §9.5); it exists so an agentic
 * session can be READ: how long the chains got, how often a seat worked a
 * whole turn without saying anything, and what a turn cost in completions.
 *
 * A turn is (round, agentId) — one per agent per round by construction.
 * `denied` actions are counted separately and never as work: a refusal
 * never spends a step or the room's slot.
 */
export function toolUse(
  actions: Action[],
  msgs: Msg[],
  agents: string[],
): Record<string, unknown> {
  const spokeIn = new Set(msgs.map((m) => `${m.round}:${m.agentId}`));
  const perAgent = (id: string) => {
    const mine = actions.filter((a) => a.agentId === id);
    const ran = mine.filter((a) => !a.denied);
    const byTurn = new Map<number, number>();
    for (const a of ran) byTurn.set(a.round, (byTurn.get(a.round) ?? 0) + 1);
    const chains = [...byTurn.values()];
    const myMsgs = msgs.filter((m) => m.agentId === id);
    return {
      actions: ran.length,
      refused: mine.length - ran.length,
      byKind: Object.fromEntries(
        (['search', 'file', 'run', 'source', 'config'] as const)
          .map((k) => [k, ran.filter((a) => a.kind === k).length])
          .filter(([, n]) => (n as number) > 0),
      ),
      actingTurns: chains.length,
      multiStepTurns: chains.filter((n) => n > 1).length,
      maxChain: chains.length ? Math.max(...chains) : 0,
      meanActionsPerActingTurn: mean(chains),
      // The shape only the loop can produce: a turn spent entirely on work,
      // saying nothing to the room. Under turnSteps 1 this is a silent
      // single action; under the loop it is a whole chain nobody heard.
      silentWorkingTurns: [...byTurn.keys()].filter((r) => !spokeIn.has(`${r}:${id}`)).length,
      // SPOKEN turns only — a turn that acted and said nothing produces no
      // message to carry the count, and those are the expensive ones. Read
      // it with silentWorkingTurns and chainLengths, not as a bill.
      meanCallsPerSpokenTurn: mean(myMsgs.map((m) => m.calls ?? 1)),
    };
  };
  const ranAll = actions.filter((a) => !a.denied);
  const histogram: Record<string, number> = {};
  const byTurnAll = new Map<string, number>();
  for (const a of ranAll) {
    const k = `${a.round}:${a.agentId}`;
    byTurnAll.set(k, (byTurnAll.get(k) ?? 0) + 1);
  }
  for (const n of byTurnAll.values()) histogram[n] = (histogram[n] ?? 0) + 1;
  return {
    room: {
      actions: ranAll.length,
      refused: actions.length - ranAll.length,
      actingTurns: byTurnAll.size,
      // How many turns took 1, 2, 3 … actions — the axis in one line.
      chainLengths: histogram,
      // Native transport only: did the seats use the tool channel they were
      // given, or write a bracket anyway? Absent in sentinel rooms, where
      // there is no channel to fall back FROM.
      ...(ranAll.some((a) => a.via)
        ? {
            viaNative: ranAll.filter((a) => a.via === 'native').length,
            viaSentinel: ranAll.filter((a) => a.via === 'sentinel').length,
          }
        : {}),
    },
    byAgent: Object.fromEntries(agents.map((a) => [a, perAgent(a)])),
  };
}

// ── Task work (§9.8): who builds, who edits whom, whose lines survive ──────
//
// The question a TASK room asks that a conversation cannot: when nobody is
// assigned a role, does one emerge — and is it visible as FUNCTION rather
// than as style? Everything here is computed from the file events alone,
// which carry the full contents of every version, so authorship is
// recoverable long after the session.
//
// Line attribution rule: a line belongs to the agent whose version first
// introduced it (counting duplicates), and re-introducing a line that had
// been deleted re-attributes it to whoever brought it back. Blank lines are
// ignored. The headline number is `survivingLines` — how much of the FINAL
// artifact is each agent's — because surviving an hour of other models
// editing you is a stronger claim than having typed the most.
//
// Exploratory, like every other tool metric: out of the registered stats.

function textLines(content: string): string[] {
  return content.split('\n').map((l) => l.trim()).filter(Boolean);
}

function counted(lines: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
}

export function fileWork(actions: Action[], agents: string[]): Record<string, unknown> {
  const writes = actions.filter(
    (a): a is Action & { name: string; content: string } =>
      a.kind === 'file' && !a.denied && !a.binary && typeof a.name === 'string' && typeof a.content === 'string',
  );
  const zero = () => Object.fromEntries(agents.map((a) => [a, 0])) as Record<string, number>;
  const created = zero(), rewrote = zero(), rewroteSelf = zero(), rewroteOthers = zero();
  const deleted = zero(), deletedOthers = zero();
  const linesAdded = zero(), linesRemoved = zero(), surviving = zero();
  // Who removes whose work — "refactored[remover][author]". The territory
  // question in one table: an agent that only ever deletes its own lines is
  // tending a plot; one that deletes everyone's is editing the room.
  const refactored: Record<string, Record<string, number>> = Object.fromEntries(agents.map((a) => [a, {}]));
  const perFile: Record<string, unknown> = {};

  const byFile = new Map<string, typeof writes>();
  for (const w of writes) byFile.set(w.name, [...(byFile.get(w.name) ?? []), w]);

  for (const [name, versions] of byFile) {
    let prev: string[] = [];
    const origin = new Map<string, string>(); // line -> agent it came from
    for (let i = 0; i < versions.length; i++) {
      const v = versions[i];
      // A DELETION is the version that is empty. The event carries the old
      // contents (so the removal is legible in the transcript), but counting
      // those as written would make a deletion look like a rewrite that
      // changed nothing — every line it took away would go unattributed.
      const cur = v.deleted ? [] : textLines(v.content);
      const pc = counted(prev), cc = counted(cur);
      if (v.deleted) {
        deleted[v.agentId] = (deleted[v.agentId] ?? 0) + 1;
        // Whose file was it? The seat that last wrote it, which is the
        // claim a deletion actually makes.
        const owner = i > 0 ? versions[i - 1].agentId : v.agentId;
        if (owner !== v.agentId) deletedOthers[v.agentId] = (deletedOthers[v.agentId] ?? 0) + 1;
      } else if (i === 0) created[v.agentId] = (created[v.agentId] ?? 0) + 1;
      else {
        rewrote[v.agentId] = (rewrote[v.agentId] ?? 0) + 1;
        if (versions[i - 1].agentId === v.agentId) rewroteSelf[v.agentId] = (rewroteSelf[v.agentId] ?? 0) + 1;
        else rewroteOthers[v.agentId] = (rewroteOthers[v.agentId] ?? 0) + 1;
      }
      for (const [line, n] of cc) {
        const d = n - (pc.get(line) ?? 0);
        if (d <= 0) continue;
        linesAdded[v.agentId] = (linesAdded[v.agentId] ?? 0) + d;
        if (!origin.has(line)) origin.set(line, v.agentId);
      }
      for (const [line, n] of pc) {
        const d = n - (cc.get(line) ?? 0);
        if (d <= 0) continue;
        linesRemoved[v.agentId] = (linesRemoved[v.agentId] ?? 0) + d;
        const from = origin.get(line);
        // Deleting your own line is editing; deleting someone else's is the
        // thing this table exists to see. Both are counted, separately.
        if (from) refactored[v.agentId][from] = (refactored[v.agentId][from] ?? 0) + d;
        if (!cc.has(line)) origin.delete(line);
      }
      prev = cur;
    }
    // Whose lines are in the version that survived to the end.
    const final = counted(prev);
    const share = zero();
    for (const [line, n] of final) {
      const who = origin.get(line);
      if (!who) continue;
      share[who] = (share[who] ?? 0) + n;
      surviving[who] = (surviving[who] ?? 0) + n;
    }
    perFile[name] = {
      versions: versions.length,
      authors: [...new Set(versions.map((v) => v.agentId))],
      firstAuthor: versions[0].agentId,
      lastAuthor: versions[versions.length - 1].agentId,
      finalLines: prev.length,
      finalChars: versions[versions.length - 1].content.length,
      survivingLinesByAgent: share,
    };
  }

  const totalSurviving = Object.values(surviving).reduce((a, b) => a + b, 0);
  return {
    files: perFile,
    byAgent: Object.fromEntries(
      agents.map((a) => [a, {
        created: created[a], rewrote: rewrote[a],
        rewroteSelf: rewroteSelf[a], rewroteOthers: rewroteOthers[a],
        // §9.9: removals, and how many of them took out a file whose last
        // author was someone else. Only meaningful where the condition
        // allows deletion at all; zero everywhere else.
        deleted: deleted[a], deletedOthers: deletedOthers[a],
        linesAdded: linesAdded[a], linesRemoved: linesRemoved[a],
        survivingLines: surviving[a],
        // The share of the finished artifact that is this agent's. Null
        // when nothing survived at all (an empty or all-binary room).
        survivingShare: totalSurviving ? round4(surviving[a] / totalSurviving) : null,
        refactored: refactored[a],
      }]),
    ),
    room: {
      writes: writes.length,
      files: byFile.size,
      // Herfindahl over surviving-line shares: 1/n = the work is spread
      // evenly across n agents, 1 = one agent's artifact. The single
      // number for "did a role emerge".
      concentration: totalSurviving
        ? round4(Object.values(surviving).reduce((acc, v) => acc + (v / totalSurviving) ** 2, 0))
        : null,
    },
  };
}

/** §9.8 completion: the negotiation, as a record. `firstDoneRound` is when
 *  the room first had ANY agreement on the table; `resets` counts the times
 *  an edit took it back off. `ending` says whether the room or the clock
 *  finished the session — the axis's headline. */
export function completionRecord(s: Session): Record<string, unknown> {
  const byAgent = Object.fromEntries(
    s.agents.map((a) => [a.id, {
      // Movement only: a vote that CHANGED this seat's standing.
      raised: s.votes.filter((v) => v.agentId === a.id && v.kind === 'done').length,
      withdrew: s.votes.filter((v) => v.agentId === a.id && v.kind === 'undone').length,
      // Saying it again is its own signal — pressing a room that has not
      // converged is not the same as raising a hand for the first time.
      restated: s.votes.filter((v) => v.agentId === a.id && v.kind === 'restated').length,
      firstRaisedRound: s.votes.find((v) => v.agentId === a.id && v.kind === 'done')?.round ?? null,
    }]),
  );
  return {
    ending: s.ending ?? null,
    agreed: s.votes.some((v) => v.kind === 'agreed'),
    firstDoneRound: s.votes.find((v) => v.kind === 'done')?.round ?? null,
    resets: s.votes.filter((v) => v.kind === 'reset').length,
    withdrawals: s.votes.filter((v) => v.kind === 'undone').length,
    byAgent,
  };
}

export function countMentions(text: string, selfId: string, agents: { id: string; name: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of agents) {
    if (a.id === selfId) continue;
    const escaped = a.name.split(' ')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const n = count(text, new RegExp(`\\b${escaped}\\b`, 'g'));
    if (n) out[a.id] = n;
  }
  return out;
}

export function addressMatrix(msgs: Msg[], agents: { id: string; name: string }[]) {
  const out: Record<string, Record<string, number>> = {};
  for (const m of msgs) {
    for (const [target, n] of Object.entries(countMentions(m.text, m.agentId, agents))) {
      out[m.agentId] = out[m.agentId] ?? {};
      out[m.agentId][target] = (out[m.agentId][target] ?? 0) + n;
    }
  }
  return out;
}

/** Cross-channel social orientation (Corina 2026-08-26): how often an agent
 *  refers to the others in each channel, normalized per 1k words because
 *  channel volumes differ wildly. Interpretation note baked in: chat
 *  mentions are mostly VOCATIVE (talking to), thinking/journal mentions are
 *  REFERENTIAL (thinking about) — the contrast is the point. */
export function mentionsByChannel(
  agents: { id: string; name: string }[],
  channels: Record<'chat' | 'thinking' | 'journal', Map<string, string[]>>,
) {
  const per = (agentId: string, texts: string[]) => {
    const all = texts.join(' ');
    const w = words(all).length;
    const targets = countMentions(all, agentId, agents);
    const total = Object.values(targets).reduce((a, b) => a + b, 0);
    return texts.length ? { mentions: total, per1kWords: w ? round2((total / w) * 1000) : 0, words: w, targets } : null;
  };
  const given = agents.map((a) => ({
    agentId: a.id,
    chat: per(a.id, channels.chat.get(a.id) ?? []),
    thinking: per(a.id, channels.thinking.get(a.id) ?? []),
    journal: per(a.id, channels.journal.get(a.id) ?? []),
  }));
  // Attention RECEIVED: who the room talks/thinks/journals ABOUT — total
  // mentions of each target per channel, and how many DISTINCT speakers
  // mentioned them (6 mentions from one obsessive ≠ 6 from six agents).
  const received = agents.map((t) => {
    const perChannel = (ch: 'chat' | 'thinking' | 'journal') => {
      let mentions = 0;
      const speakers = new Set<string>();
      for (const s of agents) {
        if (s.id === t.id) continue;
        const n = countMentions((channels[ch].get(s.id) ?? []).join(' '), s.id, agents)[t.id] ?? 0;
        if (n) { mentions += n; speakers.add(s.id); }
      }
      return { mentions, bySpeakers: speakers.size };
    };
    return { agentId: t.id, chat: perChannel('chat'), thinking: perChannel('thinking'), journal: perChannel('journal') };
  });
  return { given, received };
}

// ── Per-session analysis ───────────────────────────────────────────────────

export async function analyzeSession(dir: string) {
  const s = loadSession(dir);
  const win = windowsOf(s.maxRound);

  const clip = (t: string) => t.split(/\s+/).slice(0, CLIP_WORDS).join(' ');
  const texts = [
    ...s.msgs.map((m) => m.text),
    ...s.journals.map((j) => j.text),
    ...s.msgs.filter((m) => m.thinking).map((m) => m.thinking as string),
    ...s.msgs.map((m) => clip(m.text)),
  ];
  const vecs = await embedAll(texts, join(dir, 'embeddings-cache.json'));
  let k = 0;
  const ems: EmbeddedMsg[] = s.msgs.map((m) => ({ ...m, vec: vecs[k++] }));
  const jvecs = s.journals.map(() => vecs[k++]);
  for (const m of ems) if (m.thinking) m.thinkVec = vecs[k++];
  const emsClipped: EmbeddedMsg[] = s.msgs.map((m) => ({ ...m, vec: vecs[k++] }));

  const agents = s.agents.map((a) => a.id);
  const intraEarly = meanIntra(ems, win.early), intraLate = meanIntra(ems, win.late);
  const interEarly = meanInter(ems, win.early), interLate = meanInter(ems, win.late);
  const gap =
    interLate !== null && intraLate !== null && interEarly !== null && intraEarly !== null
      ? round4(interLate - intraLate - (interEarly - intraEarly))
      : null;

  // §2.3 journal metrics
  const turnsPerAgent = new Map<string, number>();
  for (const m of s.msgs) turnsPerAgent.set(m.agentId, (turnsPerAgent.get(m.agentId) ?? 0) + 1);
  for (const j of s.journals) turnsPerAgent.set(j.agentId, (turnsPerAgent.get(j.agentId) ?? 0) + 1);
  const journalStats = agents.map((a) => {
    const js = s.journals.filter((j) => j.agentId === a);
    const chatCent = centroid(ems.filter((m) => m.agentId === a && !m.truncated).map((m) => m.vec));
    const jCent = centroid(js.map((j) => jvecs[s.journals.indexOf(j)]));
    return {
      agentId: a,
      entries: js.length,
      rate: round4(js.length / Math.max(1, turnsPerAgent.get(a) ?? 0)),
      journalVsChat: chatCent && jCent ? round4(cosine(jCent, chatCent)) : null,
    };
  });

  // §2.5 three-channel intra comparison — point estimates WITH bootstrap
  // 95% CIs (resample each channel's texts; a centroid from 5 journal
  // entries is a noisy object and the CI says how noisy).
  const bootRng = mulberry32(0x62303074); // 'b00t'
  const threeChannel = agents.map((a) => {
    const chatVecs = ems.filter((m) => m.agentId === a && !m.truncated).map((m) => m.vec);
    const thinkVecs = ems.filter((m) => m.agentId === a && m.thinkVec).map((m) => m.thinkVec!);
    const js = s.journals.filter((j) => j.agentId === a);
    const jVecs = js.map((j) => jvecs[s.journals.indexOf(j)]);
    const chat = centroid(chatVecs), think = centroid(thinkVecs), jc = centroid(jVecs);
    // matched turns: chat vs its own same-turn trace
    const matched = ems.filter((m) => m.agentId === a && m.thinkVec && !m.truncated)
      .map((m) => cosine(m.vec, m.thinkVec!));
    return {
      agentId: a,
      chatVsThinking: chat && think ? round4(cosine(chat, think)) : null,
      chatVsThinkingCI: centroidCosineCI(chatVecs, thinkVecs, bootRng),
      chatVsThinkingMatched: mean(matched),
      chatVsJournal: chat && jc ? round4(cosine(chat, jc)) : null,
      chatVsJournalCI: centroidCosineCI(chatVecs, jVecs, bootRng),
      thinkingVsJournal: think && jc ? round4(cosine(think, jc)) : null,
      thinkingVsJournalCI: centroidCosineCI(thinkVecs, jVecs, bootRng),
      traceTurns: matched.length,
    };
  });

  const report = {
    sessionId: s.id,
    condition: s.condition.name,
    adminTouched: s.adminTouched,
    rounds: s.maxRound,
    windows: win,
    counts: {
      messages: s.msgs.length,
      truncated: s.msgs.filter((m) => m.truncated).length,
      journals: s.journals.length,
      silences: s.silences.length,
      passes: s.silences.filter((x) => x.kind === 'chosen').length,
    },
    convergence: {
      intraEarly: round4n(intraEarly), intraLate: round4n(intraLate),
      interEarly: round4n(interEarly), interLate: round4n(interLate),
      gap,
      null: permutationNull(ems, win, gap),
      pairwiseLate: pairwiseLate(ems, win.late, agents),
      // §6.1 length confound, made visible: longer texts regress toward
      // the topic centroid, so similarity rising alongside rising length
      // is suspect. Read these two before reading the gap.
      meanWordsEarly: mean(ems.filter((m) => inWin(m.round, win.early) && !m.truncated).map((m) => words(m.text).length)),
      meanWordsLate: mean(ems.filter((m) => inWin(m.round, win.late) && !m.truncated).map((m) => words(m.text).length)),
      // Length CONTROLLED (not just noted): the same gap over embeddings of
      // messages clipped to their first CLIP_WORDS words. Clipped ≈ raw ⇒
      // length isn't driving the gap; divergence ⇒ it was.
      lengthControlled: {
        clipWords: CLIP_WORDS,
        intraEarly: round4n(meanIntra(emsClipped, win.early)),
        intraLate: round4n(meanIntra(emsClipped, win.late)),
        interEarly: round4n(meanInter(emsClipped, win.early)),
        interLate: round4n(meanInter(emsClipped, win.late)),
        gap: round4n(gapOf(emsClipped, win)),
        null: permutationNull(emsClipped, win, gapOf(emsClipped, win)),
      },
    },
    styleByAgent: Object.fromEntries(agents.map((a) => {
      const mine = s.msgs.filter((m) => m.agentId === a && !m.truncated);
      // §2.6 own-token confidence: mean chosen-token logprob, all rounds
      // vs. late window. Rising = the agent's own distribution sharpening
      // ("style entrenchment"); null on seats whose provider returns none.
      const lp = (ms: Msg[]) => mean(ms.flatMap((m) => m.logprobs ?? []));
      return [a, {
        ...styleOf(mine.map((m) => m.text)),
        truncated: s.msgs.filter((m) => m.agentId === a && m.truncated).length,
        retentionDrift: styleRetention(s.msgs, a, win.late),
        meanLatencySec: round2(mean(s.latencies.get(a) ?? []) ?? 0),
        silences: s.silences.filter((x) => x.agentId === a).length,
        // The turn-taking signal: how often this seat was offered the floor
        // and declined it, as against turns it lost to an empty completion
        // or a failed call.
        passes: s.silences.filter((x) => x.agentId === a && x.kind === 'chosen').length,
        meanTokenLogprob: lp(mine),
        meanTokenLogprobLate: lp(mine.filter((m) => inWin(m.round, win.late))),
        // What a turn spends on thinking, per seat (2026-08-27). Read it
        // beside `truncated`: before the visible budget got its own room,
        // these two numbers were competing for the same cap.
        meanReasoningTokens: mean(s.msgs.filter((m) => m.agentId === a && m.reasoningTokens !== undefined).map((m) => m.reasoningTokens!)),
      }];
    })),
    mimicry: mimicry(s.msgs),
    // Present only in sessions that used tools — every pre-F4½ session's
    // metrics.json keeps its exact shape.
    ...(s.actions.length ? { toolUse: toolUse(s.actions, s.msgs, agents) } : {}),
    // §9.8, both present only where they mean something: a room that wrote
    // no files and a room with no completion rule keep their old shape.
    ...(s.actions.some((a) => a.kind === 'file' && !a.denied) ? { fileWork: fileWork(s.actions, agents) } : {}),
    ...(s.votes.length || s.ending ? { completion: completionRecord(s) } : {}),
    journals: journalStats,
    threeChannel,
    address: addressMatrix(s.msgs, s.agents),
    mentions: mentionsByChannel(s.agents, {
      chat: groupTexts(s.msgs.map((m) => [m.agentId, m.text])),
      thinking: groupTexts([
        ...s.msgs.filter((m) => m.thinking).map((m) => [m.agentId, m.thinking!] as [string, string]),
        ...s.journals.filter((j) => (j as JournalEntry & { thinking?: string }).thinking)
          .map((j) => [j.agentId, (j as JournalEntry & { thinking?: string }).thinking!] as [string, string]),
      ]),
      journal: groupTexts(s.journals.map((j) => [j.agentId, j.text])),
    }),
  };

  writeFileSync(join(dir, 'metrics.json'), JSON.stringify(report, null, 2));
  return { report, ems, win };
}

// ── Cross-session baseline (§2.1, load-bearing per §6.1) ───────────────────

export function crossSessionBaseline(sessions: { ems: EmbeddedMsg[]; win: Windows }[]): { early: number | null; late: number | null } {
  const sims = { early: [] as number[], late: [] as number[] };
  for (const w of ['early', 'late'] as const) {
    for (let i = 0; i < sessions.length; i++)
      for (let j = i + 1; j < sessions.length; j++) {
        const a = sessions[i], b = sessions[j];
        for (const m of a.ems) {
          if (!inWin(m.round, a.win[w]) || m.truncated) continue;
          const peers = b.ems.filter((x) => Math.abs(x.round - m.round) <= 1 && !x.truncated);
          const c = centroid(peers.map((x) => x.vec));
          if (c) sims[w].push(cosine(m.vec, c));
        }
      }
  }
  return { early: mean(sims.early), late: mean(sims.late) };
}

// ── Batch report ───────────────────────────────────────────────────────────

interface Manifest { name: string; sessions: { id: string; condition: string }[] }

async function analyzeBatch(manifestPath: string) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const results = [];
  for (const entry of manifest.sessions) {
    const dir = join(import.meta.dirname, '..', 'sessions', entry.id);
    console.error(`analyzing ${entry.id} (${entry.condition})…`);
    results.push(await analyzeSession(dir));
  }
  const baseline = crossSessionBaseline(results);

  const lines = [
    `# batch ${manifest.name} — analysis`,
    '',
    `${results.length} sessions · cross-session baseline (inter, agents who never met):`,
    `early ${fmt(baseline.early)} · late ${fmt(baseline.late)}`,
    '',
    '| session | condition | rounds | msgs (trunc) | journals | gap | null 95% | p | interLate | vs baseline |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const { report } of results) {
    const c = report.convergence;
    const beat = c.interLate !== null && baseline.late !== null ? fmt(c.interLate - baseline.late) : '—';
    const nullBand = c.null ? `[${c.null.lo95}, ${c.null.hi95}]` : '—';
    lines.push(
      `| ${report.sessionId} | ${report.condition}${report.adminTouched ? ' ⚠dirty' : ''} | ${report.rounds}` +
      ` | ${report.counts.messages} (${report.counts.truncated}) | ${report.counts.journals}` +
      ` | ${fmt(c.gap)} | ${nullBand} | ${c.null ? c.null.p : '—'} | ${fmt(c.interLate)} | ${beat} |`,
    );
  }
  lines.push('', 'gap = (interLate − intraLate) − (interEarly − intraEarly). Positive = the room moved toward one voice beyond what the shared prompt induces. "vs baseline" > 0 means within-session convergence beats agents who never met (the genre control). Per-agent details: each session\'s metrics.json.');
  const reportPath = manifestPath.replace(/\.json$/, '.report.md');
  writeFileSync(reportPath, lines.join('\n') + '\n');
  const summary = { name: manifest.name, baseline, sessions: results.map((r) => ({ id: r.report.sessionId, gap: r.report.convergence.gap })) };
  writeFileSync(manifestPath.replace(/\.json$/, '.metrics.json'), JSON.stringify(summary, null, 2));
  console.log(`Report: ${reportPath}`);
}

// ── Helpers & CLI ──────────────────────────────────────────────────────────

function mean(xs: number[]): number | null { return xs.length ? round4(xs.reduce((a, b) => a + b, 0) / xs.length) : null; }
function groupTexts(pairs: [string, string][]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const [id, t] of pairs) (m.get(id) ?? m.set(id, []).get(id)!).push(t);
  return m;
}
function count(s: string, re: RegExp): number { return (s.match(re) ?? []).length; }
const round2 = (x: number) => Math.round(x * 100) / 100;
const round4 = (x: number) => Math.round(x * 10000) / 10000;
const round4n = (x: number | null) => (x === null ? null : round4(x));
const fmt = (x: number | null) => (x === null ? '—' : x.toFixed(4));

// CLI only when invoked directly — tests import this module without running it.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('usage: npm run analyze -- sessions/<id> […]  |  --batch batches/<name>.json');
    process.exit(1);
  }
  if (args[0] === '--batch') {
    await analyzeBatch(args[1]);
  } else {
    for (const dir of args) {
      console.error(`analyzing ${dir}…`);
      const { report } = await analyzeSession(dir);
      console.log(JSON.stringify({
        sessionId: report.sessionId, gap: report.convergence.gap,
        interLate: report.convergence.interLate, intraLate: report.convergence.intraLate,
        metrics: join(dir, 'metrics.json'),
      }, null, 2));
    }
  }
}
