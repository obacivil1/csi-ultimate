"""اختبارات REST API: صحة + فحوصات + دورة مهمة + تفويض."""
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

import pytest
from server import create_app

BASE = "http://127.0.0.1:5001/"


@pytest.fixture(scope="module")
def client():
    return create_app().test_client()


def test_health_and_checks(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json["ok"] is True
    r = client.get("/api/checks")
    codes = {c["code"] for c in r.json}
    assert len(codes) >= 25 and "SQLLOGIN" in codes


def test_scan_rejects_bad_input(client):
    assert client.post("/api/scan", json={}).status_code == 400
    assert client.post("/api/scan",
                       json={"target": BASE, "mode": "xx"}).status_code == 400
    r = client.post("/api/scan",
                    json={"target": "http://google.com/", "mode": "detect"})
    assert r.status_code in (400, 403)


def test_scan_authorized_needs_written_confirm(client):
    r = client.post("/api/scan", json={"target": "http://example.test/",
                                       "mode": "detect"})
    assert r.status_code == 403
    assert "أؤكد" in r.json["error"]


def test_scan_job_lifecycle_detect(client):
    import urllib.request
    try:
        urllib.request.urlopen(BASE, timeout=2).close()
    except Exception:
        pytest.skip("الهدف غير مفتوح")
    r = client.post("/api/scan", json={"target": BASE, "mode": "detect"})
    assert r.status_code == 202
    jid = r.json["job_id"]
    deadline = time.time() + 60
    while time.time() < deadline:
        j = client.get(f"/api/jobs/{jid}").json
        if j["status"] in ("done", "error", "denied"):
            break
        time.sleep(0.5)
    assert j["status"] == "done", j
    assert j["summary"]["checks_total"] >= 25
    assert "findings" in j


def test_unknown_job_404(client):
    assert client.get("/api/jobs/nope").status_code == 404


def test_external_scan_uses_readonly_generic_checks_not_lab_checks(client):
    """Regression (P0): an external /api/scan must NEVER run the invasive lab set.

    Previously _run_scan iterated local_scan.CHECKS (file upload, stored XSS,
    command injection, CSRF state change) for ANY target. Now external targets
    go through generic.audit_target which is GET-only. We point it at a
    deliberately unroutable host and assert (a) no invasive check code is
    reported, and (b) the check_set marker is the read-only generic set.
    """
    import server as srv

    calls = {"generic": 0, "lab": 0}

    class _FakeReport(dict):
        def __init__(self):
            super().__init__()
            self.summary = {"findings": 0, "checks_total": 0}
            self.findings = []
            self.meta = {}

    # Patch the two audit entry points to observe which one the API chooses.
    import local_scan
    import generic

    def _fake_audit_target(scope, base, mode="verify", auth_record=None, started=None):
        calls["generic"] += 1
        r = _FakeReport()
        r.meta["checks"] = len(generic.GENERIC_CHECKS)
        return r

    def _never_lab(*a, **kw):
        calls["lab"] += 1
        raise AssertionError("invasive local_scan.CHECKS used on an external target")

    orig_audit = generic.audit_target
    orig_run_check = local_scan.run_check
    generic.audit_target = _fake_audit_target
    local_scan.run_check = _never_lab
    try:
        with srv.create_app().test_client() as c:
            r = c.post("/api/scan", json={
                "target": "http://external.invalid/",
                "mode": "verify", "confirm": "أؤكد"})
            assert r.status_code == 202
            jid = r.json["job_id"]
            deadline = time.time() + 30
            while time.time() < deadline:
                j = c.get(f"/api/jobs/{jid}").json
                if j["status"] in ("done", "error", "denied"):
                    break
                time.sleep(0.3)
    finally:
        generic.audit_target = orig_audit
        local_scan.run_check = orig_run_check

    assert calls["lab"] == 0, "invasive lab checks ran against an external target!"
    assert calls["generic"] == 1, "read-only generic audit was not used"
    assert j["status"] == "done", j
    assert "GENERIC_CHECKS" in (j.get("check_set") or ""), j.get("check_set")
    assert "local_scan.CHECKS" not in (j.get("check_set") or ""), j.get("check_set")


def test_external_scan_confirm_still_required(client):
    """The written-confirmation gate for external targets must remain."""
    r = client.post("/api/scan", json={"target": "http://external.invalid/",
                                       "mode": "verify"})
    assert r.status_code == 403
    assert "أؤكد" in r.json["error"]
