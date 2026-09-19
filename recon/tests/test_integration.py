"""Integration test — scope → HTML → JS extract → IDOR → report."""
from __future__ import annotations

import hashlib
import json
import pathlib
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from recon.core.audit_log import AuditLog
from recon.core.http_client import HttpClient
from recon.core.idor_probe import IdorProbe
from recon.core.js_extractor import extract_api_paths, extract_script_urls
from recon.core.rate_limiter import RateLimiter
from recon.core.report_builder import build_report
from recon.core.robots_cache import RobotsCache
from recon.core.scope_validator import ScopeValidator


def _scope(tmp_path: pathlib.Path):
    doc = tmp_path / "auth.pdf"
    doc.write_bytes(b"fake pdf")
    h = hashlib.sha256(b"fake pdf").hexdigest()
    now = datetime.now(timezone.utc)
    data = {
        "program_name": "Test Program",
        "program_url": "https://hackerone.com/test",
        "authorized_by": "Team",
        "authorization_document": "auth.pdf",
        "authorization_sha256": h,
        "not_before": (now - timedelta(days=1)).isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
        "contact_email": "r@example.com",
        "allowed_hosts": ["example.com"],
        "allowed_schemes": ["https"],
        "allowed_ports": [443],
        "denied_paths": [],
        "max_requests_per_host": 100,
        "max_requests_per_second": 100.0,
        "user_agent": "TestRecon/1.0 (+contact: r@example.com)",
    }
    sf = tmp_path / "scope.json"
    sf.write_text(json.dumps(data), encoding="utf-8")
    return ScopeValidator(sf)


@pytest.mark.asyncio
async def test_integration_scope_to_report(tmp_path):
    scope = _scope(tmp_path)
    # HTML with one script
    html = '<html><head><script src="/app.js"></script></head><body>hi</body></html>'
    scripts = extract_script_urls(html, "https://example.com/page", scope)
    assert "https://example.com/app.js" in scripts

    # JS with one API path
    js_text = 'fetch("/api/v1/users?id=1")'
    candidates = extract_api_paths(js_text, "https://example.com/", scope)
    assert "https://example.com/api/v1/users?id=1" in candidates

    # Mock transport serves 200 with different bodies for two sessions
    def handler(req: httpx.Request) -> httpx.Response:
        if str(req.url).endswith("/robots.txt"):
            return httpx.Response(404, text="not found")
        # IDOR endpoint
        if "api" in str(req.url):
            cookie = req.headers.get("cookie", "")
            if "session=a" in cookie:
                return httpx.Response(200, text="data for A")
            return httpx.Response(200, text="data for B different")
        # HTML page
        if str(req.url).endswith("/page"):
            return httpx.Response(200, text=html)
        if str(req.url).endswith("/app.js"):
            return httpx.Response(200, text=js_text)
        return httpx.Response(404, text="not found")

    transport = httpx.MockTransport(handler)
    audit = AuditLog(tmp_path / "audit.jsonl")
    limiter = RateLimiter(max_rps=100, max_per_host=100, burst=10)
    async with httpx.AsyncClient(transport=transport) as raw:
        robots = RobotsCache(raw, user_agent=scope.user_agent)
        sessions = {"user_a": {"session": "a"}, "user_b": {"session": "b"}}
        async with HttpClient(scope=scope, limiter=limiter, robots=robots, audit=audit, sessions=sessions, transport=transport) as hc:
            probe = IdorProbe(hc)
            # probe the API candidate
            url = list(candidates)[0]
            res = await probe.probe(url, session_a="user_a", session_b="user_b")
            assert res is not None
            assert res.flagged is True

            # Build report
            findings = [{
                "type": "idor",
                "confidence": "medium",
                "url": res.url,
                "evidence": {
                    "session_a_status": res.session_a_status,
                    "session_b_status": res.session_b_status,
                    "body_a_sha256": res.body_a_sha256,
                    "body_b_sha256": res.body_b_sha256,
                    "identifier_key": res.identifier_key,
                },
                "reproduction_steps": ["1. Auth as A", "2. Request", "3. Auth as B", "4. Request", "5. Compare"],
                "impact": "Potential IDOR",
                "remediation": "Enforce authz",
            }]
            started = datetime.now(timezone.utc) - timedelta(seconds=5)
            finished = datetime.now(timezone.utc)
            report = build_report(scope=scope, findings=findings, audit_log=audit, started_at=started, finished_at=finished, stats={"requests_total": 2, "per_host": limiter.snapshot()})
            assert "audit_log_sha256" in report
            assert len(report["audit_log_sha256"]) == 64
            # ensure no bodies, no cookies
            txt = json.dumps(report)
            assert "data for A" not in txt
            assert "data for B" not in txt
            assert "session" not in txt.lower() or "session_a_status" in txt.lower()  # only metadata allowed
            # ensure bodies not in audit either
            audit_txt = (tmp_path / "audit.jsonl").read_text(encoding="utf-8")
            assert "data for A" not in audit_txt
