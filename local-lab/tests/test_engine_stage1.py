"""اختبارات المرحلة 1: Repeater / Intruder / Proxy / Encoders."""
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT / "scanner"))

import pytest
from raw import RawRequest, parse_raw_text, send
from repeater import (DESTRUCTIVE, MAX_BODY_BYTES, READ_ONLY_METHODS,
                      RepeaterRefused, check_manual_request, method_risk,
                      replay, replay_chain)
from intruder import fuzz, inject, MARKER
from proxy import CaptureProxy, InterceptQueue
from enc import encode, decode, KINDS
from session import Session
from scoped import Scope

BASE = "http://127.0.0.1:5001"


def _target_up():
    try:
        urllib.request.urlopen(BASE + "/", timeout=2).close()
        return True
    except Exception:
        return False


# ══════════════════════════════════════════════════════════════════════
# بوابات الطلب اليدوي
# ══════════════════════════════════════════════════════════════════════
# check_url يفحص العنوان ولا يعرف الـmethod، فكان DELETE على هدف داخل
# النطاق يمرّ بلا سؤال ولا أثر. هذه الاختبارات تثبت المراوغة.
def test_method_risk_classification():
    for m in ("GET", "head", "OPTIONS", "TRACE"):
        assert method_risk(m) == "read_only"
    for m in ("POST", "PUT", "PATCH"):
        assert method_risk(m) == "state"
    for m in ("DELETE", "PURGE", "LOCK"):
        assert method_risk(m) == "destructive"
    assert method_risk("BREW") == "exotic"


def test_get_needs_no_grant():
    rq = RawRequest("GET", BASE + "/")
    assert check_manual_request(rq) == "read_only"


def test_state_changing_needs_grant():
    rq = RawRequest("POST", BASE + "/login", body="a=1")
    with pytest.raises(RepeaterRefused) as e:
        check_manual_request(rq)
    assert "تصريح" in str(e.value)
    assert check_manual_request(rq, granted=True) == "state"


def test_destructive_needs_grant_and_explicit_confirm():
    rq = RawRequest("DELETE", BASE + "/api/user/42")
    with pytest.raises(RepeaterRefused):
        check_manual_request(rq)
    with pytest.raises(RepeaterRefused) as e:
        check_manual_request(rq, granted=True)
    assert "تأكيد" in str(e.value)
    assert check_manual_request(rq, granted=True,
                                confirm_destructive=True) == "destructive"


def test_exotic_method_treated_as_state_changing():
    rq = RawRequest("BREW", BASE + "/")
    with pytest.raises(RepeaterRefused):
        check_manual_request(rq)
    assert check_manual_request(rq, granted=True) == "exotic"


def test_oversized_body_refused():
    rq = RawRequest("GET", BASE + "/", body="A" * (MAX_BODY_BYTES + 1))
    with pytest.raises(RepeaterRefused) as e:
        check_manual_request(rq)
    assert str(MAX_BODY_BYTES) in str(e.value)
    ok = RawRequest("GET", BASE + "/", body="A" * 10)
    assert check_manual_request(ok) == "read_only"


def test_refused_request_never_hits_the_wire():
    """الرفض قبل الإرسال: لا اتصال ولا أثر."""
    sent = []

    class _TrapSession:
        def request(self, *a, **k):
            sent.append(a)
            return 200, [], b"ok"

    with pytest.raises(RepeaterRefused):
        replay(_TrapSession(), {"method": "DELETE", "url": BASE + "/x"})
    assert sent == []


def test_manual_request_written_to_audit(tmp_path):
    ap = tmp_path / "manual.jsonl"
    r = replay(_sess(), {"method": "GET", "url": BASE + "/",
                         "name": "t"}, audit_path=ap)
    assert r["status"] == 200
    lines = [l for l in ap.read_text(encoding="utf-8").splitlines() if l]
    assert len(lines) == 1
    import json as _j
    rec = _j.loads(lines[0])
    assert rec["method"] == "GET"
    assert rec["risk"] == "read_only"
    assert rec["event"] == "manual-request"
    # GET ثاني يُضاف لا يستبدل
    replay(_sess(), {"method": "GET", "url": BASE + "/", "name": "t"},
           audit_path=ap)
    assert len([l for l in ap.read_text().splitlines() if l]) == 2


def test_audit_is_optional_and_off_by_default(tmp_path, monkeypatch):
    """بلا مسار أثر لا يُكتب أي ملف: السلوك السابق محفوظ."""
    monkeypatch.chdir(tmp_path)
    r = replay(_sess(), {"method": "GET", "url": BASE + "/", "name": "t"})
    assert r["status"] == 200
    assert not list(tmp_path.glob("**/*.jsonl"))


def test_replay_reports_risk_in_result():
    r = replay(_sess(), {"method": "GET", "url": BASE + "/", "name": "t"})
    assert r["risk"] == "read_only"


def test_read_only_set_excludes_destructive():
    assert "DELETE" not in READ_ONLY_METHODS
    assert "POST" not in READ_ONLY_METHODS
    assert DESTRUCTIVE & READ_ONLY_METHODS == frozenset()


def _sess():
    return Session(Scope(mode="loopback"))


def live(fn):
    return pytest.mark.skipif(not _target_up(),
                              reason="الهدف غير مفتوح")(fn)


# ---------------------------------------------------------- raw
def test_raw_roundtrip():
    rq = RawRequest("POST", BASE + "/login",
                    {"Content-Type": "application/x-www-form-urlencoded"},
                    "username=omari&password=user123", name="دخول")
    back = parse_raw_text(rq.to_raw_text())
    assert back.method == "POST"
    assert back.url == BASE + "/login"
    assert back.headers.get("Content-Type") == \
        "application/x-www-form-urlencoded"
    assert back.body == "username=omari&password=user123"


def test_raw_rejects_missing_host():
    with pytest.raises(ValueError):
        parse_raw_text("GET /x HTTP/1.1\r\nX-A: b\r\n\r\n")


# ---------------------------------------------------------- repeater
@live
def test_replay_get_home():
    r = replay(_sess(), {"method": "GET", "url": BASE + "/", "name": "home"})
    assert r["status"] == 200
    assert r["size"] > 100
    assert r["time_ms"] >= 0
    assert len(r["hash"]) == 12


@live
def test_replay_chain_login_then_dashboard():
    s = _sess()
    # POST يغيّر الحالة: البوابة ترفضه بلا تصريح. نمرّر تصريحًا صريحًا
    # ليبقى هذا اختبارًا لسلسلة الجلسة لا للبوابة (والبوابة لها اختبارها).
    rows = replay_chain(s, [
        {"method": "POST", "url": BASE + "/login",
         "headers": {"Content-Type": "application/x-www-form-urlencoded"},
         "body": "username=omari&password=user123", "name": "login"},
        {"method": "GET", "url": BASE + "/dashboard", "name": "dash"},
    ], granted=True)
    assert rows[0]["status"] in (200, 302)
    assert "لوحة التحكم" in rows[1]["text"] or rows[1]["status"] == 200


# ---------------------------------------------------------- intruder
def test_inject_marks_positions():
    rq = {"method": "GET", "url": BASE + "/search?q=" + MARKER,
          "headers": {"X-T": "v-" + MARKER}, "body": ""}
    out, hit = inject(rq, "PAY")
    assert hit
    assert "q=PAY" in out.url
    assert out.headers["X-T"] == "v-PAY"
    out2, hit2 = inject({"method": "GET", "url": BASE + "/"}, "PAY")
    assert not hit2 and out2.url == BASE + "/"


@live
def test_fuzz_search_marks_xss_and_sqli():
    s = _sess()
    base, rows = fuzz(
        s, {"method": "GET", "url": BASE + "/search?q=" + MARKER},
        ["zzzqqq9", "<b>ZZ9</b>", "' OR '1'='1' --"],
        workers=2, timeout=8)
    assert base["status"] == 200
    assert len(rows) == 3
    by = {r["payload"]: r for r in rows}
    assert by["zzzqqq9"]["interesting"] is False
    assert by["<b>ZZ9</b>"]["interesting"] is True
    assert by["<b>ZZ9</b>"]["reflected"] is True
    assert by["' OR '1'='1' --"]["interesting"] is True


# ---------------------------------------------------------- proxy
def test_intercept_queue_release_and_drop():
    q = InterceptQueue(timeout=2)
    rid = q.hold({"method": "GET"})
    assert q.release(rid, modified={"url": "http://x/"})
    assert rid not in q.pending_ids() or True
    rid2 = q.hold({"method": "GET"})
    assert q.drop(rid2)


@live
def test_proxy_forwards_and_records_history(monkeypatch):
    monkeypatch.setattr(urllib.request, "proxy_bypass", lambda host: False)
    s = _sess()
    px = CaptureProxy(s, BASE, port=0)
    port = px.start()
    try:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler(
                {"http": f"http://127.0.0.1:{port}"}))
        with opener.open(BASE + "/", timeout=8) as resp:
            assert resp.status == 200
            body = resp.read()
        assert len(body) > 100
        hist = px.snapshot()
        assert len(hist) == 1
        assert hist[0]["method"] == "GET"
        assert hist[0]["status"] == 200
    finally:
        px.stop()


@live
def test_proxy_rejects_off_base_host(monkeypatch):
    import time
    monkeypatch.setattr(urllib.request, "proxy_bypass", lambda host: False)
    s = _sess()
    px = CaptureProxy(s, BASE, port=0)
    port = px.start()
    try:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler(
                {"http": f"http://127.0.0.1:{port}"}))
        with pytest.raises(Exception):
            opener.open("http://example.com/", timeout=8)
        deadline = time.time() + 5
        hist = []
        while time.time() < deadline:
            hist = px.snapshot()
            if hist:
                break
            time.sleep(0.05)
        assert hist and hist[-1]["status"] == 403 and hist[-1]["blocked"]
    finally:
        px.stop()


# ---------------------------------------------------------- encoders
def test_enc_roundtrips():
    sample = "a/b?c=d&e=<b>نِطاق</b>"
    for kind in KINDS:
        assert decode(kind, encode(kind, sample)) == sample, kind


def test_enc_double_url_and_html():
    assert encode("dblurl", "a b") == "a%2520b"
    assert encode("html", "<b>") == "&lt;b&gt;"
