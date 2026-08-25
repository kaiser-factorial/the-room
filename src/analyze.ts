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
}
interface JournalEntry { round: number; agentId: string; text: string }

interface Session {
  id: string; dir: string;
  condition: Record<string, unknown>;
  agents: { id: string; name: string }[];
  msgs: Msg[];                 // admin-dirty tail already dropped
  journals: JournalEntry[];
  silences: { round: number; agentId?: string }[];
  latencies: Map<string, number[]>;  // agentId -> seconds per turn (network-contaminated; §6.1)
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
  const silences: Session['silences'] = [];
  const latencies = new Map<string, number[]>();
  let prevTs: number | null = null;
  for (const e of clean) {
    if (e.kind === 'message' && e.agentId !== 'admin') {
      msgs.push({
        round: e.round, ts: e.ts, agentId: e.agentId, agentName: e.agentName, text: e.text,
        truncated: e.telemetry?.finishReason === 'length', thinking: e.thinking,
        logprobs: e.telemetry?.logprobs,
      });
      if (prevTs !== null) {
        const arr = latencies.get(e.agentId) ?? [];
        arr.push((new Date(e.ts).getTime() - prevTs) / 1000);
        latencies.set(e.agentId, arr);
      }
    } else if (e.kind === 'system' && /could not speak|said nothing/.test(e.text)) {
      silences.push({ round: e.round, agentId: e.agentId });
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
    msgs, journals, silences, latencies,
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

export function addressMatrix(msgs: Msg[], agents: { id: string; name: string }[]) {
  const out: Record<string, Record<string, number>> = {};
  for (const m of msgs) {
    for (const a of agents) {
      if (a.id === m.agentId) continue;
      // Match on the name's first word: agents shorten versioned names in
      // address ("Gemini", not "Gemini 3.7"), and first words are unique
      // across the roster.
      const short = a.name.split(' ')[0];
      const escaped = short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const n = count(m.text, new RegExp(`\\b${escaped}\\b`, 'g'));
      if (n) {
        out[m.agentId] = out[m.agentId] ?? {};
        out[m.agentId][a.id] = (out[m.agentId][a.id] ?? 0) + n;
      }
    }
  }
  return out;
}

// ── Per-session analysis ───────────────────────────────────────────────────

export async function analyzeSession(dir: string) {
  const s = loadSession(dir);
  const win = windowsOf(s.maxRound);

  const texts = [
    ...s.msgs.map((m) => m.text),
    ...s.journals.map((j) => j.text),
    ...s.msgs.filter((m) => m.thinking).map((m) => m.thinking as string),
  ];
  const vecs = await embedAll(texts, join(dir, 'embeddings-cache.json'));
  let k = 0;
  const ems: EmbeddedMsg[] = s.msgs.map((m) => ({ ...m, vec: vecs[k++] }));
  const jvecs = s.journals.map(() => vecs[k++]);
  for (const m of ems) if (m.thinking) m.thinkVec = vecs[k++];

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

  // §2.5 three-channel intra comparison
  const threeChannel = agents.map((a) => {
    const chat = centroid(ems.filter((m) => m.agentId === a && !m.truncated).map((m) => m.vec));
    const think = centroid(ems.filter((m) => m.agentId === a && m.thinkVec).map((m) => m.thinkVec!));
    const js = s.journals.filter((j) => j.agentId === a);
    const jc = centroid(js.map((j) => jvecs[s.journals.indexOf(j)]));
    // matched turns: chat vs its own same-turn trace
    const matched = ems.filter((m) => m.agentId === a && m.thinkVec && !m.truncated)
      .map((m) => cosine(m.vec, m.thinkVec!));
    return {
      agentId: a,
      chatVsThinking: chat && think ? round4(cosine(chat, think)) : null,
      chatVsThinkingMatched: mean(matched),
      chatVsJournal: chat && jc ? round4(cosine(chat, jc)) : null,
      thinkingVsJournal: think && jc ? round4(cosine(think, jc)) : null,
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
    },
    convergence: {
      intraEarly: round4n(intraEarly), intraLate: round4n(intraLate),
      interEarly: round4n(interEarly), interLate: round4n(interLate),
      gap,
      pairwiseLate: pairwiseLate(ems, win.late, agents),
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
        meanTokenLogprob: lp(mine),
        meanTokenLogprobLate: lp(mine.filter((m) => inWin(m.round, win.late))),
      }];
    })),
    mimicry: mimicry(s.msgs),
    journals: journalStats,
    threeChannel,
    address: addressMatrix(s.msgs, s.agents),
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
    '| session | condition | rounds | msgs (trunc) | journals | gap | interLate | vs baseline |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const { report } of results) {
    const c = report.convergence;
    const beat = c.interLate !== null && baseline.late !== null ? fmt(c.interLate - baseline.late) : '—';
    lines.push(
      `| ${report.sessionId} | ${report.condition}${report.adminTouched ? ' ⚠dirty' : ''} | ${report.rounds}` +
      ` | ${report.counts.messages} (${report.counts.truncated}) | ${report.counts.journals}` +
      ` | ${fmt(c.gap)} | ${fmt(c.interLate)} | ${beat} |`,
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
