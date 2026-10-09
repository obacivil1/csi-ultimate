"""
local-lab/gui/app.py — الواجهة الاحترافية v4 (لوحة منتج حقيقي).
================================================================
- تبويبات: اللوحة / الفحص / التعلم / الأدوات / التقارير (بأسلوب Burp).
- نظام تصميم موحد (ألوان/خطوط/cards) + شريط حالة دائم.
- كل منطق الفحص/النطاق/الدروس محفوظ من v3؛ أُعيد تنظيم العرض فقط.
- كل طلب يمر عبر Scope.check_url — loopback أو نطاق مرخص واحد.
"""
import json
import os
import sys
import threading
import urllib.parse
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from tkinter import filedialog

import tkinter as tk
from tkinter import messagebox, simpledialog, ttk

GUI_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(GUI_DIR))
sys.path.insert(0, str(GUI_DIR.parent / "scanner"))
sys.path.insert(0, str(GUI_DIR.parent / "engine"))
sys.path.insert(0, str(GUI_DIR.parent / "report"))
sys.path.insert(0, str(GUI_DIR.parent / "learn"))
sys.path.insert(0, str(GUI_DIR.parent / "util"))

from lessons import GLOSSARY, LESSONS, ORDER
from session import Session
from scoped import Scope
from local_scan import CHECKS, build_report

DEFAULT_TARGET = "http://127.0.0.1:5001/"


def normalize_target_input(raw: str) -> str:
    """يتسامح مع النطاق العاري: demo.testfire.net → http://demo.testfire.net.

    يعيد "" للفارغ. لا يخمن https — الصقه كاملًا إن أردته.
    """
    t = (raw or "").strip().strip("'\"")
    if not t:
        return ""
    if "://" not in t:
        t = "http://" + t.lstrip("/")
    return t

# ---------------------------------------------------------- نظام التصميم
BG = "#0b1220"
PANEL = "#111c30"
CARD = "#16233c"
DEEP = "#0d1526"
BORDER = "#1e3a5f"
ACCENT = "#0ea5e9"
SKY = "#7dd3fc"
TEXT = "#e2e8f0"
MUTED = "#94a3b8"
OK = "#34d399"
WARN = "#fbbf24"
ERR = "#f87171"
CRIT = "#ef4444"

F_TITLE = ("Segoe UI", 16, "bold")
F_H2 = ("Segoe UI", 12, "bold")
F_H3 = ("Segoe UI", 10, "bold")
F_BODY = ("Segoe UI", 10)
F_SMALL = ("Segoe UI", 9)
F_MONO = ("Consolas", 9)


def _hide_console():
    """يُخفي نافذة الطرفية السوداء فورًا (ويندوز) إن وُجدت."""
    if os.name != "nt":
        return
    try:
        import ctypes
        ctypes.windll.user32.ShowWindow(
            ctypes.windll.kernel32.GetConsoleWindow(), 0)
    except Exception:
        pass


def _extra(code):
    """CVSS + CWE + إصلاح للثغرة (تُحمَّل عند الحاجة فقط)."""
    try:
        from cvss import suggest
        from bounty import CWE, FIXES
        got = suggest(code)
        s, r, vec = got if got else ("—", "—", "—")
        return {"cvss": s, "rating": r, "vector": vec,
                "cwe": CWE.get(code, "—"),
                "fix": FIXES.get(code, "راجع توجيهات OWASP.")}
    except Exception:
        return {"cvss": "—", "rating": "—", "vector": "—",
                "cwe": "—", "fix": "راجع توجيهات OWASP."}


class LocalLabApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("نِطاق — منصة اختبار الاختراق (تعليمية)")
        root.geometry("1120x820")
        root.minsize(980, 700)
        root.configure(bg=BG)

        self.scope_mode = tk.StringVar(value="loopback")
        self.confirmed = False
        self.target_var = tk.StringVar(value=DEFAULT_TARGET)
        self.busy = False
        self._pulse_job = None
        self._step_index = 0
        self._lesson_key = None
        self._last_report = None
        self._rows = []
        self._current_row = None
        self._evidence = {}
        self._filter_q = tk.StringVar(value="")
        self._filter_sev = tk.StringVar(value="الكل")
        self._filter_found = tk.BooleanVar(value=False)
        self.auth_login = tk.BooleanVar(value=False)
        self.auth_user = tk.StringVar(value="omari")
        self.auth_pass = tk.StringVar(value="user123")
        self.profile_var = tk.StringVar(value="")
        self.authz_verify = tk.BooleanVar(value=False)
        self._stop_event = threading.Event()
        self._watch_on = False
        self._watch_job = None

        self._style()
        self._bind_edit_menu()
        self._build_header()
        self._build_tabs()
        self._build_console()
        self._build_status()
        self._console("نِطاق v4 جاهزة — اختر البيئة ثم ابدأ من اللوحة.", "ok")
        self._console("الوضع الافتراضي: جهازك فقط (loopback).", "info")
        try:
            self._refresh_targets()
        except Exception:
            pass

    # ============================================================ التصميم
    def _style(self):
        st = ttk.Style(self.root)
        try:
            st.theme_use("clam")
        except Exception:
            pass
        st.configure("TNotebook", background=BG, borderwidth=0)
        st.configure("TNotebook.Tab", background=PANEL, foreground=MUTED,
                     padding=(16, 9), font=("Segoe UI", 11, "bold"),
                     borderwidth=0)
        st.map("TNotebook.Tab",
               background=[("selected", CARD)],
               foreground=[("selected", SKY)])
        st.configure("Treeview", background=DEEP, fieldbackground=DEEP,
                     foreground=TEXT, rowheight=26, font=F_BODY,
                     borderwidth=0)
        st.configure("Treeview.Heading", background=CARD, foreground=SKY,
                     font=F_H3, borderwidth=0)
        st.map("Treeview", background=[("selected", "#1d4ed8")],
               foreground=[("selected", "#ffffff")])
        st.configure("TEntry", fieldbackground=DEEP, foreground=TEXT,
                     borderwidth=1)
        st.configure("TCombobox", fieldbackground=DEEP, foreground=TEXT,
                     arrowcolor=SKY)
        st.configure("TCheckbutton", background=BG, foreground=TEXT)
        st.configure("Horizontal.TProgressbar", background=ACCENT,
                       troughcolor=DEEP, borderwidth=0)

    # ------------------------------------------- قائمة اليمين (قص/نسخ/لصق)
    def _bind_edit_menu(self):
        """قائمة زر أيمن لكل خانات الإدخال في البرنامج كله."""
        for cls in ("Entry", "TEntry"):
            try:
                self.root.bind_class(cls, "<Button-3>", self._edit_popup)
            except Exception:
                pass

    def _edit_popup(self, event):
        w = event.widget
        try:
            w.focus_set()
        except Exception:
            pass
        try:
            has_sel = bool(w.selection_present())
        except Exception:
            has_sel = False
        try:
            state = str(w.cget("state"))
        except Exception:
            state = "normal"
        editable = state not in ("disabled", "readonly")
        menu = tk.Menu(self.root, tearoff=0)
        menu.add_command(label="✂ قص", state="normal" if
                         (editable and has_sel) else "disabled",
                         command=lambda: self._emagic(w, "<<Cut>>"))
        menu.add_command(label="📋 نسخ", state="normal" if has_sel
                         else "disabled",
                         command=lambda: self._emagic(w, "<<Copy>>"))
        menu.add_command(label="📌 لصق", state="normal" if editable
                         else "disabled",
                         command=lambda: self._emagic(w, "<<Paste>>"))
        menu.add_separator()
        menu.add_command(label="تحديد الكل",
                         command=lambda: self._eselect_all(w))
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()

    @staticmethod
    def _emagic(w, seq):
        try:
            w.event_generate(seq)
        except Exception:
            pass

    @staticmethod
    def _eselect_all(w):
        try:
            if isinstance(w, ttk.Entry) or type(w).__name__ == "Entry":
                w.selection_range(0, "end")
            else:
                w.select_range(0, "end")
            w.icursor("end")
        except Exception:
            try:
                w.select_range(0, "end")
            except Exception:
                pass

    def _mk_button(self, parent, text, command, bg="#0284c7", fg="#ffffff",
                   hover="#0ea5e9", width=None):
        b = tk.Button(parent, text=text, command=command, bg=bg, fg=fg,
                      font=("Segoe UI", 10, "bold"), relief="flat", bd=0,
                      padx=16, pady=8, cursor="hand2",
                      activebackground=hover, activeforeground="#ffffff",
                      highlightthickness=1, highlightbackground=BORDER)
        if width:
            b.config(width=width)
        b.bind("<Enter>", lambda e: b.config(bg=hover))
        b.bind("<Leave>", lambda e: b.config(bg=bg))
        return b

    def _card(self, parent, **kw):
        f = tk.Frame(parent, bg=CARD, highlightbackground=BORDER,
                     highlightthickness=1, bd=0, **kw)
        return f

    def _lbl(self, parent, text, fg=TEXT, font=F_BODY, bg=None, **kw):
        return tk.Label(parent, text=text, bg=bg or parent.cget("bg"), fg=fg,
                        font=font, justify="right", anchor="e", **kw)

    # ============================================================ الرأس
    def _build_header(self):
        bar = tk.Frame(self.root, bg=PANEL, highlightthickness=0)
        bar.pack(fill="x")
        inner = tk.Frame(bar, bg=PANEL)
        inner.pack(fill="x", padx=18, pady=10)
        tk.Label(inner, text="◈ نِطاق", bg=PANEL, fg=SKY,
                 font=F_TITLE).pack(side="right")
        tk.Label(inner, text="منصة اختبار الاختراق المصرح — تعلّم • افحص • سيطر • وثّق",
                 bg=PANEL, fg=MUTED, font=F_SMALL).pack(side="right", padx=(12, 0))
        self.scope_badge = tk.Label(inner, text="🟢 محلي", bg=PANEL,
                                    fg=OK, font=F_H3)
        self.scope_badge.pack(side="left", padx=8)
        self.net_dot = tk.Canvas(inner, width=16, height=16, bg=PANEL,
                                 highlightthickness=0)
        self.net_dot.pack(side="left")
        self._net = self.net_dot.create_oval(3, 3, 13, 13, fill="#475569",
                                             outline="")
        tk.Label(inner, text="v4.0", bg=PANEL, fg=MUTED,
                 font=F_SMALL).pack(side="left", padx=8)

    # ============================================================ التبويبات
    def _build_tabs(self):
        self.nb = ttk.Notebook(self.root)
        self.nb.pack(fill="both", expand=True, padx=14, pady=(10, 0))
        self.tab_dash = tk.Frame(self.nb, bg=BG)
        self.tab_scan = tk.Frame(self.nb, bg=BG)
        self.tab_learn = tk.Frame(self.nb, bg=BG)
        self.tab_tools = tk.Frame(self.nb, bg=BG)
        self.tab_reports = tk.Frame(self.nb, bg=BG)
        self.nb.add(self.tab_dash, text="🏠  اللوحة")
        self.nb.add(self.tab_scan, text="🔍  الفحص")
        self.nb.add(self.tab_learn, text="🎓  التعلم")
        self.nb.add(self.tab_tools, text="🧰  الأدوات")
        self.nb.add(self.tab_reports, text="📤  التقارير")
        self._build_dash()
        self._build_scan()
        self._build_learn()
        self._build_tools()
        self._build_reports()
        self.nb.bind("<<NotebookTabChanged>>", self._on_tab)

    def _on_tab(self, _ev=None):
        try:
            if self.nb.select() == str(self.tab_reports):
                self._refresh_report_lists()
        except Exception:
            pass

    # ---------------------------------------------------------- اللوحة
    def _build_dash(self):
        wrap = tk.Frame(self.tab_dash, bg=BG)
        wrap.pack(fill="both", expand=True, padx=16, pady=12)

        # بطاقة الهدف
        tcard = self._card(wrap)
        tcard.pack(fill="x", pady=(0, 10))
        tk.Label(tcard, text="🎯 الهدف", bg=CARD, fg=SKY,
                 font=F_H2).pack(anchor="e", padx=14, pady=(10, 0))
        row = tk.Frame(tcard, bg=CARD)
        row.pack(fill="x", padx=14, pady=8)
        ttk.Entry(row, textvariable=self.target_var, width=46,
                  font=("Consolas", 10)).pack(side="right")
        self._mk_button(row, "اختبار الاتصال", self._test_target,
                        bg="#0d9488", hover="#14b8a6").pack(side="right",
                                                           padx=8)
        self._mk_button(row, "🌐 افتح الموقع", self._open_site,
                        bg="#0369a1", hover="#0284c7").pack(side="right")
        self.target_info = self._lbl(tcard, "لم يُختبر بعد.", fg=MUTED,
                                     font=F_SMALL, bg=CARD)
        self.target_info.pack(anchor="e", padx=14, pady=(0, 2))
        self._lbl(tcard, "مثال: http://demo.testfire.net/ — النطاق العاري يُقبَل ونكمل http:// تلقائيًا.",
                  fg=MUTED, font=F_SMALL, bg=CARD).pack(anchor="e", padx=14,
                                                       pady=(0, 6))
        trow2 = tk.Frame(tcard, bg=CARD)
        trow2.pack(fill="x", padx=14, pady=(0, 10))
        tk.Label(trow2, text="النطاقات المصرّحة:", bg=CARD, fg=MUTED,
                 font=F_SMALL).pack(side="right")
        self.target_combo = ttk.Combobox(trow2, state="readonly", width=38,
                                         font=("Consolas", 9))
        self.target_combo.pack(side="right", padx=8)
        self.target_combo.bind("<<ComboboxSelected>>", self._on_target_pick)
        self._mk_button(trow2, "＋ نطاق مصرّح", self._add_target_dialog,
                        bg="#4f46e5", hover="#6366f1").pack(side="right")
        self.deep_badge = self._lbl(tcard, "", fg=MUTED, font=F_SMALL,
                                    bg=CARD)
        self.deep_badge.pack(anchor="e", padx=14, pady=(0, 10))

        # بطاقة النطاق
        scard = self._card(wrap)
        scard.pack(fill="x", pady=(0, 10))
        tk.Label(scard, text="🛡️ النطاق", bg=CARD, fg=SKY,
                 font=F_H2).pack(anchor="e", padx=14, pady=(10, 0))
        env = tk.Frame(scard, bg=CARD)
        env.pack(fill="x", padx=14, pady=6)
        self.rb_local = tk.Radiobutton(
            env, text="محلية — جهازك فقط (loopback)", value="loopback",
            variable=self.scope_mode, command=self._on_mode_change,
            bg=CARD, fg=TEXT, selectcolor=DEEP,
            activebackground=CARD, activeforeground="#ffffff", font=F_BODY)
        self.rb_local.pack(side="right")
        self.rb_auth = tk.Radiobutton(
            env, text="مرخّصة — هدف مصرح واحد (بتوكيد «أؤكد»)",
            value="authorized", variable=self.scope_mode,
            command=self._on_mode_change, bg=CARD, fg=TEXT,
            selectcolor=DEEP, activebackground=CARD,
            activeforeground="#ffffff", font=F_BODY)
        self.rb_auth.pack(side="right", padx=24)
        self.scope_hint = self._lbl(scard, "لوحة loopback: جهازك فقط، بلا استثناء.",
                                    fg=MUTED, font=F_SMALL, bg=CARD)
        self.scope_hint.pack(anchor="e", padx=14, pady=(0, 4))
        self.authz_verify_box = tk.Checkbutton(
            scard, text="تحقق نشط على النطاق المرخص (كناري آمن: انعكاس/ترويسات فقط)",
            variable=self.authz_verify, bg=CARD, fg=TEXT, selectcolor=DEEP,
            activebackground=CARD, activeforeground="#ffffff", font=F_SMALL)
        self.authz_verify_box.pack(anchor="e", padx=14, pady=(0, 4))
        self.deep_run = tk.BooleanVar(value=False)
        self.deep_run_box = tk.Checkbutton(
            scard, text="⚡ فحص عميق لهذا الفحص (يتطلب: تصريح المالك + verify)",
            variable=self.deep_run, bg=CARD, fg="#fbbf24",
            selectcolor=DEEP, activebackground=CARD,
            activeforeground="#ffffff", font=F_SMALL)
        self.deep_run_box.pack(anchor="e", padx=14, pady=(0, 10))

        # إحصاءات
        stats = tk.Frame(wrap, bg=BG)
        stats.pack(fill="x", pady=(0, 10))
        self.stat_checks = self._stat(stats, "الفحوصات", str(len(CHECKS)))
        self.stat_checks.pack(side="right", fill="x", expand=True)
        self.stat_score = self._stat(stats, "آخر درجة", "—")
        self.stat_score.pack(side="right", fill="x", expand=True, padx=10)
        self.stat_found = self._stat(stats, "آخر ثغرات", "—")
        self.stat_found.pack(side="right", fill="x", expand=True)
        self.stat_lessons = self._stat(stats, "الدروس", str(len(ORDER)))
        self.stat_lessons.pack(side="right", fill="x", expand=True, padx=10)

        # إجراءات سريعة
        qcard = self._card(wrap)
        qcard.pack(fill="x")
        tk.Label(qcard, text="⚡ إجراءات سريعة", bg=CARD, fg=SKY,
                 font=F_H2).pack(anchor="e", padx=14, pady=(10, 0))
        grid = tk.Frame(qcard, bg=CARD)
        grid.pack(fill="x", padx=14, pady=10)
        self.btn_auto = self._mk_button(grid, "▶ فحص أوتوماتيكي", self._auto_scan)
        self.btn_auto.pack(side="right", padx=4)
        self.btn_stop = self._mk_button(grid, "⏹ إيقاف", self._stop_scan,
                                        bg="#475569", hover="#64748b")
        self.btn_stop.pack(side="right", padx=4)
        try:
            self.btn_stop.config(state="disabled")
        except Exception:
            pass
        self._mk_button(grid, "🕸️ خريطة الموقع",
                        self._open_crawl, bg="#16a34a",
                        hover="#22c55e").pack(side="right", padx=4)
        self.btn_missions = self._mk_button(
            grid, "🎯 مهمات عملية", self._open_missions,
            bg="#be123c", hover="#e11d48")
        self.btn_missions.pack(side="right", padx=4)
        self._mk_button(grid, "👁 ما بعد الاختراق", self._open_impact,
                        bg="#16a34a", hover="#22c55e").pack(side="right",
                                                           padx=4)
        self._mk_button(grid, "🛡️ شهادة الجاهزية", self._run_certify,
                        bg="#0e7490", hover="#0891b2").pack(side="right",
                                                           padx=4)
        self._mk_button(grid, "🎛 غرفة التحكم", self._open_control,
                        bg="#7c3aed", hover="#8b5cf6").pack(side="right",
                                                           padx=4)
        self._mk_button(grid, "🧪 مختبرات", self._open_labs,
                        bg="#0e7490", hover="#0891b2").pack(side="right",
                                                           padx=4)
        self._mk_button(grid, "📖 مصطلحات", self._show_glossary,
                        bg="#b45309", hover="#d97706").pack(side="right",
                                                           padx=4)

    def _stat(self, parent, title, value):
        c = self._card(parent)
        tk.Label(c, text=title, bg=CARD, fg=MUTED, font=F_SMALL).pack(pady=(8, 0))
        v = tk.Label(c, text=value, bg=CARD, fg=SKY,
                     font=("Segoe UI", 20, "bold"))
        v.pack(pady=(0, 8))
        c.value_lbl = v
        return c

    def _test_target(self):
        self.target_info.config(text="جارٍ الاختبار …", fg=WARN)
        norm = normalize_target_input(self.target_var.get())
        if norm and norm != self.target_var.get().strip():
            self.target_var.set(norm)
            self._console(f"أُكمل المخطط تلقائيًا: {norm}", "info")
        # اللقطة في خيط الواجهة: _make_scope قد يعرض حوارًا (Tk من خلفي ينهار).
        try:
            scope = self._make_scope()
        except Exception as e:
            self.target_info.config(text=f"مرفوض: {e}", fg=ERR)
            return
        base = (self.target_var.get().strip() or DEFAULT_TARGET).rstrip("/") + "/"
        threading.Thread(target=self._test_target_work, args=(scope, base),
                         daemon=True).start()

    def _test_target_work(self, scope, base):
        import time as _t
        try:
            s = Session(scope)
            t0 = _t.time()
            st, hdrs, body = s.get(base, timeout=6)
            ms = round((_t.time() - t0) * 1000)
            srv = next((v for k, v in hdrs if k.lower() == "server"), "—")
            ok = st == 200
            self.root.after(0, self.target_info.config,
                            {"text": f"{'متصل ✓' if ok else 'رد غير متوقع'} — "
                                     f"HTTP {st} · {ms}ms · {srv[:40]} · "
                                     f"{len(body)} bytes",
                             "fg": OK if ok else WARN})
            self.root.after(0, self.net_dot.itemconfig, self._net,
                            {"fill": "#22c55e" if ok else "#eab308"})
            self._console(f"[هدف] {base} → HTTP {st} ({ms}ms)",
                          "ok" if ok else "warn")
        except Exception as e:
            self.root.after(0, self.target_info.config,
                            {"text": f"تعذّر الوصول: {e}", "fg": ERR})
            self.root.after(0, self.net_dot.itemconfig, self._net,
                            {"fill": "#ef4444"})

    # ---------------------------------------------------------- الفحص
    def _build_scan(self):
        bar = tk.Frame(self.tab_scan, bg=BG)
        bar.pack(fill="x", padx=16, pady=(12, 6))
        self._mk_button(bar, "▶ بدء الفحص", self._auto_scan).pack(side="right")
        ttk.Entry(bar, textvariable=self._filter_q, width=28,
                  font=F_BODY).pack(side="right", padx=8)
        self._filter_q.trace_add("write", lambda *a: self._apply_filter())
        sev = ttk.Combobox(bar, textvariable=self._filter_sev, width=10,
                           values=["الكل", "critical", "high", "medium",
                                   "low"], state="readonly")
        sev.pack(side="right", padx=4)
        sev.bind("<<ComboboxSelected>>", lambda e: self._apply_filter())
        self._filter_sev.trace_add("write", lambda *a: self._apply_filter())
        tk.Checkbutton(bar, text="المؤكدة فقط", variable=self._filter_found,
                       bg=BG, fg=TEXT, selectcolor=DEEP,
                       activebackground=BG,
                       command=self._apply_filter).pack(side="right", padx=4)
        # الدخول المسبق
        auth = tk.Frame(self.tab_scan, bg=BG)
        auth.pack(fill="x", padx=16, pady=(0, 6))
        tk.Checkbutton(auth, text="سجّل الدخول أولًا بجلسة الفحص",
                       variable=self.auth_login, bg=BG, fg=TEXT,
                       selectcolor=DEEP, activebackground=BG).pack(side="right")
        ttk.Entry(auth, textvariable=self.auth_user, width=12).pack(
            side="right", padx=4)
        ttk.Entry(auth, textvariable=self.auth_pass, width=12,
                  show="•").pack(side="right", padx=4)
        tk.Label(auth, text="(للفحوصات التي تحتاج جلسة — على الأهداف الحقيقية)",
                 bg=BG, fg=MUTED, font=F_SMALL).pack(side="right", padx=8)
        prow = tk.Frame(self.tab_scan, bg=BG)
        prow.pack(fill="x", padx=16, pady=(0, 6))
        tk.Label(prow, text="أو ملف جلسة محفوظ:", bg=BG, fg=TEXT,
                 font=F_BODY).pack(side="right")
        self.profile_box = ttk.Combobox(prow, textvariable=self.profile_var,
                                        width=22, state="readonly")
        self.profile_box.pack(side="right", padx=6)
        self._mk_button(prow, "👤 إدارة الجلسات", self._open_profiles,
                        bg="#7c3aed", hover="#8b5cf6").pack(side="right")
        self._refresh_profiles()

        split = tk.PanedWindow(self.tab_scan, orient="vertical", bg=BG,
                               sashwidth=6, bd=0)
        split.pack(fill="both", expand=True, padx=16, pady=(0, 10))
        box = tk.Frame(split, bg=CARD, highlightbackground=BORDER,
                       highlightthickness=1, bd=0)
        cols = ("sev", "code", "name", "owasp", "verdict", "note")
        self.tree = ttk.Treeview(box, columns=cols, show="headings")
        head = {"sev": "الخطورة", "code": "الكود", "name": "الثغرة",
                "owasp": "OWASP", "verdict": "الحالة", "note": "الدليل"}
        widths = {"sev": 90, "code": 100, "name": 300, "owasp": 150,
                  "verdict": 70, "note": 380}
        for c in cols:
            self.tree.heading(c, text=head[c])
            self.tree.column(c, width=widths[c], anchor="w")
        vs = ttk.Scrollbar(box, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=vs.set)
        self.tree.pack(side="left", fill="both", expand=True)
        vs.pack(side="right", fill="y")
        self.tree.bind("<<TreeviewSelect>>", self._show_detail)
        for tag, (bg, fg) in {
                "critical": ("#450a0a", "#fca5a5"),
                "high": ("#7c2d12", "#fed7aa"),
                "medium": ("#713f12", "#fde68a"),
                "low": ("#14532d", "#bbf7d0"),
                "info": ("#1e293b", "#94a3b8"),
                "clear": ("#1e293b", "#64748b")}.items():
            self.tree.tag_configure(tag, background=bg, foreground=fg)
        split.add(box, minsize=220)

        dbox = tk.Frame(split, bg=CARD, highlightbackground=BORDER,
                        highlightthickness=1, bd=0)
        tk.Label(dbox, text="📋 بطاقة الثغرة", bg=CARD, fg=SKY,
                 font=F_H3).pack(anchor="e", padx=12, pady=(8, 0))
        self.detail = tk.Text(dbox, height=9, bg=DEEP, fg=TEXT, font=F_BODY,
                              wrap="word", borderwidth=0, padx=12, pady=8)
        self.detail.pack(fill="both", expand=True, padx=2, pady=(4, 2))
        self.detail.insert("end", "اختر ثغرة من الجدول لعرض بطاقتها (CVSS + CWE + الإصلاح).")
        self.detail.config(state="disabled")
        dact = tk.Frame(dbox, bg=CARD)
        dact.pack(fill="x", padx=12, pady=(0, 8))
        self._mk_button(dact, "📋 نسخ البطاقة", self._copy_card,
                        bg="#334155", hover="#475569").pack(side="right",
                                                           padx=4)
        self._mk_button(dact, "💾 حفظ البطاقة", self._save_card,
                        bg="#0d9488", hover="#14b8a6").pack(side="right",
                                                           padx=4)
        self._mk_button(dact, "🎓 اشرحها لي", self._explain_current,
                        bg="#7c3aed", hover="#8b5cf6").pack(side="right",
                                                           padx=4)
        split.add(dbox, minsize=140)

    def _apply_filter(self):
        q = self._filter_q.get().strip()
        sev = self._filter_sev.get()
        only = self._filter_found.get()
        for i in self.tree.get_children():
            self.tree.delete(i)
        for r in self._rows:
            if only and not r["verdict"]:
                continue
            if sev != "الكل" and r["severity"] != sev:
                continue
            if q and q not in (r["name"] + r["code"] + r["note"]):
                continue
            tag = r["severity"] if r["verdict"] else "clear"
            self.tree.insert("", "end", values=(
                r["severity"], r["code"], r["name"], r["owasp"],
                "✓" if r["verdict"] else "—", r["note"]), tags=(tag,))

    def _show_detail(self, _ev=None):
        sel = self.tree.selection()
        if not sel:
            return
        code = self.tree.item(sel[0], "values")[1]
        r = next((x for x in self._rows if x["code"] == code), None)
        if not r:
            return
        ex = _extra(code)
        txt = (f"{r['name']}  [{'✓ مؤكدة' if r['verdict'] else 'غير مؤكدة'}]\n"
               f"الكود: {r['code']} · {r['owasp']} · الخطورة: {r['severity']}\n"
               f"CVSS: {ex['cvss']} ({ex['rating']}) · {ex['cwe']}\n"
               f"المتجه: {ex['vector']}\n"
               f"الدليل: {r['note']}\n"
               f"الإصلاح: {ex['fix']}")
        ev = self._evidence.get(code)
        if ev and ev.get("request"):
            txt += f"\n\n── طلب الإثبات ──\n{ev['request'][:1200]}"
            if ev.get("response"):
                txt += f"\n\n── الاستجابة ──\n{ev['response'][:1200]}"
        try:
            from impact import get as _impact_of
            im = _impact_of(code)
            txt += (f"\n\n👑 تملك الآن: {im['owns']}"
                    f"\n➡ التالي ضمن التفويض: {im['next']}")
        except Exception:
            pass
        self.detail.config(state="normal")
        self.detail.delete("1.0", "end")
        self.detail.insert("end", txt)
        self.detail.config(state="disabled")
        self._current_row = r

    def _card_payload(self):
        if not self._current_row:
            return None
        try:
            from impact import card_text
            return card_text(self._current_row)
        except Exception:
            return None

    def _copy_card(self):
        txt = self._card_payload()
        if not txt:
            self._console("اختر ثغرة من الجدول أولًا.", "warn")
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(txt)
        self._console(f"نُسخت بطاقة {self._current_row['code']} ✓", "ok")

    def _save_card(self):
        txt = self._card_payload()
        if not txt:
            self._console("اختر ثغرة من الجدول أولًا.", "warn")
            return
        path = filedialog.asksaveasfilename(
            defaultextension=".md",
            filetypes=[("Markdown", "*.md"), ("Text", "*.txt")],
            initialfile=f"finding_{self._current_row['code']}.md")
        if not path:
            return
        try:
            Path(path).write_text(txt, encoding="utf-8")
            self._console(f"حُفظت البطاقة: {path}", "ok")
        except Exception as e:
            self._console(f"تعذّر الحفظ: {e}", "err")

    def _explain_current(self):
        if not self._current_row:
            self._console("اختر ثغرة من الجدول أولًا.", "warn")
            return
        try:
            self.nb.select(str(self.tab_learn))
        except Exception:
            pass
        self._guide_select(self._current_row["code"])

    # ---------------------------------------------------------- التعلم
    def _build_learn(self):
        wrap = tk.Frame(self.tab_learn, bg=BG)
        wrap.pack(fill="both", expand=True, padx=16, pady=12)
        ctrl = tk.Frame(wrap, bg=BG)
        ctrl.pack(fill="x", pady=(0, 10))
        self.btn_manual = self._mk_button(ctrl, "🎓 ابدأ التعلم", self._start_manual,
                                          bg="#7c3aed", hover="#8b5cf6")
        self.btn_manual.pack(side="right")
        self.btn_open = self._mk_button(ctrl, "🌐 افتح في المتصفح", self._open_lesson,
                                        bg="#0369a1", hover="#0284c7")
        self.btn_open.pack(side="right", padx=8)
        self.btn_next = self._mk_button(ctrl, "التالي ←", self._next_step,
                                        bg="#334155", hover="#475569")
        self.btn_next.pack(side="right", padx=8)
        self.btn_glossary = self._mk_button(ctrl, "📖 مصطلحات", self._show_glossary,
                                            bg="#b45309", hover="#d97706")
        self.btn_glossary.pack(side="right", padx=8)
        self.btn_academy = self._mk_button(ctrl, "🎓 مختبر PortSwigger",
                                           self._open_academy,
                                           bg="#7c3aed", hover="#8b5cf6")
        self.btn_academy.pack(side="right", padx=8)

        card = self._card(wrap)
        card.pack(fill="both", expand=True)
        self.lesson_tag = tk.Label(card, text=f"الدرس 1/{len(ORDER)}",
                                   bg=CARD, fg=ACCENT, font=F_H2)
        self.lesson_tag.pack(anchor="e", padx=14, pady=(12, 0))
        self.lesson_title = tk.Label(card, text="اضغط «ابدأ التعلم».",
                                     bg=CARD, fg="#e0f2fe",
                                     font=("Segoe UI", 11, "bold"),
                                     justify="right", anchor="e",
                                     wraplength=980)
        self.lesson_title.pack(fill="x", padx=14, pady=(4, 0))
        self.lesson_how = tk.Label(card, text="", bg=CARD, fg="#cbd5e1",
                                   font=F_BODY, justify="right", anchor="e",
                                   wraplength=980)
        self.lesson_how.pack(fill="x", padx=14, pady=(6, 0))
        self.lesson_payload = tk.Label(card, text="", bg=DEEP, fg=WARN,
                                       font=F_MONO, justify="right",
                                       anchor="e", wraplength=980,
                                       padx=10, pady=8)
        self.lesson_payload.pack(fill="x", padx=14, pady=8)
        self.verify_btn = self._mk_button(card, "✓ تحقق بنفسي من هذه الخطوة",
                                          self._verify_step, bg="#059669",
                                          hover="#10b981")
        self.verify_btn.pack(anchor="e", padx=14, pady=(0, 14))

        # ------------------------------------------------ مدرسة النتائج
        school = self._card(wrap)
        school.pack(fill="both", expand=True, pady=(10, 0))
        tk.Label(school, text="🎓 مدرسة النتائج — افهم ما وجده الفحص",
                 bg=CARD, fg=SKY, font=F_H2).pack(anchor="e", padx=14,
                                                  pady=(10, 0))
        srow = tk.Frame(school, bg=CARD)
        srow.pack(fill="x", padx=14, pady=6)
        self._mk_button(srow, "📥 من آخر فحص", self._refresh_guide_list,
                        bg="#0d9488", hover="#14b8a6").pack(side="right")
        self._guide_combo = ttk.Combobox(srow, state="readonly", width=44,
                                         font=("Consolas", 9))
        self._guide_combo.pack(side="right", padx=8)
        self._guide_combo.bind("<<ComboboxSelected>>",
                               lambda _e: self._show_guide())
        self._guide_text = tk.Text(school, height=12, bg=DEEP, fg=TEXT,
                                   font=F_BODY, wrap="word", padx=12,
                                   pady=8, borderwidth=0)
        self._guide_text.pack(fill="both", expand=True, padx=14, pady=(0, 6))
        self._guide_text.config(state="disabled")
        tk.Label(school, text="خطة الإرشاد — علّم ما أتقنته (يُحفَظ تقدمك):",
                 bg=CARD, fg=WARN, font=F_H3).pack(anchor="e", padx=14)
        self._track_frame = tk.Frame(school, bg=CARD)
        self._track_frame.pack(fill="x", padx=14, pady=(0, 12))
        self._guide_vars = {}
        self._build_track()
        self._refresh_guide_list()

    def _refresh_guide_list(self):
        try:
            from guidance import GUIDE
            confirmed = [r["code"] for r in self._rows if r.get("verdict")]
            names = confirmed + [c for c in GUIDE if c not in confirmed]
            self._guide_combo.config(values=names)
            if names and not self._guide_combo.get():
                self._guide_combo.set(names[0])
                self._show_guide()
        except Exception as e:
            self._console(f"تعذّرت قائمة الدروس: {e}", "err")

    def _guide_select(self, code):
        try:
            vals = list(self._guide_combo.cget("values"))
            if code not in vals:
                vals = [code] + vals
                self._guide_combo.config(values=vals)
            self._guide_combo.set(code)
            self._show_guide()
        except Exception:
            pass

    def _show_guide(self):
        code = self._guide_combo.get()
        if not code:
            return
        try:
            from guidance import LEVELS, guide_for
            g = guide_for(code)
            steps = "\n".join(f"  {i + 1}. {s}" for i, s in
                              enumerate(g.get("verify", [])))
            self._guide_text.config(state="normal")
            self._guide_text.delete("1.0", "end")
            self._guide_text.insert("end",
                                    f"📖 {g.get('title', code)}\n"
                                    f"{LEVELS.get(g.get('level', 1), '')}\n\n"
                                    f"ما هي بكلماتك:\n{g.get('simple', '')}\n\n"
                                    f"لماذا خطيرة:\n{g.get('why', '')}\n\n"
                                    f"تحقق بيدك:\n{steps}\n\n"
                                    f"الإصلاح (للمالك):\n{g.get('fix', '')}")
            self._guide_text.config(state="disabled")
        except Exception as e:
            self._console(f"تعذّر الدرس: {e}", "err")

    def _build_track(self):
        try:
            from guidance import TRACK, load_progress
        except Exception:
            return
        done = load_progress()
        for w in self._track_frame.winfo_children():
            w.destroy()
        self._guide_vars = {}
        for stage, codes in TRACK:
            tk.Label(self._track_frame, text=stage, bg=CARD, fg=SKY,
                     font=F_BODY).pack(anchor="e", pady=(6, 0))
            row = tk.Frame(self._track_frame, bg=CARD)
            row.pack(fill="x")
            for c in codes:
                var = tk.BooleanVar(value=(c in done))
                self._guide_vars[c] = var
                tk.Checkbutton(row, text=c, variable=var, bg=CARD,
                               fg=TEXT, selectcolor=DEEP,
                               activebackground=CARD,
                               activeforeground="#ffffff",
                               font=F_MONO,
                               command=lambda cc=c: self._toggle_guide(cc)
                               ).pack(side="right", padx=4)

    def _toggle_guide(self, code):
        try:
            from guidance import load_progress, save_progress
            done = load_progress()
            if self._guide_vars[code].get():
                done.add(code)
            else:
                done.discard(code)
            save_progress(done)
            n = len(done)
            self._console(f"تقدمك: {n} درسًا متقنًا ✓", "ok")
        except Exception:
            pass

    # ---------------------------------------------------------- الأدوات
    def _build_tools(self):
        wrap = tk.Frame(self.tab_tools, bg=BG)
        wrap.pack(fill="both", expand=True, padx=16, pady=12)
        tk.Label(wrap, text="صندوق عدة المختبر — كل أداة نافذة مستقلة تعمل بالنطاق نفسه.",
                 bg=BG, fg=MUTED, font=F_BODY).pack(anchor="e", pady=(0, 10))
        grid = tk.Frame(wrap, bg=BG)
        grid.pack(fill="x")
        self.tool_btns = []
        defs = (
            ("🔁 Repeater", "أعد إرسال أي طلب معدّل", self._open_repeater,
             "#0d9488", "#14b8a6"),
            ("💥 Intruder", "احقن قوائم FUZZ وصنّف", self._open_intruder,
             "#dc2626", "#ef4444"),
            ("📡 Proxy", "التقاط + اعتراض + فكّ TLS", self._open_proxy,
             "#4f46e5", "#6366f1"),
            ("🕸️ الخريطة", "زاحف + بصمة + ترويسات", self._open_crawl,
             "#16a34a", "#22c55e"),
            ("🔣 الترميز", "URL/Base64/Hex/HTML", self._open_encode,
             "#9333ea", "#a855f7"),
            ("🧩 الإضافات", "فحوصات المجتمع", self._open_plugins,
             "#b45309", "#d97706"),
            ("🧪 مختبرات", "13 تمرينًا محلولًا آليًا", self._open_labs,
             "#0e7490", "#0891b2"),
            ("🎯 مسح نشط", "حقن تلقائي من الخريطة", self._open_active,
             "#dc2626", "#ef4444"),
            ("👤 الجلسات", "دخول محفوظ لكل هدف", self._open_profiles,
             "#7c3aed", "#8b5cf6"),
            ("📡 مراقب OOB", "إثبات العمياء: SSRF/DNS", self._open_oob,
             "#4f46e5", "#6366f1"),
            ("🎯 مهمات PoC", "سيطرة حقيقية: شعار + XSS", self._open_missions,
             "#be123c", "#e11d48"),
        )
        for i, (label, desc, fn, bg, ho) in enumerate(defs):
            c = self._card(grid)
            c.grid(row=i // 4, column=3 - (i % 4), sticky="nsew",
                   padx=5, pady=5)
            grid.columnconfigure(3 - (i % 4), weight=1)
            tk.Label(c, text=label, bg=CARD, fg=TEXT,
                     font=F_H3).pack(pady=(10, 0))
            tk.Label(c, text=desc, bg=CARD, fg=MUTED,
                     font=F_SMALL).pack(pady=(0, 8))
            b = self._mk_button(c, "افتح", fn, bg=bg, hover=ho)
            b.pack(pady=(0, 12))
            self.tool_btns.append(b)
        hint = self._card(wrap)
        hint.pack(fill="x", pady=10)
        tk.Label(hint, text="لفكّ تشفير HTTPS: فعّل «فكّ TLS» في نافذة الوكيل ثم ثبّت الملف data/proxy_ca/ca.pem في متصفحك (Chrome: الإعدادات ← الخصوصية ← الشهادات).",
                 bg=CARD, fg=WARN, font=F_SMALL, justify="right", anchor="e",
                 wraplength=1000).pack(fill="x", padx=14, pady=10)

    # ---------------------------------------------------------- التقارير
    def _build_reports(self):
        wrap = tk.Frame(self.tab_reports, bg=BG)
        wrap.pack(fill="both", expand=True, padx=16, pady=12)
        top = tk.Frame(wrap, bg=BG)
        top.pack(fill="x", pady=(0, 10))
        self.rep_summary = self._lbl(top, "لا فحص بعد — نفّذ فحصًا من تبويب الفحص.",
                                     fg=MUTED)
        self.rep_summary.pack(side="right")
        self._mk_button(top, "📤 تصدير Bounty (MD+HTML)", self._export_bounty,
                        ).pack(side="left")
        self._mk_button(top, "📦 تصدير جماعي (محفظة)", self._export_bulk,
                        bg="#7c3aed", hover="#8b5cf6").pack(side="left",
                                                           padx=8)
        self._mk_button(top, "⚖ قارن تقريرين", self._compare_reports,
                        bg="#0e7490", hover="#0891b2").pack(side="left",
                                                           padx=8)
        self._mk_button(top, "📋 تقرير تنفيذي", self._export_executive,
                        bg="#16a34a", hover="#22c55e").pack(side="left",
                                                           padx=8)
        self._mk_button(top, "🖨 PDF تنفيذي", self._export_pdf,
                        bg="#0e7490", hover="#0891b2").pack(side="left",
                                                           padx=8)
        mid = tk.Frame(wrap, bg=BG)
        mid.pack(fill="both", expand=True)
        left = self._card(mid)
        left.pack(side="left", fill="both", expand=True)
        tk.Label(left, text="ملفات Bounty", bg=CARD, fg=SKY,
                 font=F_H3).pack(anchor="e", padx=12, pady=(8, 0))
        self.bounty_list = tk.Listbox(left, bg=DEEP, fg=TEXT, font=F_MONO,
                                      height=10)
        self.bounty_list.pack(fill="both", expand=True, padx=12, pady=8)
        right = tk.Frame(mid, bg=BG)
        right.pack(side="right", fill="both", expand=True, padx=(12, 0))
        pcard = self._card(right)
        pcard.pack(fill="x", pady=(0, 10))
        tk.Label(pcard, text="💾 المشاريع (حفظ/استئناف)", bg=CARD, fg=SKY,
                 font=F_H3).pack(anchor="e", padx=12, pady=(8, 0))
        prow = tk.Frame(pcard, bg=CARD)
        prow.pack(fill="x", padx=12, pady=8)
        self._mk_button(prow, "حفظ المشروع", self._save_project,
                        bg="#0d9488", hover="#14b8a6").pack(side="right")
        self._mk_button(prow, "استئناف مشروع", self._resume_project,
                        bg="#4f46e5", hover="#6366f1").pack(side="right",
                                                           padx=8)
        self.proj_info = self._lbl(pcard, "يحفظ الهدف والنتائج لاستئناف لاحق.",
                                   fg=MUTED, font=F_SMALL, bg=CARD)
        self.proj_info.pack(anchor="e", padx=12, pady=(0, 10))
        acard = self._card(right)
        acard.pack(fill="both", expand=True)
        tk.Label(acard, text="🧾 سجل التدقيق (الأحدث)", bg=CARD, fg=SKY,
                 font=F_H3).pack(anchor="e", padx=12, pady=(8, 0))
        self.audit_txt = tk.Text(acard, height=8, bg=DEEP, fg=MUTED,
                                 font=F_MONO, wrap="word", borderwidth=0,
                                 padx=10, pady=6)
        self.audit_txt.pack(fill="both", expand=True, padx=12, pady=8)

        wcard = self._card(wrap)
        wcard.pack(fill="x", pady=(10, 0))
        tk.Label(wcard, text="👁 المراقبة المستمرة (فرق: جديد/أُصلح)", bg=CARD,
                 fg=SKY, font=F_H3).pack(anchor="e", padx=12, pady=(8, 0))
        wrow = tk.Frame(wcard, bg=CARD)
        wrow.pack(fill="x", padx=12, pady=6)
        self._mk_button(wrow, "فحص مراقبة الآن", self._watch_once,
                        bg="#0d9488", hover="#14b8a6").pack(side="right")
        tk.Label(wrow, text="الدورية (دقيقة):", bg=CARD, fg=TEXT,
                 font=F_BODY).pack(side="right", padx=(12, 4))
        self.watch_mins = tk.Entry(wrow, width=5, font=F_BODY)
        self.watch_mins.insert(0, "30")
        self.watch_mins.pack(side="right")
        self._mk_button(wrow, "بدء الدورية", self._watch_start,
                        bg="#16a34a", hover="#22c55e").pack(side="right",
                                                           padx=6)
        self._mk_button(wrow, "إيقاف", self._watch_stop,
                        bg="#475569", hover="#64748b").pack(side="right")
        self.watch_info = self._lbl(wcard, "لا جولات بعد.", fg=MUTED,
                                    font=F_SMALL, bg=CARD)
        self.watch_info.pack(anchor="e", padx=12)
        self.watch_hist = tk.Listbox(wcard, height=4, bg=DEEP, fg=TEXT,
                                     font=F_MONO)
        self.watch_hist.pack(fill="x", padx=12, pady=(0, 10))

    # --- المراقبة ------------------------------------------------------------
    def _watch_once(self):
        try:
            scope = self._make_scope()
        except Exception as e:
            messagebox.showerror("نطاق مرفوض", str(e))
            return
        base = (self.target_var.get().strip() or DEFAULT_TARGET).rstrip("/") + "/"
        self.watch_info.config(text="جارٍ جولة المراقبة …")
        threading.Thread(target=self._watch_work, args=(scope, base),
                         daemon=True).start()

    def _watch_work(self, scope, base):
        try:
            from watch import diff, history, load_latest, snapshot, store
            prev = load_latest(base)
            s = Session(scope)
            rows = []
            for meta in CHECKS:
                try:
                    rows.append(self._run_one(s, base, meta, "verify"))
                except Exception as e:
                    rows.append({**self._row_na(meta), "note": str(e)})
            store(base, rows, mode="verify")
            d = diff(prev["snapshot"] if prev else {}, snapshot(rows))
            prev_mode = (prev or {}).get("mode", "?")
            self.root.after(0, self._watch_done, base, d, prev_mode)
        except Exception as e:
            self.root.after(0, self.watch_info.config,
                            {"text": f"خطأ: {e}"})

    def _watch_done(self, base, d, prev_mode="?"):
        from watch import history as _hist
        new_n, fix_n = len(d["new"]), len(d["fixed"])
        msg = (f"آخر جولة: جديد {new_n} · أُصلح {fix_n} · "
               f"تغيّر {len(d['changed'])} · ثابت {d['same']}")
        if prev_mode not in ("?", "verify"):
            msg += f" (السابقة بوضع {prev_mode} — قارن بحذر)"
        self.watch_info.config(text=msg, fg=ERR if new_n else OK)
        if new_n:
            self._console(f"🚨 مراقبة: ثغرات جديدة: {', '.join(d['new'])}",
                          "err")
            messagebox.showwarning("المراقبة", f"ثغرات جديدة ظهرت: {', '.join(d['new'])}")
        elif fix_n:
            self._console(f"[مراقبة] أُصلح: {', '.join(d['fixed'])}", "ok")
        else:
            self._console(f"[مراقبة] لا جديد ({msg})", "op")
        try:
            self.watch_hist.delete(0, "end")
            for h in _hist(base):
                self.watch_hist.insert("end",
                                       f"{h['taken_at']} — {h['findings']} ثغرة")
        except Exception:
            pass

    def _watch_start(self):
        if self._watch_on:
            return
        try:
            mins = max(1, int(self.watch_mins.get()))
        except ValueError:
            messagebox.showwarning("المراقبة", "الدقائق رقم.")
            return
        self._watch_on = True
        self._console(f"[مراقبة] دورية كل {mins} دقيقة.", "info")
        self._watch_tick(mins * 60000)

    def _watch_tick(self, ms):
        if not self._watch_on:
            return
        self._watch_once()
        self._watch_job = self.root.after(ms, self._watch_tick, ms)

    def _watch_stop(self):
        self._watch_on = False
        if self._watch_job:
            try:
                self.root.after_cancel(self._watch_job)
            except Exception:
                pass
            self._watch_job = None
        self._console("[مراقبة] توقفت الدورية.", "warn")

    def _refresh_report_lists(self):
        repdir = GUI_DIR.parent / "reports" / "bounty"
        try:
            self.bounty_list.delete(0, "end")
            if repdir.is_dir():
                for p in sorted(repdir.glob("bounty_report_*.md"),
                                reverse=True)[:20]:
                    self.bounty_list.insert("end", p.name)
        except Exception:
            pass
        try:
            aud = GUI_DIR.parent / "reports" / "audit.jsonl"
            lines = aud.read_text(encoding="utf-8").splitlines()[-8:] \
                if aud.exists() else []
            self.audit_txt.delete("1.0", "end")
            self.audit_txt.insert("end", "\n".join(lines) or "لا سجل بعد.")
        except Exception:
            pass
        try:
            from watch import history as _hist
            base = (self.target_var.get().strip() or DEFAULT_TARGET).rstrip("/") + "/"
            self.watch_hist.delete(0, "end")
            for h in _hist(base):
                self.watch_hist.insert("end",
                                       f"{h['taken_at']} — {h['findings']} ثغرة")
        except Exception:
            pass

    # --- المشاريع: حفظ/استئناف ------------------------------------------
    def _save_project(self):
        if not self._rows:
            messagebox.showinfo("المشاريع", "نفّذ فحصًا أولًا ثم احفظ.")
            return
        try:
            from project import save as _psave
        except ImportError:
            self._console("وحدة المشاريع غير متاحة.", "err")
            return
        default = str(GUI_DIR.parent / "reports" /
                      f"project_{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.json")
        path = filedialog.asksaveasfilename(
            defaultextension=".json", initialfile=Path(default).name,
            initialdir=str(GUI_DIR.parent / "reports"),
            filetypes=[("JSON", "*.json")]) or default
        done_codes = {r["code"] for r in self._rows}
        pending = [c["code"] for c in CHECKS if c["code"] not in done_codes]
        _psave(path, self.target_var.get().strip(),
               self._last_report["meta"]["mode"] if self._last_report else "?",
               self.scope_mode.get(), self._rows, pending)
        self.proj_info.config(text=f"حُفظ: {Path(path).name}")
        self._console(f"[مشروع] حُفظ في {path}", "ok")

    def _resume_project(self):
        path = filedialog.askopenfilename(
            initialdir=str(GUI_DIR.parent / "reports"),
            filetypes=[("JSON", "*.json")])
        if not path:
            return
        try:
            from project import load as _pload
            from local_scan import run_check
            st = _pload(path)
        except Exception as e:
            messagebox.showerror("المشاريع", f"تعذّر التحميل: {e}")
            return
        self.target_var.set(st["target"])
        self._rows = list(st["rows_done"])
        self._evidence = {}
        self._rebuild_from_rows(f"استُعيد {len(self._rows)} نتيجة")
        pending = list(st.get("pending", []))
        if not pending:
            self._console("[مشروع] لا عناصر معلقة — العرض مستعاد.", "ok")
            return
        try:
            scope = self._make_scope()
        except Exception as e:
            messagebox.showerror("نطاق مرفوض", str(e))
            return
        base = f"{st['target'].rstrip('/')}/"
        self._console(f"[مشروع] استئناف {len(pending)} فحصًا معلقًا …", "op")
        threading.Thread(target=self._resume_work,
                         args=(pending, scope, base), daemon=True).start()

    def _resume_work(self, pending, scope, base):
        from evidence import RecordingSession, run_check_evidence
        from local_scan import run_check
        s = Session(scope)
        metas = {m["code"]: m for m in CHECKS}
        for code in pending:
            m = metas.get(code)
            if not m:
                continue
            try:
                r, ev = run_check_evidence(m, RecordingSession(s),
                                           base, "verify")
                self._rows.append(r)
                self._evidence[r["code"]] = ev
            except Exception as e:
                self._rows.append({**self._row_na(m), "note": str(e)})
        self.root.after(0, self._rebuild_from_rows,
                        f"اكتمل الاستئناف (+{len(pending)})")

    def _rebuild_from_rows(self, msg=""):
        rep = build_report(self._rows, self.target_var.get().strip(),
                           "مستعاد", "resume", datetime.now(timezone.utc))
        self._last_report = rep
        self._fill_tree(rep)
        if msg:
            self._console(f"[مشروع] {msg}", "ok")

    # ------------------------------------------------- منفذ التشغيل الدائم
    def _build_console(self):
        wrap = tk.Frame(self.root, bg=BG)
        wrap.pack(fill="x", padx=14, pady=(8, 0))
        tk.Label(wrap, text="⌨ منفذ التشغيل — كل عملية لحظة بلحظة",
                 bg=BG, fg=OK, font=F_H3).pack(anchor="e")
        box = tk.Frame(wrap, bg="#000000", highlightbackground=BORDER,
                       highlightthickness=1, bd=0)
        box.pack(fill="x", pady=(4, 0))
        self.console = tk.Text(box, height=6, bg="#02060d", fg=TEXT,
                               font=F_MONO, wrap="word", borderwidth=0,
                               padx=10, pady=6)
        cs = ttk.Scrollbar(box, orient="vertical", command=self.console.yview)
        self.console.configure(yscrollcommand=cs.set)
        self.console.pack(side="left", fill="both", expand=True)
        cs.pack(side="right", fill="y")
        for name, fg in (("op", TEXT), ("ok", OK), ("warn", WARN),
                         ("err", ERR), ("info", SKY), ("cur", "#f472b6")):
            self.console.tag_configure(name, foreground=fg)

    # --- شريط الحالة ------------------------------------------------------
    def _build_footer(self):
        pass

    def _build_status(self):
        foot = tk.Frame(self.root, bg=BG)
        foot.pack(fill="x", padx=14, pady=(8, 10))
        self.progress = ttk.Progressbar(foot, maximum=100, value=0,
                                        style="Horizontal.TProgressbar")
        self.progress.pack(fill="x")
        row = tk.Frame(foot, bg=BG)
        row.pack(fill="x", pady=(6, 0))
        self.status_dot = tk.Canvas(row, width=18, height=18, bg=BG,
                                    highlightthickness=0)
        self.status_dot.pack(side="right")
        self._dot = self.status_dot.create_oval(4, 4, 14, 14, fill="#475569",
                                                outline="")
        self.status_var = tk.StringVar(value="الحالة: جاهز")
        tk.Label(row, textvariable=self.status_var, bg=BG, fg=MUTED,
                 font=F_SMALL, justify="right").pack(side="right", padx=8)

    # ============================================================ منطق النطاق
    def _on_mode_change(self):
        self.confirmed = False
        if self.scope_mode.get() == "authorized":
            self.scope_hint.config(text="سأطلب منك «أؤكد» قبل أي فحص — وقراءة فقط.")
            self.scope_badge.config(text="🟡 مرخّص", fg=WARN)
            self._console("النطاق: مرخّص (هدف واحد). القراءة فقط تُستخدم تلقائيًا.", "warn")
        else:
            self.scope_hint.config(text="لوحة loopback: جهازك فقط، بلا استثناء.")
            self.scope_badge.config(text="🟢 محلي", fg=OK)
            self._console("النطاق: محلي (loopback).", "ok")

    def _make_scope(self):
        if self.scope_mode.get() == "loopback":
            return Scope(mode="loopback")
        t = normalize_target_input(self.target_var.get()) or DEFAULT_TARGET
        try:
            from targets import find_target
            rec = find_target(t)
        except Exception:
            rec = None
        if rec and rec.get("confirm") == "أؤكد":
            # مسجل مسبقًا بتفويض مكتوب — لا حوار جديد
            return Scope(mode="authorized", allow=[rec["target"]],
                         confirm=True)
        if not self.confirmed:
            a = simpledialog.askstring(
                "توكيد النطاق المرخّص",
                "اكتب كلمة: أؤكد\nللتأكيد أن هذا الهدف مصرح لك فحصه.")
            if not a or "أؤكد" not in a:
                raise ValueError("دون «أؤكد» لا يُنفَّذ فحص مرخّص.")
            self.confirmed = True
        t = normalize_target_input(self.target_var.get()) or DEFAULT_TARGET
        return Scope(mode="authorized", allow=[t], confirm=self.confirmed)

    # ------------------------------------------------- النطاقات المصرّحة
    def _saved_targets(self):
        try:
            from targets import list_targets
            return list_targets()
        except Exception:
            return []

    def _refresh_targets(self):
        try:
            names = ["🧪 المختبر المحلي"] + \
                [t["base"] for t in self._saved_targets()]
            self.target_combo.config(values=names)
            cur = (self.target_var.get().strip() or DEFAULT_TARGET)
            self.target_combo.set(cur if cur in names else names[0])
        except Exception:
            pass
        self._refresh_deep_badge()

    def _on_target_pick(self, _event=None):
        pick = self.target_combo.get()
        if pick.startswith("🧪"):
            self.target_var.set(DEFAULT_TARGET)
            self.scope_mode.set("loopback")
        else:
            self.target_var.set(pick)
            self.scope_mode.set("authorized")
        self.confirmed = False
        self._on_mode_change()
        self._refresh_deep_badge()

    def _refresh_deep_badge(self):
        try:
            from targets import intrusive_granted
            g = intrusive_granted(self.target_var.get().strip()) \
                if self.scope_mode.get() == "authorized" else None
            self.deep_badge.config(
                text=("🔓 فحص عميق: مصرّح من المالك ✓" if g
                      else "🔒 فحص عميق: غير مصرّح"),
                fg=OK if g else MUTED)
        except Exception:
            pass

    def _add_target_dialog(self):
        top = tk.Toplevel(self.root)
        top.title("＋ نطاق مصرّح جديد")
        top.geometry("520x360")
        top.configure(bg="#0b1220")
        tk.Label(top, text="سجّل نطاقًا مصرّحًا لك فحصه (Bug Bounty / موقعك / عميل)",
                 bg="#0b1220", fg="#7dd3fc",
                 font=("Segoe UI", 10, "bold")).pack(pady=10)
        tk.Label(top, text="الرابط (https://site.com):", bg="#0b1220",
                 fg="#e2e8f0", font=("Segoe UI", 9)).pack(anchor="e", padx=20)
        url_v = tk.StringVar(value="https://")
        ttk.Entry(top, textvariable=url_v, width=52,
                  font=("Consolas", 10)).pack(padx=20, pady=4)
        tk.Label(top, text="البيان (رابط البرنامج/الموافقة):", bg="#0b1220",
                 fg="#e2e8f0", font=("Segoe UI", 9)).pack(anchor="e", padx=20)
        note_v = tk.StringVar()
        ttk.Entry(top, textvariable=note_v, width=52).pack(padx=20, pady=4)
        tk.Label(top, text="اكتب كلمة «أؤكد» للتسجيل:", bg="#0b1220",
                 fg="#fbbf24", font=("Segoe UI", 10, "bold")).pack(
            anchor="e", padx=20, pady=(8, 0))
        conf_v = tk.StringVar()
        ttk.Entry(top, textvariable=conf_v, width=52).pack(padx=20, pady=4)
        msg = tk.Label(top, text="", bg="#0b1220", fg="#f87171",
                       font=("Segoe UI", 9))
        msg.pack(pady=4)

        def save():
            try:
                from targets import add_target
                rec = add_target(normalize_target_input(url_v.get()),
                                 note=note_v.get().strip(),
                                 confirm_text=conf_v.get())
            except Exception as e:
                msg.config(text=str(e)[:90])
                return
            self.target_var.set(rec["base"])
            self.scope_mode.set("authorized")
            self.confirmed = False
            self._on_mode_change()
            self._refresh_targets()
            self.target_combo.set(rec["base"])
            self._console(f"نطاق مصرّح: {rec['target']} ✓", "ok")
            top.destroy()

        self._mk_button(top, "حفظ النطاق ✓", save,
                        bg="#16a34a", hover="#22c55e").pack(pady=8)

        tk.Label(top, text="— تصريح المالك بالفحص العميق —",
                 bg="#0b1220", fg="#7dd3fc",
                 font=("Segoe UI", 10, "bold")).pack(pady=(6, 2))
        tk.Label(top, text="تجاوز دخول + حقن أوامر/قوالب + رفع كناري (لا يعمل أبدًا بلا هذا التصريح)",
                 bg="#0b1220", fg="#94a3b8", font=("Segoe UI", 9)).pack()
        deep_msg = tk.Label(top, text="", bg="#0b1220", fg="#fbbf24",
                            font=("Segoe UI", 9, "bold"))
        deep_msg.pack(pady=2)
        brow = tk.Frame(top, bg="#0b1220")
        brow.pack(pady=4)

        def _deep_status():
            try:
                from targets import intrusive_granted as _ig
                g = _ig(normalize_target_input(url_v.get()))
                deep_msg.config(
                    text=("🔓 التصريح ممنوح ✓"
                          + (f" ({g.get('granted_at', '')})" if g else ""))
                    if g else "🔒 غير مصرّح — العميق لن يعمل",
                    fg="#34d399" if g else "#94a3b8")
            except Exception:
                pass

        def grant():
            from tkinter import simpledialog as _sd
            u = normalize_target_input(url_v.get())
            try:
                from targets import find_target as _ft
                if not _ft(u):
                    deep_msg.config(text="سجّل النطاق أولًا بزر الحفظ.",
                                    fg="#f87171")
                    return
                phrase = _sd.askstring(
                    "تصريح المالك",
                    "بصفتك مالك الموقع/المفوّض، اكتب: أصرّح\n"
                    "للسماح بالفحص العميق (تجاوز/حقن/رفع كناري حميد).")
                if phrase is None:
                    return
                from targets import set_intrusive as _si
                _si(u, True, phrase=phrase, by="gui-dialog")
                deep_msg.config(text="🔓 مُنح التصريح ✓", fg="#34d399")
                self._console(f"تصريح عميق ممنوح: {u}", "ok")
                self._refresh_deep_badge()
            except Exception as e:
                deep_msg.config(text=str(e)[:90], fg="#f87171")

        def revoke():
            try:
                from targets import set_intrusive as _si
                _si(normalize_target_input(url_v.get()), False,
                    by="gui-dialog")
                deep_msg.config(text="🔒 سُحب التصريح", fg="#94a3b8")
                self._console("سُحب التصريح العميق.", "warn")
                self._refresh_deep_badge()
            except Exception as e:
                deep_msg.config(text=str(e)[:90], fg="#f87171")

        self._mk_button(brow, "أصرّح بالفحص العميق ✓", grant,
                        bg="#b45309", hover="#d97706").pack(side="left",
                                                           padx=4)
        self._mk_button(brow, "سحب التصريح ✗", revoke,
                        bg="#475569", hover="#64748b").pack(side="left",
                                                           padx=4)
        url_v.trace_add("write", lambda *_: _deep_status())
        _deep_status()

    def _set_busy(self, busy: bool):
        self.busy = busy
        try:
            self.btn_auto.config(state="disabled" if busy else "normal")
        except Exception:
            pass
        try:
            self.btn_stop.config(state="normal" if busy else "disabled")
        except Exception:
            pass
        if busy:
            self._pulse()
        elif self._pulse_job:
            self.root.after_cancel(self._pulse_job)
            self._pulse_job = None
            self.status_dot.itemconfig(self._dot, fill="#475569")

    def _pulse(self):
        if not self.busy:
            return
        colors = ["#22c55e", "#eab308", "#f97316", "#ef4444"]
        i = getattr(self, "_pulse_i", 0)
        self.status_dot.itemconfig(self._dot, fill=colors[i % len(colors)])
        self._pulse_i = i + 1
        self._pulse_job = self.root.after(240, self._pulse)

    # ============================================================ المنفذ الحي
    def _console(self, msg: str, tag="op"):
        ts = datetime.now().strftime("%H:%M:%S")
        try:
            self.console.insert("end", f"  [{ts}]  {msg}\n", (tag,))
            self.console.see("end")
            lines = int(self.console.index("end-1c").split(".")[0])
            if lines > 400:
                self.console.delete("1.0", f"{(lines - 300)}.0")
        except Exception:
            pass

    # ============================================================ الفحص
    def _stop_scan(self):
        if not self.busy:
            return
        self._stop_event.set()
        self._console("⏹ طُلب الإيقاف — يتوقف بعد الطلب الحالي.", "warn")

    def _auto_scan(self):
        if self.busy:
            return
        self._stop_event.clear()
        norm = normalize_target_input(self.target_var.get())
        if norm and norm != self.target_var.get().strip():
            self.target_var.set(norm)
        # لقطة كل مدخلات Tk في خيط الواجهة (اللمس من خيط خلفي ينهار).
        try:
            scope = self._make_scope()
        except Exception as e:
            self._console(f"توقف الفحص: {e}", "err")
            messagebox.showerror("نطاق مرفوض", str(e))
            return
        target = self.target_var.get().strip() or DEFAULT_TARGET
        base = f"{target.rstrip('/')}/"
        if scope.mode == "authorized":
            mode = "verify" if self.authz_verify.get() else "detect"
        else:
            mode = "verify"
        want_deep = bool(scope.mode == "authorized" and mode == "verify"
                         and self.deep_run.get())
        stop = self._stop_event.is_set
        do_auth = self.auth_login.get()
        auth_u, auth_p = self.auth_user.get(), self.auth_pass.get()
        profile_name = self.profile_var.get().strip()
        profile = None
        if scope.mode != "loopback" and (profile_name or do_auth):
            # ملفات الجلسات والدخول الآلي للمختبر فقط — لا أسرار خارجية أبدًا
            self._console("ملف الجلسة/الدخول الآلي عُطّل: للنطاق المرخص قراءة مجهولة فقط.",
                          "warn")
            profile_name, do_auth = "", False
        if profile_name:
            try:
                from profiles import load as _pload
                profile = _pload(profile_name)
            except Exception as e:
                self._console(f"ملف الجلسة: {e}", "err")
                messagebox.showerror("ملف الجلسة", str(e))
                return
        self._set_busy(True)
        self.progress.config(value=0)
        self.status_var.set("الحالة: جارٍ الفحص …")
        try:
            self.nb.select(str(self.tab_scan))
        except Exception:
            pass

        def work():
            try:
                s = Session(scope)
                if profile:
                    try:
                        from profiles import apply_profile
                        ok, msg = apply_profile(s, base, profile)
                        self.root.after(0, self._console,
                                        f"[جلسة:{profile['name']}] {msg}",
                                        "ok" if ok else "warn")
                    except Exception as e:
                        self.root.after(0, self._console,
                                        f"[جلسة] تعذّر: {e}", "err")
                elif do_auth:
                    try:
                        from auth import login_form
                        ok, msg = login_form(s, base, auth_u, auth_p)
                        self.root.after(0, self._console,
                                        f"[دخول] {msg}", "ok" if ok else "warn")
                    except Exception as e:
                        self.root.after(0, self._console,
                                        f"[دخول] تعذّر: {e}", "err")
                self.root.after(0, self._console,
                                "فحص النطاق: محلي (loopback) ✓"
                                if scope.mode == "loopback"
                                else "فحص النطاق: مرخّص — قراءة فقط ✓",
                                "ok" if scope.mode == "loopback" else "warn")
                rows = []
                if scope.mode == "authorized":
                    from generic import GENERIC_CHECKS, discover
                    from local_scan import run_check as _plain_check
                    from targets import find_target as _find_target
                    from targets import intrusive_granted as _deep_grant
                    from deep import DEEP_CHECKS
                    metas = list(GENERIC_CHECKS)
                    deep_on = False
                    if want_deep:
                        grant = _deep_grant(base)
                        if grant:
                            deep_on = True
                            metas += DEEP_CHECKS
                            self.root.after(0, self._console,
                                            "⚡ فحص عميق مصرّح من المالك ✓ "
                                            "(تجاوز/حقن/رفع كناري حميد)",
                                            "warn")
                        else:
                            self.root.after(0, self._console,
                                            "الفحص العميق مرفوض لهذا النطاق — "
                                            "سجّل تصريح المالك («أصرّح») أولًا.",
                                            "err")
                    host = urllib.parse.urlsplit(base).hostname or base
                    try:
                        s._generic_ctx = discover(s, base)
                        d = s._generic_ctx
                        self.root.after(0, self._console,
                                        f"الاستكشاف: {d.get('pages', 0)} صفحة · "
                                        f"{len(d.get('params', []))} معاملًا · "
                                        f"{len(d.get('scripts', []))} سكربتًا",
                                        "info")
                    except Exception as e:
                        self.root.after(0, self._console,
                                        f"تعذّر الاستكشاف: {e}", "err")
                        raise
                    total = len(metas)
                    self.root.after(0, lambda t=total:
                                    self.stat_checks.value_lbl.config(
                                        text=str(t)))
                    for i, meta in enumerate(metas):
                        if stop():
                            self.root.after(0, self._console,
                                            "⏹ أُوقف يدويًا — يُبنى التقرير بما اكتمل.",
                                            "warn")
                            break
                        self.root.after(0, self._console,
                                        f"▸ {meta['name']}  [{meta['code']}]",
                                        "cur")
                        try:
                            r = _plain_check(meta, s, base, mode)
                            rows.append(r)
                            self.root.after(
                                0, self._console,
                                f"    {'مؤكد ✓' if r['verdict'] else 'لا دليل'} — {r['note']}",
                                "ok" if r["verdict"] else "op")
                        except Exception as e:
                            rows.append({**self._row_na(meta),
                                         "status": "خطأ",
                                         "note": str(e)})
                            self.root.after(0, self._console,
                                            f"    خطأ: {e}", "err")
                        self.root.after(0, self.progress.config,
                                        {"value": int((i + 1) / total * 100)})
                    rep = build_report(rows, base, host, f"gui-{mode}",
                                       datetime.now(timezone.utc))
                    rep["meta"]["scope"] = "authorized"
                    try:
                        rec = _find_target(base)
                    except Exception:
                        rec = None
                    if deep_on and rec:
                        try:
                            rec = {**rec,
                                   "intrusive": _deep_grant(base)}
                        except Exception:
                            pass
                    rep["meta"]["authorization"] = rec
                    if rec:
                        self.root.after(0, self._console,
                                        f"التفويض: {rec['target']} ✓ "
                                        f"({rec.get('added_at', '')})", "ok")
                    try:
                        from local_scan import AuditLog
                        aud = AuditLog(str(Path(__file__).resolve(
                            ).parents[1] / "reports" / "audit.jsonl"))
                        aud.append({
                            "event": "external-scan", "target": base,
                            "mode": mode, "deep": bool(deep_on),
                            "findings": rep["summary"]["findings"],
                            "score": rep["summary"]["score"],
                            "requests": s.n_requests,
                            "auth": {"target": (rec or {}).get("target"),
                                     "added_at": (rec or {}).get(
                                         "added_at")}})
                        self.root.after(0, self._console,
                                        f"سُجل التدقيق ✓ — الطلبات: "
                                        f"{s.n_requests}", "ok")
                    except Exception as e:
                        self.root.after(0, self._console,
                                        f"تعذّر سجل التدقيق: {e}", "err")
                    self._evidence = {}
                    self._last_report = rep
                    self.root.after(0, self._fill_tree, rep)
                    if rep["summary"]["findings"] > 0:
                        self.root.after(0, self._console,
                                        "🎯 تُفتَح نافذة ما بعد الاختراق تلقائيًا — شاهد ما ملكت.",
                                        "warn")
                        self.root.after(0, self._open_impact)
                    self.root.after(
                        0, self._console,
                        f"انتهى: {rep['summary']['findings']}/{total} ثغرة · "
                        f"درجة {rep['summary']['score']} ({rep['summary']['grade']})",
                        "ok")
                    self.root.after(0, lambda: self.status_var.set(
                        f"الحالة: {rep['summary']['findings']}/{total} ثغرة · "
                        f"الحرج {rep['summary']['by_severity']['critical']} · "
                        f"عالٍ {rep['summary']['by_severity']['high']} · "
                        f"وسط {rep['summary']['by_severity']['medium']} · "
                        f"الدرجة {rep['summary']['score']}"))
                    return
                total = len(CHECKS)
                from evidence import RecordingSession, run_check_evidence
                for i, meta in enumerate(CHECKS):
                    if stop():
                        self.root.after(0, self._console,
                                        "⏹ أُوقف يدويًا — يُبنى التقرير بما اكتمل.",
                                        "warn")
                        break
                    self.root.after(0, self._console,
                                    f"▸ {meta['name']}  [{meta['code']}]", "cur")
                    try:
                        r, ev = run_check_evidence(
                            meta, RecordingSession(s), base, mode)
                        rows.append(r)
                        self._evidence[r["code"]] = ev
                        self.root.after(
                            0, self._console,
                            f"    {'مؤكد ✓' if r['verdict'] else 'لا دليل'} — {r['note']}",
                            "ok" if r["verdict"] else "op")
                    except Exception as e:
                        rows.append({**self._row_na(meta), "status": "خطأ",
                                     "note": str(e)})
                        self.root.after(0, self._console, f"    خطأ: {e}", "err")
                    self.root.after(0, self.progress.config,
                                    {"value": int((i + 1) / total * 100)})
                rep = build_report(rows, base, "محلي", f"gui-{mode}",
                                   datetime.now(timezone.utc))
                self._last_report = rep
                self.root.after(0, self._fill_tree, rep)
                if rep["summary"]["findings"] > 0:
                    self.root.after(0, self._console,
                                    "🎯 تُفتَح نافذة ما بعد الاختراق تلقائيًا — شاهد ما ملكت.",
                                    "warn")
                    self.root.after(0, self._open_impact)
                try:
                    n_req = s.n_requests
                except Exception:
                    n_req = "?"
                self.root.after(0, self._console,
                                f"الطلبات المرسلة: {n_req}", "info")
                self.root.after(
                    0, self._console,
                    f"انتهى: {rep['summary']['findings']}/{total} ثغرة · "
                    f"درجة {rep['summary']['score']} ({rep['summary']['grade']})",
                    "ok")
                self.root.after(0, lambda: self.status_var.set(
                    f"الحالة: {rep['summary']['findings']}/{total} ثغرة · "
                    f"الحرج {rep['summary']['by_severity']['critical']} · "
                    f"عالٍ {rep['summary']['by_severity']['high']} · "
                    f"وسط {rep['summary']['by_severity']['medium']} · "
                    f"الدرجة {rep['summary']['score']}"))
            except Exception as e:
                self.root.after(0, self._console, f"توقف الفحص: {e}", "err")
                self.root.after(
                    0, lambda: self.status_var.set("الحالة: مرفوض/متوقف"))
                self.root.after(0, messagebox.showerror, "نطاق مرفوض", str(e))
            finally:
                self.root.after(0, self._set_busy, False)

        self._console("بدأ الفحص الأوتوماتيكي …", "op")
        threading.Thread(target=work, daemon=True).start()

    def _row_na(self, meta):
        return {"code": meta["code"], "name": meta["name"],
                "owasp": meta["owasp"], "severity": meta["severity"],
                "family": meta["family"], "sub_status": 0,
                "status": "—", "verdict": False, "note": "متوقف.",
                "evidence": "", "mode": "verify"}

    def _run_one(self, s, base, meta, mode):
        from local_scan import run_check
        return run_check(meta, s, base, mode)

    def _fill_tree(self, rep):
        self._rows = list(rep["all_checks"])
        self._apply_filter()
        self.detail.config(state="normal")
        self.detail.delete("1.0", "end")
        self.detail.insert("end", "اختر ثغرة من الجدول لعرض بطاقتها (CVSS + CWE + الإصلاح).")
        self.detail.config(state="disabled")
        s = rep["summary"]
        try:
            self.stat_score.value_lbl.config(text=str(s["score"]))
            self.stat_found.value_lbl.config(
                text=f"{s['findings']}/{s['checks_total']}")
            self.rep_summary.config(
                text=f"آخر فحص: {s['findings']}/{s['checks_total']} ثغرة · "
                     f"الدرجة {s['score']} ({s['grade']}) · {rep['meta']['generated_at'][:19]}",
                fg=TEXT)
        except Exception:
            pass

    # ============================================================ التعلم
    def _start_manual(self):
        self._step_index = 0
        self._set_lesson()
        self._console("وضع التعلّم بدأ. اتبع كل خطوة وافتحها في المتصفح.", "info")
        try:
            self.nb.select(str(self.tab_learn))
        except Exception:
            pass

    def _set_lesson(self):
        if self._step_index >= len(ORDER):
            self.lesson_tag.config(text="الدرس — انتهيت ✓")
            self.lesson_title.config(text="أنهيت كل الخطوات. كرر ما شئت.")
            self.lesson_how.config(text="")
            self.lesson_payload.config(text="")
            self.btn_next.config(text="من البداية", command=self._restart_manual)
            return
        key = ORDER[self._step_index]
        self._lesson_key = key
        meta = next(m for m in CHECKS if m["code"] == key)
        les = LESSONS[key]
        self.lesson_tag.config(text=f"الدرس {self._step_index + 1}/{len(ORDER)}")
        self.lesson_title.config(text=f"📌 {les['title']}")
        self.lesson_how.config(text=f"كيف تعملها؟ {les['how']}")
        self.lesson_payload.config(
            text=f"ما تكتبه:  {les['payload']}\n"
                 f"لماذا خطرة؟  {les['why']}\n"
                 f"الإصلاح:  {les['fix']}")
        self.btn_next.config(text="التالي ←", command=self._next_step)
        self.btn_open.config(
            text=f"🌐 افتح {les['title'].split('(')[0].strip()} في المتصفح")

    def _restart_manual(self):
        self._step_index = 0
        self._set_lesson()

    def _next_step(self):
        self._step_index += 1
        self._set_lesson()

    def _open_lesson(self):
        if not self._lesson_key:
            self._console("ابدأ التعلّم أولًا بزر «ابدأ التعلم».", "warn")
            return
        les = LESSONS[self._lesson_key]
        target = self.target_var.get().strip() or DEFAULT_TARGET
        base = target.rstrip("/")
        if self._lesson_key == "IDOR":
            path = "/profile/4"
        elif self._lesson_key == "PATH":
            path = "/download?file=lab.db"
        elif self._lesson_key == "CMDI":
            path = "/api/ping?host=127.0.0.1%3B%20echo%20PWN297"
        else:
            path = les["manual_url"]
        webbrowser.open(base + path)
        self._console(f"فُتح في المتصفح: {base + path}", "info")

    def _verify_step(self):
        if not self._lesson_key:
            self._console("ابدأ التعلّم أولًا بزر «ابدأ التعلم».", "warn")
            return
        try:
            scope = self._make_scope()
            target = self.target_var.get().strip() or DEFAULT_TARGET
            base = f"{target.rstrip('/')}/"
            meta = next(m for m in CHECKS if m["code"] == self._lesson_key)
            s = Session(scope)
            from evidence import RecordingSession, run_check_evidence
            r, ev = run_check_evidence(
                meta, RecordingSession(s), base, "verify")
            self._evidence[r["code"]] = ev
            verdict = r["verdict"]
            msg = (f"لنفس الخطوة: {'مؤكّد ✓ (أنت فعلتها!)' if verdict else 'لا يظهر بعد — أعد المحاولة.'}"
                   f"  الدليل: {r['note']}")
            self.lesson_how.config(text=msg)
            self._console(f"خطوة {self._lesson_key}: {'مؤكّد ✓' if verdict else 'غير مؤكد — أعد المحاولة'}",
                          "ok" if verdict else "warn")
            for row in self._rows:
                if row["code"] == r["code"]:
                    row.update(r)
                    break
            else:
                self._rows.append(r)
            self._apply_filter()
        except Exception as e:
            self._console(f"خطأ أثناء التحقق: {e}", "err")
            messagebox.showerror("نطاق مرفوض", str(e))

    def _show_glossary(self):
        lines = ["ما معنى هذه الأسماء؟\n", "─" * 40]
        for term, mean in GLOSSARY:
            lines.append(f"● {term}\n   {mean}")
        messagebox.showinfo("قاموس المصطلحات", "\n\n".join(lines))

    def _open_academy(self):
        if not self._lesson_key:
            self._console("ابدأ التعلّم أولًا ثم افتح مختبر الأكاديمية.",
                          "warn")
            return
        try:
            import sys as _sys
            _sys.path.insert(0, str(GUI_DIR.parent / "learn"))
            from portswigger import academy_for
            url, lab = academy_for(self._lesson_key)
        except Exception as e:
            self._console(f"تعذّر رابط الأكاديمية: {e}", "err")
            return
        if not url:
            messagebox.showinfo("PortSwigger",
                                f"هذا الدرس تغطيه مختبراتنا فقط:\n{lab}")
            return
        webbrowser.open(url)
        self._console(f"فُتحت الأكاديمية ({lab}) — طبّق ثم عُد لمختبرنا.",
                      "info")

    # ---------------------------------------------------------- فتح
    def _open_site(self):
        target = normalize_target_input(
            self.target_var.get()) or DEFAULT_TARGET
        base = target.rstrip("/")
        webbrowser.open(base + "/")
        self._console(f"فُتح الموقع كاملاً: {base}/", "ok")

    def _tool(self, name):
        try:
            import tools as _t
        except Exception:
            sys.path.insert(0, str(GUI_DIR))
            import tools as _t
        return getattr(_t, name)(self)

    def _open_missions(self):
        try:
            from missions import MissionsWindow
        except Exception as e:
            self._console(f"تعذّر فتح المهمات: {e}", "err")
            return
        MissionsWindow(self)

    def _run_certify(self):
        if self.busy:
            return
        lab = (self.target_var.get().strip() or DEFAULT_TARGET
               if self.scope_mode.get() == "loopback" else DEFAULT_TARGET)
        self._console("🛡️ بدأت شهادة الجاهزية (معايرة + خصوصية + بوابات) …",
                      "op")
        self._set_busy(True)

        def work():
            try:
                from certify import certify_all
                cert = certify_all(lab)
                self.root.after(0, self._console,
                                f"المعايرة: {'✓' if cert['lab']['pass'] else '✗'} "
                                f"{cert['lab']['detail']}",
                                "ok" if cert["lab"]["pass"] else "err")
                self.root.after(0, self._console,
                                f"الخصوصية: {'✓' if cert['stub']['pass'] else '✗'} "
                                f"{cert['stub']['detail']}",
                                "ok" if cert["stub"]["pass"] else "err")
                self.root.after(0, self._console,
                                f"البوابات: {'✓' if cert['gates']['pass'] else '✗'}",
                                "ok" if cert["gates"]["pass"] else "err")
                self.root.after(0, self._console,
                                f"الحكم: {cert['verdict']} — {cert['file']}",
                                "ok" if cert["verdict"].startswith("جاهز")
                                else "err")
                self.root.after(0, messagebox.showinfo, "شهادة الجاهزية",
                                f"{cert['verdict']}\n"
                                f"معايرة: {cert['lab']['detail']}\n"
                                f"خصوصية: {cert['stub']['detail']}\n"
                                f"{cert['file']}")
            except Exception as e:
                self.root.after(0, self._console, f"تعذّرت الشهادة: {e}",
                                "err")
            finally:
                self.root.after(0, self._set_busy, False)

        threading.Thread(target=work, daemon=True).start()

    def _open_control(self):
        try:
            from controldeck import ControlDeck
        except Exception as e:
            self._console(f"تعذّر فتح غرفة التحكم: {e}", "err")
            return
        ControlDeck(self)

    def _open_impact(self):
        if not self._rows:
            self._console("نفّذ فحصًا أولًا — لا صفوف بعد.", "warn")
            messagebox.showinfo("ما بعد الاختراق",
                                "نفّذ فحصًا أوتوماتيكيًا أولًا ثم عد هنا.")
            return
        try:
            from viewer import ImpactWin
        except Exception as e:
            self._console(f"تعذّر فتح ما بعد الاختراق: {e}", "err")
            return
        base = (self.target_var.get().strip() or DEFAULT_TARGET).rstrip("/")
        ImpactWin(self, self._rows, base)

    def _open_repeater(self):
        try:
            self._tool("RepeaterWin")
        except Exception as e:
            self._console(f"تعذّر فتح Repeater: {e}", "err")

    def _open_intruder(self):
        try:
            self._tool("IntruderWin")
        except Exception as e:
            self._console(f"تعذّر فتح Intruder: {e}", "err")

    def _open_proxy(self):
        try:
            self._tool("ProxyWin")
        except Exception as e:
            self._console(f"تعذّر فتح Proxy: {e}", "err")

    def _open_crawl(self):
        try:
            self._tool("CrawlWin")
        except Exception as e:
            self._console(f"تعذّر فتح الخريطة: {e}", "err")

    def _open_encode(self):
        try:
            self._tool("EncodeWin")
        except Exception as e:
            self._console(f"تعذّر فتح الترميز: {e}", "err")

    def _open_plugins(self):
        try:
            self._tool("PluginsWin")
        except Exception as e:
            self._console(f"تعذّر فتح الإضافات: {e}", "err")

    def _open_labs(self):
        try:
            self._tool("LabsWin")
        except Exception as e:
            self._console(f"تعذّر فتح المختبرات: {e}", "err")

    def _open_active(self):
        try:
            self._tool("ActiveScanWin")
        except Exception as e:
            self._console(f"تعذّر فتح المسح النشط: {e}", "err")

    def _open_oob(self):
        try:
            self._tool("OOBWin")
        except Exception as e:
            self._console(f"تعذّر فتح مراقب OOB: {e}", "err")

    def _open_profiles(self):
        try:
            import tools as _t
            _t.ProfilesWin(self, on_change=self._refresh_profiles)
        except Exception:
            try:
                self._tool("ProfilesWin")
            except Exception as e:
                self._console(f"تعذّر فتح الجلسات: {e}", "err")

    def _refresh_profiles(self):
        try:
            from profiles import list_profiles
            names = [""] + [p["name"] for p in list_profiles()]
            self.profile_box.config(values=names)
            if self.profile_var.get() not in names:
                self.profile_var.set("")
        except Exception:
            pass

    def _export_bounty(self):
        if not self._last_report:
            self._console("نفّذ فحصًا أوتوماتيكيًا أولًا ثم صدّر التقرير.", "warn")
            messagebox.showinfo("تقرير Bounty", "نفّذ فحصًا أوتوماتيكيًا أولًا.")
            return
        try:
            from bounty import write_reports
            outdir = GUI_DIR.parent / "reports" / "bounty"
            evmap = {}
            for code, ev in self._evidence.items():
                steps = [f"الدليل المسجل: "
                         f"{next((r['note'] for r in self._rows if r['code'] == code), '—')}"]
                if code in LESSONS:
                    steps.append(f"أعدها يدويًا: {LESSONS[code]['how']}")
                    steps.append(f"الحمولة: {LESSONS[code]['payload']}")
                evmap[code] = {"request": ev.get("request", ""),
                               "response": ev.get("response", ""),
                               "steps": steps}
            out = write_reports(outdir, self._last_report,
                                evidence_map=evmap, researcher="LocalLab")
            self._console(f"صُدّر التقرير: {out['md']}", "ok")
            self._console(f"ونسخة HTML: {out['html']}", "ok")
            messagebox.showinfo("تقرير Bounty",
                                f"تم التصدير ({out['cards']} بطاقة):\n{out['md']}\n{out['html']}")
        except Exception as e:
            self._console(f"تعذّر التصدير: {e}", "err")

    def _export_bulk(self):
        paths = filedialog.askopenfilenames(
            title="اختر مشاريع أو تقارير (JSON)",
            initialdir=str(GUI_DIR.parent / "reports"),
            filetypes=[("JSON", "*.json")])
        if not paths:
            return
        try:
            from bulk import export_bulk
            outdir = GUI_DIR.parent / "reports" / \
                f"bulk_{datetime.now(timezone.utc):%Y%m%d-%H%M%S}"
            out = export_bulk(outdir, [{"report": p} for p in paths],
                              researcher="LocalLab")
            self._console(f"صُدّرت المحفظة: {out['dir']}", "ok")
            self._console(f"الأهداف: {out['targets']} · الثغرات: {out['findings']} · CSV جاهز", "ok")
            messagebox.showinfo("محفظة Bounty",
                                f"الأهداف: {out['targets']} · الثغرات: {out['findings']}\n"
                                f"الفهرس: {out['index_html']}\nCSV: {out['csv']}")
        except Exception as e:
            self._console(f"تعذّر التصدير الجماعي: {e}", "err")
            messagebox.showerror("محفظة Bounty", str(e))

    def _compare_reports(self):
        a = filedialog.askopenfilename(
            title="التقرير الأول (قبل)",
            initialdir=str(GUI_DIR.parent / "reports"),
            filetypes=[("JSON", "*.json")])
        if not a:
            return
        b = filedialog.askopenfilename(
            title="التقرير الثاني (بعد)",
            initialdir=str(GUI_DIR.parent / "reports"),
            filetypes=[("JSON", "*.json")])
        if not b:
            return
        try:
            from bulk import _as_report
            from compare import compare_reports, to_html, to_markdown
            ra, _, la = _as_report({"report": a})
            rb, _, lb = _as_report({"report": b})
            comp = compare_reports(ra, rb, Path(a).stem[:24],
                                   Path(b).stem[:24])
            outdir = GUI_DIR.parent / "reports" / \
                f"compare_{datetime.now(timezone.utc):%Y%m%d-%H%M%S}"
            outdir.mkdir(parents=True, exist_ok=True)
            (outdir / "compare.md").write_text(to_markdown(comp),
                                               encoding="utf-8")
            (outdir / "compare.html").write_text(to_html(comp),
                                                 encoding="utf-8")
            self._console(
                f"[مقارنة] جديد {len(comp['new'])} · أُصلح {len(comp['fixed'])} "
                f"· مستمر {len(comp['persisting'])} · الفرق {comp['delta']:+d}",
                "ok" if not comp["new"] else "warn")
            messagebox.showinfo(
                "مقارنة", f"جديد: {', '.join(comp['new']) or '—'}\n"
                           f"أُصلح: {', '.join(comp['fixed']) or '—'}\n"
                           f"الفرق: {comp['delta']:+d}\n{outdir / 'compare.html'}")
        except Exception as e:
            self._console(f"تعذّرت المقارنة: {e}", "err")
            messagebox.showerror("مقارنة", str(e))

    def _export_executive(self):
        if not self._last_report:
            messagebox.showinfo("تنفيذي", "نفّذ فحصًا أولًا.")
            return
        try:
            from executive import to_html
            outdir = GUI_DIR.parent / "reports" / "executive"
            outdir.mkdir(parents=True, exist_ok=True)
            ts = f"{datetime.now(timezone.utc):%Y%m%d-%H%M%S}"
            evmap = {}
            for code, ev in self._evidence.items():
                evmap[code] = {"request": ev.get("request", ""),
                               "response": ev.get("response", ""),
                               "steps": []}
            p = outdir / f"executive_{ts}.html"
            p.write_text(to_html(self._last_report, researcher="LocalLab",
                                 evidence_map=evmap), encoding="utf-8")
            self._console(f"صُدّر التنفيذي: {p}", "ok")
            messagebox.showinfo("تنفيذي", str(p))
        except Exception as e:
            self._console(f"تعذّر التنفيذي: {e}", "err")

    def _export_pdf(self):
        if not self._last_report:
            messagebox.showinfo("PDF", "نفّذ فحصًا أولًا.")
            return
        try:
            from pdfexport import export_pdf
        except Exception as e:
            messagebox.showerror(
                "PDF", "تحتاج: pip install reportlab arabic-reshaper "
                       "python-bidi\n" + str(e)[:200])
            return
        try:
            outdir = GUI_DIR.parent / "reports" / "pdf"
            outdir.mkdir(parents=True, exist_ok=True)
            ts = f"{datetime.now(timezone.utc):%Y%m%d-%H%M%S}"
            p = outdir / f"report_{ts}.pdf"
            export_pdf(self._last_report, str(p), researcher="LocalLab")
            self._console(f"صُدّر PDF: {p} ({p.stat().st_size // 1024}KB)",
                          "ok")
            messagebox.showinfo("PDF", str(p))
        except Exception as e:
            self._console(f"تعذّر PDF: {e}", "err")
            messagebox.showerror("PDF", str(e)[:300])


def _create_app():
    _hide_console()
    root = tk.Tk()
    app = LocalLabApp(root)
    return root, app


def main():
    root, _app = _create_app()
    root.mainloop()


def selftest():
    """يبني الواجهة ويغلقها فورًا — للتحقق من سلامة البناء دون انتظار."""
    root, app = _create_app()
    assert app._make_scope().mode == "loopback"
    assert len(app.tool_btns) == 11
    from generic import GENERIC_CHECKS
    assert len(GENERIC_CHECKS) == 14
    from deep import DEEP_CHECKS
    assert len(DEEP_CHECKS) == 5
    assert "🧪 المختبر المحلي" in app.target_combo.cget("values")
    from targets import canonical
    assert canonical("https://Example.COM:443/a") == "https://example.com:443"
    assert normalize_target_input("demo.testfire.net") == \
        "http://demo.testfire.net"
    assert normalize_target_input("https://x.com/") == "https://x.com/"
    assert normalize_target_input("  ") == ""
    assert root.bind_class("Entry", "<Button-3>"), "لا قائمة لصق!"
    # الحلقة المكسورة سابقًا: لا مسار في الواجهة يُنشئ عملية إثبات،
    # فلا رمز لغرفة التحكم، فلا أثر، وشهادة فارغة. نتحقق من وجود المسار.
    from controldeck import ControlDeck
    assert hasattr(ControlDeck, "_new_engagement"), \
        "لا زر إنشاء عملية في غرفة التحكم — الحلقة المكسورة"
    assert hasattr(ControlDeck, "_open_token"), \
        "غرفة التحكم لا تملأ الرمز من آخر عملية"
    from viewer import ImpactWin
    src = Path(__file__).read_text(encoding="utf-8")
    assert "new_engagement" in src, "شاشة الشهادة لا تفتح عمليات"
    # _open_token منطق خالص — نختبره بلا Tk: آخر عملية مفتوحة على الهدف.
    import tempfile
    from proof import list_engagements, new_engagement
    from pathlib import Path as _P
    deck = object.__new__(ControlDeck)          # بلا بناء Tk
    deck._base = lambda: "http://127.0.0.1:9/"
    _p = _P(tempfile.mkdtemp()) / "st.json"
    new_engagement("http://127.0.0.1:9/", path=_p)
    # نوجّه المتجر مؤقتًا إلى ملف الاختبار
    import proof as _proof
    _orig_store = _proof.store_path
    _proof.store_path = lambda: _p
    try:
        assert deck._open_token().startswith("GX9-"), "لم يُملأ الرمز"
        new_engagement("http://other.invalid/", path=_p)
        assert deck._open_token().startswith("GX9-"), \
            "اختزل رمز هدف آخر"
    finally:
        _proof.store_path = _orig_store
    assert list_engagements(path=_p), "sanity"
    root.update_idletasks()
    root.destroy()
    print("GUI selftest: OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        main()
