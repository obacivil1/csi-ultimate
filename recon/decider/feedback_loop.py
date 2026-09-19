"""feedback_loop.py — الذاكرة التي تحسّن الترتيب (تحليل فقط).

الفكرة: بعد أن تفحص بيدك وتخبرنا «هذا كان حقيقيًا وهذا كان وهمًا»،
نتذكر. الفئة التي تخيب كثيرًا نخفض درجتها (حتى النصف)، والتي
تصدق كثيرًا نرفعها (حتى مرة ونصف). لا شبكة، فقط ملف محلي.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


class FeedbackLoop:
    """ذاكرة نتائج الفحص اليدوي في ملف JSONL."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("", encoding="utf-8")

    def _records(self) -> list[dict]:
        """اقرأ كل السجلات من القرص (طازجة دائمًا)."""
        out: list[dict] = []
        if not self.path.exists():
            return out
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return out

    def record(self, url: str, category: str, was_real: bool, notes: str) -> None:
        """سجل نتيجة فحص يدوي: هل كانت الفرضية حقيقية أم وهمًا؟"""
        entry = {
            "url": url,
            "category": category,
            "was_real": bool(was_real),
            "notes": notes,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            f.flush()

    def confidence_adjustment(self, url: str, category: str) -> float:
        """معامل التعديل حسب سجل الفئة: من 0.5 (عقوبة) إلى 1.5 (تعزيز).

        الصافي = حقيقية − وهمية، محصور بين -3 و +3، ثم:
        المعامل = 1.0 + الصافي/6 — خطي بين 0.5 و 1.5.
        بلا سجل → 1.0 (محايد).
        """
        real = sum(1 for r in self._records() if r.get("category") == category and r.get("was_real") is True)
        false = sum(1 for r in self._records() if r.get("category") == category and r.get("was_real") is False)
        net = max(-3, min(3, real - false))
        return 1.0 + net / 6.0

    def stats(self) -> dict:
        """إحصائيات الذاكرة: لكل فئة (حقيقية/وهمية/المجموع) + الإجمالي."""
        per_category: dict[str, dict[str, int]] = {}
        total_real = 0
        total_false = 0
        for r in self._records():
            cat = str(r.get("category", "unknown"))
            slot = per_category.setdefault(cat, {"real": 0, "false": 0, "total": 0})
            if r.get("was_real") is True:
                slot["real"] += 1
                total_real += 1
            else:
                slot["false"] += 1
                total_false += 1
            slot["total"] += 1
        return {
            "per_category": per_category,
            "total_real": total_real,
            "total_false": total_false,
            "total": total_real + total_false,
        }
