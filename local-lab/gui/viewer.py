"""
local-lab/gui/viewer.py — عارض الدليل الحي + نافذة ما بعد الاختراق.
===============================================================
PageViewer: يعرض أي صفحة عبر جلسة البرنامج (بكوكيزها المسروقة شرعيًا)
  كنص مقروء + روابط قابلة للتنقل — لترى لوحة التحكم بعينيك.
ImpactWin: قائمة الثغرات المؤكدة مع خريطة أثر كل واحدة + زر عرض حي.
"""
import threading
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scanner"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "report"))

from session import Session

try:
    from postex import fetch_page, replay
except ImportError:
    from engine.postex import fetch_page, replay

try:
    from impact import get as impact_of
except ImportError:
    from report.impact import get as impact_of


def photo_from_bytes(data: bytes):
    """صورة tkinter من بايتات PNG/GIF — تعيد None لغير المدعوم."""
    try:
        import base64
        if not data or len(data) < 8:
            return None
        if data[:8] != b"\x89PNG\r\n\x1a\n" and data[:6] not in (
                b"GIF87a", b"GIF89a"):
            return None
        return tk.PhotoImage(
            data=base64.b64encode(bytes(data)).decode("ascii"))
    except Exception:
        return None


class PageViewer:
    """عارض صفحة واحدة عبر جلسة البرنامج."""

    def __init__(self, app, session, base):
        self.app = app
        self.session = session
        self.base = (base or "").rstrip("/")
        top = self.top = tk.Toplevel(app.root)
        top.title("👁 عارض الدليل الحي")
        top.geometry("860x640")
        top.configure(bg="#0b1220")

        bar = tk.Frame(top, bg="#0b1220")
        bar.pack(fill="x", padx=12, pady=8)
        self.url_var = tk.StringVar(value=self.base + "/")
        tk.Entry(bar, textvariable=self.url_var, width=62,
                 font=("Consolas", 9)).pack(side="left", fill="x",
                                            expand=True)
        app._mk_button(bar, "اذهب ↩", self._go,
                       bg="#0284c7", hover="#0ea5e9").pack(side="left",
                                                          padx=6)
        self.status = tk.Label(top, text="…", bg="#0b1220", fg="#94a3b8",
                               font=("Segoe UI", 9))
        self.status.pack(anchor="w", padx=12)
        self.img_label = tk.Label(top, bg="#02060d")
        self._photo = None
        self.text = tk.Text(top, bg="#02060d", fg="#e2e8f0",
                            font=("Segoe UI", 10), wrap="word", padx=12,
                            pady=8)
        self.text.pack(fill="both", expand=True, padx=12, pady=4)
        self.text.config(state="disabled")
        tk.Label(top, text="روابط الصفحة (نقرة مزدوجة للتنقل):",
                 bg="#0b1220", fg="#34d399",
                 font=("Segoe UI", 9, "bold")).pack(anchor="w", padx=12)
        self.links = tk.Listbox(top, height=4, bg="#02060d", fg="#7dd3fc",
                                font=("Consolas", 9))
        self.links.pack(fill="x", padx=12, pady=(0, 4))
        self.links.bind("<Double-Button-1>", self._follow)
        self._link_urls = []
        bot = tk.Frame(top, bg="#0b1220")
        bot.pack(fill="x", padx=12, pady=(0, 10))
        app._mk_button(bot, "↻ تحديث", self._go,
                       bg="#334155", hover="#475569").pack(side="left")
        app._mk_button(bot, "🌐 فتح في المتصفح", self._browser,
                       bg="#0369a1", hover="#0284c7").pack(side="left",
                                                          padx=6)
        app._mk_button(bot, "📋 نسخ الرابط", self._copy,
                       bg="#334155", hover="#475569").pack(side="left",
                                                          padx=6)
        tk.Label(bot, text="الداخلي يستخدم جلسة البرنامج (الكوكيز معه) — الخارجي بلا جلسة.",
                 bg="#0b1220", fg="#64748b",
                 font=("Segoe UI", 8)).pack(side="left", padx=10)

    def _show(self, page):
        self.text.config(state="normal")
        self.text.delete("1.0", "end")
        head = f"[{page.get('status')}] {page.get('url')}"
        if page.get("via"):
            head += f"  — عبر: {page['via']}"
        cookies = page.get("cookies") or []
        if cookies:
            head += f"\n🍪 الجلسة تحمل: {', '.join(cookies)}"
        self.text.insert("end", head + "\n" + ("─" * 60) + "\n")
        raw = page.get("raw")
        ctype = (page.get("headers") or {}).get("content-type", "")
        photo = photo_from_bytes(raw) if (
            raw and ctype.startswith("image/")) else None
        if photo is not None:
            self._photo = photo
            self.img_label.config(image=photo)
            self.img_label.pack(fill="x", padx=12, pady=4)
            self.text.insert("end", "🖼 الصورة أعلاه هي الدليل نفسه "
                                    "(قبل/بعد) — احفظها بعينك.\n\n")
        else:
            self._photo = None
            self.img_label.pack_forget()
        self.text.insert("end", page.get("text") or "(صفحة فارغة)")
        self.text.config(state="disabled")
        self.status.config(
            text=f"{page.get('url', '')} — HTTP {page.get('status')}")
        self.url_var.set(page.get("url", ""))
        self.links.delete(0, "end")
        self._link_urls = [l["url"] for l in page.get("links") or []]
        for l in page.get("links") or []:
            self.links.insert("end", f"{l['text'][:70]}  →  {l['url'][:70]}")

    def open(self, url):
        self.url_var.set(url)
        self.status.config(text="جارٍ الجلب عبر الجلسة …")
        threading.Thread(target=self._work_open, args=(url,),
                         daemon=True).start()

    def _work_open(self, url):
        try:
            page = fetch_page(self.session, url)
        except Exception as e:
            page = {"url": url, "status": 0, "headers": {},
                    "text": f"خطأ: {e}", "links": [], "cookies": []}
        self.top.after(0, self._show, page)

    def open_replay(self, row):
        self.status.config(
            text=f"إعادة تشغيل دليل {row.get('code')} …")
        threading.Thread(target=self._work_replay, args=(dict(row),),
                         daemon=True).start()

    def _work_replay(self, row):
        try:
            page = replay(self.session, self.base, row)
        except Exception as e:
            page = {"url": self.base, "status": 0, "headers": {},
                    "text": f"خطأ: {e}", "links": [], "cookies": []}
        self.top.after(0, self._show, page)

    def _go(self):
        self.open(self.url_var.get().strip())

    def _follow(self, _ev=None):
        sel = self.links.curselection()
        if sel:
            self.open(self._link_urls[sel[0]])

    def _browser(self):
        webbrowser.open(self.url_var.get().strip())
        self.app._console("[عارض] فُتح خارجيًا (بلا جلسة البرنامج).",
                         "info")

    def _copy(self):
        self.top.clipboard_clear()
        self.top.clipboard_append(self.url_var.get().strip())


class ImpactWin:
    """ما بعد الاختراق: ماذا ملكت + عرض حي لكل ثغرة مؤكدة."""

    def __init__(self, app, rows, base):
        self.app = app
        self.base = (base or "").rstrip("/")
        self.rows = [r for r in (rows or []) if r.get("verdict")]
        try:
            self.session = Session(app._make_scope())
        except Exception as e:
            messagebox.showerror("نطاق مرفوض", str(e))
            self.session = None
        top = self.top = tk.Toplevel(app.root)
        top.title("🎯 ما بعد الاختراق — ماذا ملكت فعلًا")
        top.geometry("960x700")
        top.configure(bg="#0b1220")
        tk.Label(top, text=f"الثغرات المؤكدة: {len(self.rows)} — اختر واحدة وشاهد أثرها حيًا",
                 bg="#0b1220", fg="#7dd3fc",
                 font=("Segoe UI", 11, "bold")).pack(pady=8)
        mid = tk.Frame(top, bg="#0b1220")
        mid.pack(fill="both", expand=True, padx=12)
        self.lst = tk.Listbox(mid, bg="#02060d", fg="#e2e8f0",
                              font=("Segoe UI", 10), height=8)
        self.lst.pack(side="left", fill="both", expand=True)
        for r in self.rows:
            self.lst.insert("end", f"✅ {r['name']}  [{r['code']}]")
        self.lst.bind("<<ListboxSelect>>", self._pick)
        side = tk.Frame(mid, bg="#0b1220", width=380)
        side.pack(side="left", fill="y", padx=(10, 0))
        self.imp = tk.Text(side, bg="#111c30", fg="#e2e8f0",
                           font=("Segoe UI", 10), wrap="word", padx=10,
                           pady=8, height=14, width=46)
        self.imp.pack(fill="both", expand=True)
        self.imp.config(state="disabled")
        app._mk_button(side, "👁 اعرض الدليل حيًا", self._view,
                       bg="#16a34a", hover="#22c55e").pack(fill="x",
                                                          pady=(0, 8))
        app._mk_button(side, "📜 شهادة الإثبات (كشف/احتجاب)", self._cert,
                       bg="#b45309", hover="#d97706").pack(fill="x")
        if self.rows:
            self.lst.select_set(0)
            self._pick()
        else:
            self._say("لا ثغرات مؤكدة في آخر فحص — نفّذ فحصًا أولًا.")

    def _say(self, text):
        self.imp.config(state="normal")
        self.imp.delete("1.0", "end")
        self.imp.insert("end", text)
        self.imp.config(state="disabled")

    def _pick(self, _ev=None):
        sel = self.lst.curselection()
        if not sel:
            return
        r = self.rows[sel[0]]
        im = impact_of(r["code"])
        self._say(f"🎯 {r['name']}  [{r['code']}]\n"
                  f"الدليل: {r.get('note', '')}\n\n"
                  f"👑 تملك الآن: {im['owns']}\n\n"
                  f"👁 سترى: {im['see']}\n\n"
                  f"➡ التالي ضمن التفويض: {im['next']}\n\n"
                  f"💰 الباونتي: {im['bounty']}")

    def _view(self):
        sel = self.lst.curselection()
        if not sel or self.session is None:
            return
        row = self.rows[sel[0]]
        v = PageViewer(self.app, self.session, self.base)
        v.open_replay(row)
        self.app._console(f"[ما بعد الاختراق] عرض حي: {row['code']}",
                          "info")

    def _cert(self):
        try:
            from proof import (disclosure_state, export_certificate,
                               get_engagement, list_engagements,
                               new_engagement, set_disclosure, verify_plant)
        except Exception as e:
            messagebox.showerror("الشهادة", f"محرك الإثبات غير متاح: {e}")
            return
        top = tk.Toplevel(self.top)
        top.title("📜 شهادة إثبات الاختراق — كشف أم احتجاب؟")
        top.geometry("640x520")
        top.configure(bg="#0b1220")
        tk.Label(top, text="اختر العملية، ثم قرر: يُكشَف الرمز الكامل أم يُحجَب؟",
                 bg="#0b1220", fg="#7dd3fc",
                 font=("Segoe UI", 10, "bold")).pack(pady=8)
        lst = tk.Listbox(top, bg="#02060d", fg="#e2e8f0",
                         font=("Consolas", 9), height=6)
        lst.pack(fill="x", padx=12)
        state = {"engs": []}

        def refresh():
            """تعيد بناء القائمة — كانت تُبنى مرة واحدة، فأي عملية جديدة
            كانت تستلزم إغلاق النافذة وإعادتها."""
            state["engs"] = list_engagements()
            lst.delete(0, "end")
            for e in state["engs"]:
                try:
                    dec = disclosure_state(e["id"]) or "لم يُسأل"
                except Exception:
                    dec = "لم يُسأل"
                mark = "🎯 " if e.get("target", "").rstrip("/") == self.base \
                    else ""
                lst.insert("end",
                           f"{mark}{e['id']} — {e.get('target', '')} — "
                           f"{len(e.get('plants', []))} آثار — {dec}")

        def make_engagement():
            """فتح عملية — كان new_engagement بلا أي مستدعٍ في التطبيق."""
            note = simpledialog.askstring(
                "عملية إثبات جديدة",
                f"الهدف: {self.base}\n\nبيان مختصر (يُطبع في الشهادة):",
                initialvalue="") or ""
            try:
                rec = new_engagement(self.base, note=note)
            except Exception as e:
                say(f"تعذّر فتح العملية: {e}")
                return
            refresh()
            lst.selection_clear(0, "end")
            for i, e in enumerate(state["engs"]):
                if e["id"] == rec["id"]:
                    lst.selection_set(i)
                    break
            say(f"✅ فُتحت العملية {rec['id']}\n"
                f"الرمز الكامل: {rec['token']}\n\n"
                f"استخدمه في «غرفة التحكم ← رفع كناري» ليسجَّل الأثر، "
                f"ثم ارجع هنا واضغط «إعادة التحقق».")
            self.app._console(f"[إثبات] فُتحت عملية {rec['id']}", "ok")

        refresh()
        txt = tk.Text(top, bg="#02060d", fg="#e2e8f0", font=("Segoe UI", 9),
                      wrap="word", padx=10, pady=6, height=14)
        txt.pack(fill="both", expand=True, padx=12, pady=6)
        txt.config(state="disabled")
        state = {"cert": "", "id": None}

        def say(t):
            txt.config(state="normal")
            txt.delete("1.0", "end")
            txt.insert("end", t)
            txt.config(state="disabled")

        def current():
            sel = lst.curselection()
            if not sel:
                say("اختر عملية من القائمة أولًا.")
                return None
            return state["engs"][sel[0]]

        def reverify():
            """إعادة التحقق الحي من الآثار المزروعة.

            هذه هي methodology الاختامية (شهادة ← detect ← راجع ← verify)،
            وكانت verify_plant دالة ميتة لا يستدعيها أحد.
            """
            e = current()
            if not e:
                return
            if self.session is None:
                say("لا توجد جلسة — لا يمكن التحقق الحي.")
                return
            rec = get_engagement(e["id"]) or e
            plants = rec.get("plants", [])
            if not plants:
                say("لا آثار مسجّلة لهذه العملية بعد. ارفع كناريًا من "
                    "«غرفة التحكم» بالرمز أولًا.")
                return
            lines = []
            live = 0
            for p in plants:
                r = verify_plant(self.session, self.base, p)
                live += 1 if r.get("ok") else 0
                lines.append(f"{'✅' if r.get('ok') else '❌'} "
                             f"{p.get('check')} — {p.get('location')} — "
                             f"{r.get('detail', '')}")
            say(f"التحقق: {live}/{len(plants)} أثر حي.\n\n"
                + "\n".join(lines))
            self.app._console(f"[إثبات] تحقق حي: {live}/{len(plants)} "
                              f"في {e['id']}", "ok" if live else "warn")

        def show_hold():
            e = current()
            if e:
                say(f"🔒 {e['id']}\nالهدف: {e.get('target', '')}\n"
                    f"الآثار: {len(e.get('plants', []))}\n"
                    "الرمز الكامل محجوب — لن يُكشَف إلا بقرار «كشف» منك.")

        def release():
            e = current()
            if not e:
                return
            ok = messagebox.askyesno(
                "قرار الإفصاح",
                "هل يتم الإفصاح عن بيانات الإثبات لهذه العملية؟\n\n"
                "نعم = يُكشَف الرمز الكامل وتُصدَر الشهادة.\n"
                "لا = تبقى محجوبة محليًا.")
            if not ok:
                set_disclosure(e["id"], False)
                self.app._console("[إثبات] قرار: احتجاب 🔒", "warn")
                say("🔒 قرارك: احتجاب — لا شيء سيُكشَف.")
                return
            set_disclosure(e["id"], True)
            try:
                cert = export_certificate(e["id"])
            except Exception as ex:
                say(f"تعذّر: {ex}")
                return
            state["cert"], state["id"] = cert, e["id"]
            say(cert)
            self.app._console(f"[إثبات] قرار: كشف ✓ {e['id']}", "ok")

        def save():
            if not state["cert"]:
                say("أصدر الشهادة أولًا بزر الكشف.")
                return
            p = filedialog.asksaveasfilename(
                defaultextension=".md",
                initialfile=f"proof_{state['id']}.md",
                filetypes=[("Markdown", "*.md")])
            if p:
                Path(p).write_text(state["cert"], encoding="utf-8")
                self.app._console(f"[إثبات] حُفظت الشهادة: {p}", "ok")

        lst.bind("<<ListboxSelect>>", lambda _e: show_hold())
        brow = tk.Frame(top, bg="#0b1220")
        brow.pack(fill="x", padx=12, pady=(0, 10))
        self.app._mk_button(brow, "➕ عملية جديدة", make_engagement,
                            bg="#7c3aed", hover="#8b5cf6").pack(
            side="right", padx=4)
        self.app._mk_button(brow, "✅ كشف وإصدار", release,
                            bg="#16a34a", hover="#22c55e").pack(
            side="right", padx=4)
        self.app._mk_button(brow, "🔁 إعادة التحقق", reverify,
                            bg="#0891b2", hover="#06b6d4").pack(
            side="right", padx=4)
        self.app._mk_button(brow, "🔒 احتجاب", lambda: (
            current() and set_disclosure(current()["id"], False),
            say("🔒 قرارك: احتجاب — لا شيء سيُكشَف."),
            self.app._console("[إثبات] قرار: احتجاب 🔒", "warn")),
            bg="#475569", hover="#64748b").pack(side="right", padx=4)
        self.app._mk_button(brow, "💾 حفظ الشهادة", save,
                            bg="#0d9488", hover="#14b8a6").pack(
            side="right", padx=4)
