#!/usr/bin/env python3
"""
evalkit.py — an evaluation pipeline in one dependency-free Python file.

Four things (written for repo-teacher's Lecture 6 on model and harness evals; also shipped in
the-room under eval/):

  Stat / stat_delta   a metric as a distribution; the z-test on a difference of means
                      (a port of cooperationengine's shared/metrics.ts, population variance)
  cohen_kappa         chance-corrected agreement between two coders
  kappa_report        per-column and pooled kappa from two coding sheets, binary or nominal columns
  parse_label         a label parser: first-line anchor, whole-word match, parse status, never guesses

Command line:
  python3 evalkit.py delta  K_A N_A K_B N_B          # e.g. delta 2 16 5 16
  python3 evalkit.py kappa  coder_a.csv coder_b.csv   # sheets with an id column + code columns
  python3 evalkit.py parse  "reply text" LABEL [LABEL ...]

Standard library only. Python 3.10 or newer.
"""

from __future__ import annotations

import csv
import math
import re
import sys
from dataclasses import dataclass, field
from typing import Iterable, Sequence


# ---------------------------------------------------------------------------
# Stat — a port of shared/metrics.ts (population variance, running sums)
# ---------------------------------------------------------------------------
@dataclass
class Stat:
    name: str = "metric"
    count: int = 0
    total: float = 0.0
    sum_squared: float = 0.0
    lo: float = field(default=math.inf)
    hi: float = field(default=-math.inf)

    @property
    def mean(self) -> float:
        return self.total / self.count if self.count else 0.0

    @property
    def variance(self) -> float:
        # Population variance, as in metrics.ts (HELM's statistic.py): E[x²] − E[x]², floored at 0.
        if not self.count:
            return 0.0
        return max(0.0, self.sum_squared / self.count - self.mean ** 2)

    @property
    def stddev(self) -> float:
        return math.sqrt(self.variance)

    @property
    def stderr(self) -> float:
        """Standard error of the mean, √(var / n)."""
        return math.sqrt(self.variance / self.count) if self.count else 0.0

    def add(self, value: float) -> "Stat":
        return Stat(self.name, self.count + 1, self.total + value, self.sum_squared + value * value,
                    min(self.lo, value), max(self.hi, value))

    def merge(self, other: "Stat") -> "Stat":
        if self.count == 0:
            return Stat(self.name, other.count, other.total, other.sum_squared, other.lo, other.hi)
        if other.count == 0:
            return self
        return Stat(self.name, self.count + other.count, self.total + other.total,
                    self.sum_squared + other.sum_squared, min(self.lo, other.lo), max(self.hi, other.hi))


def aggregate(values: Iterable[float], name: str = "metric") -> Stat:
    s = Stat(name)
    for v in values:
        s = s.add(v)
    return s


def bernoulli(k: int, n: int) -> list[int]:
    """k successes out of n, as a 0/1 column."""
    if not 0 <= k <= n:
        raise ValueError("need 0 <= k <= n")
    return [1] * k + [0] * (n - k)


@dataclass
class StatDelta:
    mean_delta: float
    stderr: float
    z: float
    significant: bool


def stat_delta(a: Stat, b: Stat, threshold: float = 2.0) -> StatDelta:
    """b.mean − a.mean, its standard error, z, and a significance gate. Same semantics as statDelta()."""
    mean_delta = b.mean - a.mean
    se_a = a.variance / a.count if a.count else 0.0
    se_b = b.variance / b.count if b.count else 0.0
    stderr = math.sqrt(se_a + se_b)
    if stderr > 0:
        z = mean_delta / stderr
    elif mean_delta == 0:
        z = 0.0
    else:
        z = math.inf if mean_delta > 0 else -math.inf
    return StatDelta(mean_delta, stderr, z, abs(z) >= threshold)


# ---------------------------------------------------------------------------
# Cohen's kappa — chance-corrected agreement between two nominal codings
# ---------------------------------------------------------------------------
def cohen_kappa(a: Sequence, b: Sequence) -> float:
    """κ = (p_o − p_e) / (1 − p_e). Returns 1.0 when both coders are constant and identical."""
    if len(a) != len(b) or not a:
        raise ValueError("need two non-empty sequences of equal length")
    n = len(a)
    labels = set(a) | set(b)
    p_o = sum(1 for x, y in zip(a, b) if x == y) / n
    p_e = sum((list(a).count(l) / n) * (list(b).count(l) / n) for l in labels)
    if p_e == 1.0:
        return 1.0 if p_o == 1.0 else 0.0
    return (p_o - p_e) / (1 - p_e)


def kappa_band(k: float) -> str:
    """Landis & Koch (1977) labels. A convention, not evidence: report the number too."""
    if k < 0:
        return "no agreement"
    if k <= 0.20:
        return "slight"
    if k <= 0.40:
        return "fair"
    if k <= 0.60:
        return "moderate"
    if k <= 0.80:
        return "substantial"
    return "almost perfect"


def read_sheet(path: str) -> tuple[list[str], dict[str, dict[str, int]]]:
    """A coding sheet: header row with `id` then code columns. A column is binary (0/1, blank = 0)
    or nominal (any label strings, e.g. propose/assent/challenge); kappa works for both. Columns
    whose names start with evidence/note/text/round/seat/channel/agent are context, not codes."""
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows or "id" not in rows[0]:
        raise ValueError(f"{path}: need a header row starting with 'id'")
    skip = ("evidence", "note", "text", "round", "seat", "channel", "agent")
    codes = [c for c in rows[0].keys() if c != "id" and not c.lower().startswith(skip)]
    data: dict[str, dict[str, str]] = {}
    for r in rows:
        data[r["id"]] = {c: _cell(r.get(c, "")) for c in codes}
    return codes, data


def _cell(raw: object) -> str:
    """Normalise one sheet cell. Binary marks become "1"/"0"; anything else is a nominal label."""
    v = str(raw).strip()
    if v in ("1", "x", "X", "yes", "true"):
        return "1"
    if v in ("", "0", "no", "false"):
        return "0"
    return v.lower()


def kappa_report(path_a: str, path_b: str) -> str:
    codes_a, a = read_sheet(path_a)
    codes_b, b = read_sheet(path_b)
    codes = [c for c in codes_a if c in codes_b]
    ids = [i for i in a if i in b]
    if not ids or not codes:
        raise ValueError("the two sheets share no ids or no code columns")
    out = [f"{len(ids)} items, {len(codes)} shared codes", ""]
    out.append(f"{'code':<26}{'agree':>7}{'kappa':>8}   band")
    pooled_a, pooled_b = [], []
    for c in codes:
        values = {a[i][c] for i in ids} | {b[i][c] for i in ids}
        if values == {"0"}:
            out.append(f"{c:<26}{'—':>7}{'—':>8}   no labels in either sheet")
            continue
        nominal = not values <= {"0", "1"}
        # In a nominal column a blank ("0") means "not labelled": drop those items from that column.
        use = [i for i in ids if not nominal or (a[i][c] != "0" and b[i][c] != "0")]
        if not use:
            out.append(f"{c:<26}{'—':>7}{'—':>8}   no items labelled by both")
            continue
        xa = [a[i][c] for i in use]
        xb = [b[i][c] for i in use]
        pooled_a += xa
        pooled_b += xb
        agree = sum(1 for x, y in zip(xa, xb) if x == y) / len(use)
        k = cohen_kappa(xa, xb)
        out.append(f"{c:<26}{agree:>7.2f}{k:>8.2f}   {kappa_band(k)}" + (f"  (n={len(use)})" if nominal else ""))
    out.append("")
    if pooled_a:
        k_all = cohen_kappa(pooled_a, pooled_b)
        agree_all = sum(1 for x, y in zip(pooled_a, pooled_b) if x == y) / len(pooled_a)
        out.append(f"{'pooled over all cells':<26}{agree_all:>7.2f}{k_all:>8.2f}   {kappa_band(k_all)}")
    else:
        out.append("nothing to score yet: no column has labels in both sheets")
    disagreements = [(i, c) for c in codes for i in ids if a[i][c] != b[i][c] and not (
        {a[i][c], b[i][c]} & {"0"} and not ({a[i][c], b[i][c]} <= {"0", "1"}))]
    if disagreements:
        out.append("")
        out.append("disagreements (item, code) — each one is a codebook definition to revisit:")
        for i, c in disagreements:
            out.append(f"  {i:<8}{c}")
    return "\n".join(out)


# ---------------------------------------------------------------------------
# parse_label — the repaired grader (slide 7; the shape of PR #34)
# ---------------------------------------------------------------------------
@dataclass
class Parsed:
    label: str | None
    parse_ok: bool
    how: str


def parse_label(content: str, labels: Sequence[str]) -> Parsed:
    """First-line anchor, then a single whole-word hit, else null with parse_ok=False. Never guesses."""
    first_line = content.strip().split("\n", 1)[0].upper()
    by_length = sorted(labels, key=len, reverse=True)  # DONT_PULL before PULL
    for l in by_length:
        if re.match(r"^\W*" + re.escape(l.upper()) + r"\b", first_line):
            return Parsed(l, True, "first-line anchor")
    found = [l for l in by_length if re.search(r"\b" + re.escape(l) + r"\b", content, re.I)]
    if len(found) == 1:
        return Parsed(found[0], True, "single whole-word hit")
    return Parsed(None, False, "no label present" if not found else "ambiguous: " + ", ".join(found))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 1
    cmd, args = argv[1], argv[2:]
    if cmd == "delta" and len(args) == 4:
        k_a, n_a, k_b, n_b = map(int, args)
        d = stat_delta(aggregate(bernoulli(k_a, n_a)), aggregate(bernoulli(k_b, n_b)))
        print(f"A = {k_a}/{n_a} = {k_a / n_a:.4f}   B = {k_b}/{n_b} = {k_b / n_b:.4f}")
        print(f"Δ = {d.mean_delta:.4f}   SE = {d.stderr:.4f}   z = {d.z:.2f}   significant (|z| ≥ 2) = {d.significant}")
        return 0
    if cmd == "kappa" and len(args) == 2:
        print(kappa_report(*args))
        return 0
    if cmd == "parse" and len(args) >= 2:
        p = parse_label(args[0], args[1:])
        print(f"label={p.label}  parse_ok={p.parse_ok}  ({p.how})")
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
