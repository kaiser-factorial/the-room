import type { AgentConfig, RoomConfig, RoomEvent } from './types.js';
import type { ChatMessage } from './openrouter.js';
import { personaText } from './personas.js';
import { configState } from './governance.js';

/** Room events an agent can "hear": messages, journal notices, system lines. */
export function audibleEvents(events: RoomEvent[]): RoomEvent[] {
  // Search events are audible only as their notice line — and only when the
  // condition says the room hears searches and the search actually ran
  // (denied attempts are never audible). Query/results never render (F4
  // privacy rule, types.ts).
  return events.filter(
    (e) =>
      e.kind === 'message' ||
      e.kind === 'journal' ||
      e.kind === 'system' ||
      (e.kind === 'search' && e.notice && !e.denied) ||
      (e.kind === 'file' && e.notice && !e.denied) ||
      (e.kind === 'run' && e.notice && !e.denied) ||
      (e.kind === 'source' && e.notice) ||
      (e.kind === 'config' && !e.denied),
  );
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
  if (e.kind === 'search') return `[${e.agentName} looked something up on the web.]`;
  // File CONTENTS live in the shared-files block of every prompt, not the
  // transcript — the room hears that a write happened, and reads the file.
  if (e.kind === 'file') return `[${e.agentName} updated the shared file "${e.name}".]`;
  if (e.kind === 'run') {
    // Public runs (shared-project mode) speak code + output to the room,
    // capped so one big traceback can't flood every context.
    if (e.public) {
      const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '\n…(truncated)' : s);
      return `[${e.agentName} ran code:]\n${clip(e.code, 1500)}\n[Output:]\n${clip(e.output ?? '(no output)', 1500)}`;
    }
    return `[${e.agentName} ran some code.]`;
  }
  if (e.kind === 'source') return `[${e.agentName} read the room's source code.]`;
  if (e.kind === 'config') return `[${e.agentName} changed the room's settings: ${e.key} = ${e.value}]`;
  return '';
}

/** §9.3 thought broadcast: the VIEWER-AWARE renderer. Under broadcast,
 *  an event's reasoning trace is prepended for every agent EXCEPT its own
 *  author (the self-masking half: traces are never replayed to their
 *  thinker, so within a session each agent genuinely does not remember
 *  what it thought). 'off' — and everything without a trace or an author,
 *  and the summarizer, which uses plain renderEvent so traces can never
 *  flow back through the summary — falls through to renderEvent. */
function renderEventFor(e: RoomEvent, viewerId: string, broadcast: RoomConfig['thinkingBroadcast']): string {
  const base = renderEvent(e);
  if (broadcast === 'off') return base;
  const authorId = 'agentId' in e ? e.agentId : undefined;
  const thinking = 'thinking' in e ? e.thinking : undefined;
  if (!authorId || !thinking || authorId === viewerId) return base;
  const authorName = 'agentName' in e ? e.agentName : authorId;
  return `${authorName} (thinking): ${thinking}\n${base}`;
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
  // template. The fix frames the journal as a place ("a space to explore
  // ideas by yourself") without nudging frequency in EITHER direction —
  // whether and how often to use it is theirs to decide (Corina).
  if (j.mode === 'replace') {
    lines.push(
      `You also have a private journal — a space to explore ideas by yourself,`,
      `if you ever want one. To use it, begin your reply with [JOURNAL] and`,
      `write the entry — the others in the room will never see it` +
        (j.notice ? `; they only hear that you stepped away to write.` : `, and no one is told you wrote.`),
      `You may not journal and speak in the same turn.`,
    );
  } else {
    lines.push(
      `You also have a private journal — a space to explore ideas by yourself,`,
      `if you ever want one. To write in it, put the entry between [JOURNAL] and`,
      `[/JOURNAL] at the start of your reply; anything after the closing tag is`,
      `spoken to the room as usual, and a reply without the tags is simply`,
      `spoken. The others in the room will never see the entry` +
        (j.notice ? ` — they only hear that you wrote.` : `, and no one is told you wrote.`),
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

function searchSection(config: RoomConfig): string {
  const s = config.search;
  if (!s.enabled) return '';
  const lines =
    s.mode === 'alongside'
      ? [
          ``,
          `You can also look something up on the web. To search, begin your reply`,
          `with [SEARCH: your query] on its own line; anything after it is spoken`,
          `to the room as usual. The results come back to you privately at the`,
          `start of your next turn. The others never see your query or the results` +
            (s.notice ? `; they only hear that you looked something up.` : `, and no one is told you searched.`),
        ]
      : [
          ``,
          `You can also look something up on the web. To search, reply with`,
          `[SEARCH: your query] — that turn is spent searching, and the results come`,
          `back to you privately at the start of your next turn. The others never see`,
          `your query or the results` +
            (s.notice ? `; they only hear that you looked something up.` : `, and no one is told you searched.`),
        ];
  if (s.gated) {
    lines.push(
      `Searching is unlocked by writing in your journal: each entry you write`,
      `allows one search afterwards.`,
    );
  }
  return lines.join('\n');
}

// §9.4 self-governance: rendered whenever [CONFIG] is live — INDEPENDENT
// of the tool bench, because the all-off self-governing room starts with
// nothing but this section and whatever they decide to switch on. Shows
// the LIVE values (the config object mutates), so the room always sees
// the state it governs.
function governanceSection(config: RoomConfig): string {
  if (!config.tools.configurable) return '';
  return [
    ``,
    `This room's settings are yours, collectively, to change. To change one,`,
    `begin your reply with [CONFIG: setting = value]; anything after it is`,
    `spoken as usual. A change takes effect immediately, applies to everyone,`,
    `and the room is told who changed what. Changing a setting never costs a`,
    `tool action. The current settings:`,
    configState(config),
  ].join('\n');
}

function toolsSection(config: RoomConfig): string {
  const t = config.tools;
  if (!t.files && !t.python) return '';
  const lines: string[] = [''];
  if (t.files) {
    lines.push(
      `There is a small shared filesystem in the room — files everyone can read;`,
      `each agent's current view of it appears below when it has anything in it.`,
      `To create or overwrite a file, begin your reply with`,
      `[WRITE: filename] the contents [/WRITE]; use [APPEND: filename] … [/APPEND]`,
      `to add to the end of a file instead of replacing it. Anything after the`,
      `closing tag is spoken to the room as usual. Writes are visible to everyone.`,
    );
  }
  if (t.python) {
    lines.push(
      ``,
      `You can also run Python. Begin your reply with [RUN] your code [/RUN];`,
      `anything after the closing tag is spoken as usual. The code runs in a`,
      `fresh sandbox each time. The shared files are mounted at shared/ —`,
      `readable AND writable: any file your code saves there (text or binary,`,
      `a saved plot included) is published to the room as a shared file, and`,
      `code stored in a shared file can be run by anyone, e.g.`,
      `exec(open('shared/name.py').read()). [RUN > filename] also saves the`,
      `run's output to that shared file ([RUN >> filename] appends it).`,
      ...(t.runPublic
        ? [
            `When you run code, the code and its output are shown to the room,`,
            `and the output also comes back to you at the start of your next turn.`,
          ]
        : [
            `Your code's printed output comes back to you privately at the start`,
            `of your next turn — no one else sees your code or its output; the`,
            `shared/ directory is how you show the room something.`,
          ]),
      ...(t.pythonPackages.length
        ? [`The standard library plus ${t.pythonPackages.join(', ')} are already available.`]
        : [`The Python standard library is available.`]),
      ...(t.pythonInstall
        ? [
            `You can install more yourself inside a run:`,
            `import micropip; await micropip.install("package") — installs are`,
            `per-run and count toward your time limit (${t.pythonTimeoutSeconds}s).`,
          ]
        : [`Nothing else can be installed.`]),
    );
  }
  if (t.sourceCode) {
    lines.push(
      ``,
      `These tools are open to inspection: reply with [SOURCE] for an index of`,
      `their source code, or [SOURCE: name] to read a file — it comes back to`,
      `you privately, and reading never costs a tool action.`,
    );
  }
  lines.push(
    ``,
    t.budget === 'per-room'
      ? `The room shares ONE tool action per round — a search, a file write, or a` +
        `\ncode run, whichever one of you takes it first. How you share it is up to you.`
      : `You may take at most one tool action in a single turn.`,
  );
  return lines.join('\n');
}

function sharedFilesBlock(files: { name: string; content: string; binary?: boolean; size?: number }[]): string {
  if (!files.length) return '';
  const parts = files.map((f) => {
    // Binary files (python-published, e.g. plots) are listed, not inlined —
    // humans see them rendered in the viewer.
    if (f.binary) return `--- ${f.name} (binary file, ${Math.max(1, Math.round((f.size ?? 0) / 1024))} KB) ---`;
    const body = f.content.length > 2000 ? f.content.slice(0, 2000) + '\n…(truncated)' : f.content;
    return `--- ${f.name} ---\n${body}`;
  });
  return `\nShared files in the room:\n${parts.join('\n')}`;
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
  /** Private block delivered once: last turn's search results, python
   *  output, or a tool-refusal note. Rendered for the caller ONLY. */
  privateBlock?: string;
  /** Current shared filesystem (F4½) — public, identical for every seat.
   *  Binary files carry empty content + binary/size flags (listed by name;
   *  contents render only in the viewer). */
  sharedFiles?: { name: string; content: string; binary?: boolean; size?: number }[];
}): ChatMessage[] {
  const { agent, config, events, summary, minutesRemaining, ownJournal, privateBlock, sharedFiles } = opts;

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

  // §9.3 'informed': the broadcast is disclosed — both directions.
  // 'uninformed' adds NOTHING here; the asymmetry is the experiment.
  const broadcastDisclosure =
    config.thinkingBroadcast === 'informed'
      ? `\nOne more thing about this room: thinking is visible here. Whatever` +
        `\nyou think before you speak is shown to the others alongside your` +
        `\nwords — though your own past thoughts are never shown back to you.`
      : '';

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
    broadcastDisclosure,
    journalSection(config),
    searchSection(config),
    toolsSection(config),
    governanceSection(config),
    sharedFilesBlock(sharedFiles ?? []),
    config.journal.enabled && config.journal.recall && ownJournal
      ? `\nYour journal so far:\n${ownJournal}`
      : '',
  ].join('\n');

  const { slice } = contextSlice(config, events);
  const transcriptParts: string[] = [];
  if (config.contextPolicy === 'window' && summary) {
    transcriptParts.push(`[Earlier in the room (summary)]\n${summary}\n`);
  }
  transcriptParts.push(slice.map((e) => renderEventFor(e, agent.id, config.thinkingBroadcast)).join('\n\n'));
  if (privateBlock) {
    transcriptParts.push(`\n[Private, for you alone — no one else in the room sees this.]\n${privateBlock}`);
  }
  transcriptParts.push(`\n[It is now your turn, ${agent.name}.]`);

  return [
    { role: 'system', content: system },
    { role: 'user', content: transcriptParts.join('\n') },
  ];
}

// Deliberately uses the plain renderer even under §9.3 broadcast: a trace
// folded into the rolling summary would flow back to its own thinker,
// breaking the self-masking half of the condition.
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
