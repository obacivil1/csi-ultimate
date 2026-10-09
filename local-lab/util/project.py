"""
util/project.py — حفظ المشاريع واستئنافها (JSON).
===================================================
يحفظ: الهدف، النمط، النطاق، زمن البدء، نتائج الفحوصات المنجزة،
وقائمة الأكواد المتبقية للاستئناف. يعيد التحميل والتحقق من السلامة.
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


def save(path, target: str, mode: str, scope_mode: str, rows_done: list,
         rows_pending_codes: list, extra: dict | None = None) -> str:
    state = {
        "tool": "local-lab-project", "version": 1,
        "target": target, "mode": mode, "scope": scope_mode,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "rows_done": rows_done,
        "pending": list(rows_pending_codes),
        "extra": extra or {},
    }
    blob = json.dumps(state, ensure_ascii=False, sort_keys=True).encode()
    state["sha256"] = hashlib.sha256(blob).hexdigest()
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # كتابة ذرية: ملف مؤقت ثم استبدال — لا ملف نصف مكتوب عند انقطاع.
    import os as _os
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    _os.replace(tmp, path)
    return str(path)


def load(path) -> dict:
    path = Path(path)
    state = json.loads(path.read_text(encoding="utf-8"))
    blob = json.dumps({k: v for k, v in state.items() if k != "sha256"},
                      ensure_ascii=False, sort_keys=True).encode()
    if hashlib.sha256(blob).hexdigest() != state.get("sha256"):
        raise ValueError("ملف المشروع تالف (البصمة لا تطابق).")
    for k in ("target", "mode", "rows_done", "pending"):
        if k not in state:
            raise ValueError(f"ملف المشروع ناقص: {k}")
    return state
