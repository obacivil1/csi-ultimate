"""
learn/labs.py — تمارين منهجية محلولة آليًا (Academy-style).
=============================================================
LABS: قائمة {id, title, goal, steps[], url, check}
run_lab(session_factory, base, lab_id, mode="verify") -> (ok, msg)
"""
import sys
from pathlib import Path

LAB = Path(__file__).resolve().parents[1]
for _d in ("scanner",):
    _p = str(LAB / _d)
    if _p not in sys.path:
        sys.path.insert(0, _p)

from local_scan import CHECKS, run_check

LABS = [
    {"id": "sqli-login", "title": "تجاوز الدخول بحقن SQL", "check": "SQLLOGIN",
     "url": "/login",
     "goal": "ادخل لوحة التحكم دون معرفة أي كلمة مرور.",
     "steps": ["افتح /login", "اسم المستخدم:  ' OR '1'='1' --",
               "كلمة المرور: أي شيء", "اضغط دخول — يجب أن ترى لوحة التحكم"]},
    {"id": "sqli-search", "title": "كشف البيانات من البحث", "check": "SQLSEARCH",
     "url": "/search",
     "goal": "اجعل البحث يعرض كل المقالات بحقنة واحدة.",
     "steps": ["افتح /search", "ابحث عن:  ' OR '1'='1' --",
               "يجب أن تظهر كل المقالات"]},
    {"id": "sqli-blind", "title": "الحقن الأعمى Boolean", "check": "SQLBLIND",
     "url": "/search",
     "goal": "ميّز بين شرط صحيح وخاطئ من اختلاف الصفحة فقط.",
     "steps": ["ابحث:  ' OR '1'='1  (تظهر مقالات)",
               "ابحث:  ' AND '1'='2  (لا نتائج)"]},
    {"id": "sqli-time", "title": "الحقن الزمني", "check": "SQLTIME",
     "url": "/search",
     "goal": "لاحظ تأخر ~ثانيتين مع الحمولة الثقيلة مقابل الفورية للخفيفة.",
     "steps": ["استعمل Repeater: الحمولة الثقيلة من مكتبة الحمولات",
               "قارن الزمن مع حمولة UNION خفيفة"]},
    {"id": "xss-reflect", "title": "XSS منعكسة", "check": "XSSREFLECT",
     "url": "/search",
     "goal": "اجعل الموقع يعرض وسمك كوسم حقيقي لا كنص.",
     "steps": ["ابحث عن:  <b>LOCAL-TEST</b>", "يجب أن يظهر عريضًا"]},
    {"id": "xss-stored", "title": "XSS مخزنة", "check": "XSSSTORED",
     "url": "/settings",
     "goal": "ازرع وسمًا في ملفك يظهر لكل زائر.",
     "steps": ["ادخل omari/user123", "النبذة: <b>STORED9</b> واحفظ",
               "افتح /profile/2 — الوسم يعمل"]},
    {"id": "idor", "title": "قراءة ملف خاص (IDOR)", "check": "IDOR",
     "url": "/profile/4",
     "goal": "اقرأ ملف المستخدم privacy دون تسجيل دخول.",
     "steps": ["افتح /profile/4 مباشرة", "لاحظ شارة [ملف خاص]"]},
    {"id": "traverse", "title": "قراءة قاعدة البيانات", "check": "PATH",
     "url": "/download?file=lab.db",
     "goal": "حمّل ملف قاعدة البيانات عبر معامل المسار.",
     "steps": ["افتح /download?file=lab.db", "احفظ الملف — هذه كل البيانات"]},
    {"id": "upload", "title": "رفع ملف منفَّذ", "check": "UPLOAD",
     "url": "/upload",
     "goal": "ارفع صفحة HTML تعمل كصفحة كاملة من الموقع.",
     "steps": ["ارفع ملف .htm بمحتوى <b>LOCAL-OK</b>",
               "افتح رابطه — يعمل كصفحة"]},
    {"id": "cmdi", "title": "تنفيذ أمر على الخادم", "check": "CMDI",
     "url": "/api/ping?host=127.0.0.1",
     "goal": "اجعل الخادم ينفذ أمر echo لك.",
     "steps": ["جرّب: ?host=127.0.0.1; echo PWN297",
               "يجب أن يظهر PWN297 في المخرجات"]},
    {"id": "ssrf", "title": "الخادم يجلب عنك", "check": "SSRF",
     "url": "/api/fetch?url=http://127.0.0.1:5001/api/me",
     "goal": "اجعل الخادم يجلب نقطة داخلية ويعيدها لك.",
     "steps": ["مرّر url لنقطة /api/me الداخلية",
               "الرد يحوي admin_area — الجلب تم من جهته"]},
    {"id": "ssti", "title": "تنفيذ قالب على الخادم", "check": "SSTI",
     "url": "/preview?template={{7*7}}",
     "goal": "احسب 7*7 على الخادم نفسه.",
     "steps": ["افتح ?template={{7*7}}", "النتيجة 49 = تنفيذ حي"]},
    {"id": "csrf", "title": "تحريك حساب بلا رمز", "check": "CSRF",
     "url": "/settings",
     "goal": "نفّذ فعلًا مغيّرًا للحالة بلا رمز حماية.",
     "steps": ["ادخل omari/user123", "حدّث النبذة بطلب بلا Referer",
               "التغيير يُقبَل — لا حماية CSRF"]},
]

REQUIRED_KEYS = {"id", "title", "goal", "steps", "url", "check"}


def get_lab(lab_id):
    for lab in LABS:
        if lab["id"] == lab_id:
            return lab
    raise ValueError(f"مختبر غير معروف: {lab_id}")


def run_lab(session_factory, base, lab_id, mode="verify"):
    """ينفّذ PoC المختبر حيًا. يعيد (ناجح, رسالة)."""
    lab = get_lab(lab_id)
    meta = next((m for m in CHECKS if m["code"] == lab["check"]), None)
    if meta is None:
        raise ValueError(f"فحص غير موجود: {lab['check']}")
    r = run_check(meta, session_factory(), base.rstrip("/") + "/", mode)
    ok = bool(r["verdict"])
    return ok, ("أُنجز ✓ — " if ok else "لم يُنجَز بعد — ") + r["note"]
