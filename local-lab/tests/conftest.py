"""عزل مشترك لاختبارات local-lab.

السبب: Tk لا يحتمل إنشاء/تدمير جذور متعددة داخل العملية نفسها.
كان كل ملف اختبار ينشئ جذوره ويمرّره، فيفشل الملف التالي بـ
_tkinter.TclError: invalid command name "tcl_findLibrary"
ويتغيّر الأمر حسب ترتيب التشغيل/مجلد التنفيذ. الحل: جذر واحد
على مستوى الجلسة، والاختبارات تنظّف أبناءها فقط ولا تمسّ المفسّر.
"""
import tkinter as tk

import pytest


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
