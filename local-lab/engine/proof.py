"""
local-lab/engine/proof.py — إثبات الوجود اللاحق (deferred attribution).
=======================================================================
السيناريو المشروع (CTF / تدريب فريق أحمر متفق عليه): تعمل ببصمة صغيرة
أثناء الاختبار، ثم تثبت لاحقًا أنك أنت من دخل — عبر رموز كناري فريدة
زرعتها بيدك ومسجلة ومؤرخة، لا عبر إخفاء هويتك عن القانون.

القاعدة: الإثبات = كشف (reveal) لا إخفاء. الرمز الكامل يُحجَب أثناء
العملية (يظهر مقتطعًا في التقارير) ويُكشَف كاملًا في شهادة الإثبات
التي تسلمها للجهة — مع خطوات تحقق يملكها مالك الموقع من سجلاته.

لا يحتوي: لا Tor، لا بروكسيات إخفاء، لا مسح سجلات الهدف — تلك أدوات
تهرب لا حرفة اختبار، ومكانها خارج هذه المنظومة.
"""
import json
import urllib.parse
import uuid
from datetime import datetime, timezone
from pathlib import Path


def store_path() -> Path:
    p = Path(__file__).resolve().parents[1] / "data" / "proofs.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _load(path=None) -> list:
    path = Path(path) if path else store_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save(items: list, path=None) -> None:
    path = Path(path) if path else store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(items, ensure_ascii=False, indent=2),
                    encoding="utf-8")


def new_token() -> str:
    """رمز كناري فريد لعملية واحدة — يُزرَع ويُكشَف لاحقًا."""
    return "GX9-" + uuid.uuid4().hex[:10].upper()


def new_engagement(target: str, note: str = "", path=None) -> dict:
    """يفتح عملية إثبات: يعيد السجل (الرمز الكامل فيه — احفظه)."""
    rec = {
        "id": "ENG-" + uuid.uuid4().hex[:8].upper(),
        "token": new_token(),
        "target": target,
        "note": (note or "")[:300],
        "created_at": datetime.now(timezone.utc).isoformat()[:19] + "Z",
        "plants": [],
        # بوابة الإفصاح: None = لم يُسأل بعد، held = احتجاب،
        # released = كشف مسموح. لا شهادة دون released.
        "disclosure": {"decision": None, "decided_at": None},
    }
    items = _load(path)
    items.append(rec)
    _save(items, path)
    return rec


def list_engagements(path=None) -> list:
    return _load(path)


def get_engagement(eng_id: str, path=None):
    for r in _load(path):
        if r.get("id") == eng_id:
            return r
    return None


def record_plant(eng_id: str, check: str, location: str,
                 marker_hint: str, path=None) -> dict:
    """يسجل أثرًا زرعته (ملف/ضربة OOB/انعكاس) — التلميح مقتطع فقط."""
    items = _load(path)
    rec = next((r for r in items if r.get("id") == eng_id), None)
    if not rec:
        raise ValueError("عملية غير موجودة.")
    plant = {
        "check": check, "location": location,
        "marker_hint": (marker_hint or "")[:24],
        "at": datetime.now(timezone.utc).isoformat()[:19] + "Z",
    }
    rec["plants"].append(plant)
    _save(items, path)
    return plant


def verify_plant(session, base: str, plant: dict, timeout: int = 8) -> dict:
    """يعيد التحقق من أثر: إعادة جلب الموقع والبحث عن التلميح."""
    loc = plant.get("location", "")
    url = urllib.parse.urljoin(base.rstrip("/") + "/",
                               loc.lstrip("/"))
    try:
        st, _, raw = session.get(url, timeout=timeout)
        body = raw.decode("utf-8", "replace")
    except Exception as e:
        return {"ok": False, "url": url, "detail": f"تعذّر: {e}"}
    hint = plant.get("marker_hint", "")
    ok = st == 200 and bool(hint) and hint in body
    return {"ok": ok, "url": url, "status": st,
            "detail": "الأثر حي ✓" if ok else "الأثر غائب/متغير"}


def disclosure_state(eng_id: str, path=None):
    """يعيد قرار الإفصاح الحالي: None/held/released."""
    rec = get_engagement(eng_id, path)
    if not rec:
        raise ValueError("عملية غير موجودة.")
    return (rec.get("disclosure") or {}).get("decision")


def set_disclosure(eng_id: str, release: bool, path=None) -> dict:
    """قرار المشغّل بعد العملية: True = اكشف، False = احتجب.

    يُسجَّل القرار مؤرخًا. الكشف يفتح الشهادة؛ الاحتجاب يغلقها.
    """
    items = _load(path)
    rec = next((r for r in items if r.get("id") == eng_id), None)
    if not rec:
        raise ValueError("عملية غير موجودة.")
    rec["disclosure"] = {
        "decision": "released" if release else "held",
        "decided_at": datetime.now(timezone.utc).isoformat()[:19] + "Z",
    }
    _save(items, path)
    return rec


def export_certificate(eng_id: str, path=None) -> str:
    """شهادة الإثبات الكاملة (MD) — تُسلَّم للجهة بعد العملية.

    تحوي الرمز الكامل (الكشف) + خطوات تحقق من سجلات المالك نفسه.
    البوابة: ترفض ما لم يصدر قرار الكشف (released) صراحة.
    """
    rec = get_engagement(eng_id, path)
    if not rec:
        raise ValueError("عملية غير موجودة.")
    if (rec.get("disclosure") or {}).get("decision") != "released":
        raise ValueError("الشهادة محجوبة — لم يصدر قرار الإفصاح بعد. "
                         "اختر «كشف» أولًا.")
    lines = [
        "# شهادة إثبات اختراق (Proof of Presence)",
        "",
        f"- **العملية**: `{rec['id']}`",
        f"- **الهدف**: `{rec['target']}`",
        f"- **فُتحت**: {rec['created_at']}",
        f"- **البيان**: {rec.get('note', '—')}",
        f"- **الرمز الكامل (الكشف)**: `{rec['token']}`",
        "",
        "## الآثار المزروعة",
        "",
        "| الفحص | الموقع | التلميح | الوقت |",
        "|---|---|---|---|",
    ]
    for p in rec.get("plants", []):
        lines.append(f"| {p['check']} | `{p['location']}` | "
                     f"`{p['marker_hint']}` | {p['at']} |")
    if not rec.get("plants"):
        lines.append("| — | لا آثار مسجلة | — | — |")
    lines += [
        "",
        "## كيف يتحقق المالك (من جهته)",
        "",
        "1. ابحث في سجلات الوصول عن الرمز الكامل أعلاه — ظهر فقط "
        "في طلبات المخترِق.",
        "2. افتح كل موقع مذكور وتأكد من وجود التلميح.",
        "3. قارن الأوقات مع سجل التدقيق المرفق من الفاحص.",
        "4. بعد التحقق: احذف الملفات المزروعة ودوّر أي سر لامسها.",
        "",
        "> الكشف هنا طوعي ولمرة واحدة — احتفظ بالشهادة كإثبات.",
    ]
    return "\n".join(lines)
