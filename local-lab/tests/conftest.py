"""عزل مشترك لاختبارات local-lab.

السبب: Tk لا يحتمل إنشاء/تدمير جذور متعددة داخل العملية نفسها.
كان كل ملف اختبار ينشئ جذوره ويمرّره، فيفشل الملف التالي بـ
_tkinter.TclError: invalid command name "tcl_findLibrary"
ويتغيّر الأمر حسب ترتيب التشغيل/مجلد التنفيذ. الحل: جذر واحد
على مستوى الجلسة، والاختبارات تنظّف أبناءها فقط ولا تمسّ المفسّر.
"""
import sys
import threading
import time
import urllib.request
from pathlib import Path

import tkinter as tk

import pytest

ROOT = Path(__file__).resolve().parents[1]  # local-lab/
TARGET_BASE = "http://127.0.0.1:5001/"


def _target_up(timeout=2):
    try:
        urllib.request.urlopen(TARGET_BASE, timeout=timeout).close()
        return True
    except Exception:
        return False


@pytest.fixture(scope="session", autouse=True)
def live_target():
    """يشغّل هدف local-lab على 127.0.0.1:5001 إن لم يكن مفتوحاً.

    اختبارات القفز الحيّ (المعلّمة بـ ``@live`` في test_engine_stage1
    وغيرها) واختبارات الحالة تتوقّع خادماً يعمل فعلاً على المنفذ 5001.
    لا يشغّله ``ci.yml`` بأي خطوة، فكان يتعذّر الاتصال وترجع الحالة 0.

    التصميم بأفضل جهد: إن تعذّر التشغيل لا نُسقط بقية السويت — تُترك
    الاختبارات الحيّة تتخطّى كما كان سلوكها السابق.
    """
    already = _target_up()
    server = None
    thread = None
    if not already:
        try:
            # app.py يستورد png_util استيراداً مسطّحاً، فيلزم إدراج مجلّده.
            sys.path.insert(0, str(ROOT / "target"))
            import app as target  # noqa: E402  (local-lab/target/app.py)

            target.init_db()  # idempotent: ينشئ البيانات إن لزم

            from werkzeug.serving import make_server

            server = make_server("127.0.0.1", 5001, target.app, threaded=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()

            for _ in range(25):
                if _target_up():
                    break
                time.sleep(0.2)
            if not _target_up():
                print("⚠️ تعذّر تشغيل هدف local-lab على 5001؛ "
                      "الاختبارات الحيّة ستتخطّى.")
        except Exception as exc:  # pragma: no cover - بيئة بلا flask مثلاً
            print(f"⚠️ تعذّر تشغيل هدف local-lab: {exc!r}")

    yield

    if server is not None:
        try:
            server.shutdown()
        except Exception:
            pass
    if thread is not None:
        thread.join(timeout=5)


@pytest.fixture(scope="session")
def tk_root():
    root = tk.Tk()
    root.withdraw()
    yield root
    try:
        root.destroy()
    except Exception:
        pass


def _wipe_children(root):
    """تنظيف واجهة الاختبار دون تدمير الجذر المشترك."""
    for w in list(root.winfo_children()):
        try:
            w.destroy()
        except Exception:
            pass
