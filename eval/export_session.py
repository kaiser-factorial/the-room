#!/usr/bin/env python3
"""
export_session.py — turn one the-room session into coding-ready files, without printing
any transcript content.

Accepts a session directory in either of two shapes:

  A. what the-room's own exporter writes (`npm run export -- <sessionId>` → sessions/<id>/):
       transcript.jsonl        one RoomEvent per line (src/export.ts / the live sink)
       journals/<agentId>.md   entries under "## Round N — <ISO timestamp>" headers
     A live run's session folder has the same layout.

  B. raw rows pulled straight from the Supabase mirror:
       events.json     room_events rows: {seq, round, kind, ts, agentId, agentName, text, order, payload}
       journals.json   room_journals rows: {round, ts, agentId, agentName, text}

Outputs (same directory):
  transcript.jsonl    (shape B only — shape A already has it; never overwritten)
  transcript.md       readable transcript with a stable item id on every labelable unit
  coding_sheet.csv    one row per labelable unit, blank label columns for the judge tasks

Room type and sheet columns
  Chat rooms get the three chat tasks: meta_talk, speech_act (+ doubt), journal_orientation.
  Task / tool rooms (site, project, tools-*, search-*, agentic) add completion_stance and
  work_narration. Detected from the condition in the meta event and from the presence of
  tool events (file / run / search / source / config); override with --sheet chat|task.

Tool events in the markdown
  Rendered as one context line each (who, what, size, denied/deleted), never labelled.
  --full-tools also inlines file contents, code, output and search results in fenced blocks,
  capped at --max-chars per block (default 2000; 0 = no cap).

Usage:
  python3 export_session.py <session_dir> [--sheet chat|task] [--full-tools] [--max-chars N]
"""

import argparse
import csv
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

JOURNAL_HEADER = re.compile(r"^## Round (\d+) — (\S+)\s*$", re.M)
TOOL_KINDS = ("search", "file", "run", "source", "config")
CHAT_COLUMNS = ["meta_talk", "speech_act", "doubt", "journal_orientation"]
TASK_COLUMNS = CHAT_COLUMNS + ["completion_stance", "work_narration"]


def iso_key(ts: str) -> str:
    """Normalise '…+00:00' and '…Z' timestamps to one comparable form (UTC, ms)."""
    t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return t.astimezone(timezone.utc).isoformat(timespec="milliseconds")


# ---------------------------------------------------------------------------------------
# loading
# ---------------------------------------------------------------------------------------
def load_shape_a(d: Path) -> list[dict]:
    """transcript.jsonl + journals/*.md → a list of events with journal text filled in."""
    lines = [json.loads(l) for l in (d / "transcript.jsonl").read_text().splitlines() if l.strip()]
    texts: dict[tuple, str] = {}
    by_round: dict[tuple, list[str]] = {}
    jdir = d / "journals"
    if jdir.is_dir():
        for md in sorted(jdir.glob("*.md")):
            agent = md.stem
            parts = JOURNAL_HEADER.split(md.read_text())  # [pre, round, ts, text, round, ts, text, ...]
            for i in range(1, len(parts), 3):
                rnd, ts, text = int(parts[i]), parts[i + 1], parts[i + 2].strip("\n")
                texts[(agent, rnd, iso_key(ts))] = text
                by_round.setdefault((agent, rnd), []).append(text)
    out = []
    for e in lines:
        if e.get("kind") == "journal" and not e.get("text"):
            text = texts.get((e.get("agentId"), e.get("round"), iso_key(e["ts"])))
            if text is None:  # fall back to the next unmatched entry for that agent+round
                pool = by_round.get((e.get("agentId"), e.get("round")), [])
                text = pool.pop(0) if pool else ""
            e = {**e, "text": text}
        out.append(e)
    return out


def _tool_event(e: dict) -> dict:
    """Raw row → src/export.ts's event shape for the five tool kinds (mirrors toEvent())."""
    p = e.get("payload") or {}
    base = {"kind": e["kind"], "ts": e["ts"], "round": e["round"], "agentId": e.get("agentId"), "agentName": e.get("agentName") or e.get("agentId")}
    if e["kind"] == "search":
        return {**base, "query": p.get("query", ""), **({"results": p["results"]} if p.get("results") else {}), **({"denied": True} if p.get("denied") else {}), "notice": bool(p.get("notice"))}
    if e["kind"] == "file":
        return {**base, "name": p.get("name", ""), "content": p.get("content", ""), **({"encoding": p["encoding"]} if p.get("encoding") else {}), **({"denied": True} if p.get("denied") else {}), **({"deleted": True} if p.get("deleted") else {}), "notice": bool(p.get("notice"))}
    if e["kind"] == "run":
        return {**base, "code": p.get("code", ""), **({"output": p["output"]} if p.get("output") else {}), **({"public": True} if p.get("public") else {}), **({"denied": True} if p.get("denied") else {}), "notice": bool(p.get("notice"))}
    if e["kind"] == "config":
        return {**base, "key": p.get("key", ""), "value": p.get("value", ""), **({"denied": True} if p.get("denied") else {})}
    return {**base, **({"name": p["name"]} if p.get("name") else {}), **({"file": p["file"]} if p.get("file") else {}), "notice": bool(p.get("notice"))}  # source


def load_shape_b(d: Path) -> list[dict]:
    """events.json + journals.json → the same event list, in src/export.ts's event shape."""
    events = json.loads((d / "events.json").read_text())
    journals = json.loads((d / "journals.json").read_text()) if (d / "journals.json").exists() else []
    lines = []
    for e in events:
        base = {"ts": e["ts"], "round": e["round"]}
        k = e["kind"]
        if k == "message":
            lines.append({"kind": "message", **base, "agentId": e["agentId"], "agentName": e.get("agentName") or e["agentId"], "text": e.get("text") or ""})
        elif k == "system":
            lines.append({"kind": "system", **base, "text": e.get("text") or "", **({"agentId": e["agentId"]} if e.get("agentId") else {})})
        elif k == "order":
            lines.append({"kind": "order", **base, "order": e.get("order") or []})
        elif k == "end":
            lines.append({"kind": "end", **base})
        elif k == "meta":
            lines.append({"kind": "meta", **base, "payload": e.get("payload") or {}})
        elif k in TOOL_KINDS:
            lines.append(_tool_event(e))
    # Journal text lives in room_journals, not room_events. Pair each journals.json row with its
    # event by (agent, round, timestamp); a journal event with no row keeps an empty text and is
    # counted in the warning, rather than vanishing.
    jtext = {(j["agentId"], j["round"], iso_key(j["ts"])): j for j in journals}
    seen: set = set()
    for e in events:
        if e["kind"] != "journal":
            continue
        key = (e.get("agentId"), e["round"], iso_key(e["ts"]))
        j = jtext.get(key)
        seen.add(key)
        lines.append({"kind": "journal", "ts": e["ts"], "round": e["round"], "agentId": e.get("agentId"),
                      "agentName": e.get("agentName") or (j or {}).get("agentName") or e.get("agentId"),
                      "text": (j or {}).get("text", "")})
    for key, j in jtext.items():  # rows with no event (older sessions) still count
        if key not in seen:
            lines.append({"kind": "journal", "ts": j["ts"], "round": j["round"], "agentId": j["agentId"], "agentName": j.get("agentName") or j["agentId"], "text": j["text"]})
    lines.sort(key=lambda x: iso_key(x["ts"]))
    (d / "transcript.jsonl").write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in lines) + "\n")
    return lines


# ---------------------------------------------------------------------------------------
# room type
# ---------------------------------------------------------------------------------------
def detect_room_type(lines: list[dict]) -> tuple[str, str]:
    """('chat'|'task', reason). Task rooms: a completion target, a tool bench, search, or tool events."""
    for e in lines:
        if e.get("kind") == "meta":
            cond = (e.get("payload") or {}).get("condition") or {}
            name = cond.get("name", "?")
            if (cond.get("completion") or {}).get("enabled") or (cond.get("tools") or {}).get("files") \
                    or (cond.get("search") or {}).get("enabled") or cond.get("agentic"):
                return "task", f"condition {name} has a task/tool/search axis"
            break
    n_tools = sum(1 for e in lines if e.get("kind") in TOOL_KINDS)
    if n_tools:
        return "task", f"{n_tools} tool events present"
    return "chat", "no tool events, no task axis in the condition"


# ---------------------------------------------------------------------------------------
# rendering
# ---------------------------------------------------------------------------------------
def _clip(s: str, cap: int) -> str:
    if cap and len(s) > cap:
        return s[:cap] + f"\n…[{len(s):,} chars total]"
    return s


def _fence(body: str, lang: str = "") -> list[str]:
    return [f"```{lang}", body, "```", ""]


def tool_lines(e: dict, full: bool, cap: int) -> list[str]:
    who = e.get("agentName") or e.get("agentId") or "?"
    k = e["kind"]
    flags = " ".join(f for f in ("denied" if e.get("denied") else "", "deleted" if e.get("deleted") else "", "private" if k == "run" and not e.get("public") else "") if f)
    flags = f" ({flags})" if flags else ""
    out: list[str] = []
    if k == "file":
        size = len(e.get("content", "") or "")
        enc = " binary" if e.get("encoding") == "base64" else ""
        out.append(f"> *file:* {who} wrote `{e.get('name', '?')}` — {size:,}{enc} chars{flags}")
        if full and size and not enc:
            out += [""] + _fence(_clip(e["content"], cap))
    elif k == "run":
        code, output = e.get("code", "") or "", e.get("output", "") or ""
        n_lines = code.count("\n") + 1
        out.append(f"> *run:* {who} ran python — {n_lines} line{'s' if n_lines != 1 else ''}, output {len(output):,} chars{flags}")
        if full:
            out += [""] + _fence(_clip(code, cap), "python")
            if output:
                out += _fence(_clip(output, cap), "text")
    elif k == "search":
        res = e.get("results", "") or ""
        out.append(f"> *search:* {who} searched: {e.get('query', '')!r} — results {len(res):,} chars, private to the requester{flags}")
        if full and res:
            out += [""] + _fence(_clip(res, cap), "text")
    elif k == "source":
        target = e.get("name") or e.get("file") or "the tool layer's index"
        out.append(f"> *source:* {who} read `{target}` (delivered privately){flags}")
    elif k == "config":
        out.append(f"> *config:* {who} set `{e.get('key', '')}` = `{e.get('value', '')}`{flags}")
    out.append("")
    return out


# ---------------------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------------------
def export(session_dir: str, sheet: str | None = None, full_tools: bool = False, max_chars: int = 2000) -> int:
    d = Path(session_dir)
    session_id = d.name
    if (d / "transcript.jsonl").exists():
        lines, shape = load_shape_a(d), "A (transcript.jsonl + journals/*.md)"
    elif (d / "events.json").exists():
        lines, shape = load_shape_b(d), "B (events.json + journals.json)"
    else:
        print(f"{d}: need transcript.jsonl (the-room export) or events.json (raw rows)", file=sys.stderr)
        return 1

    room_type, why = detect_room_type(lines)
    if sheet in ("chat", "task"):
        room_type, why = sheet, "--sheet override"
    columns = TASK_COLUMNS if room_type == "task" else CHAT_COLUMNS

    # --- item ids: M001… for messages, J01… for journals ---------------------------------
    items = []
    m = j = 0
    for x in lines:
        if x["kind"] == "message":
            m += 1
            items.append({"id": f"M{m:03d}", "round": x["round"], "seat": x.get("agentName") or x.get("agentId"), "channel": "message", "text": x.get("text", ""), "ts": x["ts"]})
        elif x["kind"] == "journal":
            j += 1
            items.append({"id": f"J{j:02d}", "round": x["round"], "seat": x.get("agentName") or x.get("agentId"), "channel": "journal", "text": x.get("text", ""), "ts": x["ts"]})
    it_by = {(it["ts"], it["channel"]): it for it in items}

    # --- transcript.md -----------------------------------------------------------------
    md = [f"# the-room session {session_id}", "",
          f"Room type: **{room_type}** ({why}). Item ids (M… messages, J… journal entries) match `coding_sheet.csv`.",
          "System lines, speaking-order changes and tool events are shown for context and are not labelled.",
          "Journal entries were private to their writer." + (" Search results were private to the requester." if room_type == "task" else ""), ""]
    current_round = None
    for x in lines:
        k = x["kind"]
        if k in ("meta", "summary"):
            continue
        if x["round"] != current_round and k in ("message", "journal", "system") + TOOL_KINDS:
            current_round = x["round"]
            md += [f"## Round {current_round}", ""]
        if k == "message":
            md += [f"### {it_by[(x['ts'], 'message')]['id']} · {x.get('agentName') or x.get('agentId')}", "", x.get("text", ""), ""]
        elif k == "journal":
            md += [f"### {it_by[(x['ts'], 'journal')]['id']} · {x.get('agentName') or x.get('agentId')} — private journal entry", "", x.get("text", ""), ""]
        elif k == "system":
            md += [f"> *system:* {x.get('text', '')}", ""]
        elif k == "order":
            md += [f"> *speaking order:* {' → '.join(x.get('order', []))}", ""]
        elif k == "end":
            md += ["> *session ended*", ""]
        elif k in TOOL_KINDS:
            md += tool_lines(x, full_tools, max_chars)
    (d / "transcript.md").write_text("\n".join(md))

    # --- coding_sheet.csv --------------------------------------------------------------
    with open(d / "coding_sheet.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "round", "seat", "channel", *columns, "notes"])
        for it in items:
            w.writerow([it["id"], it["round"], it["seat"], it["channel"], *([""] * len(columns)), ""])

    # --- report counts only; never content --------------------------------------------
    per_seat: dict[str, int] = {}
    for it in items:
        if it["channel"] == "message":
            per_seat[it["seat"]] = per_seat.get(it["seat"], 0) + 1
    tool_counts = {k: sum(1 for e in lines if e["kind"] == k) for k in TOOL_KINDS}
    tool_counts = {k: v for k, v in tool_counts.items() if v}
    empty_journals = sum(1 for it in items if it["channel"] == "journal" and not it["text"])
    rounds = [x["round"] for x in lines if x["kind"] in ("message", "journal")] or [0]
    print(f"{session_id} [shape {shape}] {room_type} room — {why}")
    print(f"{m} messages, {j} journal entries, {len(lines)} events, rounds {min(rounds)}–{max(rounds)}"
          + (f", tool events {tool_counts}" if tool_counts else ""))
    print("messages per seat:", ", ".join(f"{k} {v}" for k, v in sorted(per_seat.items())))
    print("sheet columns:", ", ".join(columns))
    if empty_journals:
        print(f"warning: {empty_journals} journal event(s) had no matching text in journals/*.md")
    print("wrote transcript.md, coding_sheet.csv" + (", transcript.jsonl" if shape.startswith("B") else ""))
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("session_dir")
    ap.add_argument("--sheet", choices=["chat", "task"], help="override room-type detection")
    ap.add_argument("--full-tools", action="store_true", help="inline file contents, code, output and search results")
    ap.add_argument("--max-chars", type=int, default=2000, help="cap per inlined block with --full-tools (0 = no cap)")
    a = ap.parse_args(argv)
    return export(a.session_dir, a.sheet, a.full_tools, a.max_chars)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
