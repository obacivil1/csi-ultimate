"""Tests for report_builder.py — scrub, atomic write, report shape."""
from __future__ import annotations

import json
import pathlib
from datetime import datetime, timedelta, timezone
import hashlib

from recon.core.audit_log import AuditLog
from recon.core.report_builder import SCRUB_KEYS, build_report, scrub, write_report
from recon.core.scope_validator import ScopeValidator


def _scope(tmp_path):
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
        "denied_paths": ["/admin"],
        "max_requests_per_host": 10,
        "max_requests_per_second": 10.0,
        "user_agent": "TestRecon/1.0 (+contact: r@example.com)",
    }
    sf = tmp_path / "scope.json"
    sf.write_text(json.dumps(data), encoding="utf-8")
    return ScopeValidator(sf)


def test_scrub_removes_every_key_case_insensitive():
    for key in SCRUB_KEYS:
        # lower, upper, mixed
        for variant in [key, key.upper(), key.capitalize()]:
            obj = {variant: "secret", "keep": "yes"}
            out = scrub(obj)
            assert variant not in out, f"key {variant} not scrubbed"
            assert out["keep"] == "yes"


def test_scrub_recurses():
    obj = {"outer": {"password": "x", "inner": [{"token": "y", "ok": 1}]}}
    out = scrub(obj)
    assert "password" not in out["outer"]
    assert "token" not in out["outer"]["inner"][0]
    assert out["outer"]["inner"][0]["ok"] == 1


def test_scrub_keeps_nonsensitive():
    obj = {"url": "https://example.com", "status": 200, "host": "example.com"}
    out = scrub(obj)
    assert out == obj


def test_report_has_required_keys(tmp_path):
    scope = _scope(tmp_path)
    audit = AuditLog(tmp_path / "audit.jsonl")
    audit.log({"method": "GET", "url": "https://example.com/"})
    started = datetime.now(timezone.utc) - timedelta(seconds=10)
    finished = datetime.now(timezone.utc)
    rep = build_report(scope=scope, findings=[], audit_log=audit, started_at=started, finished_at=finished, stats={"requests_total": 1, "per_host": {"example.com": 1}})
    for k in ["program", "tool", "started_at", "finished_at", "scope", "stats", "findings", "audit_log_sha256"]:
        assert k in rep
    assert rep["tool"]["name"] == "ReconModule"
    assert "audit_log_sha256" in rep and len(rep["audit_log_sha256"]) == 64


def test_atomic_write_no_tmp(tmp_path):
    scope = _scope(tmp_path)
    audit = AuditLog(tmp_path / "audit.jsonl")
    started = datetime.now(timezone.utc)
    finished = datetime.now(timezone.utc)
    rep = build_report(scope=scope, findings=[], audit_log=audit, started_at=started, finished_at=finished, stats={})
    out_dir = tmp_path / "reports"
    dest = write_report(rep, out_dir)
    assert dest.exists()
    # no .tmp left
    assert not any(p.suffix == ".tmp" for p in out_dir.iterdir())
    # verify content is valid json
    data = json.loads(dest.read_text(encoding="utf-8"))
    assert data["program"]["name"] == "Test Program"


def test_no_string_longer_than_4096(tmp_path):
    scope = _scope(tmp_path)
    audit = AuditLog(tmp_path / "audit.jsonl")
    long_str = "x" * 5000
    findings = [{"type": "idor", "evidence": {"note": long_str}}]
    rep = build_report(scope=scope, findings=findings, audit_log=audit, started_at=datetime.now(timezone.utc), finished_at=datetime.now(timezone.utc), stats={})
    # check all strings in report <=4096
    def check(obj):
        if isinstance(obj, str):
            assert len(obj) <= 4096
        elif isinstance(obj, dict):
            for v in obj.values():
                check(v)
        elif isinstance(obj, list):
            for x in obj:
                check(x)
    check(rep)
