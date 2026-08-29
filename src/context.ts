import type { AgentConfig, RoomConfig, RoomEvent } from './types.js';
import type { ChatMessage } from './openrouter.js';
import { personaText } from './personas.js';
import { configState } from './governance.js';
import { effectiveTurnSteps, loopEnabled } from './agentic.js';

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
      // A system line marked private is recorded for analysis and heard by
      // nobody — a silent [PASS] is the case that needs it.
      (e.kind === 'system' && !e.private) ||
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

// F4¾: a multi-step turn can fire several actions, and one notice line each
// would flood every other agent's context with "[X looked something up.]"
// three times in a row (the joint-session lesson — its transcript collapses
// a run of tool-call rows behind one summary). So consecutive NOTICE-ONLY
// tool events from the same agent in the same round render as one line.
// Public runs (code + output) never collapse — those are substance, not
// notice — and nothing collapses under thought broadcast, where each event
// carries its own trace into the others' contexts (§9.3 must not lose one).
function noticeVerb(e: RoomEvent): string | null {
  if (e.kind === 'search') return 'looked something up on the web';
  if (e.kind === 'file') return `updated the shared file "${e.name}"`;
  if (e.kind === 'run' && !e.public) return 'ran some code';
  if (e.kind === 'source') return "read the room's source code";
  return null;
}

function joinVerbs(verbs: string[]): string {
  if (verbs.length === 1) return verbs[0];
  return `${verbs.slice(0, -1).join(', ')}, then ${verbs[verbs.length - 1]}`;
}

/** A seat's own non-message events, in the second person. Under 'turns' a
 *  seat's own actions must not come back to it under a name — partly
 *  because it reads naturally ("[You ran some code.]"), and partly because
 *  under selfDisclosure 'anonymous' the room has not told it that name. */
function renderOwnEvent(e: RoomEvent, ownName: string): string {
  // Every line this applies to is pre-baked with the author's name — notice
  // lines built here, and system lines built in session.ts ("Alpha said
  // nothing this turn."). Swapping the leading name is enough for both.
  const base = renderEvent(e);
  return base.startsWith(`[${ownName} `) ? `[You ${base.slice(ownName.length + 2)}` : base;
}

export function renderTranscript(
  slice: RoomEvent[],
  viewerId: string,
  broadcast: RoomConfig['thinkingBroadcast'],
  /** Set under 'turns': the viewer's own name, so its own events render in
   *  the second person instead of under a name it may not have been given. */
  ownName?: string,
): string {
  const out: string[] = [];
  for (let i = 0; i < slice.length; i++) {
    const e = slice[i];
    const mine = ownName !== undefined && 'agentId' in e && e.agentId === viewerId;
    const verb = broadcast === 'off' ? noticeVerb(e) : null;
    if (verb && 'agentName' in e) {
      const verbs = [verb];
      let j = i + 1;
      for (; j < slice.length; j++) {
        const n = slice[j];
        const v = noticeVerb(n);
        if (!v || !('agentName' in n) || n.agentId !== e.agentId || n.round !== e.round) break;
        verbs.push(v);
      }
      if (verbs.length > 1) {
        out.push(mine ? `[You ${joinVerbs(verbs)}.]` : `[${e.agentName} ${joinVerbs(verbs)}.]`);
        i = j - 1;
        continue;
      }
    }
    out.push(mine ? renderOwnEvent(e, ownName!) : renderEventFor(e, viewerId, broadcast));
  }
  return out.join('\n\n');
}

/**
 * 'turns' (the control since 2026-08-27): the room as a conversation the
 * seat is IN rather than a document it is reading. Its own messages become
 * its own assistant turns, bare — no "Opus 5:" label on its own words —
 * and everything else stays user-role, labelled as before.
 *
 * Two wire constraints are handled here rather than left to the providers:
 * adjacent same-role messages are merged (a room can produce two of a
 * seat's messages in a row when nobody audible spoke between them), and the
 * sequence is guaranteed to open user-side.
 */
function transcriptTurns(
  slice: RoomEvent[],
  agent: AgentConfig,
  config: RoomConfig,
  lead: string,
): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  let pending: RoomEvent[] = [];
  const flush = () => {
    if (!pending.length) return;
    const text = renderTranscript(pending, agent.id, config.thinkingBroadcast, agent.name);
    if (text.trim()) msgs.push({ role: 'user', content: text });
    pending = [];
  };
  for (const e of slice) {
    if (e.kind === 'message' && e.agentId === agent.id) {
      flush();
      msgs.push({ role: 'assistant', content: e.text });
    } else {
      pending.push(e);
    }
  }
  flush();
  if (lead) msgs.unshift({ role: 'user', content: lead });
  // Anthropic (and others) require the first non-system message to be
  // user-role; a window that opens on the seat's own line would not be.
  if (msgs[0]?.role === 'assistant') msgs.unshift({ role: 'user', content: '[The conversation so far.]' });
  return mergeAdjacent(msgs);
}

/** Merge neighbouring messages of the same role — several providers reject
 *  a non-alternating sequence outright. Tool messages are never merged:
 *  each one answers exactly one call. */
export function mergeAdjacent(msgs: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of msgs) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role && m.role !== 'tool' && !prev.toolCalls && !m.toolCalls) {
      prev.content = `${prev.content}\n\n${m.content}`;
    } else {
      out.push({ ...m });
    }
  }
  return out;
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
  return lines.join('\n');
}

/** Declining the floor — rendered whenever [PASS] is live, journal or no
 *  journal. The wording says the turn is OFFERED and may be spent on
 *  nothing: the harness still asks everyone, so no seat starves, but
 *  whether to answer is theirs. */
function passSection(config: RoomConfig): string {
  if (!config.pass.enabled) return '';
  return [
    ``,
    `You do not have to use your turn. If you would rather say nothing at all,`,
    `reply with exactly [PASS].` +
      (config.pass.notice ? ` The room is told you chose silence.` : ` No one is told anything.`),
  ].join('\n');
}

/** §9.8 — how the room says its work is finished, and where the count
 *  stands right now. Rendered live (the votes mutate through the session),
 *  so a seat always reads the current tally rather than remembering one.
 *
 *  Deliberately NOT moved to the native tool channel: like [JOURNAL] and
 *  [PASS], agreeing is room furniture rather than a tool — it changes no
 *  file and fetches nothing. Making it a tool would also make it look like
 *  a task-completion API, which is precisely the register this room exists
 *  to avoid.
 */
function completionSection(config: RoomConfig, standing: string[]): string {
  const c = config.completion;
  if (!c.enabled) return '';
  const need = c.rule === 'unanimous' ? 'all of you' : `${c.quorum} of you`;
  const lines = [
    ``,
    `When you think the work here is finished, say so: begin your reply with`,
    `[DONE], and anything after it is spoken to the room as usual. You can`,
    `take it back the same way, with [NOT DONE]. When ${need} are standing on`,
    `[DONE] at the end of a round, the session ends.`,
  ];
  if (c.resetOnEdit && c.target) {
    lines.push(
      `Changing ${c.target} after that clears everyone's [DONE] — the thing you`,
      `agreed about is no longer the thing in front of you.`,
    );
  }
  if (c.notice) {
    lines.push(
      standing.length
        ? `Standing on [DONE] right now: ${standing.join(', ')}.`
        : `No one is standing on [DONE] right now.`,
    );
  }
  return lines.join('\n');
}

/** F4¾: is the bench expressed through the native tool channel? The room
 *  still describes its furniture in prose either way — only the SYNTAX
 *  lines drop out (Corina 2026-08-27: keep furniture phrasing). */
function native(config: RoomConfig): boolean {
  return config.tools.transport === 'native';
}

function searchSection(config: RoomConfig): string {
  const s = config.search;
  if (!s.enabled) return '';
  // F4¾: under the turn loop results arrive INSIDE the turn, so the timing
  // clause has to say so — an agent that believes its results are a turn
  // away will speak instead of reading them (the whole point of the axis).
  const loop = loopEnabled(config);
  const when = loop ? `come straight back to you, privately` : `come back to you privately at the start of your next turn`;
  // F4¾ native transport: the same furniture sentences, minus the syntax —
  // the model expresses the call through the tool channel, so telling it
  // where to put a bracket would be describing a second way to do it.
  const lines = native(config)
    ? [
        ``,
        `You can also look something up on the web. The results ${when}.`,
        `The others never see your query or the results` +
          (s.notice ? `; they only hear that you looked something up.` : `, and no one is told you searched.`),
      ]
    : s.mode === 'alongside'
      ? [
          ``,
          `You can also look something up on the web. To search, begin your reply`,
          `with [SEARCH: your query] on its own line; anything after it is spoken`,
          `to the room as usual. The results ${when}. The others never see`,
          `your query or the results` +
            (s.notice ? `; they only hear that you looked something up.` : `, and no one is told you searched.`),
        ]
      : [
          ``,
          `You can also look something up on the web. To search, reply with`,
          `[SEARCH: your query] — that turn is spent searching, and the results`,
          `${when}. The others never see your query or the results` +
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
    `This room's settings are yours, collectively, to change.`,
    ...(native(config)
      ? [`A change takes effect immediately, applies to everyone,`]
      : [`To change one, begin your reply with [CONFIG: setting = value]; anything`,
         `after it is spoken as usual. A change takes effect immediately, applies to everyone,`]),
    `and the room is told who changed what. Changing a setting never costs a`,
    `tool action. The current settings:`,
    configState(config),
  ].join('\n');
}

function toolsSection(config: RoomConfig): string {
  const t = config.tools;
  if (!t.files && !t.python) return '';
  const loop = loopEnabled(config);
  const lines: string[] = [''];
  if (t.files) {
    lines.push(
      `There is a small shared filesystem in the room — files everyone can read;`,
      `each agent's current view of it appears below when it has anything in it.`,
      ...(native(config)
        ? [`You can create a file, overwrite one, or add to the end of one.`,
           `Writes are visible to everyone.`]
        : [`To create or overwrite a file, begin your reply with`,
           `[WRITE: filename] the contents [/WRITE]; use [APPEND: filename] … [/APPEND]`,
           `to add to the end of a file instead of replacing it. Anything after the`,
           `closing tag is spoken to the room as usual. Writes are visible to everyone.`]),
      // The ceiling, stated. A room whose deliverable IS a file plans
      // around a number it knows and discovers a number it doesn't — the
      // second costs a turn and arrives as a refusal mid-draft.
      `A file holds up to ${t.maxFileChars.toLocaleString('en-US')} characters.`,
    );
  }
  if (t.python) {
    lines.push(
      ``,
      ...(native(config)
        ? [`You can also run Python. The code runs in a`]
        : [`You can also run Python. Begin your reply with [RUN] your code [/RUN];`,
           `anything after the closing tag is spoken as usual. The code runs in a`]),
      `fresh sandbox each time. The shared files are mounted at shared/ —`,
      `readable AND writable: any file your code saves there (text or binary,`,
      `a saved plot included) is published to the room as a shared file, and`,
      `code stored in a shared file can be run by anyone, e.g.`,
      `exec(open('shared/name.py').read()).`,
      ...(native(config) ? [] : [`[RUN > filename] also saves the`, `run's output to that shared file ([RUN >> filename] appends it).`]),
      ...(t.runPublic
        ? [
            `When you run code, the code and its output are shown to the room,`,
            loop
              ? `and the output comes straight back to you as well.`
              : `and the output also comes back to you at the start of your next turn.`,
          ]
        : [
            loop
              ? `Your code's printed output comes straight back to you, privately —`
              : `Your code's printed output comes back to you privately at the start`,
            loop
              ? `no one else sees your code or its output; the shared/ directory is`
              : `of your next turn — no one else sees your code or its output; the`,
            loop ? `how you show the room something.` : `shared/ directory is how you show the room something.`,
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
      ...(native(config)
        ? [`These tools are open to inspection: you can read their own source code,`,
           `either the index or one file.`]
        : [`These tools are open to inspection: reply with [SOURCE] for an index of`,
           `their source code, or [SOURCE: name] to read a file.`]),
      loop
        ? `It comes back to you privately, and reading never costs the room a tool`
        : `It comes back to you privately, and reading never costs a tool action.`,
      ...(loop ? [`action (it does use one of your turn's actions).`] : []),
    );
  }
  // The economics line, and under F4¾ the loop's one rule. Everything an
  // agent needs to plan a multi-step turn is here: how many actions it has,
  // that results arrive in between, and that speaking is what ends the turn.
  lines.push(
    ``,
    ...(t.budget === 'per-room'
      ? [
          `The room shares ONE tool action per round — a search, a file write, or a`,
          `code run, whichever one of you takes it first. How you share it is up to you.`,
        ]
      : loop
        ? [
            `You can take up to ${effectiveTurnSteps(config)} actions in a single turn. After each one its`,
            `result comes straight back to you and you can act again on what you`,
            // The example has to be reachable in THIS room: a loop room with
            // search off ('site') was telling its seats to look something up.
            ...(config.search.enabled
              ? [`learned — look something up and run code on it, or run code, read the`,
                 `error, and fix it. Speaking ends your turn: anything you say to the`]
              : [`learned — write a file, run code that reads it, fix what the error`,
                 `showed you. Speaking ends your turn: anything you say to the`]),
            `room is the last thing you do in it, so act first and speak when you`,
            `are ready. A turn spent entirely on actions says nothing to the room,`,
            `which is a fine way to spend one.`,
          ]
        : [`You may take at most one tool action in a single turn.`]),
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
  /** §9.8: names of the seats currently standing on [DONE], in speaking
   *  order. Rendered only when the room is told about votes at all. */
  standingDone?: string[];
  /** F4¾ agentic loop: the turn's own steps so far, already in message
   *  form — under the sentinel transport an assistant reply followed by the
   *  observation as a user message; under the native transport an assistant
   *  message carrying tool_calls followed by one tool-result message per
   *  call (every call MUST get a result or the next request is rejected).
   *  Caller-only: the loop rebuilds the whole list each step, which is what
   *  lets a file an agent just wrote appear in its own shared-files block. */
  inTurn?: ChatMessage[];
}): ChatMessage[] {
  const { agent, config, events, summary, minutesRemaining, ownJournal, privateBlock, sharedFiles, standingDone, inTurn } = opts;

  // Roster disclosure (§3.2c): 'named' keeps the original control wording
  // verbatim (quirk included) so pre-knob sessions stay comparable.
  //
  // Self-disclosure (2026-08-27) cuts across it: when the room doesn't say
  // who you are, the roster must not say it either. The named list drops
  // the "(you)" marker and stays complete — listing only the OTHERS would
  // hand identity back by elimination, and the count line stops counting
  // from the reader outward.
  const anon = config.selfDisclosure === 'anonymous';
  // Under anonymity the list is COMPLETE and unmarked (omitting the reader
  // would identify them by elimination). When the room does say who you
  // are, "the others" means the others — the old wording listed the reader
  // among them, marked "(you)", with Opus 5 first, and a seat duly reported
  // being told it was Opus (fixed 2026-08-28).
  const roster = anon
    ? config.agents.map((a) => a.name).join(', ')
    : config.agents.filter((a) => a.id !== agent.id).map((a) => a.name).join(', ');
  const identity = anon
    ? config.rosterDisclosure === 'named'
      ? `In the room: ${roster}.`
      : config.rosterDisclosure === 'count'
        ? `There are ${config.agents.length} of you in the room.`
        : ''
    : config.rosterDisclosure === 'named'
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

  // The turn paragraph, rewritten 2026-08-27 (Corina). Three changes, all
  // of them about register rather than content: the "How this works:"
  // header went (it read like documentation about the room rather than
  // anything said inside it); doing comes BEFORE saying, because a room
  // that leads with "whatever you write is spoken" describes a chat that
  // happens to have tools; and the "you are not obligated to be helpful"
  // line went with it. That last one was doing anti-assistant work, so
  // watch register on the first sessions after this — if assistant-mode
  // creeps back, it is the sentence to reinstate first.
  const hasBench = config.tools.files || config.tools.python || config.search.enabled;
  const turnLines = hasBench
    ? [
        `A turn is yours to spend as you like — on doing something, or on saying`,
        `something. What you say, everyone here hears; keep it conversational, a`,
        `few sentences to a short paragraph, like a group chat.`,
      ]
    : [
        `A turn is yours to spend as you like. What you say, everyone here hears;`,
        `keep it conversational, a few sentences to a short paragraph, like a`,
        `group chat.`,
      ];

  const system = [
    config.welcomeMessage,
    ``,
    identity,
    persona ? `\n${persona}` : '',
    countdownSection(config, minutesRemaining),
    ...turnLines,
    broadcastDisclosure,
    journalSection(config),
    passSection(config),
    completionSection(config, standingDone ?? []),
    searchSection(config),
    toolsSection(config),
    governanceSection(config),
    sharedFilesBlock(sharedFiles ?? []),
    config.journal.enabled && config.journal.recall && ownJournal
      ? `\nYour journal so far:\n${ownJournal}`
      : '',
  ].join('\n');

  const { slice } = contextSlice(config, events);
  const lead = config.contextPolicy === 'window' && summary ? `[Earlier in the room (summary)]\n${summary}\n` : '';
  // Everything that closes the prompt, whichever mode built the body: the
  // private block (search results, run output, a refusal) and the nudge.
  const tail = [
    ...(privateBlock ? [`\n[Private, for you alone — no one else in the room sees this.]\n${privateBlock}`] : []),
    anon ? `\n[It is now your turn.]` : `\n[It is now your turn, ${agent.name}.]`,
  ].join('\n');

  const body: ChatMessage[] =
    config.transcriptMode === 'turns'
      ? [...transcriptTurns(slice, agent, config, lead), { role: 'user', content: tail }]
      : [{
          role: 'user',
          content: [lead, renderTranscript(slice, agent.id, config.thinkingBroadcast), tail].filter(Boolean).join('\n'),
        }];

  return mergeAdjacent([
    { role: 'system', content: system },
    ...body,
    // The turn's own steps so far (F4¾): what this agent did, and what came
    // back. Nobody else's context ever holds these.
    ...(inTurn ?? []),
  ]);
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
