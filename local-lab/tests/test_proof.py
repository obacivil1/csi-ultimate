"""اختبارات إثبات الوجود + نظافة OPSEC المشروعة."""
import sys
import threading
from http.server import HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT / "scanner"))
sys.path.insert(0, str(ROOT / "tests"))

import pytest
from proof import (disclosure_state, export_certificate, get_engagement,
                   list_engagements, new_engagement, new_token,
                   record_plant, set_disclosure, verify_plant)
from test_deep import DeepFake


def test_token_unique_and_format():
    a, b = new_token(), new_token()
    assert a.startswith("GX9-") and a != b


def test_engagement_roundtrip(tmp_path):
    p = tmp_path / "p.json"
    assert list_engagements(path=p) == []
    rec = new_engagement("http://h/", note="ctf", path=p)
    assert rec["id"].startswith("ENG-") and rec["token"].startswith("GX9-")
    assert get_engagement(rec["id"], path=p)["target"] == "http://h/"
    assert get_engagement("ENG-NOPE", path=p) is None
    with pytest.raises(ValueError):
        record_plant("ENG-NOPE", "X", "Y", "Z", path=p)
    pl = record_plant(rec["id"], "D-UPLOAD", "/files/f.txt",
                      "GX9PROBE-ABC", path=p)
    assert pl["check"] == "D-UPLOAD"
    assert len(get_engagement(rec["id"], path=p)["plants"]) == 1


def test_certificate_reveals_and_guides(tmp_path):
    p = tmp_path / "p.json"
    rec = new_engagement("http://h/", path=p)
    record_plant(rec["id"], "D-UPLOAD", "/files/f.txt", "GX9-HINT",
                 path=p)
    assert disclosure_state(rec["id"], path=p) is None
    with pytest.raises(ValueError):
        export_certificate(rec["id"], path=p)  # محجوبة قبل القرار
    set_disclosure(rec["id"], False, path=p)
    assert disclosure_state(rec["id"], path=p) == "held"
    with pytest.raises(ValueError):
        export_certificate(rec["id"], path=p)  # محجوبة بعد الاحتجاب
    set_disclosure(rec["id"], True, path=p)
    assert disclosure_state(rec["id"], path=p) == "released"
    md = export_certificate(rec["id"], path=p)
    assert rec["token"] in md  # الكشف الكامل هنا فقط
    assert "يتحقق المالك" in md and "/files/f.txt" in md
    with pytest.raises(ValueError):
        export_certificate("ENG-NOPE", path=p)
    with pytest.raises(ValueError):
        set_disclosure("ENG-NOPE", True, path=p)


def test_verify_plant_live():
    from session import Session
    from scoped import Scope
    DeepFake.FILES = {}
    srv = HTTPServer(("127.0.0.1", 0), DeepFake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d/" % srv.server_address[1]
    try:
        s = Session(Scope(mode="authorized", allow=[base.rstrip("/")],
                          confirm=True))
        s.post(base + "upload", fields={},
               files={"f": ("gx9proof_t.txt", b"MARK-GX9-LIVE")})
        ok = verify_plant(s, base, {"location": "/files/gx9proof_t.txt",
                                    "marker_hint": "MARK-GX9-LIVE"})
        assert ok["ok"] is True
        bad = verify_plant(s, base, {"location": "/files/gx9proof_t.txt",
                                     "marker_hint": "WRONG"})
        assert bad["ok"] is False
    finally:
        srv.shutdown()


def test_upload_uses_proof_token():
    from session import Session
    from scoped import Scope
    from deep import DEEP_CHECKS
    DeepFake.FILES = {}
    srv = HTTPServer(("127.0.0.1", 0), DeepFake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d/" % srv.server_address[1]
    try:
        s = Session(Scope(mode="authorized", allow=[base.rstrip("/")],
                          confirm=True))
        s._proof_token = "ENGTEST1"
        s._generic_ctx = {
            "upload_forms": [{"action": base + "upload",
                              "file_field": "f", "inputs": []}],
            "probed": []}
        fn = next(m["fn"] for m in DEEP_CHECKS if m["code"] == "D-UPLOAD")
        code, _, verdict, note, ev = fn(s, base, "verify")
        assert verdict is True
        assert "ENGTEST1" in note
    finally:
        srv.shutdown()


def test_ua_override_is_honest():
    from session import Session
    from scoped import Scope
    s = Session(Scope(mode="loopback"))
    assert ("User-Agent", "LocalLab/1.0 (+local-only)") in \
        s.opener.addheaders
    s2 = Session(Scope(mode="loopback"), ua="Engagement-Test/1.0")
    assert ("User-Agent", "Engagement-Test/1.0") in s2.opener.addheaders


# ══════════════════════════════════════════════════════════════════════
# الحلقة الكاملة: إنشاء عملية → رفع كناري بالرمز → تسجيل الأثر → شهادة
# ══════════════════════════════════════════════════════════════════════
# ما كان ميتًا: new_engagement بلا أي مستدعٍ في التطبيق، لذا كان
# _eng_for_token في control.py يُرجع None دائمًا، فلم يُسجَّل أي أثر،
# وrecord_plant كان داخل try/except فتسكت بصمت. الاختبار القديم
# (test_submit_and_upload_with_grant) كان يمرّر رمزًا وهميًا "ENGT9"
# فيمرّ بلا أن يثبت شيئًا عن سلسلة الإثبات.
def test_full_engagement_loop_records_a_plant(tmp_path, monkeypatch):
    """الاختبار الذي كان مفقودًا: الأثر يُسجَّل فعلًا في العملية."""
    import control
    from control import upload_canary
    from session import Session
    from scoped import Scope
    from test_deep import DeepFake

    monkeypatch.setattr(control, "intrusive_granted",
                        lambda url, path=None: {"granted": True})
    p = tmp_path / "proofs.json"
    rec = new_engagement("http://127.0.0.1/", note="loop", path=p)
    token = rec["token"]

    DeepFake.FILES = {}
    srv = HTTPServer(("127.0.0.1", 0), DeepFake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d/" % srv.server_address[1]
    try:
        s = Session(Scope(mode="authorized", allow=[base.rstrip("/")],
                          confirm=True))
        out = upload_canary(s, base, base + "upload", "f", token, path=p)
        assert out["ok"] is True, out
        # هذا هو السطر الذي كان ميتًا بصمت:
        assert control._eng_for_token(token, p) == rec["id"]
        plants = get_engagement(rec["id"], path=p)["plants"]
        assert len(plants) == 1, f"لم يُسجَّل الأثر: {plants}"
        assert plants[0]["check"] == "CONTROL-UPLOAD"
        assert plants[0]["location"].endswith(out["file"])
        # الشهادة محجوبة قبل قرار الإفصاح، ثم تُصدر وتحتوي الأثر
        with pytest.raises(ValueError):
            export_certificate(rec["id"], path=p)
        set_disclosure(rec["id"], True, path=p)
        md = export_certificate(rec["id"], path=p)
        assert token in md
        assert out["file"] in md
    finally:
        srv.shutdown()


def test_unknown_token_records_nothing(tmp_path, monkeypatch):
    """رمز لا يطابق أي عملية: لا أثر، لا انهيار صامت."""
    import control
    from control import upload_canary
    from session import Session
    from scoped import Scope
    from test_deep import DeepFake

    monkeypatch.setattr(control, "intrusive_granted",
                        lambda url, path=None: {"granted": True})
    p = tmp_path / "proofs.json"
    new_engagement("http://127.0.0.1/", path=p)
    DeepFake.FILES = {}
    srv = HTTPServer(("127.0.0.1", 0), DeepFake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d/" % srv.server_address[1]
    try:
        s = Session(Scope(mode="authorized", allow=[base.rstrip("/")],
                          confirm=True))
        out = upload_canary(s, base, base + "upload", "f",
                            "GX9-NOT-A-REAL-TOKEN", path=p)
        assert out["ok"] is True          # الرفع نجح
        assert list_engagements(path=p)[0]["plants"] == []   # بلا أثر
    finally:
        srv.shutdown()
