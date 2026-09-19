"""audit_log.py — Hash-chained append-only JSONL log."""
from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path


class AuditLog:
    """Append-only hash-chained JSONL log."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # ensure file exists
        if not self.path.exists():
            self.path.write_text("", encoding="utf-8")
        # resume state: scan file to find last seq and hash
        self._last_seq = -1
        self._last_hash = "0" * 64
        try:
            for e in self.entries():
                self._last_seq = int(e.get("seq", self._last_seq))
                self._last_hash = str(e.get("hash", self._last_hash))
        except Exception:
            # if corrupt, keep defaults; verify() will report failure
            pass

    def log(self, entry: dict) -> dict:
        """Append entry with seq, ts, prev_hash, hash. Returns stored dict."""
        seq = self._last_seq + 1
        ts = datetime.now(timezone.utc).isoformat()
        prev_hash = self._last_hash
        # build object without hash
        obj = dict(entry)
        obj["seq"] = seq
        obj["ts"] = ts
        obj["prev_hash"] = prev_hash
        canonical = json.dumps(obj, sort_keys=True, separators=(",", ":"))
        h = hashlib.sha256((prev_hash + canonical).encode("utf-8")).hexdigest()
        obj["hash"] = h
        line = json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n"
        # append with fsync
        with self.path.open("a", encoding="utf-8") as f:
            f.write(line)
            f.flush()
            try:
                import os

                os.fsync(f.fileno())
            except Exception:
                pass
        self._last_seq = seq
        self._last_hash = h
        return obj

    def entries(self) -> Iterator[dict]:
        """Yield entries as dicts in order."""
        if not self.path.exists():
            return
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                yield json.loads(line)

    def verify(self) -> tuple[bool, str]:
        """Verify hash chain. Returns (True, 'ok') or (False, reason)."""
        prev = "0" * 64
        expected_seq = 0
        try:
            with self.path.open("r", encoding="utf-8") as f:
                for idx, raw in enumerate(f):
                    raw_stripped = raw.strip()
                    if not raw_stripped:
                        continue
                    try:
                        obj = json.loads(raw_stripped)
                    except json.JSONDecodeError as exc:
                        return False, f"corrupt line {idx}: {exc}"
                    # check seq
                    if obj.get("seq") != expected_seq:
                        return False, f"seq mismatch at line {idx}: expected {expected_seq}, got {obj.get('seq')}"
                    # check prev_hash
                    if obj.get("prev_hash") != prev:
                        return False, f"prev_hash mismatch at line {idx}"
                    # recompute hash
                    h = obj.get("hash")
                    if not isinstance(h, str) or len(h) != 64:
                        return False, f"invalid hash at line {idx}"
                    # canonical without hash
                    copy = dict(obj)
                    copy.pop("hash", None)
                    canonical = json.dumps(copy, sort_keys=True, separators=(",", ":"))
                    expected_h = hashlib.sha256((prev + canonical).encode("utf-8")).hexdigest()
                    if h != expected_h:
                        return False, f"hash mismatch at line {idx}: expected {expected_h}, got {h}"
                    prev = h
                    expected_seq += 1
            return True, "ok"
        except FileNotFoundError:
            return True, "ok (no file)"

    def sha256_of_file(self) -> str:
        """Return sha256 hex of file bytes (stable)."""
        if not self.path.exists():
            return hashlib.sha256(b"").hexdigest()
        data = self.path.read_bytes()
        return hashlib.sha256(data).hexdigest()
