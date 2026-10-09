"""Tests for js_extractor.py — pure functions, no I/O."""
from __future__ import annotations

import json
import pathlib
from datetime import datetime, timedelta, timezone
import hashlib

import pathlib as pl

from recon.core.js_extractor import extract_api_paths, extract_script_urls, extract_from_html
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
        "denied_paths": [],
        "max_requests_per_host": 10,
        "max_requests_per_second": 10.0,
        "user_agent": "TestRecon/1.0 (+contact: r@example.com)",
    }
    sf = tmp_path / "scope.json"
    sf.write_text(json.dumps(data), encoding="utf-8")
    return ScopeValidator(sf)


def test_script_src_relative(tmp_path):
    scope = _scope(tmp_path)
    html = '<script src="/app.js"></script>'
    urls = extract_script_urls(html, "https://example.com/page", scope)
    assert "https://example.com/app.js" in urls


def test_script_src_evil_ignored(tmp_path):
    scope = _scope(tmp_path)
    html = '<script src="https://evil.com/x.js"></script>'
    urls = extract_script_urls(html, "https://example.com/page", scope)
    assert urls == set()


def test_api_path_extracted(tmp_path):
    scope = _scope(tmp_path)
    js = 'var u = "/api/v1/users?id=1";'
    paths = extract_api_paths(js, "https://example.com/", scope)
    assert "https://example.com/api/v1/users?id=1" in paths


def test_v2_path_extracted(tmp_path):
    scope = _scope(tmp_path)
    js = 'fetch("/v2/me")'
    paths = extract_api_paths(js, "https://example.com/", scope)
    assert "https://example.com/v2/me" in paths


def test_path_without_quotes_ignored(tmp_path):
    scope = _scope(tmp_path)
    js = 'var u = /api/v1/users;'
    paths = extract_api_paths(js, "https://example.com/", scope)
    assert paths == set()


def test_duplicate_deduplicated(tmp_path):
    scope = _scope(tmp_path)
    js = '"/api/a" "/api/a"'
    paths = extract_api_paths(js, "https://example.com/", scope)
    assert len(paths) == 1


def test_pure_no_io():
    src = (pathlib.Path(__file__).resolve().parent.parent / "core" / "js_extractor.py").read_text(encoding="utf-8")
    assert "httpx" not in src
    assert "open(" not in src
