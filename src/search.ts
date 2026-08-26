// F4 websearch backend (§3.4b). One entry point, two implementations:
//
//  - ROOM_STUB=1: deterministic fake results (query echoed in each line so
//    the privacy tests can grep for leakage into other agents' context).
//  - Live: OpenRouter's `web` plugin on a cheap model — reuses the runner's
//    one OPENROUTER_API_KEY (no new secret to rotate) and returns the
//    plugin's url_citation annotations as a numbered result list. The
//    model's own prose is the fallback only when no annotations arrive.
//
// The return value is a plain text block handed PRIVATELY to the requesting
// agent on their next turn (session.ts). It never enters anyone else's
// context — journal-class rule, enforced by tests/privacy.test.ts.

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Cheap, fast seat for the web plugin; never a roster model (the searcher
 *  must not be a voice in the room — same non-roster rule as the judge). */
export const SEARCH_MODEL = process.env.ROOM_SEARCH_MODEL || 'google/gemini-2.5-flash';

interface Annotation {
  type?: string;
  url_citation?: { url?: string; title?: string; content?: string };
}

export async function webSearch(query: string, maxResults: number): Promise<string> {
  if (process.env.ROOM_STUB === '1') {
    return Array.from({ length: Math.min(3, maxResults) }, (_, i) =>
      `${i + 1}. Stub result ${i + 1} for "${query}" — https://example.org/${i + 1}\n   A deterministic snippet about ${query}.`,
    ).join('\n');
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('Set OPENROUTER_API_KEY in the environment.');
  const body = {
    model: SEARCH_MODEL,
    messages: [{ role: 'user', content: query }],
    plugins: [{ id: 'web', max_results: maxResults }],
    max_tokens: 800,
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'the-room' },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null; annotations?: Annotation[] } }[];
    };
    const msg = data.choices?.[0]?.message;
    const cites = (msg?.annotations ?? [])
      .filter((a) => a.type === 'url_citation' && a.url_citation?.url)
      .slice(0, maxResults);
    if (cites.length) {
      return cites
        .map((a, i) => {
          const c = a.url_citation!;
          const snippet = (c.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
          return `${i + 1}. ${c.title ?? c.url} — ${c.url}${snippet ? `\n   ${snippet}` : ''}`;
        })
        .join('\n');
    }
    const text = msg?.content?.trim();
    if (text) return text;
    throw new Error('search returned no results');
  }
  throw new Error('search: retries exhausted');
}
