"""
engine/watch.py — المراقبة المستمرة: لقطات + فرق (جديد/أُصلح/تغيّر).
======================================================================
snapshot(rows) -> {code: {verdict, severity, note_norm}}
diff(old, new) -> {new:[], fixed:[], changed:[], same:int}
store/load snapshot files under reports/watch/<target-hash>/.
يقارن الملاحظات بعد تطبيع الأرقام (توقيت SQLTIME يتبدل كل جولة).
"""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

NUM_RE = re.compile(r"\d+\.\d+|\d+")


def norm_note(note: str | None) -> str:
    return NUM_RE.sub("#", note or "")


def snapshot(rows: list) -> dict:
    snap = {}
    for r in rows:
        snap[r["code"]] = {"verdict": bool(r["verdict"]),
                           "severity": r.get("severity", "?"),
                           "note": norm_note(r.get("note", ""))}
    return snap


def diff(old: dict | None, new: dict | None) -> dict:
    old, new = old or {}, new or {}
    result: dict[str, Any] = {"new": [], "fixed": [], "changed": [],
                              "same": 0}
    for code, cur in new.items():
        prev = old.get(code)
        if prev is None:
            result["same"] += 0
            continue
        if cur["verdict"] and not prev["verdict"]:
            result["new"].append(code)
        elif prev["verdict"] and not cur["verdict"]:
            result["fixed"].append(code)
        elif cur["verdict"] and prev["verdict"] and \
                cur["note"] != prev["note"]:
            result["changed"].append(code)
        else:
            result["same"] += 1
    for code in old:
        if code not in new:
            result["changed"].append(code + "?")
    return result


def _wdir(base, reports_dir=None):
    root = Path(reports_dir) if reports_dir else \
        Path(__file__).resolve().parents[1] / "reports"
    h = hashlib.sha256(base.encode()).hexdigest()[:12]
    d = root / "watch" / h
    d.mkdir(parents=True, exist_ok=True)
    return d


def store(base: str, rows: list, reports_dir=None, mode: str = "?") -> str:
    d = _wdir(base, reports_dir)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    payload = {"target": base, "taken_at": ts, "mode": mode,
               "snapshot": snapshot(rows)}
    (d / f"snap_{ts}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (d / "latest.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(d / "latest.json")


def load_latest(base: str, reports_dir=None) -> dict | None:
    p = _wdir(base, reports_dir) / "latest.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def history(base: str, reports_dir=None, limit: int = 10) -> list:
    d = _wdir(base, reports_dir)
    files = sorted(d.glob("snap_*.json"), reverse=True)[:limit]
    out = []
    for f in files:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            snap = data.get("snapshot", {})
            out.append({"file": f.name,
                        "taken_at": data.get("taken_at", "?"),
                        "findings": sum(1 for v in snap.values()
                                        if v.get("verdict"))})
        except Exception:
            continue
    return out
