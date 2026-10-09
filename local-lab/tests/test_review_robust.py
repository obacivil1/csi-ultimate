"""اختبارات مراجعة المتانة: قفل التدقيق + تحليل مرن."""
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scanner"))
sys.path.insert(0, str(ROOT / "engine"))

from local_scan import AuditLog
from raw import parse_raw_text


def test_audit_concurrent_appends_stay_chained(tmp_path):
    log = AuditLog(tmp_path / "audit.jsonl")

    def worker(n):
        for i in range(25):
            log.append({"event": "t", "w": n, "i": i})

    threads = [threading.Thread(target=worker, args=(n,)) for n in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    lines = [l for l in (tmp_path / "audit.jsonl").read_text(
        encoding="utf-8").splitlines() if l.strip()]
    assert len(lines) == 100, len(lines)
    assert log.verify_tail(), "السلسلة انكسرت تحت التزامن"


def test_audit_accepts_str_path(tmp_path):
    log = AuditLog(str(tmp_path / "a.jsonl"))
    log.append({"e": 1})
    assert log.verify_tail()


def test_parse_raw_tolerates_tight_colon():
    rq = parse_raw_text("POST /x HTTP/1.1\r\nHost:127.0.0.1:5001\r\n"
                        "X-A:b\r\nContent-Type:application/json\r\n\r\n{}")
    assert rq.method == "POST"
    assert rq.url == "http://127.0.0.1:5001/x"
    assert rq.headers.get("X-A") == "b"
    assert rq.body == "{}"


def test_parse_raw_roundtrip_still_strict_on_host():
    import pytest
    with pytest.raises(ValueError):
        parse_raw_text("GET /x HTTP/1.1\r\nX-A: b\r\n\r\n")
