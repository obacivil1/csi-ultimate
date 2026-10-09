"""اختبارات الرؤية في الوجه: صور + فتح تلقائي + مهمة اللوحة."""
import base64
import sys
import threading
from http.server import HTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "gui"))
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT / "scanner"))
sys.path.insert(0, str(ROOT / "tests"))

from test_authorized import FakeSite

PNG1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGA"
    "hKmMIQAAAABJRU5ErkJggg==")


@pytest.fixture(scope="session")
def tkroot(tk_root):
    # الجذر يأتي من conftest: واحد لكل الجلسة (انظر تعليقه).
    yield tk_root


def test_photo_from_bytes(tkroot):
    from viewer import photo_from_bytes
    assert photo_from_bytes(b"") is None
    assert photo_from_bytes(b"not-an-image" * 10) is None
    assert photo_from_bytes(b"\xff\xd8" + b"x" * 100) is None  # JPEG غير مدعوم
    ph = photo_from_bytes(PNG1)
    assert ph is not None
    assert ph.width() == 1 and ph.height() == 1


def test_fetch_page_carries_raw():
    from session import Session
    from scoped import Scope
    from postex import fetch_page
    srv = HTTPServer(("127.0.0.1", 0), FakeSite)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d/" % srv.server_address[1]
    try:
        s = Session(Scope(mode="authorized", allow=[base.rstrip("/")],
                          confirm=True))
        page = fetch_page(s, base)
        assert page["status"] == 200
        assert isinstance(page.get("raw"), bytes) and len(page["raw"]) > 0
        assert "page" in page["text"]  # نص رابط مرئي بعد التنقيح
        assert any("page" in l["url"] for l in page["links"])
    finally:
        srv.shutdown()


def test_dash_mission_registered():
    from missions import MISSIONS
    assert "DASH" in MISSIONS
    assert len(MISSIONS["DASH"]["steps"]) == 4
    assert all(hasattr(__import__("missions").MissionsWindow, h)
               for _, h in MISSIONS["DASH"]["steps"])


def test_lab_logo_is_viewable_png(tkroot):
    import urllib.request
    try:
        raw = urllib.request.urlopen("http://127.0.0.1:5001/logo",
                                     timeout=4).read()
    except Exception:
        pytest.skip("المختبر غير مفتوح")
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"
    from viewer import photo_from_bytes
    assert photo_from_bytes(raw) is not None
