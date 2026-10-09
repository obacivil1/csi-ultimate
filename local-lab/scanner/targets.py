"""
local-lab/scanner/targets.py — سجل النطاقات المصرّحة.
=====================================================
نطاق مصرّح = ثلاثي دقيق (مخطط، مضيف، منفذ) + توكيد مكتوب «أؤكد»
+ ملاحظة (رابط برنامج المكافآت مثلًا) + تاريخ.

البوابة لا تُرفَع أبدًا: لا يُحفَظ هدف دون كتابة «أؤكد» صراحة،
ولا يعمل الفحص على هدف غير مسجل ومؤكد.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

try:
    from .scoped import Scope, split_target
except ImportError:  # تشغيل مباشر/اختبارات خارج الحزمة
    from scoped import Scope, split_target


def store_path() -> Path:
    p = Path(__file__).resolve().parents[1] / "data" / "authorized_targets.json"
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


def canonical(url: str) -> str:
    """التطبيع القانوني: scheme://host:port (المنفذ جزء من الهوية)."""
    scheme, host, port = split_target(url)
    return f"{scheme}://{host}:{port}"


def base_of(url: str) -> str:
    scheme, host, port = split_target(url)
    default = 443 if scheme == "https" else 80
    netloc = host if port == default else f"{host}:{port}"
    return f"{scheme}://{netloc}/"


def list_targets(path=None) -> list:
    return _load(path)


def add_target(url: str, note: str = "", confirm_text: str = "",
               path=None) -> dict:
    """يضيف نطاقًا مصرّحًا. يرفض دون «أؤكد» أو رابط فاسد."""
    if not confirm_text or "أؤكد" not in confirm_text:
        raise ValueError("دون كتابة «أؤكد» لا يُسجَّل أي نطاق.")
    canon = canonical(url)  # يرفع ValueError للرابط الفاسد
    rec = {
        "target": canon,
        "base": base_of(url),
        "note": (note or "").strip()[:300],
        "confirm": "أؤكد",
        "added_at": datetime.now(timezone.utc).isoformat()[:19] + "Z",
    }
    items = [t for t in _load(path) if t.get("target") != canon]
    items.append(rec)
    _save(items, path)
    return rec


def remove_target(url_or_canon: str, path=None) -> bool:
    canon = canonical(url_or_canon)
    items = _load(path)
    kept = [t for t in items if t.get("target") != canon]
    if len(kept) == len(items):
        return False
    _save(kept, path)
    return True


def find_target(url: str, path=None):
    """يعيد السجل المطابق للثلاثي الدقيق أو None."""
    try:
        canon = canonical(url)
    except ValueError:
        return None
    for t in _load(path):
        if t.get("target") == canon:
            return t
    return None


def make_scope(url: str, path=None) -> tuple:
    """يبني Scope جاهزًا لهدف مسجل. يعيد (Scope, record).

    يرفع ValueError إن لم يكن الهدف مسجلًا ومؤكدًا.
    """
    rec = find_target(url, path)
    if not rec or rec.get("confirm") != "أؤكد":
        raise ValueError(
            "هذا الهدف غير مسجل كمصرّح. سجّله أولًا مع كتابة «أؤكد».")
    scope = Scope(mode="authorized", allow=[rec["target"]], confirm=True)
    scope.check_url(rec["base"])  # إثبات مبكر أن الثلاثي يمر
    return scope, rec


# ------------------------------------------------- تصريح الفحص العميق
# البوابة الثانية (بعد التسجيل): لا يعمل أي فحص مُغيّر/اختراقي على
# نطاق خارجي إلا بتصريح صريح من مالك الموقع/المفوّض، مسجلًا ومؤرخًا.
DEEP_PHRASE = "أصرّح"


def set_intrusive(url: str, granted: bool, phrase: str = "",
                  by: str = "gui", path=None) -> dict:
    """منح/سحب تصريح الفحص العميق لنطاق مسجل.

    المنح يتطلب كتابة «أصرّح» حرفيًا (نية مزدوجة: زر + كتابة).
    السحب فوري بلا عبارة. يرفع ValueError لهدف غير مسجل.
    """
    canon = canonical(url)
    items = _load(path)
    rec = next((t for t in items if t.get("target") == canon), None)
    if not rec:
        raise ValueError("سجّل النطاق أولًا مع «أؤكد» قبل التصريح العميق.")
    if granted and DEEP_PHRASE not in (phrase or ""):
        raise ValueError("المنح يتطلب كتابة «أصرّح» حرفيًا.")
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()[:19] + "Z"
    if granted:
        rec["intrusive"] = {"granted": True, "granted_at": now,
                            "by": by[:24]}
    else:
        rec["intrusive"] = {"granted": False, "revoked_at": now,
                            "by": by[:24]}
    _save(items, path)
    return rec


def intrusive_granted(url: str, path=None):
    """يعيد سجل التصريح العميق إن كان ممنوحًا، وإلا None."""
    rec = find_target(url, path)
    intr = (rec or {}).get("intrusive") or {}
    return intr if intr.get("granted") is True else None


def _cli():  # python scanner/targets.py --list | --grant URL ...
    import argparse
    ap = argparse.ArgumentParser(description="سجل النطاقات المصرّحة")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--url", default="")
    ap.add_argument("--note", default="")
    ap.add_argument("--confirm", default="")
    ap.add_argument("--grant", action="store_true",
                    help="تسجيل + منح تصريح عميق (يتطلب أؤكد + أصرّح)")
    ap.add_argument("--revoke", action="store_true")
    a = ap.parse_args()
    if a.list or not (a.url or a.grant or a.revoke):
        items = list_targets()
        print(f"النطاقات المصرّحة: {len(items)}")
        for t in items:
            intr = (t.get("intrusive") or {}).get("granted")
            print(f"  {'🔓' if intr else '🔒'} {t['target']}  "
                  f"{t.get('added_at', '')}  {t.get('note', '')[:60]}")
        return 0
    if a.revoke:
        rec = find_target(a.url)
        if not rec:
            print("غير مسجل.")
            return 1
        set_intrusive(a.url, False, by="cli")
        print(f"سُحب التصريح العميق: {canonical(a.url)}")
        return 0
    if not a.url:
        print("حدد --url")
        return 1
    rec = add_target(a.url, note=a.note, confirm_text=a.confirm)
    print(f"سُجل: {rec['target']}")
    if a.grant:
        set_intrusive(a.url, True, phrase=a.confirm, by="cli")
        print(f"مُنح التصريح العميق: {rec['target']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
