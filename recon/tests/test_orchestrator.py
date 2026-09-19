"""Tests for orchestrator.py — missing tool, filtering, timeout, no shell."""
from __future__ import annotations

import asyncio
import json
import hashlib
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest

from recon.core.orchestrator import Orchestrator
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


@pytest.mark.asyncio
async def test_missing_tool_skipped(tmp_path):
    scope = _scope(tmp_path)
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports")
    res = await orch.run_katana(["https://example.com/page"])
    assert res.skipped is True
    assert res.skip_reason is not None
    assert "not found" in res.skip_reason.lower()


@pytest.mark.asyncio
async def test_mixed_in_out_of_scope_inputs_only_in_scope(tmp_path, tmp_path_factory=None):
    # Use a fake binary that echoes input — we override tools dict to point to python
    scope = _scope(tmp_path)
    # Create a fake katana script that just echoes its -o file with input url
    # Instead we mock shutil.which to return python and fake run
    # Simpler: test filtering logic directly via _filter_input_urls and _is_in_scope_line
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports")
    filtered = orch._filter_input_urls(["https://example.com/a", "https://evil.com/b", "https://example.com/c"])
    assert filtered == ["https://example.com/a", "https://example.com/c"]


@pytest.mark.asyncio
async def test_out_of_scope_output_filtered(tmp_path):
    scope = _scope(tmp_path)
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports")
    # create a fake output file with mixed lines
    out = tmp_path / "reports" / "raw" / "httpx" / "httpx.txt"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("https://example.com/page\nhttps://evil.com/secret\nhttps://example.com/other\n", encoding="utf-8")
    lines = orch._filter_output_file(out)
    assert lines == 2
    text = out.read_text(encoding="utf-8")
    assert "evil.com" not in text
    assert "example.com/page" in text


@pytest.mark.asyncio
async def test_timeout_respected(tmp_path):
    scope = _scope(tmp_path)
    # create a fake sleeping script
    script = tmp_path / "sleepy.py"
    script.write_text("import time; time.sleep(5)\n", encoding="utf-8")
    # Use orchestrator with timeout 1 and tool pointing to python sleepy
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports", tools={"katana": sys.executable}, timeout_seconds=1)
    # Override _run to use our script: we will directly call _run with sleepy args
    # But run_katana will use katana binary; we set tools katana -> python, and katana args include -u url etc which sleepy doesn't understand
    # Instead test low-level _run with a command that sleeps
    # Create a script that sleeps
    out = tmp_path / "reports" / "raw" / "katana" / "katana.txt"
    res = await orch._run("katana", "katana", [str(script)], out)
    assert res.exit_code == -1
    assert "timeout" in (res.skip_reason or "").lower() or res.exit_code == -1


def test_no_shell_true():
    src = pathlib.Path("recon/core/orchestrator.py").read_text(encoding="utf-8")
    assert "shell=True" not in src
    assert "shell = True" not in src
    assert "create_subprocess_exec" in src


def test_subfinder_out_of_scope_domain(tmp_path):
    import asyncio as _asyncio
    scope = _scope(tmp_path)
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports")
    res = _asyncio.run(orch.run_subfinder("evil.com"))
    assert res.lines == 0
