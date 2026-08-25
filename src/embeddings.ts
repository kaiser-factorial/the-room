// Embedding client for analysis (D5: google/gemini-embedding-2, permanently).
// Batched OpenRouter calls with a per-session on-disk cache so re-running
// analyze.ts never re-bills unchanged text. ROOM_STUB=1 returns deterministic
// pseudo-embeddings (char-trigram hashing) so the whole pipeline dry-runs free.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const EMBEDDING_MODEL = 'google/gemini-embedding-2';
const API_URL = 'https://openrouter.ai/api/v1/embeddings';
const BATCH = 64;
const STUB_DIM = 256;

export type Vec = number[];

export function cosine(a: Vec, b: Vec): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export function centroid(vs: Vec[]): Vec | null {
  if (!vs.length) return null;
  const c = new Array(vs[0].length).fill(0);
  for (const v of vs) for (let i = 0; i < c.length; i++) c[i] += v[i];
  return c.map((x) => x / vs.length);
}

function keyOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 24);
}

// Deterministic stand-in: hashed character trigrams. Similar texts get
// similar vectors (shared trigrams), which is enough to exercise every
// metric downstream without a network call.
function stubEmbed(text: string): Vec {
  const v = new Array(STUB_DIM).fill(0);
  const s = text.toLowerCase();
  for (let i = 0; i < s.length - 2; i++) {
    const h = createHash('md5').update(s.slice(i, i + 3)).digest();
    v[h.readUInt16BE(0) % STUB_DIM] += h[2] >= 128 ? 1 : -1;
  }
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

/** Embed texts, using (and updating) a JSON cache file keyed by text hash. */
export async function embedAll(texts: string[], cachePath: string): Promise<Vec[]> {
  const cache: Record<string, Vec> = existsSync(cachePath)
    ? (JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, Vec>)
    : {};
  const missing = [...new Set(texts.filter((t) => !cache[keyOf(t)]))];

  if (missing.length && process.env.ROOM_STUB === '1') {
    for (const t of missing) cache[keyOf(t)] = stubEmbed(t);
  } else if (missing.length) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('Set OPENROUTER_API_KEY (or ROOM_STUB=1) to embed.');
    for (let i = 0; i < missing.length; i += BATCH) {
      const chunk = missing.slice(i, i + BATCH);
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'the-room' },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: chunk }),
      });
      if (!res.ok) throw new Error(`OpenRouter embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      for (const d of data.data) cache[keyOf(chunk[d.index])] = d.embedding;
      console.error(`  embedded ${Math.min(i + BATCH, missing.length)}/${missing.length}`);
    }
  }
  if (missing.length) writeFileSync(cachePath, JSON.stringify(cache));
  return texts.map((t) => cache[keyOf(t)]);
}
