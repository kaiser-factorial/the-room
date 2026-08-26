import { openrouterAdapter, type Adapter } from './openrouter.js';
import { xaiAdapter } from './xai.js';
import type { AgentConfig } from './types.js';

/** Per-seat adapter dispatch. The summarizer and the search backend stay on
 *  OpenRouter regardless — only room seats ride per-harness adapters. */
export function adapterFor(agent: Pick<AgentConfig, 'adapter'>): Adapter {
  return agent.adapter === 'xai' ? xaiAdapter : openrouterAdapter;
}
