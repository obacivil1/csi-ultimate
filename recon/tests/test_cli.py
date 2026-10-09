"""Tests for cli.py — verify-scope, scan, idor."""
from __future__ import annotations

import json
import hashlib
import pathlib
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx
import pytest

from recon.core.scope_validator import ScopeValidator


def _valid_scope_dict(tmp_path: pathlib.Path, expired=False):
    doc = tmp_path / "auth.pdf"
    doc.write_bytes(b"fake pdf")
    h = hashlib.sha256(b"fake pdf").hexdigest()
    now = datetime.now(timezone.utc)
    not_before = (now - timedelta(days=1)).isoformat()
    expires = (now - timedelta(days=1)).isoformat() if expired else (now + timedelta(days=30)).isoformat()
    return {
        "program_name": "Test Program",
        "program_url": "https://hackerone.com/test",
        "authorized_by": "Team",
        "authorization_document": "auth.pdf",
        "authorization_sha256": h,
        "not_before": not_before,
        "expires_at": expires,
        "contact_email": "r@example.com",
        "allowed_hosts": ["example.com"],
        "allowed_schemes": ["https"],
        "allowed_ports": [443],
        "denied_paths": [],
        "max_requests_per_host": 10,
        "max_requests_per_second": 10.0,
        "user_agent": "TestRecon/1.0 (+contact: r@example.com)",
    }


def test_verify_scope_valid(tmp_path, capsys):
    data = _valid_scope_dict(tmp_path)
    sf = tmp_path / "scope.json"
    sf.write_text(json.dumps(data), encoding="utf-8")
    from recon.cli import main

    with patch("builtins.input", return_value="I CONFIRM"):
        with pytest.raises(SystemExit) as exc:
            main(["verify-scope", "--scope", str(sf)])
        assert exc.value.code == 0


def test_verify_scope_expired(tmp_path):
    data = _valid_scope_dict(tmp_path, expired=True)
    sf = tmp_path / "scope.json"
    sf.write_text(json.dumps(data), encoding="utf-8")
    from recon.cli import main

    with patch("builtins.input", return_value="I CONFIRM"):
        with pytest.raises(SystemExit) as exc:
            main(["verify-scope", "--scope", str(sf)])
        assert exc.value.code == 2


@pytest.mark.asyncio
async def test_scan_missing_tool_continues(tmp_path):
    data = _valid_scope_dict(tmp_path)
    sf = tmp_path / "scope.json"
    sf.write_text(json.dumps(data), encoding="utf-8")
    from recon.cli import _run_scan
    from recon.core.scope_validator import ScopeValidator

    scope = ScopeValidator(sf)
    # cmd_scan would confirm via the real interactive gate; simulate it here
    # (the gate itself is tested in test_scope_validator).
    scope.mark_confirmed()
    out = tmp_path / "reports"
    # tools missing -> should be skipped but not raise
    with patch("recon.cli.require_operator_confirmation", return_value=None):
        with patch("shutil.which", return_value=None):
            await _run_scan(scope, "https://example.com/", ["katana", "httpx", "nuclei"], out)
            # check report exists
            reports = list(out.glob("report_*.json"))
            assert len(reports) == 1
            # brain + decider must be wired into the pipeline, not dead code
            assert (out / "brain.json").exists()
            assert (out / "decision.json").exists()
            rep = json.loads(reports[0].read_text(encoding="utf-8"))
            assert rep["recon"]["strategy"] == "balanced"
            assert rep["recon"]["brain"]["endpoints_count"] == 0
            assert rep["audit_chain_valid"] is True


@pytest.mark.asyncio
async def test_scan_reads_feedback_memory(tmp_path, monkeypatch):
    """الذاكرة كانت مقطوعة الطرفين: record بلا مستدعٍ، و decide بلا feedback.

    هذا يثبت أن مسار الإنتاج يقرأ السجل فعلًا (adjustment يظهر في
    decision.json كـadjusted_value بدل القيمة الخام).
    """
    from recon.cli import _feedback_path, _run_scan
    from recon.core.scope_validator import ScopeValidator
    from recon.decider.feedback_loop import FeedbackLoop

    mem = tmp_path / "feedback.jsonl"
    monkeypatch.setenv("RECON_FEEDBACK_PATH", str(mem))
    assert _feedback_path() == mem

    data = _valid_scope_dict(tmp_path)
    sf = tmp_path / "scope.json"
    sf.write_text(json.dumps(data), encoding="utf-8")
    scope = ScopeValidator(sf)
    scope.mark_confirmed()

    ep = tmp_path / "endpoints.txt"
    ep.write_text("https://example.com/api/user/1\n", encoding="utf-8")
    fb = FeedbackLoop(mem)
    for _ in range(3):
        fb.record("https://example.com/api/user/1", "idor", False, "وهم")

    out = tmp_path / "reports"
    # endpoints تُقرأ من مخرجات katana؛ الأداة مفقودة هنا، فنزرع الملف
    # مسبقًا ليمرّ نفس مسار القراءة بدل مسار فارغ.
    kat = out / "raw" / "katana" / "katana.txt"
    kat.parent.mkdir(parents=True, exist_ok=True)
    kat.write_text(ep.read_text(encoding="utf-8"), encoding="utf-8")
    with patch("recon.cli.require_operator_confirmation", return_value=None):
        with patch("shutil.which", return_value=None):
            await _run_scan(scope, "https://example.com/", ["katana"], out)

    decision = json.loads((out / "decision.json").read_text(encoding="utf-8"))
    hyps = [t for p in decision["plans"] for t in p.get("target_hypotheses", [])]
    hyps += decision.get("rejected", [])
    assert hyps, "لا فروض في القرار"
    hit = [h for h in hyps if h.get("adjusted_value") is not None]
    assert hit, "الذاكرة لم تُطبَّق: adjusted_value غائبة"
    # ثلاث أحكام وهمية → تعديل 0.5 كحد أدنى
    assert any(h["adjusted_value"] < h["value"] for h in hit), \
        f"التعديل لم يخفض القيمة: {hit}"


def test_feedback_command_records_and_reads(tmp_path, monkeypatch, capsys):
    """الطرف الآخر: أمر يكتب حكم المشغّل، والقراءة تعكسه فورًا."""
    from recon.cli import main

    mem = tmp_path / "feedback.jsonl"
    monkeypatch.setenv("RECON_FEEDBACK_PATH", str(mem))

    main(["feedback", "--url", "https://example.com/a", "--category", "idor",
          "--real", "--notes", "تحقق يدوي"])
    main(["feedback", "--url", "https://example.com/b", "--category", "xss",
          "--false"])
    out = capsys.readouterr().out
    assert "recorded" in out

    main(["feedback", "--stats"])
    stats = json.loads(capsys.readouterr().out)
    assert stats["total"] == 2
    assert stats["per_category"]["idor"]["real"] == 1
    assert stats["per_category"]["xss"]["false"] == 1


def test_feedback_command_requires_a_verdict(monkeypatch, tmp_path):
    from recon.cli import main

    monkeypatch.setenv("RECON_FEEDBACK_PATH", str(tmp_path / "fb.jsonl"))
    with pytest.raises(SystemExit) as exc:
        main(["feedback", "--url", "https://example.com/a"])
    assert exc.value.code == 2


@pytest.mark.asyncio
async def test_idor_one_endpoint_produces_one_finding(tmp_path):
    data = _valid_scope_dict(tmp_path)
    sf = tmp_path / "scope.json"
    sf.write_text(json.dumps(data), encoding="utf-8")
    from recon.core.scope_validator import ScopeValidator
    scope = ScopeValidator(sf)
    # _run_idor is called directly here (bypassing cmd_idor); simulate the
    # confirmation cmd_idor would have collected.
    scope.mark_confirmed()
    # endpoints file
    ep = tmp_path / "endpoints.txt"
    ep.write_text("https://example.com/api/123\n", encoding="utf-8")
    # sessions
    sess_a = tmp_path / "user_a.json"
    sess_a.write_text(json.dumps({"name": "user_a", "cookies": {"session": "a"}}), encoding="utf-8")
    sess_b = tmp_path / "user_b.json"
    sess_b.write_text(json.dumps({"name": "user_b", "cookies": {"session": "b"}}), encoding="utf-8")
    out = tmp_path / "reports"
    out.mkdir(parents=True, exist_ok=True)

    # handler that returns different bodies for a vs b
    def handler(req: httpx.Request) -> httpx.Response:
        if str(req.url).endswith("/robots.txt"):
            return httpx.Response(404, text="not found")
        cookie = req.headers.get("cookie", "")
        if "session=a" in cookie:
            return httpx.Response(200, text="body A")
        return httpx.Response(200, text="body B different")

    transport = httpx.MockTransport(handler)
    from recon.cli import _run_idor

    with patch("recon.cli.require_operator_confirmation", return_value=None):
        dest, findings = await _run_idor(scope, ep, sess_a, sess_b, out, transport=transport)
        assert len(findings) == 1
        assert findings[0]["type"] == "idor"
        assert pathlib.Path(dest).exists()
