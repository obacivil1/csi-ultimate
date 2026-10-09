"""Tests for scope_validator — gate, time window, host/path checks."""
from __future__ import annotations

import hashlib
import json
import pathlib
from datetime import datetime, timedelta, timezone

import pytest

from recon.core.scope_validator import ScopeError, ScopeValidator, require_operator_confirmation


def _write_scope(tmp_path: pathlib.Path, overrides=None):
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
    if overrides:
        data.update(overrides)
    sf = tmp_path / "scope.json"
    sf.write_text(json.dumps(data), encoding="utf-8")
    return sf


def test_missing_scope_file_raises(tmp_path):
    with pytest.raises(ScopeError, match="not found"):
        ScopeValidator(tmp_path / "missing.json")


def test_expired_scope_raises(tmp_path):
    now = datetime.now(timezone.utc)
    sf = _write_scope(tmp_path, overrides={
        "not_before": (now - timedelta(days=5)).isoformat(),
        "expires_at": (now - timedelta(days=2)).isoformat(),
    })
    with pytest.raises(ScopeError, match="expired"):
        ScopeValidator(sf)


def test_host_outside_allowed_raises(tmp_path):
    sf = _write_scope(tmp_path)
    sv = ScopeValidator(sf)
    with pytest.raises(ScopeError, match="host not in allowed"):
        sv.assert_allowed("https://evil.com/page")


def test_denied_path_raises(tmp_path):
    sf = _write_scope(tmp_path)
    sv = ScopeValidator(sf)
    with pytest.raises(ScopeError, match="path denied"):
        sv.assert_allowed("https://example.com/admin/secret")


def test_allowed_url_passes(tmp_path):
    sf = _write_scope(tmp_path)
    sv = ScopeValidator(sf)
    sv.assert_allowed("https://example.com/public/page")
    # كان allows() واجهة ثانية للتحقق بنفس المنطق، فحذفناها ليُختبر
    # المسار الإنتاجي assert_allowed نفسه بدل نسخة موازية.
    with pytest.raises(Exception):
        sv.assert_allowed("https://evil.com")


def test_hash_mismatch_raises(tmp_path):
    sf = _write_scope(tmp_path)
    # tamper doc
    (tmp_path / "auth.pdf").write_bytes(b"different")
    with pytest.raises(ScopeError, match="hash mismatch"):
        ScopeValidator(sf)


def test_scope_starts_unconfirmed(tmp_path):
    sv = ScopeValidator(_write_scope(tmp_path))
    assert sv.confirmed is False


def test_correct_confirm_marks_scope(tmp_path):
    from unittest.mock import patch

    sv = ScopeValidator(_write_scope(tmp_path))
    # NOTE: input_fn must be passed explicitly — the def-time default binds
    # the real builtin and would ignore the patch.
    with patch("builtins.input", return_value="I CONFIRM"):
        require_operator_confirmation(sv, input_fn=input)
    assert sv.confirmed is True


def test_wrong_confirm_raises_and_stays_unconfirmed(tmp_path):
    from unittest.mock import patch

    sv = ScopeValidator(_write_scope(tmp_path))
    with patch("builtins.input", return_value="yes"):
        with pytest.raises(ScopeError, match="did not confirm"):
            require_operator_confirmation(sv, input_fn=input)
    assert sv.confirmed is False
