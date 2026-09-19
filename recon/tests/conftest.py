"""Shared fixtures. No network. No real time."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from recon.core.scope_validator import ScopeValidator


def _write_doc(path: Path, content: bytes = b"fake pdf") -> str:
    path.write_bytes(content)
    return hashlib.sha256(content).hexdigest()


def valid_scope_dict(tmp_path: Path) -> dict:
    doc_hash = _write_doc(tmp_path / "authorization.pdf")
    now = datetime.now(timezone.utc)
    return {
        "program_name": "Test Program",
        "program_url": "https://hackerone.com/test",
        "authorized_by": "Test Security Team",
        "authorization_document": "authorization.pdf",
        "authorization_sha256": doc_hash,
        "not_before": (now - timedelta(days=1)).isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
        "contact_email": "researcher@example.com",
        "allowed_hosts": ["example.com", "api.example.com"],
        "allowed_schemes": ["https"],
        "allowed_ports": [443],
        "denied_paths": ["/admin"],
        "max_requests_per_host": 100,
        "max_requests_per_second": 5.0,
        "user_agent": "TestRecon/1.0 (+contact: researcher@example.com)",
    }


@pytest.fixture
def scope_file(tmp_path: Path) -> Path:
    p = tmp_path / "scope.json"
    p.write_text(json.dumps(valid_scope_dict(tmp_path)), encoding="utf-8")
    return p


@pytest.fixture
def scope(scope_file: Path) -> ScopeValidator:
    return ScopeValidator(scope_file)


class _MockTransport:
    def __init__(self, routes: dict[str, tuple[int, str]]) -> None:
        self.routes = routes
        self.calls: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        url = str(request.url)
        if url in self.routes:
            status, body = self.routes[url]
            return httpx.Response(
                status,
                text=body,
                headers={"content-type": "text/html; charset=utf-8"},
            )
        return httpx.Response(404, text="not found")

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)


@pytest.fixture
def mock_transport_factory():
    def _make(routes: dict[str, tuple[int, str]]) -> _MockTransport:
        return _MockTransport(routes)
    return _make
