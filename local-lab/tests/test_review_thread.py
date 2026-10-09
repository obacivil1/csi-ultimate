"""اختبار مراجعة: كل لمس لـ Tk يتم في الخيط الرئيسي فقط."""
import sys
import threading
import time
import tkinter as tk
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "gui"))

import importlib.util

_spec = importlib.util.spec_from_file_location(
    "gui_app_under_review", str(ROOT / "gui" / "app.py"))
_gui = importlib.util.module_from_spec(_spec)
sys.modules["gui_app_under_review"] = _gui
_spec.loader.exec_module(_gui)
LocalLabApp = _gui.LocalLabApp


def _target_up():
    try:
        urllib.request.urlopen("http://127.0.0.1:5001/", timeout=2).close()
        return True
    except Exception:
        return False


def test_make_scope_called_on_main_thread(tk_root):
    if not _target_up():
        import pytest
        pytest.skip("الهدف غير مفتوح")
    root = tk_root
    app = LocalLabApp(root)
    main_id = threading.get_ident()
    calls = []
    orig = app._make_scope

    def spy():
        calls.append(threading.get_ident())
        return orig()

    app._make_scope = spy
    app._test_target()

    state = {"done": False}
    deadline = time.time() + 20

    def tick():
        txt = app.target_info.cget("text")
        if "جارٍ" not in txt:
            state["done"] = True
            root.quit()
        elif time.time() >= deadline:
            root.quit()
        else:
            root.after(200, tick)

    root.after(200, tick)
    root.mainloop()
    try:
        assert calls, "لم يُستدعَ _make_scope"
        assert all(c == main_id for c in calls), \
            "نطاق من خيط خلفي — انهيار Tk مؤكد"
        assert "متصل" in app.target_info.cget("text"), \
            app.target_info.cget("text")
    finally:
        # ننظّف أبناء الجذر فقط: تدمير الجذر المشترك يسمّم بقية الجلسة.
        for w in list(root.winfo_children()):
            try:
                w.destroy()
            except Exception:
                pass
