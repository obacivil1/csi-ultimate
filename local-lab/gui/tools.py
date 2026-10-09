"""
local-lab/gui/tools.py — نوافذ أدوات المحترف (GUI v3).
========================================================
  RepeaterWin : محرر طلب + إرسال + استجابة خام (engine.repeater).
  IntruderWin : حقن قوائم كلمات بعلامة FUZZ + جدول نتائج (engine.intruder).
  ProxyWin    : وكيل التقاط + سجل + اعتراض + فتح في Repeater (engine.proxy).
  CrawlWin    : خريطة الموقع + بصمة + ترويسات (recon.*).
  EncodeWin   : ترميز/فك داخلي (engine.enc).
  PluginsWin  : اكتشاف الإضافات وتشغيلها (plugins.loader).
كل نافذة تعمل بخيوط خلفية وتحدّث الواجهة عبر root.after (آمن).
كل طلب يمر عبر Scope الواجهة الأم (loopback/مرخّص بتوكيد).
طبقتان عبر _snap(app, intrusive): القراءة والطلب الواحد بالتوكيد العادي،
والقصف الآلي (Intruder/ActiveScan) وإرسال الدخول (Profiles) بتصريح مالك.
"""
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, ttk

LAB = Path(__file__).resolve().parents[1]
for _d in ("engine", "scanner", "recon_lab", "report", "plugins", "util",
           "learn"):
    _p = str(LAB / _d)
    if _p not in sys.path:
        sys.path.insert(0, _p)

from session import Session  # noqa: E402


def _require_intrusive_grant(base: str) -> None:
    """طبقة intrusive: المختبر المحلي دائمًا مسموح؛ الخارجي يتطلب تصريح مالك.

    ترفع PermissionError برسالة عربية واضحة عند غياب التصريح.
    """
    from scoped import is_loopback, normalize_host
    from targets import intrusive_granted
    host = normalize_host(base.split("://", 1)[1]) if "://" in base else normalize_host(base)
    if not is_loopback(host) and not intrusive_granted(base):
        raise PermissionError(
            "هذه الأداة مغيّرة للحالة (حمولات/حقن/دخول) — تتطلب تصريح "
            "المالك للفحص العميق على هذا الهدف الخارجي. "
            "المختبر المحلي يعمل دائمًا بلا قيد."
        )


def _snap(app, intrusive=False):
    """لقطة (النطاق، القاعدة) في خيط الواجهة قبل إطلاق خيوط العمل.

    طبقتان (مثل CLI: عام للقراءة + عميق بتصريح المالك):
    - intrusive=False (افتراضي): أدوات القراءة/الطلب الواحد — يكفيها نطاق
      الواجهة (مختبر محلي، أو خارجي بتوكيد «أؤكد»).
    - intrusive=True: القصف الآلي بالحمولات (Intruder)، المسح النشط
      (ActiveScan)، وإرسال بيانات الدخول (Profiles) — تتطلب المختبر المحلي
      أو تصريح مالك صريح (intrusive_granted)، وإلا PermissionError برسالة
      عربية واضحة بدل التنفيذ الصامت.
    """
    scope = app._make_scope()
    base = (app.target_var.get().strip() or "http://127.0.0.1:5001/")
    base = base.rstrip("/") + "/"
    if intrusive:
        _require_intrusive_grant(base)
    return scope, base


try:
    from raw import RawRequest
    from repeater import replay
    from intruder import fuzz
    from proxy import CaptureProxy
    from enc import KINDS, decode, encode
    from crawler import crawl
    from activescan import PARAM_HINTS, active_scan
    from attack_surface import analyze, probe_auth
    from jsharvest import harvest
    from fingerprint import fingerprint
    from headcheck import check_headers
    from loader import discover
    from ratelimit import RateLimiter
    from bounty import write_reports
    from labs import LABS, run_lab
    from oob import OOBServer
    from profiles import (apply_profile, delete as prof_delete,
                          list_profiles, load as prof_load, save as prof_save)
except ImportError as _e:
    raise SystemExit(f"تعذّر تحميل محركات الأدوات: {_e}")


def _repeater_audit_path():
    """مسار أثر الطلبات اليدوية — ряд sidecar لتقرير الفحص."""
    try:
        from local_scan import __file__ as _ls
        return Path(_ls).resolve().parents[1] / "reports" / "manual_requests.jsonl"
    except Exception:
        return Path.cwd() / "reports" / "manual_requests.jsonl"


# ================================================================ Repeater
class RepeaterWin:
    def __init__(self, app, preset=None):
        self.app = app
        top = self.top = tk.Toplevel(app.root)
        top.title("🔁 Repeater — أعد إرسال أي طلب")
        top.geometry("860x620")
        top.configure(bg="#0b1220")
        preset = preset or {}

        frm = tk.Frame(top, bg="#0b1220")
        frm.pack(fill="x", padx=12, pady=8)
        self.method = tk.StringVar(value=preset.get("method", "GET"))
        tk.OptionMenu(frm, self.method, "GET", "POST", "PUT", "DELETE",
                      "PATCH").pack(side="left")
        self.url = tk.Entry(frm, width=70, font=("Consolas", 10))
        self.url.pack(side="left", padx=8, fill="x", expand=True)
        self.url.insert(0, preset.get("url", app.target_var.get()))
        self.follow = tk.BooleanVar(value=False)
        tk.Checkbutton(frm, text="تابع التوجيه", variable=self.follow,
                       bg="#0b1220", fg="#e2e8f0",
                       selectcolor="#0f172a").pack(side="left")
        app._mk_button(frm, "إرسال ▶", self._send,
                       bg="#0d9488", hover="#14b8a6").pack(side="left", padx=8)

        mid = tk.Frame(top, bg="#0b1220")
        mid.pack(fill="both", expand=True, padx=12)
        left = tk.Frame(mid, bg="#0b1220")
        left.pack(side="left", fill="both", expand=True)
        tk.Label(left, text="الترويسات (سطر: Name: value)",
                 bg="#0b1220", fg="#94a3b8").pack(anchor="w")
        self.hdrs = tk.Text(left, height=5, bg="#02060d", fg="#e2e8f0",
                            font=("Consolas", 9))
        self.hdrs.pack(fill="x")
        for k, v in (preset.get("headers") or {}).items():
            self.hdrs.insert("end", f"{k}: {v}\n")
        tk.Label(left, text="الجسم", bg="#0b1220", fg="#94a3b8").pack(anchor="w")
        self.body = tk.Text(left, height=6, bg="#02060d", fg="#e2e8f0",
                            font=("Consolas", 9))
        self.body.pack(fill="both", expand=True)
        pb = preset.get("body")
        if pb:
            self.body.insert("end", pb.decode("utf-8", "replace")
                             if isinstance(pb, bytes) else pb)

        right = tk.Frame(mid, bg="#0b1220")
        right.pack(side="right", fill="both", expand=True, padx=(8, 0))
        self.info = tk.Label(right, text="الاستجابة: —",
                             bg="#0b1220", fg="#34d399",
                             font=("Segoe UI", 10, "bold"))
        self.info.pack(anchor="w")
        self.resp = tk.Text(right, bg="#02060d", fg="#e2e8f0",
                            font=("Consolas", 9), wrap="word")
        self.resp.pack(fill="both", expand=True)

    def _send(self):
        h = {}
        for line in self.hdrs.get("1.0", "end").splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                h[k.strip()] = v.strip()
        tpl = {"method": self.method.get(), "url": self.url.get().strip(),
               "headers": h, "body": self.body.get("1.0", "end").rstrip("\n"),
               "name": "repeater"}
        try:
            scope, _ = _snap(self.app)
        except Exception as e:
            messagebox.showerror("نطاق مرفوض", str(e))
            return
        from repeater import method_risk
        risk = method_risk(tpl["method"])
        confirm = False
        if risk == "destructive":
            if not messagebox.askyesno(
                    "طلب يمسح موردًا",
                    f"{tpl['method']} على {tpl['url']}\n\n"
                    f"هذا قد يحذف بيانات لا يمكن التراجع عنها.\n"
                    f"هل أنت متأكد؟"):
                return
            confirm = True
        self.info.config(text="جارٍ الإرسال …")
        threading.Thread(target=self._work,
                         args=(tpl, scope, self.follow.get(), risk, confirm),
                         daemon=True).start()

    def _work(self, tpl, scope, follow, risk, confirm):
        from targets import intrusive_granted
        from repeater import RepeaterRefused, replay
        try:
            base = tpl["url"]
            granted = intrusive_granted(base) if risk != "read_only" else None
            r = replay(Session(scope), tpl, follow=follow, granted=granted,
                       confirm_destructive=confirm,
                       audit_path=_repeater_audit_path())
            txt = (f"HTTP {r['status']} · {r['size']} bytes · "
                   f"{r['time_ms']}ms · {r['hash']} · خطورة: {r['risk']}\n"
                   + "\n".join(f"{k}: {v}" for k, v in r["headers"])
                   + "\n\n" + r["text"][:6000])
            self.top.after(0, self._show, f"الاستجابة: {r['status']}", txt)
            self.app._console(f"[Repeater] {tpl['method']} → {r['status']} "
                              f"({r['risk']})",
                              "ok" if r["status"] < 400 else "warn")
        except RepeaterRefused as e:
            self.top.after(0, self._show, "مرفوض", str(e))
            self.app._console(f"[Repeater] مرفوض: {e}", "err")
        except Exception as e:
            self.top.after(0, self._show, "خطأ", str(e))
            self.app._console(f"[Repeater] خطأ: {e}", "err")

    def _show(self, title, txt):
        self.info.config(text=title)
        self.resp.delete("1.0", "end")
        self.resp.insert("end", txt)


# ================================================================ Intruder
class IntruderWin:
    DEF_PAYLOADS = ("' OR '1'='1' --\n' AND '1'='2\n<b>INTR9</b>\n"
                    "<script>alert(9)</script>\n{{7*7}}\n../../../../etc/passwd\n"
                    "; echo INTR9\nhttp://127.0.0.1:5001/api/me")

    def __init__(self, app):
        self.app = app
        top = self.top = tk.Toplevel(app.root)
        top.title("💥 Intruder — حقن القوائم بعلامة FUZZ")
        top.geometry("900x640")
        top.configure(bg="#0b1220")

        frm = tk.Frame(top, bg="#0b1220")
        frm.pack(fill="x", padx=12, pady=8)
        tk.Label(frm, text="URL (ضع FUZZ مكان الحقن):",
                 bg="#0b1220", fg="#e2e8f0").pack(side="left")
        self.url = tk.Entry(frm, width=60, font=("Consolas", 10))
        self.url.pack(side="left", padx=8, fill="x", expand=True)
        self.url.insert(0, app.target_var.get().rstrip("/") + "/search?q=FUZZ")

        row2 = tk.Frame(top, bg="#0b1220")
        row2.pack(fill="x", padx=12)
        tk.Label(row2, text="الحمولات (سطر لكل حمولة):",
                 bg="#0b1220", fg="#94a3b8").pack(anchor="w")
        self.payloads = tk.Text(row2, height=6, bg="#02060d", fg="#fbbf24",
                                font=("Consolas", 9))
        self.payloads.pack(fill="x")
        self.payloads.insert("end", self.DEF_PAYLOADS)

        row3 = tk.Frame(top, bg="#0b1220")
        row3.pack(fill="x", padx=12, pady=6)
        tk.Label(row3, text="الخيوط:", bg="#0b1220",
                 fg="#e2e8f0").pack(side="left")
        self.workers = tk.Entry(row3, width=4)
        self.workers.insert(0, "3")
        self.workers.pack(side="left", padx=4)
        tk.Label(row3, text="المعدل/ثا:", bg="#0b1220",
                 fg="#e2e8f0").pack(side="left")
        self.rate = tk.Entry(row3, width=5)
        self.rate.insert(0, "5")
        self.rate.pack(side="left", padx=4)
        self.status = tk.Label(row3, text="جاهز", bg="#0b1220", fg="#94a3b8")
        self.status.pack(side="left", padx=12)
        app._mk_button(row3, "ابدأ الحقن 💥", self._run,
                       bg="#dc2626", hover="#ef4444").pack(side="right")

        box = tk.Frame(top, bg="#0b1220")
        box.pack(fill="both", expand=True, padx=12, pady=(0, 10))
        cols = ("payload", "status", "size", "time", "reason")
        self.tree = ttk.Treeview(box, columns=cols, show="headings")
        for c, w, t in (("payload", 320, "الحمولة"), ("status", 70, "الحالة"),
                        ("size", 80, "الحجم"), ("time", 80, "الزمن"),
                        ("reason", 220, "السبب")):
            self.tree.heading(c, text=t)
            self.tree.column(c, width=w, anchor="w")
        self.tree.pack(fill="both", expand=True)
        self.tree.tag_configure("hit", background="#450a0a",
                                foreground="#fca5a5")

    def _run(self):
        pls = [l for l in self.payloads.get("1.0", "end").splitlines()
               if l.strip()]
        if not pls or "FUZZ" not in self.url.get():
            messagebox.showwarning("Intruder", "ضع FUZZ في الرابط وحمولة واحدة على الأقل.")
            return
        try:
            workers = max(1, int(self.workers.get()))
            rate = max(1, int(self.rate.get()))
        except ValueError:
            messagebox.showwarning("Intruder", "الخيوط والمعدل أرقام.")
            return
        self.status.config(text="جارٍ الحقن …")
        tpl = {"method": "GET", "url": self.url.get().strip(), "name": "intruder"}
        try:
            # Intruder يقصف بالحمولات آليًا → طبقة intrusive (تصريح مالك للخارجي)
            scope, _ = _snap(self.app, intrusive=True)
        except Exception as e:
            messagebox.showerror("نطاق مرفوض", str(e))
            return
        threading.Thread(target=self._work,
                         args=(tpl, pls, workers, rate, scope),
                         daemon=True).start()

    def _work(self, tpl, pls, workers, rate, scope):
        try:
            base, rows = fuzz(Session(scope), tpl, pls, workers=workers,
                              limiter=RateLimiter(rate), timeout=8)
            self.top.after(0, self._fill, base, rows)
            hits = sum(1 for r in rows if r["interesting"])
            self.app._console(f"[Intruder] {len(rows)} حمولة · {hits} مثيرة",
                              "ok" if hits else "op")
        except Exception as e:
            self.top.after(0, self.status.config, {"text": f"خطأ: {e}"})

    def _fill(self, base, rows):
        for i in self.tree.get_children():
            self.tree.delete(i)
        for r in rows:
            self.tree.insert("", "end", values=(
                r["payload"][:60], r["status"], r["size"],
                f"{r['time_ms']}ms",
                ("★ " + r["reason"]) if r["interesting"] else "—"),
                tags=("hit",) if r["interesting"] else ())
        self.status.config(
            text=f"اكتمل: الأساس {base['status']}/{base['size']} · "
                 f"{sum(1 for r in rows if r['interesting'])} مثيرة")


# ================================================================ Proxy
class ProxyWin:
    def __init__(self, app):
        self.app = app
        self.px = None
        self._timer = None
        top = self.top = tk.Toplevel(app.root)
        top.title("📡 Proxy — سجل الالتقاط والاعتراض")
        top.geometry("920x600")
        top.configure(bg="#0b1220")
        top.protocol("WM_DELETE_WINDOW", self._close)

        bar = tk.Frame(top, bg="#0b1220")
        bar.pack(fill="x", padx=12, pady=8)
        tk.Label(bar, text="المنفذ:", bg="#0b1220",
                 fg="#e2e8f0").pack(side="left")
        self.port = tk.Entry(bar, width=7)
        self.port.insert(0, "18080")
        self.port.pack(side="left", padx=4)
        self.btn_start = app._mk_button(bar, "ابدأ الوكيل ▶", self._start,
                                        bg="#16a34a", hover="#22c55e")
        self.btn_start.pack(side="left", padx=4)
        self.btn_stop = app._mk_button(bar, "أوقف ■", self._stop,
                                       bg="#475569", hover="#64748b")
        self.btn_stop.pack(side="left", padx=4)
        self.intercept = tk.BooleanVar(value=False)
        tk.Checkbutton(bar, text="وضع الاعتراض (تجميد الطلبات)",
                       variable=self.intercept, bg="#0b1220", fg="#fbbf24",
                       selectcolor="#0f172a",
                       command=self._toggle).pack(side="left", padx=12)
        self.tls = tk.BooleanVar(value=False)
        tk.Checkbutton(bar, text="فكّ TLS (ثبّت ca.pem في متصفحك)",
                       variable=self.tls, bg="#0b1220", fg="#7dd3fc",
                       selectcolor="#0f172a",
                       command=self._toggle_tls).pack(side="left")
        self.info = tk.Label(bar, text="متوقف", bg="#0b1220", fg="#94a3b8")
        self.info.pack(side="left")

        cols = ("id", "method", "url", "status", "size", "time")
        self.tree = ttk.Treeview(top, columns=cols, show="headings", height=14)
        for c, w, t in (("id", 50, "#"), ("method", 70, "الأسلوب"),
                        ("url", 460, "الرابط"), ("status", 70, "الحالة"),
                        ("size", 80, "الحجم"), ("time", 80, "الزمن")):
            self.tree.heading(c, text=t)
            self.tree.column(c, width=w, anchor="w")
        self.tree.pack(fill="both", expand=True, padx=12)
        self.tree.tag_configure("blocked", background="#450a0a",
                                foreground="#fca5a5")

        row = tk.Frame(top, bg="#0b1220")
        row.pack(fill="x", padx=12, pady=8)
        app._mk_button(row, "فتح المحدد في Repeater 🔁", self._to_repeater,
                       bg="#0d9488", hover="#14b8a6").pack(side="left")
        app._mk_button(row, "إطلاق المحتجَز ✓", self._release,
                       bg="#16a34a", hover="#22c55e").pack(side="left", padx=6)
        app._mk_button(row, "إسقاط المحتجَز ✕", self._drop,
                       bg="#dc2626", hover="#ef4444").pack(side="left", padx=6)
        app._mk_button(row, "مسح السجل", self._clear,
                       bg="#475569", hover="#64748b").pack(side="right")
        self.pend = tk.Label(row, text="المحتجَز: لا شيء", bg="#0b1220",
                             fg="#fbbf24")
        self.pend.pack(side="right", padx=12)

    def _start(self):
        if self.px:
            return
        try:
            port = int(self.port.get())
        except ValueError:
            messagebox.showwarning("Proxy", "المنفذ رقم.")
            return
        try:
            scope = self.app._make_scope()
        except Exception as e:
            messagebox.showerror("نطاق مرفوض", str(e))
            return
        base = self.app.target_var.get().strip() or "http://127.0.0.1:5001/"
        self.px = CaptureProxy(Session(scope), base, port=port)
        self.px.tls_decrypt = self.tls.get()
        try:
            real = self.px.start()
        except Exception as e:
            self.px = None
            messagebox.showerror("Proxy", str(e))
            return
        self.info.config(text=f"يعمل على 127.0.0.1:{real} — وجّه متصفحك إليه")
        self.app._console(f"[Proxy] يعمل على :{real} → {base}", "ok")
        self._tick()

    def _toggle(self):
        if self.px:
            self.px.intercept_enabled = self.intercept.get()
            self.app._console("[Proxy] الاعتراض: "
                              + ("مفعّل" if self.intercept.get() else "متوقف"),
                              "warn")

    def _toggle_tls(self):
        if self.px:
            self.px.tls_decrypt = self.tls.get()
            self.app._console("[Proxy] فكّ TLS: "
                              + ("مفعّل" if self.tls.get() else "متوقف"),
                              "warn")
        elif self.tls.get():
            try:
                from ca import ca_dir
            except ImportError:
                from engine.ca import ca_dir
            self.app._console("[Proxy] ثبّت هذه الشهادة في متصفحك أولًا: "
                              + str(ca_dir() / "ca.pem"),
                              "info")

    def _tick(self):
        if not self.px:
            return
        try:
            hist = self.px.snapshot()
            for i in self.tree.get_children():
                self.tree.delete(i)
            for h in hist[-200:]:
                self.tree.insert("", "end", values=(
                    h["id"], h["method"], h["url"][:90], h["status"],
                    h["resp_size"], f"{h['time_ms']}ms"),
                    tags=("blocked",) if h["blocked"] else ())
            pend = self.px.queue.pending_ids()
            self.pend.config(text=f"المحتجَز: {pend[0] if pend else 'لا شيء'}")
        except Exception:
            pass
        self._timer = self.top.after(1000, self._tick)

    def _sel_hist(self):
        sel = self.tree.selection()
        if not sel or not self.px:
            return None
        hid = int(self.tree.item(sel[0], "values")[0])
        for h in self.px.snapshot():
            if h["id"] == hid:
                return h
        return None

    def _to_repeater(self):
        h = self._sel_hist()
        if not h:
            messagebox.showinfo("Proxy", "اختر طلبًا من السجل أولًا.")
            return
        RepeaterWin(self.app, preset={"method": h["method"], "url": h["url"],
                                      "headers": h["req_headers"],
                                      "body": h["req_body"]})

    def _release(self):
        if self.px and self.px.queue.pending_ids():
            self.px.queue.release(self.px.queue.pending_ids()[0])
            self.app._console("[Proxy] أُطلق الطلب المحتجَز", "ok")

    def _drop(self):
        if self.px and self.px.queue.pending_ids():
            self.px.queue.drop(self.px.queue.pending_ids()[0])
            self.app._console("[Proxy] أُسقط الطلب المحتجَز", "warn")

    def _clear(self):
        if self.px:
            self.px.clear()

    def _stop(self):
        if self.px:
            self.px.stop()
            self.px = None
            self.info.config(text="متوقف")

    def _close(self):
        if self._timer:
            try:
                self.top.after_cancel(self._timer)
            except Exception:
                pass
        self._stop()
        self.top.destroy()


# ================================================================ Crawler
class CrawlWin:
    def __init__(self, app):
        self.app = app
        top = self.top = tk.Toplevel(app.root)
        top.title("🕸️ خريطة الموقع — استطلاع ذكي")
        top.geometry("900x640")
        top.configure(bg="#0b1220")
        bar = tk.Frame(top, bg="#0b1220")
        bar.pack(fill="x", padx=12, pady=8)
        self.status = tk.Label(bar, text="جاهز", bg="#0b1220", fg="#94a3b8")
        self.status.pack(side="left")
        app._mk_button(bar, "ابنِ الخريطة 🕸️", self._run,
                       bg="#16a34a", hover="#22c55e").pack(side="right")

        nb = ttk.Notebook(top)
        nb.pack(fill="both", expand=True, padx=12, pady=(0, 10))
        self.lst = tk.Listbox(nb, bg="#02060d", fg="#7dd3fc",
                              font=("Consolas", 9))
        self.forms = tk.Text(nb, bg="#02060d", fg="#e2e8f0",
                             font=("Consolas", 9), wrap="word")
        self.fp = tk.Text(nb, bg="#02060d", fg="#e2e8f0",
                          font=("Consolas", 9), wrap="word")
        self.hd = tk.Text(nb, bg="#02060d", fg="#e2e8f0",
                          font=("Consolas", 9), wrap="word")
        self.surf = tk.Text(nb, bg="#02060d", fg="#e2e8f0",
                            font=("Consolas", 9), wrap="word")
        nb.add(self.lst, text="النقاط")
        nb.add(self.forms, text="النماذج")
        nb.add(self.fp, text="البصمة")
        nb.add(self.hd, text="الترويسات")
        nb.add(self.surf, text="السطح")

    def _run(self):
        self.status.config(text="يزحف …")
        try:
            scope, base = _snap(self.app)
        except Exception as e:
            self.status.config(text=f"نطاق مرفوض: {e}")
            return
        threading.Thread(target=self._work, args=(scope, base),
                         daemon=True).start()

    def _work(self, scope, base):
        try:
            import urllib.parse as _up
            s = Session(scope)
            root = base.rstrip("/") + "/"
            m = crawl(s, root, max_pages=30, max_depth=2)
            fp = fingerprint(s, base)
            hc = check_headers(s, root)
            paths = sorted({_up.urlsplit(e).path or "/"
                            for e in m["endpoints"]})[:15]
            am = probe_auth(Session(scope),
                            [root.rstrip("/") + p for p in paths])
            surf = analyze(m, fp, hc, am, hints=PARAM_HINTS)
            try:
                js = harvest(Session(scope), m.get("scripts", []),
                             base.rstrip("/") + "/")
                for c in js["candidates"]:
                    if c not in m["endpoints"]:
                        m["endpoints"].append("JS→ " + c)
                nsec = sum(len(f["secrets"]) for f in js["files"])
            except Exception:
                js, nsec = {"files": [], "candidates": []}, 0
            self.top.after(0, self._fill, m, fp, hc, surf)
            self.app._console(f"[خريطة] {len(m['pages'])} صفحة · "
                              f"{len(m['endpoints'])} نقطة · "
                              f"سطح {surf['grade']} ({surf['score']}) · "
                              f"حصاد JS: {len(js['files'])} ملف، "
                              f"{len(js['candidates'])} مسار، {nsec} سر",
                              "warn" if nsec else "ok")
        except Exception as e:
            self.top.after(0, self.status.config, {"text": f"خطأ: {e}"})
            self.app._console(f"[خريطة] خطأ: {e}", "err")

    def _fill(self, m, fp, hc, surf=None):
        self.lst.delete(0, "end")
        for e in m["endpoints"]:
            self.lst.insert("end", e)
        self.forms.delete("1.0", "end")
        for f in m["forms"]:
            names = ", ".join(i["name"] or "?" for i in f["inputs"])
            self.forms.insert("end",
                              f"{f['method']} {f['action']}  [{names}]\n")
        self.fp.delete("1.0", "end")
        self.fp.insert("end",
                       f"الخادم: {fp['server']}\nالتخمين: "
                       f"{'، '.join(fp['framework_guesses']) or '—'}\n"
                       f"المكتبات: {', '.join(fp['js_libs']) or '—'}\n"
                       f"ملاحظات: {'; '.join(fp['notes']) or '—'}\n")
        self.hd.delete("1.0", "end")
        for f in hc["findings"]:
            self.hd.insert("end", f"[{f['state']}] {f['item']}: {f['detail']}\n")
        self.status.config(text=f"{len(m['pages'])} صفحة · "
                                f"{len(m['endpoints'])} نقطة · "
                                f"{len(m['forms'])} نموذج")
        self.surf.delete("1.0", "end")
        if surf:
            self.surf.insert("end",
                             f"درجة التعرض: {surf['score']} ({surf['grade']})\n\n")
            for n in surf["notes"]:
                self.surf.insert("end", f"• {n}\n")
            self.surf.insert("end", "\nالتوصيات:\n")
            for i, r in enumerate(surf["recommendations"], 1):
                self.surf.insert("end", f"{i}. {r}\n")


# ================================================================ Labs
class LabsWin:
    """مختبرات المنهجية بأسلوب الأكاديميات: هدف + خطوات + تحقق حي."""

    def __init__(self, app):
        self.app = app
        self.solved = set()
        top = self.top = tk.Toplevel(app.root)
        top.title("🧪 مختبرات المنهجية — حلّ وتحقق")
        top.geometry("880x600")
        top.configure(bg="#0b1220")

        left = tk.Frame(top, bg="#0b1220")
        left.pack(side="left", fill="y", padx=12, pady=10)
        tk.Label(left, text="المختبرات", bg="#0b1220", fg="#38bdf8",
                 font=("Segoe UI", 11, "bold")).pack(anchor="w")
        self.lst = tk.Listbox(left, width=34, height=26, bg="#02060d",
                              fg="#e2e8f0", font=("Segoe UI", 10))
        self.lst.pack(fill="y", expand=True)
        self.lst.bind("<<ListboxSelect>>", lambda e: self._show())
        for lab in LABS:
            self.lst.insert("end", f"○ {lab['title']}")

        right = tk.Frame(top, bg="#0b1220")
        right.pack(side="right", fill="both", expand=True, padx=(0, 12),
                   pady=10)
        self.title = tk.Label(right, text="", bg="#0b1220", fg="#e0f2fe",
                              font=("Segoe UI", 12, "bold"), anchor="w",
                              justify="right")
        self.title.pack(fill="x")
        self.goal = tk.Label(right, text="", bg="#0b1220", fg="#7dd3fc",
                             font=("Segoe UI", 10), anchor="w",
                             justify="right", wraplength=520)
        self.goal.pack(fill="x", pady=4)
        self.steps = tk.Text(right, height=12, bg="#02060d", fg="#e2e8f0",
                             font=("Segoe UI", 10), wrap="word")
        self.steps.pack(fill="both", expand=True)
        row = tk.Frame(right, bg="#0b1220")
        row.pack(fill="x", pady=8)
        app._mk_button(row, "🌐 افتح الهدف", self._open,
                       bg="#0d9488", hover="#14b8a6").pack(side="left")
        app._mk_button(row, "✓ تحقق من الحل", self._verify,
                       bg="#16a34a", hover="#22c55e").pack(side="left",
                                                           padx=6)
        self.status = tk.Label(row, text="", bg="#0b1220", fg="#94a3b8")
        self.status.pack(side="left", padx=10)
        self._cur = None
        if LABS:
            self.lst.selection_set(0)
            self._show()

    def _cur_lab(self):
        sel = self.lst.curselection()
        if not sel:
            return None
        return LABS[sel[0]]

    def _show(self):
        lab = self._cur_lab()
        if not lab:
            return
        self._cur = lab
        mark = "✓" if lab["id"] in self.solved else "○"
        self.title.config(text=f"{mark} {lab['title']}")
        self.goal.config(text=f"الهدف: {lab['goal']}")
        self.steps.delete("1.0", "end")
        for i, st in enumerate(lab["steps"], 1):
            self.steps.insert("end", f"{i}. {st}\n")

    def _open(self):
        import webbrowser
        lab = self._cur_lab()
        if not lab:
            return
        base = (self.app.target_var.get().strip()
                or "http://127.0.0.1:5001/").rstrip("/")
        webbrowser.open(base + lab["url"])
        self.app._console(f"[مختبر] فُتح: {lab['url']}", "info")

    def _verify(self):
        lab = self._cur_lab()
        if not lab:
            return
        try:
            scope, base = _snap(self.app)
        except Exception as e:
            self.status.config(text=f"نطاق مرفوض: {e}")
            return
        self.status.config(text="جارٍ التحقق …")
        threading.Thread(target=self._work,
                         args=(lab, scope, base), daemon=True).start()

    def _work(self, lab, scope, base):
        try:
            ok, msg = run_lab(lambda: Session(scope), base, lab["id"])
            if ok:
                self.solved.add(lab["id"])
            self.top.after(0, self._done, lab, ok, msg)
            self.app._console(f"[مختبر] {lab['id']}: {msg}",
                              "ok" if ok else "warn")
        except Exception as e:
            self.top.after(0, self.status.config, {"text": f"خطأ: {e}"})

    def _done(self, lab, ok, msg):
        self.status.config(text=msg)
        idx = next(i for i, l in enumerate(LABS) if l["id"] == lab["id"])
        self.lst.delete(idx)
        self.lst.insert(idx, f"{'✓' if ok else '○'} {lab['title']}")
        self.lst.selection_set(idx)
        self._show()


# ================================================================ ActiveScan
class ActiveScanWin:
    """المسح النشط: من الخريطة إلى الحقن المصنف — بنقرة واحدة."""

    def __init__(self, app):
        self.app = app
        self._data = []
        top = self.top = tk.Toplevel(app.root)
        top.title("🎯 مسح نشط — حقن تلقائي مصنف")
        top.geometry("960x620")
        top.configure(bg="#0b1220")
        bar = tk.Frame(top, bg="#0b1220")
        bar.pack(fill="x", padx=12, pady=8)
        self.want_time = tk.BooleanVar(value=False)
        tk.Checkbutton(bar, text="تصعيد زمني (للنقاط المرشحة فقط)",
                       variable=self.want_time, bg="#0b1220", fg="#e2e8f0",
                       selectcolor="#0f172a").pack(side="left")
        tk.Label(bar, text="النقاط:", bg="#0b1220",
                 fg="#e2e8f0").pack(side="left", padx=(12, 2))
        self.maxp = tk.Entry(bar, width=4)
        self.maxp.insert(0, "25")
        self.maxp.pack(side="left")
        self.status = tk.Label(bar, text="جاهز", bg="#0b1220", fg="#94a3b8")
        self.status.pack(side="left", padx=12)
        app._mk_button(bar, "ابنِ الخريطة وامسح 🎯", self._run,
                       bg="#dc2626", hover="#ef4444").pack(side="right")
        app._mk_button(bar, "فتح في Repeater 🔁", self._to_repeater,
                       bg="#0d9488", hover="#14b8a6").pack(side="right",
                                                          padx=6)

        cols = ("url", "param", "category", "payload", "reason")
        self.tree = ttk.Treeview(top, columns=cols, show="headings")
        for c, w, t in (("url", 260, "النقطة"), ("param", 90, "المعامل"),
                        ("category", 110, "الصنف"), ("payload", 220, "الحمولة"),
                        ("reason", 220, "السبب")):
            self.tree.heading(c, text=t)
            self.tree.column(c, width=w, anchor="w")
        self.tree.pack(fill="both", expand=True, padx=12, pady=(0, 10))
        self.tree.tag_configure("hit", background="#450a0a",
                                foreground="#fca5a5")

    def _run(self):
        try:
            maxp = max(1, int(self.maxp.get()))
        except ValueError:
            messagebox.showwarning("مسح نشط", "النقاط رقم.")
            return
        try:
            # المسح النشط يحقن آليًا → طبقة intrusive (تصريح مالك للخارجي)
            scope, base = _snap(self.app, intrusive=True)
        except Exception as e:
            messagebox.showerror("نطاق مرفوض", str(e))
            return
        self.status.config(text="يزحف ثم يحقن …")
        threading.Thread(target=self._work,
                         args=(scope, base, maxp, self.want_time.get()),
                         daemon=True).start()

    def _work(self, scope, base, maxp, want_time):
        try:
            s = Session(scope)
            m = crawl(s, base, max_pages=30, max_depth=2)
            rep = active_scan(s, m, base, include_time=want_time,
                              max_points=maxp)
            self.top.after(0, self._fill, rep)
            st = rep["stats"]
            self.app._console(
                f"[نشط] {st['points']} نقطة · {st['requests']} طلب · "
                f"{st['findings']} اكتشاف ({st['elapsed']}s)",
                "ok" if st["findings"] else "op")
        except Exception as e:
            self.top.after(0, self.status.config, {"text": f"خطأ: {e}"})
            self.app._console(f"[نشط] خطأ: {e}", "err")

    def _fill(self, rep):
        for i in self.tree.get_children():
            self.tree.delete(i)
        self._data = rep["findings"]
        for f in self._data:
            self.tree.insert("", "end", values=(
                f["url"], f["param"], f["category"], f["payload"][:50],
                f["reason"][:60]), tags=("hit",))
        st = rep["stats"]
        self.status.config(
            text=f"اكتمل: {st['points']} نقطة · {st['requests']} طلب · "
                 f"{st['findings']} اكتشاف · {st['elapsed']}s")

    def _to_repeater(self):
        sel = self.tree.selection()
        if not sel:
            messagebox.showinfo("مسح نشط", "اختر اكتشافًا أولًا.")
            return
        vals = self.tree.item(sel[0], "values")
        f = next((x for x in self._data if x["url"] == vals[0]
                  and x["param"] == vals[1]
                  and x["category"] == vals[2]), None)
        if not f:
            return
        if f["method"] == "GET":
            import urllib.parse
            q = urllib.parse.urlencode([(f["param"], f["payload"])])
            preset = {"method": "GET", "url": f["url"] + "?" + q}
        else:
            import urllib.parse
            preset = {"method": "POST", "url": f["url"],
                      "headers": {"Content-Type":
                                  "application/x-www-form-urlencoded"},
                      "body": urllib.parse.urlencode(
                          [(f["param"], f["payload"])])}
        RepeaterWin(self.app, preset=preset)


# ================================================================ Encoder
class EncodeWin:
    def __init__(self, app):
        top = self.top = tk.Toplevel(app.root)
        top.title("🔣 الترميز — مشفّر/مفكّك داخلي")
        top.geometry("640x420")
        top.configure(bg="#0b1220")
        bar = tk.Frame(top, bg="#0b1220")
        bar.pack(fill="x", padx=12, pady=8)
        self.kind = tk.StringVar(value="url")
        tk.OptionMenu(bar, self.kind, *KINDS).pack(side="left")
        app._mk_button(bar, "رمّز →", lambda: self._go(False),
                       bg="#9333ea", hover="#a855f7").pack(side="left", padx=6)
        app._mk_button(bar, "← فكّ", lambda: self._go(True),
                       bg="#0d9488", hover="#14b8a6").pack(side="left", padx=6)
        self.src = tk.Text(top, height=6, bg="#02060d", fg="#e2e8f0",
                           font=("Consolas", 10))
        self.src.pack(fill="x", padx=12)
        self.dst = tk.Text(top, height=6, bg="#02060d", fg="#34d399",
                           font=("Consolas", 10))
        self.dst.pack(fill="x", padx=12, pady=8)

    def _go(self, dec):
        try:
            fn = decode if dec else encode
            out = fn(self.kind.get(),
                     self.src.get("1.0", "end").rstrip("\n"))
            self.dst.delete("1.0", "end")
            self.dst.insert("end", out)
        except Exception as e:
            self.dst.delete("1.0", "end")
            self.dst.insert("end", f"خطأ: {e}")


# ================================================================ Plugins
class PluginsWin:
    def __init__(self, app):
        self.app = app
        top = self.top = tk.Toplevel(app.root)
        top.title("🧩 الإضافات — فحوصات المجتمع")
        top.geometry("760x520")
        top.configure(bg="#0b1220")
        bar = tk.Frame(top, bg="#0b1220")
        bar.pack(fill="x", padx=12, pady=8)
        app._mk_button(bar, "تحديث القائمة", self._refresh,
                       bg="#475569", hover="#64748b").pack(side="left")
        app._mk_button(bar, "تشغيل المحدد ▶", self._run,
                       bg="#b45309", hover="#d97706").pack(side="left", padx=6)
        self.status = tk.Label(bar, text="", bg="#0b1220", fg="#94a3b8")
        self.status.pack(side="left", padx=10)
        self.lst = tk.Listbox(top, bg="#02060d", fg="#fbbf24",
                              font=("Consolas", 10))
        self.lst.pack(fill="both", expand=True, padx=12)
        self.out = tk.Text(top, height=8, bg="#02060d", fg="#e2e8f0",
                           font=("Consolas", 9), wrap="word")
        self.out.pack(fill="x", padx=12, pady=8)
        self._metas = []
        self._refresh()

    def _refresh(self):
        from pathlib import Path as _P
        plugdir = LAB / "plugins" / "checks"
        loaded, errors = discover(plugdir)
        self._metas = loaded
        self.lst.delete(0, "end")
        for m in loaded:
            self.lst.insert("end", f"{m['code']} — {m['name']} [{m['source']}]")
        msg = f"{len(loaded)} إضافة"
        if errors:
            msg += f" · أخطاء: {len(errors)} ({errors[0]['file']})"
        self.status.config(text=msg)

    def _run(self):
        sel = self.lst.curselection()
        if not sel:
            messagebox.showinfo("الإضافات", "اختر إضافة أولًا.")
            return
        meta = self._metas[sel[0]]
        self.status.config(text=f"جارٍ: {meta['code']} …")
        try:
            scope, base = _snap(self.app)
        except Exception as e:
            self.status.config(text=f"نطاق مرفوض: {e}")
            return
        threading.Thread(target=self._work, args=(meta, scope, base),
                         daemon=True).start()

    def _work(self, meta, scope, base):
        try:
            from local_scan import run_check
            r = run_check(meta, Session(scope), base, "verify")
            msg = (f"[{r['code']}] {'مؤكد ✓' if r['verdict'] else 'سليم/غير مؤكد'}"
                   f" — {r['note']}")
            self.top.after(0, self._show, msg)
            self.app._console(f"[إضافة] {msg}",
                              "ok" if r["verdict"] else "op")
        except Exception as e:
            self.top.after(0, self._show, f"خطأ: {e}")

    def _show(self, msg):
        self.status.config(text=msg)
        self.out.insert("end", msg + "\n")


# ================================================================ Profiles
class ProfilesWin:
    """ملفات الجلسات: حفظ بيانات دخول كل هدف واختبارها واستخدامها."""

    FIELDS = (("name", "الاسم"), ("target", "الهدف"),
              ("username", "المستخدم"), ("password", "كلمة المرور"),
              ("login_path", "مسار الدخول"))

    def __init__(self, app, on_change=None):
        self.app = app
        self.on_change = on_change
        top = self.top = tk.Toplevel(app.root)
        top.title("👤 ملفات الجلسات — دخول كل هدف")
        top.geometry("760x540")
        top.configure(bg="#0b1220")
        bar = tk.Frame(top, bg="#0b1220")
        bar.pack(fill="x", padx=12, pady=8)
        tk.Label(bar, text="الملفات المحفوظة:", bg="#0b1220", fg="#e2e8f0",
                 font=("Segoe UI", 10, "bold")).pack(side="left")
        app._mk_button(bar, "تحديث", self._refresh,
                       bg="#475569", hover="#64748b").pack(side="right")
        self.lst = tk.Listbox(top, height=7, bg="#02060d", fg="#7dd3fc",
                              font=("Consolas", 10))
        self.lst.pack(fill="x", padx=12)
        self.lst.bind("<<ListboxSelect>>", lambda e: self._fill_form())

        form = tk.Frame(top, bg="#0b1220")
        form.pack(fill="x", padx=12, pady=8)
        self.vars = {}
        for i, (key, label) in enumerate(self.FIELDS):
            tk.Label(form, text=label, bg="#0b1220", fg="#94a3b8",
                     font=("Segoe UI", 9)).grid(row=i // 2, column=(i % 2) * 2 + 1,
                                                sticky="e", pady=2)
            v = tk.StringVar()
            e = tk.Entry(form, textvariable=v, width=26,
                         font=("Consolas", 10),
                         show="•" if key == "password" else "")
            e.grid(row=i // 2, column=(i % 2) * 2, sticky="w", padx=6,
                   pady=2)
            self.vars[key] = v
        self.vars["target"].set(app.target_var.get())
        self.vars["login_path"].set("/login")

        row = tk.Frame(top, bg="#0b1220")
        row.pack(fill="x", padx=12, pady=4)
        app._mk_button(row, "💾 حفظ", self._save,
                       bg="#059669", hover="#10b981").pack(side="left")
        app._mk_button(row, "اختبار الدخول", self._test,
                       bg="#0d9488", hover="#14b8a6").pack(side="left",
                                                          padx=6)
        app._mk_button(row, "🗑 حذف", self._delete,
                       bg="#dc2626", hover="#ef4444").pack(side="left",
                                                          padx=6)
        self.status = tk.Label(top, text="", bg="#0b1220", fg="#94a3b8",
                               font=("Segoe UI", 9), wraplength=700,
                               justify="right")
        self.status.pack(fill="x", padx=12, pady=6)
        tk.Label(top, text="⚠ كلمات المرور نص صريح على قرصك — حسابات اختبار فقط.",
                 bg="#0b1220", fg="#fbbf24",
                 font=("Segoe UI", 9)).pack(padx=12)
        self._refresh()

    def _refresh(self):
        self.lst.delete(0, "end")
        self._items = list_profiles()
        for it in self._items:
            self.lst.insert("end",
                            f"{it['name']} — {it['username']} @ {it['target']}")
        if self.on_change:
            try:
                self.on_change()
            except Exception:
                pass

    def _fill_form(self):
        sel = self.lst.curselection()
        if not sel:
            return
        try:
            d = prof_load(self._items[sel[0]]["name"])
        except Exception as e:
            self.status.config(text=str(e))
            return
        for k, v in self.vars.items():
            v.set(d.get(k, ""))

    def _collect(self):
        return {k: v.get().strip() for k, v in self.vars.items()}

    def _save(self):
        d = self._collect()
        try:
            prof_save(d["name"], d["target"] or self.app.target_var.get(),
                      d["username"], d["password"],
                      login_path=d["login_path"] or "/login")
            self.status.config(text=f"حُفظ الملف «{d['name']}» ✓")
            self.app._console(f"[جلسات] حُفظ «{d['name']}»", "ok")
            self._refresh()
        except Exception as e:
            self.status.config(text=str(e))

    def _delete(self):
        sel = self.lst.curselection()
        if not sel:
            return
        name = self._items[sel[0]]["name"]
        if prof_delete(name):
            self.status.config(text=f"حُذف «{name}»")
            self._refresh()

    def _test(self):
        d = self._collect()
        if not d["username"]:
            self.status.config(text="املأ الحقول أولًا (أو اختر ملفًا).")
            return
        try:
            scope = self.app._make_scope()
        except Exception as e:
            self.status.config(text=str(e))
            return
        base = (d["target"] or self.app.target_var.get()).rstrip("/") + "/"
        try:
            # اختبار الدخول يرسل بيانات اعتماد حقيقية → طبقة intrusive
            _require_intrusive_grant(base)
        except Exception as e:
            self.status.config(text=str(e))
            return
        prof = {"username": d["username"], "password": d["password"],
                "login_path": d["login_path"] or "/login",
                "user_field": "username", "pass_field": "password"}
        self.status.config(text="جارٍ اختبار الدخول …")
        threading.Thread(target=self._work,
                         args=(scope, base, prof), daemon=True).start()

    def _work(self, scope, base, prof):
        try:
            ok, msg = apply_profile(Session(scope), base, prof)
            self.top.after(0, self.status.config,
                           {"text": f"{'ناجح ✓' if ok else 'فشل'} — {msg}"})
            self.app._console(f"[جلسات] اختبار: {msg}",
                              "ok" if ok else "warn")
        except Exception as e:
            self.top.after(0, self.status.config, {"text": f"خطأ: {e}"})


# ================================================================ OOB Monitor
class OOBWin:
    """مراقب التفاعل خارج النطاق: إثبات الثغرات العمياء (SSRF/DNS)."""

    def __init__(self, app):
        self.app = app
        self.oob = None
        self.token = ""
        self._timer = None
        top = self.top = tk.Toplevel(app.root)
        top.title("📡 مراقب OOB — إثبات العمياء")
        top.geometry("760x540")
        top.configure(bg="#0b1220")
        top.protocol("WM_DELETE_WINDOW", self._close)
        bar = tk.Frame(top, bg="#0b1220")
        bar.pack(fill="x", padx=12, pady=8)
        app._mk_button(bar, "بدء المراقب ▶", self._start,
                       bg="#16a34a", hover="#22c55e").pack(side="left")
        app._mk_button(bar, "إيقاف ■", self._stop,
                       bg="#475569", hover="#64748b").pack(side="left",
                                                          padx=6)
        self.info = tk.Label(bar, text="متوقف", bg="#0b1220", fg="#94a3b8",
                             font=("Segoe UI", 9))
        self.info.pack(side="left", padx=8)

        tok = tk.Frame(top, bg="#0b1220")
        tok.pack(fill="x", padx=12, pady=4)
        app._mk_button(tok, "رمز جديد + حمولات", self._new_token,
                       bg="#0d9488", hover="#14b8a6").pack(side="left")
        app._mk_button(tok, "نسخ رابط SSRF", self._copy_url,
                       bg="#334155", hover="#475569").pack(side="left",
                                                          padx=6)
        app._mk_button(tok, "نسخ اسم DNS", self._copy_dns,
                       bg="#334155", hover="#475569").pack(side="left",
                                                          padx=6)
        self.tok_lbl = tk.Label(top, text="—", bg="#02060d", fg="#fbbf24",
                                font=("Consolas", 10), anchor="w",
                                justify="left", padx=10, pady=6)
        self.tok_lbl.pack(fill="x", padx=12, pady=4)
        tk.Label(top, text="الوارد (يُحدَّث تلقائيًا):", bg="#0b1220",
                 fg="#34d399", font=("Segoe UI", 10, "bold")).pack(
            anchor="w", padx=12)
        self.lst = tk.Listbox(top, bg="#02060d", fg="#e2e8f0",
                              font=("Consolas", 9))
        self.lst.pack(fill="both", expand=True, padx=12, pady=(0, 10))
        tk.Label(top, text="الوصفة: احقن الرابط/الاسم في نقطة مشبوهة (SSRF/XXE/DNS) ثم راقب الوارد — الضربة تثبت التنفيذ من جهة الخادم بلا رد.",
                 bg="#0b1220", fg="#94a3b8", font=("Segoe UI", 9),
                 wraplength=700, justify="right").pack(padx=12, pady=(0, 10))

    def _start(self):
        if self.oob:
            return
        self.oob = OOBServer()
        try:
            port = self.oob.start()
        except Exception as e:
            self.oob = None
            messagebox.showerror("OOB", f"تعذّر الإقلاع: {e}")
            return
        self.info.config(
            text=f"يعمل: HTTP :{port} · DNS 127.0.0.1:15353", fg="#34d399")
        self.app._console(f"[OOB] يعمل (HTTP :{port} + DNS :15353)", "ok")
        self._new_token()
        self._tick()

    def _new_token(self):
        if not self.oob:
            messagebox.showinfo("OOB", "ابدأ المراقب أولًا.")
            return
        self.token = self.oob.token()
        self.tok_lbl.config(
            text=f"الرمز: {self.token}\nSSRF: {self.oob.http_url(self.token)}\n"
                 f"DNS: {self.oob.dns_name(self.token)}")

    def _copy(self, text):
        if not text:
            return
        self.top.clipboard_clear()
        self.top.clipboard_append(text)
        self.app._console("[OOB] نُسخ إلى الحافظة", "info")

    def _copy_url(self):
        if self.oob and self.token:
            self._copy(self.oob.http_url(self.token))

    def _copy_dns(self):
        if self.oob and self.token:
            self._copy(self.oob.dns_name(self.token))

    def _tick(self):
        if not self.oob:
            return
        try:
            hits = self.oob.hits[-100:]
            self.lst.delete(0, "end")
            for h in hits:
                mark = "🎯 " if self.token and self.token in h["detail"] \
                    else ""
                self.lst.insert("end",
                                f"{mark}#{h['id']} [{h['ts']}] {h['kind']}: "
                                f"{h['detail'][:80]}")
        except Exception:
            pass
        self._timer = self.top.after(2000, self._tick)

    def _stop(self):
        if self.oob:
            self.oob.stop()
            self.oob = None
            self.info.config(text="متوقف", fg="#94a3b8")

    def _close(self):
        if self._timer:
            try:
                self.top.after_cancel(self._timer)
            except Exception:
                pass
        self._stop()
        self.top.destroy()
