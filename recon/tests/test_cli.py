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
    out = tmp_path / "reports"
    # tools missing -> should be skipped but not raise
    with patch("recon.cli.require_operator_confirmation", return_value=None):
        with patch("shutil.which", return_value=None):
            await _run_scan(scope, "https://example.com/", ["katana", "httpx", "nuclei"], out)
            # check report exists
            reports = list(out.glob("report_*.json"))
            assert len(reports) == 1


@pytest.mark.asyncio
async def test_idor_one_endpoint_produces_one_finding(tmp_path):
    data = _valid_scope_dict(tmp_path)
    sf = tmp_path / "scope.json"
    sf.write_text(json.dumps(data), encoding="utf-8")
    from recon.core.scope_validator import ScopeValidator
    scope = ScopeValidator(sf)
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
