#!/usr/bin/env python3
"""Checks that evalkit.py reproduces shared/metrics.test.ts and the lecture's worked numbers.

    python3 test_evalkit.py
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from evalkit import Stat, aggregate, bernoulli, cohen_kappa, parse_label, stat_delta  # noqa: E402


def near(a, b, eps=1e-9):
    assert abs(a - b) < eps, f"{a} != {b}"


def test_aggregate_matches_metrics_test_ts():
    s = aggregate([0, 1, 1, 0, 1])          # "aggregateStat computes the distribution"
    assert s.count == 5 and s.total == 3 and s.lo == 0 and s.hi == 1
    near(s.mean, 0.6)
    near(s.variance, 0.24)                  # 3/5 − 0.6²
    near(s.stddev, math.sqrt(0.24))


def test_empty_stat_is_safe():
    s = Stat()
    assert s.count == 0 and s.mean == 0 and s.variance == 0 and s.stddev == 0


def test_merge_is_associative():
    whole = aggregate([0, 1, 1, 0, 1])
    merged = aggregate([0, 1, 1]).merge(aggregate([0, 1]))
    near(merged.mean, whole.mean)
    near(merged.variance, whole.variance)
    assert merged.count == whole.count


def test_delta_flags_a_real_shift():
    a = aggregate([0, 0, 0, 0, 0, 0, 0, 1, 0, 0])
    b = aggregate([1, 1, 1, 1, 1, 1, 1, 0, 1, 1])
    d = stat_delta(a, b)
    near(d.mean_delta, 0.8)
    assert d.z > 2 and d.significant


def test_delta_treats_overlap_as_noise():
    d = stat_delta(aggregate([0, 1, 0, 1, 0]), aggregate([0, 1, 1, 0, 1]))
    assert not d.significant


def test_delta_perfect_separation_and_no_change():
    d = stat_delta(aggregate([0, 0, 0]), aggregate([1, 1, 1]))
    assert d.stderr == 0 and d.z == math.inf and d.significant
    s = aggregate([0, 1, 0, 1])
    d0 = stat_delta(s, s)
    assert d0.mean_delta == 0 and d0.z == 0 and not d0.significant


def test_lecture_worked_numbers():
    d = stat_delta(aggregate(bernoulli(2, 16)), aggregate(bernoulli(5, 16)))
    near(d.mean_delta, 0.1875)
    assert abs(d.stderr - 0.1424) < 5e-4
    assert abs(d.z - 1.32) < 0.01 and not d.significant
    d2 = stat_delta(aggregate(bernoulli(0, 16)), aggregate(bernoulli(5, 16)))
    assert abs(d2.z - 2.70) < 0.01 and d2.significant


def test_kappa_textbook_case():
    # p_o = 0.7, each coder says "yes" half the time, so p_e = 0.5 and κ = 0.4
    a = [1] * 10 + [0] * 10
    b = [1] * 7 + [0] * 3 + [1] * 3 + [0] * 7
    near(cohen_kappa(a, b), 0.4)
    near(cohen_kappa(a, a), 1.0)


def test_kappa_report_handles_nominal_columns(tmp_dir=None):
    import tempfile, os as _os
    from evalkit import kappa_report
    d = tempfile.mkdtemp()
    a = _os.path.join(d, "a.csv"); b = _os.path.join(d, "b.csv")
    open(a, "w").write("id,meta_talk,speech_act,doubt,notes\n1,meta,propose,no,x\n2,not-meta,assent,no,\n3,not-meta,,yes,\n4,meta,challenge,no,\n")
    open(b, "w").write("id,meta_talk,speech_act,doubt,notes\n1,meta,propose,no,\n2,not-meta,challenge,no,\n3,not-meta,reflect,yes,\n4,meta,challenge,no,\n")
    rep = kappa_report(a, b)
    assert "meta_talk" in rep and "1.00" in rep          # perfect agreement on meta_talk
    assert "speech_act" in rep and "(n=3)" in rep         # item 3 unlabelled by coder a -> dropped
    assert "3       speech_act" not in rep                 # and not listed as a disagreement
    assert "2       speech_act" in rep                     # the real disagreement is


def test_parse_label_cases():
    pd = ["COOPERATE", "DEFECT"]
    assert parse_label("COOPERATE: I trust them.", pd).label == "COOPERATE"
    amb = parse_label("I would never COOPERATE with that. DEFECT.", pd)
    assert amb.label is None and not amb.parse_ok
    assert parse_label("**DEFECT** — horizon unknown.", pd).label == "DEFECT"
    trolley = ["PULL", "DONT_PULL", "PUSH", "DONT_PUSH", "SACRIFICE", "DONT_SACRIFICE", "REFUSES"]
    assert parse_label("DONT_PULL: I refuse to intervene.", trolley).label == "DONT_PULL"
    none = parse_label("I decline to play this scenario.", pd)
    assert none.label is None and not none.parse_ok


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print("ok  ", t.__name__)
    print(f"{len(tests)} passed")
