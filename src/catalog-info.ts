// Emit catalog.json for the viewer's admin panel: every seat a room can
// hold, grouped by family, so the seat picker can offer the whole catalog
// rather than only the roster. Situation and seats are two axes — `site`
// with Haiku 3 and Fable 5.1 is a click, not a ninth condition file — and
// the runner already resolves any catalog id passed as `agentIds`
// (conditions.ts), so this is the viewer half of a change the runner does
// not need. Run at deploy time by deploy/deploy.sh:
//   tsx src/catalog-info.ts > out

import { pathToFileURL } from 'node:url';
import { CATALOG } from './catalog.js';

export interface CatalogEntry {
  id: string;
  name: string;
  color: string;
  model: string;
  /** Display family — the vendor line, vendor-free like the names. */
  family: string;
}

/** Families in the order the picker shows them: the roster's order. */
export const FAMILY_ORDER = ['Claude', 'Gemini', 'Qwen', 'Grok', 'DeepSeek', 'Seed'];

export function familyOf(model: string): string {
  if (model.startsWith('anthropic/')) return 'Claude';
  if (model.startsWith('google/gemini')) return 'Gemini';
  if (model.startsWith('qwen/')) return 'Qwen';
  if (model.startsWith('x-ai/')) return 'Grok';
  if (model.startsWith('deepseek/')) return 'DeepSeek';
  if (model.startsWith('bytedance-seed/')) return 'Seed';
  return 'Other';
}

export function catalogEntries(): CatalogEntry[] {
  const rank = (f: string) => { const i = FAMILY_ORDER.indexOf(f); return i < 0 ? FAMILY_ORDER.length : i; };
  return CATALOG
    .map(({ id, name, color, model }) => ({ id, name, color, model, family: familyOf(model) }))
    // Within a family, names sort numerically ("Opus 4.1" before "Opus 4.5"
    // before "Opus 5"), which reads as a timeline per tier.
    .sort((a, b) => rank(a.family) - rank(b.family) || a.name.localeCompare(b.name, 'en', { numeric: true }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(catalogEntries(), null, 2));
}
