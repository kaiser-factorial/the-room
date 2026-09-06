#!/usr/bin/env python3
"""Checks export_session.py on a synthetic session in the-room's own export layout.

    python3 test_export_session.py

The fixture is invented (three seats, two rounds, one journal, one of each tool event);
it exists to pin the file formats, not to stand in for any real session.
"""

import csv
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export_session import CHAT_COLUMNS, TASK_COLUMNS, detect_room_type, export  # noqa: E402


def make_session(root: Path, task: bool) -> Path:
    d = root / "2026-01-01T00-00-00"
    (d / "journals").mkdir(parents=True)
    ev = [
        {"kind": "meta", "ts": "2026-01-01T00:00:00.000+00:00", "round": 0,
         "payload": {"condition": {"name": "site" if task else "house", "completion": {"enabled": task}}}},
        {"kind": "system", "ts": "2026-01-01T00:00:00.100+00:00", "round": 0, "text": "Welcome."},
        {"kind": "order", "ts": "2026-01-01T00:00:00.200+00:00", "round": 1, "order": ["a", "b", "c"]},
        {"kind": "message", "ts": "2026-01-01T00:00:01.000+00:00", "round": 1, "agentId": "a", "agentName": "Alpha", "text": "First."},
        {"kind": "journal", "ts": "2026-01-01T00:00:02.000+00:00", "round": 1, "agentId": "b", "agentName": "Beta"},
        {"kind": "message", "ts": "2026-01-01T00:00:03.000+00:00", "round": 1, "agentId": "b", "agentName": "Beta", "text": "Second."},
        {"kind": "message", "ts": "2026-01-01T00:00:04.000+00:00", "round": 1, "agentId": "c", "agentName": "Gamma", "text": "Third."},
    ]
    if task:
        ev += [
            {"kind": "run", "ts": "2026-01-01T00:00:05.000+00:00", "round": 2, "agentId": "a", "agentName": "Alpha", "code": "print(1)\nprint(2)", "output": "1\n2", "public": True, "notice": True},
            {"kind": "file", "ts": "2026-01-01T00:00:06.000+00:00", "round": 2, "agentId": "a", "agentName": "Alpha", "name": "index.html", "content": "<h1>x</h1>" * 300, "notice": True},
            {"kind": "search", "ts": "2026-01-01T00:00:07.000+00:00", "round": 2, "agentId": "b", "agentName": "Beta", "query": "tides", "results": "moon", "notice": True},
            {"kind": "source", "ts": "2026-01-01T00:00:08.000+00:00", "round": 2, "agentId": "c", "agentName": "Gamma", "name": "parse.ts", "notice": True},
            {"kind": "config", "ts": "2026-01-01T00:00:09.000+00:00", "round": 2, "agentId": "c", "agentName": "Gamma", "key": "runPublic", "value": "true"},
            {"kind": "message", "ts": "2026-01-01T00:00:10.000+00:00", "round": 2, "agentId": "a", "agentName": "Alpha", "text": "Standing on [DONE]."},
            {"kind": "system", "ts": "2026-01-01T00:00:10.100+00:00", "round": 2, "agentId": "a", "text": "Alpha says the work is finished."},
        ]
    ev.append({"kind": "end", "ts": "2026-01-01T00:00:11.000+00:00", "round": -1, "payload": {"adminTouched": False}})
    (d / "transcript.jsonl").write_text("\n".join(json.dumps(e) for e in ev) + "\n")
    (d / "journals" / "b.md").write_text("\n## Round 1 — 2026-01-01T00:00:02.000Z\n\nPrivate note.\n")
    return d


def read_sheet(d: Path):
    with open(d / "coding_sheet.csv", newline="") as f:
        return list(csv.DictReader(f))


def test_chat_room():
    with tempfile.TemporaryDirectory() as tmp:
        d = make_session(Path(tmp), task=False)
        assert export(str(d)) == 0
        rows = read_sheet(d)
        assert [r["id"] for r in rows] == ["M001", "J01", "M002", "M003"]
        assert list(rows[0].keys()) == ["id", "round", "seat", "channel", *CHAT_COLUMNS, "notes"]
        md = (d / "transcript.md").read_text()
        assert "Room type: **chat**" in md
        assert "### J01 · Beta — private journal entry\n\nPrivate note." in md  # matched by timestamp
        assert "> *speaking order:* a → b → c" in md


def test_task_room_and_tool_lines():
    with tempfile.TemporaryDirectory() as tmp:
        d = make_session(Path(tmp), task=True)
        assert export(str(d)) == 0
        rows = read_sheet(d)
        assert list(rows[0].keys()) == ["id", "round", "seat", "channel", *TASK_COLUMNS, "notes"]
        assert [r["id"] for r in rows][-1] == "M004"
        md = (d / "transcript.md").read_text()
        assert "Room type: **task**" in md
        assert "> *run:* Alpha ran python — 2 lines, output 3 chars" in md
        assert "> *file:* Alpha wrote `index.html` — 3,000 chars" in md
        assert "> *search:* Beta searched: 'tides' — results 4 chars, private to the requester" in md
        assert "> *source:* Gamma read `parse.ts`" in md
        assert "> *config:* Gamma set `runPublic` = `true`" in md
        assert "<h1>x</h1>" not in md                      # contents stay out unless asked
        # --full-tools inlines, capped
        assert export(str(d), full_tools=True, max_chars=100) == 0
        md = (d / "transcript.md").read_text()
        assert "```python\nprint(1)\nprint(2)\n```" in md
        assert "…[3,000 chars total]" in md


def test_sheet_override_and_detection():
    with tempfile.TemporaryDirectory() as tmp:
        d = make_session(Path(tmp), task=True)
        assert export(str(d), sheet="chat") == 0
        assert list(read_sheet(d)[0].keys()) == ["id", "round", "seat", "channel", *CHAT_COLUMNS, "notes"]
        lines = [json.loads(l) for l in (d / "transcript.jsonl").read_text().splitlines()]
        assert detect_room_type(lines)[0] == "task"
        assert detect_room_type([e for e in lines if e["kind"] not in ("meta", "run", "file", "search", "source", "config")])[0] == "chat"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print("ok  ", t.__name__)
    print(f"{len(tests)} passed")
