// Content-blind style instruments (§2.2, added 2026-09-16).
//
// The embedding gap in analyze.ts runs on a retrieval embedding, which
// encodes what a message is ABOUT far more than how it is said; two agents
// on the same topic look alike whatever their voices do. This module
// measures voice with features that cannot see topic: function-word and
// punctuation rates plus a few shape scalars. A softmax-regression
// authorship classifier is trained on the early window and tested on the
// late one — accuracy falling toward chance means the room's voices
// merged. Same round-shuffle null as the embedding gap, so the number
// comes with a band. Prototyped in Python across 33 hosted sessions
// (2026-09-16): late accuracy ~0.55 against chance ~0.19, i.e. voices stay
// distinct on this layer even where the room shares a lexicon.

/** A compact English function-word list. Not a validated stylometric
 *  lexicon; the point is that nothing on it carries topic. */
export const FUNCTION_WORDS = `a an the and or but if while of at by for with about against between into
through during before after above below to from up down in out on off over under again further
then once here there when where why how all any both each few more most other some such no nor
not only own same so than too very s t can will just don should now i me my myself we our ours
ourselves you your yours yourself yourselves he him his himself she her hers herself it its itself
they them their theirs themselves what which who whom this that these those am is are was were be
been being have has had having do does did doing would could might must shall may ought also
because as until although though whether either neither yet still even ever never always often
sometimes rather quite really actually perhaps maybe indeed however therefore thus hence
anyway besides meanwhile otherwise instead already almost around away back much many less
something anything nothing everything someone anyone everyone nobody like well okay yes yeah
ok right sure honestly literally basically exactly kind sort bit lot`.split(/\s+/);
const FW_INDEX = new Map(FUNCTION_WORDS.map((w, i) => [w, i]));
const PUNCT = ['?', '!', '.', ',', ';', ':', '—', '–', '-', '(', ')', '"', "'", '*', '...'];

const WORD_RE = /[a-z’'-]+/g;
const words = (t: string) => t.toLowerCase().match(WORD_RE) ?? [];
/** A word that can carry topic: not a function word, four letters or more. */
export const isContentWord = (w: string) => !FW_INDEX.has(w) && w.length >= 4;

export const MIN_WORDS = 15;       // shorter messages have no style distribution to speak of
export const MIN_MSGS_PER_WINDOW = 3;

/** Function-word rates, punctuation rates and shape scalars for one text. */
export function styleFeatures(text: string): number[] {
  const ws = words(text);
  const n = Math.max(ws.length, 1);
  const fw = new Array(FUNCTION_WORDS.length).fill(0);
  for (const w of ws) { const i = FW_INDEX.get(w); if (i !== undefined) fw[i]++; }
  const fwTotal = fw.reduce((a, b) => a + b, 0);
  const pu = PUNCT.map((p) => text.split(p).length - 1);
  const sents = text.split(/[.!?]+/).filter((s) => s.trim()).length || 1;
  return [
    ...fw.map((c) => c / n),
    ...pu.map((c) => c / n),
    ws.length,
    n / sents,
    ws.length ? ws.reduce((a, w) => a + w.length, 0) / ws.length : 0,
    new Set(ws).size / n,
    fwTotal / n,
    (text.split('\n').length - 1) / n * 100,
  ];
}

// ── Softmax regression (L2, full-batch gradient descent) ─────────────────
// Small enough to own: a few dozen training rows, ~160 features. Features
// are standardized on the TRAINING rows only; zero-variance columns are
// left at zero rather than blown up.

interface Model { mu: Float64Array; sd: Float64Array; W: Float64Array; b: Float64Array; classes: string[]; d: number }

const ITERS = 200, LR = 0.1, L2 = 1;

function fit(X: number[][], y: string[]): Model {
  const classes = [...new Set(y)].sort();
  const d = X[0].length, n = X.length, k = classes.length;
  const mu = new Float64Array(d), sd = new Float64Array(d);
  for (const row of X) for (let j = 0; j < d; j++) mu[j] += row[j] / n;
  for (const row of X) for (let j = 0; j < d; j++) sd[j] += (row[j] - mu[j]) ** 2 / n;
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]);
  const Z = new Float64Array(n * d);
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) Z[i * d + j] = sd[j] > 0 ? (X[i][j] - mu[j]) / sd[j] : 0;
  const yi = y.map((c) => classes.indexOf(c));
  const W = new Float64Array(k * d), b = new Float64Array(k);
  const gW = new Float64Array(k * d), gb = new Float64Array(k), p = new Float64Array(k);
  for (let it = 0; it < ITERS; it++) {
    gW.fill(0); gb.fill(0);
    for (let i = 0; i < n; i++) {
      softmax(Z, i * d, W, b, d, k, p);
      for (let c = 0; c < k; c++) {
        const e = (p[c] - (yi[i] === c ? 1 : 0)) / n;
        gb[c] += e;
        const zo = i * d, wo = c * d;
        for (let j = 0; j < d; j++) gW[wo + j] += e * Z[zo + j];
      }
    }
    for (let c = 0; c < k; c++) {
      b[c] -= LR * gb[c];
      const wo = c * d;
      for (let j = 0; j < d; j++) W[wo + j] -= LR * (gW[wo + j] + (L2 / n) * W[wo + j]);
    }
  }
  return { mu, sd, W, b, classes, d };
}

/** Class probabilities for the row of Z starting at `zo`, written into `out`. */
function softmax(Z: Float64Array, zo: number, W: Float64Array, b: Float64Array, d: number, k: number, out: Float64Array) {
  let m = -Infinity;
  for (let c = 0; c < k; c++) {
    let l = b[c]; const wo = c * d;
    for (let j = 0; j < d; j++) l += W[wo + j] * Z[zo + j];
    out[c] = l; if (l > m) m = l;
  }
  let s = 0;
  for (let c = 0; c < k; c++) { out[c] = Math.exp(out[c] - m); s += out[c]; }
  for (let c = 0; c < k; c++) out[c] /= s;
}

function predict(model: Model, x: number[]): string {
  const { d, sd, mu } = model;
  const z = new Float64Array(d);
  for (let j = 0; j < d; j++) z[j] = sd[j] > 0 ? (x[j] - mu[j]) / sd[j] : 0;
  const p = new Float64Array(model.classes.length);
  softmax(z, 0, model.W, model.b, d, model.classes.length, p);
  let best = 0;
  for (let c = 1; c < p.length; c++) if (p[c] > p[best]) best = c;
  return model.classes[best];
}

// ── The probe ─────────────────────────────────────────────────────────────

export interface StyleMsg { round: number; agentId: string; text: string; truncated: boolean }
type Win = [number, number];
const inWin = (r: number, [a, b]: Win) => r >= a && r <= b;

/** Train early, test late. Returns null when fewer than 3 agents have
 *  MIN_MSGS_PER_WINDOW usable messages in both windows. `rounds` lets the
 *  permutation null re-run the same split under shuffled round labels
 *  without re-featurizing. */
export function earlyLateAccuracy(
  feats: number[][], agentIds: string[], rounds: number[], early: Win, late: Win, agents: string[],
): { accuracy: number; perAgent: Record<string, number>; nEarly: number; nLate: number } | null {
  const tr: number[] = [], te: number[] = [];
  rounds.forEach((r, i) => { if (inWin(r, early)) tr.push(i); else if (inWin(r, late)) te.push(i); });
  if (new Set(tr.map((i) => agentIds[i])).size < 2 || !te.length) return null;
  const model = fit(tr.map((i) => feats[i]), tr.map((i) => agentIds[i]));
  let hits = 0;
  const per: Record<string, { n: number; hit: number }> = Object.fromEntries(agents.map((a) => [a, { n: 0, hit: 0 }]));
  for (const i of te) {
    const ok = predict(model, feats[i]) === agentIds[i];
    hits += ok ? 1 : 0;
    per[agentIds[i]].n++; if (ok) per[agentIds[i]].hit++;
  }
  return {
    accuracy: hits / te.length,
    perAgent: Object.fromEntries(agents.filter((a) => per[a].n).map((a) => [a, per[a].hit / per[a].n])),
    nEarly: tr.length, nLate: te.length,
  };
}

/** Which messages and agents the probe may use (§6.1 filters + floors). */
export function eligible(msgs: StyleMsg[], early: Win, late: Win) {
  const usable = msgs.filter((m) => !m.truncated && words(m.text).length >= MIN_WORDS);
  const cnt = (win: Win) => {
    const c = new Map<string, number>();
    for (const m of usable) if (inWin(m.round, win)) c.set(m.agentId, (c.get(m.agentId) ?? 0) + 1);
    return c;
  };
  const ce = cnt(early), cl = cnt(late);
  const agents = [...new Set(usable.map((m) => m.agentId))]
    .filter((a) => (ce.get(a) ?? 0) >= MIN_MSGS_PER_WINDOW && (cl.get(a) ?? 0) >= MIN_MSGS_PER_WINDOW)
    .sort();
  return { msgs: usable.filter((m) => agents.includes(m.agentId)), agents };
}
