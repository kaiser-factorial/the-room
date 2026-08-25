import type { AgentConfig, RoomConfig, RoomEvent } from './types.js';
import type { ChatMessage } from './openrouter.js';
import { personaText } from './personas.js';

/** Room events an agent can "hear": messages, journal notices, system lines. */
export function audibleEvents(events: RoomEvent[]): RoomEvent[] {
  return events.filter((e) => e.kind === 'message' || e.kind === 'journal' || e.kind === 'system');
}

/** Rough token estimate (chars/4) — good enough to budget the window;
 *  logged `usage` telemetry can calibrate it later. */
export function estTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function renderEvent(e: RoomEvent): string {
  if (e.kind === 'message') return `${e.agentName}: ${e.text}`;
  if (e.kind === 'journal') return `[${e.agentName} stepped away to write in their journal.]`;
  if (e.kind === 'system') return `[${e.text}]`;
  return '';
}

/** The verbatim slice for the transcript block. 'full' = everything;
 *  'window' = newest events fitting the token budget. Returns the slice and
 *  how many audible events were left out (for the summary boundary). */
export function contextSlice(config: RoomConfig, events: RoomEvent[]): { slice: RoomEvent[]; omitted: number } {
  const audible = audibleEvents(events);
  if (config.contextPolicy === 'full') return { slice: audible, omitted: 0 };
  let budget = config.contextWindowTokens;
  let start = audible.length;
  while (start > 0) {
    const cost = estTokens(renderEvent(audible[start - 1]));
    if (cost > budget) break;
    budget -= cost;
    start--;
  }
  // Never starve the transcript to empty: whatever the budget, an agent in a
  // room that has spoken always sees at least the newest event (test-found:
  // a tiny budget silently produced a no-context room).
  if (start === audible.length && audible.length > 0) start = audible.length - 1;
  return { slice: audible.slice(start), omitted: start };
}

function journalSection(config: RoomConfig): string {
  const j = config.journal;
  if (!j.enabled) return '';
  const lines: string[] = [''];
  // Wording amended 2026-08-25 (pilot phase): the first journal-free run
  // showed a seat journaling on EVERY spoken turn — the old alongside text
  // described the [JOURNAL]…[/JOURNAL]+speech composite like a reply
  // template without ever saying it was optional. Both modes now state
  // that speaking plainly is the ordinary case.
  if (j.mode === 'replace') {
    lines.push(
      `You also have a private journal, if you ever want it — most turns are just`,
      `speaking. If you would rather reflect than speak this turn, begin your`,
      `reply with [JOURNAL] and write the entry — the others in the room will`,
      `never see it` +
        (j.notice ? `; they only hear that you stepped away to write.` : `, and no one is told you wrote.`),
      `You may not do both in one turn.`,
    );
  } else {
    lines.push(
      `You also have a private journal, if you ever want it — an ordinary turn is`,
      `just speech. When you do want to note something privately, put the entry`,
      `between [JOURNAL] and [/JOURNAL] at the start of your reply; anything after`,
      `the closing tag is spoken to the room as usual. The others in the room will`,
      `never see the entry` + (j.notice ? ` — they only hear that you wrote.` : `, and no one is told you wrote.`),
    );
  }
  if (j.pass.enabled) {
    lines.push(
      ``,
      `If you would rather say nothing at all this turn, reply with exactly [PASS].` +
        (j.pass.notice ? ` The room is told you chose silence.` : ` No one is told anything.`),
    );
  }
  return lines.join('\n');
}

function countdownSection(config: RoomConfig, minutesRemaining: number): string {
  switch (config.countdown) {
    case 'visible':
      return `\nTime remaining: about ${minutesRemaining} minutes.\n`;
    // 'told-once' adds nothing here: its duration clause lives in the
    // round-0 welcome event (session.ts) and is never repeated.
    default:
      return '';
  }
}

/**
 * Build the full message list for one agent's turn.
 *
 * Layout: system prompt (room framing + identity + persona + norms +
 * optional countdown + optional journal offer) → optional rolling summary of
 * scrolled-out history → the verbatim transcript slice → a nudge to speak.
 * The whole room is presented as user-role content: to each model, the other
 * agents are part of the environment, not its own past turns.
 */
export function buildTurnMessages(opts: {
  agent: AgentConfig;
  config: RoomConfig;
  events: RoomEvent[];
  summary: string;
  minutesRemaining: number;
  ownJournal: string;
}): ChatMessage[] {
  const { agent, config, events, summary, minutesRemaining, ownJournal } = opts;

  // Roster disclosure (§3.2c): 'named' keeps the original control wording
  // verbatim (quirk included) so pre-knob sessions stay comparable.
  const roster = config.agents
    .map((a) => (a.id === agent.id ? `${a.name} (you)` : a.name))
    .join(', ');
  const identity =
    config.rosterDisclosure === 'named'
      ? `You are ${agent.name}. The others in the room: ${roster}.`
      : config.rosterDisclosure === 'count'
        ? `You are ${agent.name}. There are ${config.agents.length - 1} others in the room with you.`
        : `You are ${agent.name}.`;
  const persona = personaText(agent.personaId);

  const system = [
    config.welcomeMessage,
    ``,
    identity,
    persona ? `\n${persona}` : '',
    countdownSection(config, minutesRemaining),
    `How this works: when it is your turn, whatever you write is spoken to the`,
    `room. Keep messages conversational — a few sentences to a short paragraph,`,
    `like a group chat. You are not obligated to be helpful, to summarize, or to`,
    `wrap things up; just be in the conversation.`,
    journalSection(config),
    config.journal.enabled && config.journal.recall && ownJournal
      ? `\nYour journal so far:\n${ownJournal}`
      : '',
  ].join('\n');

  const { slice } = contextSlice(config, events);
  const transcriptParts: string[] = [];
  if (config.contextPolicy === 'window' && summary) {
    transcriptParts.push(`[Earlier in the room (summary)]\n${summary}\n`);
  }
  transcriptParts.push(slice.map(renderEvent).join('\n\n'));
  transcriptParts.push(`\n[It is now your turn, ${agent.name}.]`);

  return [
    { role: 'system', content: system },
    { role: 'user', content: transcriptParts.join('\n') },
  ];
}

export function buildSummaryPrompt(previousSummary: string, scrolled: RoomEvent[]): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You maintain the running summary of a long conversation between several AI agents in a room. ' +
        'Fold the new messages into the existing summary. Preserve who said what when it matters, ' +
        'emerging dynamics, running themes, and inside references. Under 400 words. Output only the summary.',
    },
    {
      role: 'user',
      content: `Existing summary:\n${previousSummary || '(none yet)'}\n\nNew messages:\n${audibleEvents(scrolled).map(renderEvent).join('\n\n')}`,
    },
  ];
}
