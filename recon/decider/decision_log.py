"""decision_log.py — دفتر قرارات مربوط بسلسلة بصمات (تحليل فقط).

الفكرة: مثل محضر اجتماع لا ينسى — كل قرار نسجله مع سببه ووقته،
وكل سطر مربوط بالذي قبله ببصمة. إن عبث أحد بسطر قديم انكسرت
السلسلة وانكشف العبث. نفس تصميم core/audit_log.py.
"""
from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path


class DecisionLog:
    """سجل قرارات إلحاقي مربوط بالبصمات، بصيغة JSONL."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("", encoding="utf-8")
        # استئناف الحالة من آخر سطر: الرقم والبصمة
        self._last_seq = -1
        self._last_hash = "0" * 64
        try:
            for e in self.entries():
                self._last_seq = int(e.get("seq", self._last_seq))
                self._last_hash = str(e.get("hash", self._last_hash))
        except Exception:
            pass  # ملف فاسد؟ verify() سيكشف ذلك لاحقًا

    def log(self, decision: dict) -> dict:
        """سجل قرارًا مع الرقم والوقت والبصمة. يعيد ما خُزن."""
        seq = self._last_seq + 1
        ts = datetime.now(timezone.utc).isoformat()
        prev_hash = self._last_hash
        obj = dict(decision)
        obj["seq"] = seq
        obj["ts"] = ts
        obj["prev_hash"] = prev_hash
        canonical = json.dumps(obj, sort_keys=True, separators=(",", ":"))
        h = hashlib.sha256((prev_hash + canonical).encode("utf-8")).hexdigest()
        obj["hash"] = h
        line = json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n"
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
        """اعرض القرارات بالترتيب."""
        if not self.path.exists():
            return
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                yield json.loads(line)

    def verify(self) -> tuple[bool, str]:
        """تحقق من سلامة السلسلة. يعيد (True, 'ok') أو (False, السبب)."""
        prev = "0" * 64
        expected_seq = 0
        try:
            with self.path.open("r", encoding="utf-8") as f:
                for idx, raw in enumerate(f):
                    text = raw.strip()
                    if not text:
                        continue
                    try:
                        obj = json.loads(text)
                    except json.JSONDecodeError as exc:
                        return False, f"سطر فاسد {idx}: {exc}"
                    if obj.get("seq") != expected_seq:
                        return False, f"تسلسل خاطئ في السطر {idx}"
                    if obj.get("prev_hash") != prev:
                        return False, f"انقطاع السلسلة في السطر {idx}"
                    h = obj.get("hash")
                    if not isinstance(h, str) or len(h) != 64:
                        return False, f"بصمة غير صالحة في السطر {idx}"
                    copy = dict(obj)
                    copy.pop("hash", None)
                    canonical = json.dumps(copy, sort_keys=True, separators=(",", ":"))
                    expected = hashlib.sha256((prev + canonical).encode("utf-8")).hexdigest()
                    if h != expected:
                        return False, f"بصمة غير متطابقة في السطر {idx}"
                    prev = h
                    expected_seq += 1
            return True, "ok"
        except FileNotFoundError:
            return True, "ok (لا ملف بعد)"
