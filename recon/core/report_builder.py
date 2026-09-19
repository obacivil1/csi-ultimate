"""report_builder.py — Emit HackerOne/Bugcrowd-shaped JSON with scrubbing."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from recon.core.audit_log import AuditLog
from recon.core.scope_validator import ScopeValidator

SCRUB_KEYS = frozenset({
    "password", "passwd", "pwd", "token", "access_token", "refresh_token",
    "cookie", "cookies", "set-cookie", "authorization", "auth",
    "secret", "api_key", "apikey", "session", "sessionid", "bearer", "jwt",
})

# lowercased set for case-insensitive matching
_SCRUB_LOWER = {k.lower() for k in SCRUB_KEYS}


def scrub(obj: Any) -> Any:
    """Recursively remove sensitive keys (case-insensitive). Truncate long strings."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if isinstance(k, str) and k.lower() in _SCRUB_LOWER:
                continue
            out[k] = scrub(v)
        return out
    if isinstance(obj, list):
        return [scrub(x) for x in obj]
    if isinstance(obj, str) and len(obj) > 4096:
        return obj[:4096]
    return obj


def build_report(
    *,
    scope: ScopeValidator,
    findings: list[dict],
    audit_log: AuditLog,
    started_at: datetime,
    finished_at: datetime,
    stats: dict,
) -> dict:
    """Build report dict (scrubbed) ready for write."""
    # ensure timezone aware
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    if finished_at.tzinfo is None:
        finished_at = finished_at.replace(tzinfo=timezone.utc)
    report = {
        "program": {
            "name": scope.scope.program_name,
            "url": str(scope.scope.program_url),
            "authorized_by": scope.scope.authorized_by,
            "valid_until": scope.scope.expires_at.isoformat(),
        },
        "tool": {"name": "ReconModule", "version": "1.0"},
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "scope": {
            "hosts": scope.scope.allowed_hosts,
            "denied_paths": scope.scope.denied_paths,
        },
        "stats": {
            "requests_total": stats.get("requests_total", 0),
            "per_host": stats.get("per_host", {}),
        },
        "findings": findings,
        "audit_log_sha256": audit_log.sha256_of_file(),
    }
    # scrub before return
    report = scrub(report)
    # also ensure no string >4096 remains (scrub handles but double check)
    return report


def write_report(report: dict, out_dir: Path) -> Path:
    """Atomic write report to out_dir. Returns Path."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    program_slug = re.sub(r"[^A-Za-z0-9]+", "_", report.get("program", {}).get("name", "report")).strip("_").lower()
    if not program_slug:
        program_slug = "report"
    # timestamp
    now = datetime.now(timezone.utc)
    ts = now.strftime("%Y%m%d_%H%M%S")
    fname = f"report_{program_slug}_{ts}.json"
    dest = out_dir / fname
    tmp = out_dir / (fname + ".tmp")
    # scrub again to be safe
    scrubbed = scrub(report)
    data = json.dumps(scrubbed, sort_keys=True, indent=2, ensure_ascii=False)
    # truncate check: ensure no string >4096 via scrub already
    tmp.write_text(data, encoding="utf-8")
    # fsync
    with tmp.open("rb") as f:
        try:
            os.fsync(f.fileno())
        except Exception:
            pass
    # atomic replace
    os.replace(tmp, dest)
    # ensure no tmp left
    if tmp.exists():
        try:
            tmp.unlink()
        except Exception:
            pass
    return dest
