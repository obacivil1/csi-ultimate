"""Tests for audit_log.py — hash chain, tamper detection, reopen."""
from __future__ import annotations

import json
import pathlib

from recon.core.audit_log import AuditLog


def test_append_three_verify_true(tmp_path: pathlib.Path):
    p = tmp_path / "audit.jsonl"
    log = AuditLog(p)
    log.log({"method": "GET", "url": "https://example.com/a"})
    log.log({"method": "GET", "url": "https://example.com/b"})
    log.log({"method": "GET", "url": "https://example.com/c"})
    ok, msg = log.verify()
    assert ok, msg
    assert len(list(log.entries())) == 3


def test_tamper_middle_verify_false(tmp_path: pathlib.Path):
    p = tmp_path / "audit.jsonl"
    log = AuditLog(p)
    log.log({"url": "https://example.com/a"})
    log.log({"url": "https://example.com/b"})
    log.log({"url": "https://example.com/c"})
    # tamper second line
    lines = p.read_text(encoding="utf-8").splitlines()
    obj = json.loads(lines[1])
    obj["url"] = "https://evil.com"
    lines[1] = json.dumps(obj, sort_keys=True, separators=(",", ":"))
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log2 = AuditLog(p)
    ok, msg = log2.verify()
    assert ok is False
    assert "hash mismatch" in msg.lower() or "mismatch" in msg.lower()


def test_reopen_chains_from_last(tmp_path: pathlib.Path):
    p = tmp_path / "audit.jsonl"
    log = AuditLog(p)
    log.log({"n": 1})
    log.log({"n": 2})
    # reopen
    log2 = AuditLog(p)
    log2.log({"n": 3})
    ok, _ = log2.verify()
    assert ok
    entries = list(log2.entries())
    assert len(entries) == 3
    assert entries[2]["seq"] == 2
    # chain: each prev_hash equals previous hash
    assert entries[1]["prev_hash"] == entries[0]["hash"]
    assert entries[2]["prev_hash"] == entries[1]["hash"]


def test_sha256_stable(tmp_path: pathlib.Path):
    p = tmp_path / "audit.jsonl"
    log = AuditLog(p)
    log.log({"a": 1})
    h1 = log.sha256_of_file()
    h2 = log.sha256_of_file()
    assert h1 == h2
    assert len(h1) == 64


def test_corrupt_line_verify_false(tmp_path: pathlib.Path):
    p = tmp_path / "audit.jsonl"
    log = AuditLog(p)
    log.log({"ok": 1})
    # append corrupt line
    with p.open("a", encoding="utf-8") as f:
        f.write("NOT JSON\n")
    log2 = AuditLog(p)
    ok, msg = log2.verify()
    assert ok is False
    assert "corrupt" in msg.lower()


def test_forbidden_no_pii_helpers():
    src = pathlib.Path("recon/core/audit_log.py").read_text(encoding="utf-8")
    assert "password" not in src.lower()
    # should not have helpers that clean bodies
    assert "def clean" not in src.lower()
