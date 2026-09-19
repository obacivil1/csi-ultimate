"""اختبارات سجل القرارات — بلا شبكة."""
from __future__ import annotations

import json
import pathlib

from recon.decider.decision_log import DecisionLog


def test_empty_file_verifies():
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        log = DecisionLog(pathlib.Path(d) / "decisions.jsonl")
        ok, _ = log.verify()
        assert ok is True


def test_append_three_verify_true(tmp_path):
    log = DecisionLog(tmp_path / "decisions.jsonl")
    log.log({"decision": "ابدأ من A", "reason": "الأعلى قيمة"})
    log.log({"decision": "اترك B", "reason": "منخفضة"})
    log.log({"decision": "أعد الفحص", "reason": "نتيجة غامضة"})
    ok, msg = log.verify()
    assert ok, msg
    assert len(list(log.entries())) == 3


def test_returned_dict_shape(tmp_path):
    log = DecisionLog(tmp_path / "decisions.jsonl")
    stored = log.log({"decision": "x"})
    assert set(stored.keys()) >= {"decision", "seq", "ts", "prev_hash", "hash"}
    assert stored["seq"] == 0
    assert len(stored["hash"]) == 64


def test_seq_increments(tmp_path):
    log = DecisionLog(tmp_path / "decisions.jsonl")
    a = log.log({"n": 1})
    b = log.log({"n": 2})
    assert (a["seq"], b["seq"]) == (0, 1)
    assert b["prev_hash"] == a["hash"]


def test_tamper_breaks_chain(tmp_path):
    p = tmp_path / "decisions.jsonl"
    log = DecisionLog(p)
    log.log({"d": 1})
    log.log({"d": 2})
    lines = p.read_text(encoding="utf-8").splitlines()
    obj = json.loads(lines[0])
    obj["d"] = 999  # عبث بالسطر الأول
    lines[0] = json.dumps(obj, sort_keys=True, separators=(",", ":"))
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    ok, msg = DecisionLog(p).verify()
    assert ok is False


def test_reopen_continues_chain(tmp_path):
    p = tmp_path / "decisions.jsonl"
    DecisionLog(p).log({"n": 1})
    log2 = DecisionLog(p)
    log2.log({"n": 2})
    ok, _ = log2.verify()
    assert ok
    entries = list(log2.entries())
    assert [e["seq"] for e in entries] == [0, 1]


def test_corrupt_line_fails(tmp_path):
    p = tmp_path / "decisions.jsonl"
    DecisionLog(p).log({"ok": 1})
    with p.open("a", encoding="utf-8") as f:
        f.write("NOT JSON\n")
    ok, msg = DecisionLog(p).verify()
    assert ok is False


def test_entries_in_order(tmp_path):
    log = DecisionLog(tmp_path / "decisions.jsonl")
    for i in range(5):
        log.log({"i": i})
    assert [e["i"] for e in log.entries()] == [0, 1, 2, 3, 4]
