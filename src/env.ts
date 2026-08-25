// Loads .env from the project root into process.env (existing vars win).
// Imported for its side effect at the top of loop.ts and runner.ts — no
// dotenv dependency needed for a file this simple.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

try {
  const raw = readFileSync(join(import.meta.dirname, '..', '.env'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const [, key, valueRaw] = m;
    const value = valueRaw.replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {
  // no .env — env vars come from the shell/host, which is fine
}
