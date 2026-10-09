"""
engine/profiles.py — ملفات الجلسات لكل هدف.
================================================
يحفظ بيانات الدخول (المسار/الحقول/النجاح) في data/profiles/*.json
ويطبقها على أي جلسة عبر auth.login_form.
تنبيه أمان: كلمات المرور نص صريح على قرصك — لا تشارك المجلد،
واستعمل حسابات اختبار فقط (نفس تحذير أدوات الاحتراف).
"""
import json
from pathlib import Path

try:
    from auth import login_form
except ImportError:
    from .auth import login_form

DEFAULTS = {
    "login_path": "/login",
    "user_field": "username",
    "pass_field": "password",
    "success_markers": ["dashboard", "لوحة التحكم", "logout", "خروج"],
}


def profiles_dir(base_data_dir=None):
    root = Path(base_data_dir) if base_data_dir else \
        Path(__file__).resolve().parents[1] / "data"
    d = root / "profiles"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _path(name, base_data_dir=None):
    safe = "".join(c if (c.isalnum() or c in "-_") else "_" for c in name)
    if not safe:
        raise ValueError("اسم الملف فارغ.")
    return profiles_dir(base_data_dir) / f"{safe}.json"


def save(name: str, target: str, username: str, password: str,
         login_path: str = "/login", user_field: str = "username",
         pass_field: str = "password", success_markers=None,
         base_data_dir=None) -> str:
    if not name.strip() or not username:
        raise ValueError("الاسم واسم المستخدم إجباريان.")
    data = {"name": name.strip(), "target": target.strip(),
            "username": username, "password": password,
            "login_path": login_path or "/login",
            "user_field": user_field or "username",
            "pass_field": pass_field or "password",
            "success_markers": success_markers or
            list(DEFAULTS["success_markers"])}
    p = _path(name, base_data_dir)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2),
                 encoding="utf-8")
    return str(p)


def load(name: str, base_data_dir=None) -> dict:
    p = _path(name, base_data_dir)
    if not p.exists():
        raise ValueError(f"الملف غير موجود: {name}")
    data = json.loads(p.read_text(encoding="utf-8"))
    for k in ("target", "username", "password"):
        if k not in data:
            raise ValueError(f"الملف ناقص: {k}")
    return data


def list_profiles(base_data_dir=None) -> list:
    d = profiles_dir(base_data_dir)
    out = []
    for p in sorted(d.glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            out.append({"name": data.get("name", p.stem),
                        "target": data.get("target", "?"),
                        "username": data.get("username", "?")})
        except Exception:
            continue
    return out


def delete(name: str, base_data_dir=None) -> bool:
    p = _path(name, base_data_dir)
    if p.exists():
        p.unlink()
        return True
    return False


def apply_profile(session, base: str, profile: dict) -> tuple:
    """يسجّل الدخول حسب الملف. يعيد (ناجح, رسالة)."""
    return login_form(
        session, base, profile["username"], profile["password"],
        login_path=profile.get("login_path", "/login"),
        user_field=profile.get("user_field", "username"),
        pass_field=profile.get("pass_field", "password"),
        success_markers=tuple(profile.get(
            "success_markers", DEFAULTS["success_markers"])))
