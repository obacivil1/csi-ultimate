"""
local-lab/gui/controldeck.py — غرفة التحكم الشاملة.
=====================================================
قراءة أي URL داخل النطاق + أفعال مُغيّرة (POST/رفع/زرع) ببوابة
التصريح العميق + توثيق كل فعل في audit.jsonl. لا يعمل خارج النطاق
أبدًا، ولا فعل مُغيّر بلا «أصرّح».
"""
import threading
import tkinter as tk
import urllib.parse
from pathlib import Path
from tkinter import messagebox

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scanner"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))

from session import Session

try:
    from control import log_control, read_url, submit_form, upload_canary
    from postex import extract_links
except ImportError:
    from engine.control import (log_control, read_url, submit_form,
                                upload_canary)
    from engine.postex import extract_links


class ControlDeck:
    def __init__(self, app):
        self.app = app
        try:
            self.session = Session(app._make_scope())
        except Exception as e:
            messagebox.showerror("نطاق مرفوض", str(e))
            self.session = None
        base0 = (app.target_var.get().strip() or "").rstrip("/")
        top = self.top = tk.Toplevel(app.root)
        top.title("🎛 غرفة التحكم الشاملة")
        top.geometry("900x680")
        top.configure(bg="#0b1220")

        tk.Label(top, text="غرفة التحكم — قراءة حرة، وتغيير بتصريح المالك فقط",
                 bg="#0b1220", fg="#7dd3fc",
                 font=("Segoe UI", 11, "bold")).pack(pady=8)
        self.info = tk.Label(top, text="", bg="#0b1220", fg="#94a3b8",
                             font=("Segoe UI", 9))
        self.info.pack()
        self._refresh_info(base0)

        card = tk.Frame(top, bg="#111c30")
        card.pack(fill="x", padx=12, pady=6)
        tk.Label(card, text="URL للقراءة:", bg="#111c30", fg="#e2e8f0",
                 font=("Segoe UI", 9)).pack(anchor="e", padx=10)
        self.url_v = tk.StringVar(value=base0 + "/" if base0 else "")
        tk.Entry(card, textvariable=self.url_v, width=80,
                 font=("Consolas", 9)).pack(fill="x", padx=10, pady=2)
        brow = tk.Frame(card, bg="#111c30")
        brow.pack(pady=4)
        app._mk_button(brow, "📖 قراءة في العارض", self._read,
                       bg="#0284c7", hover="#0ea5e9").pack(side="right",
                                                          padx=4)

        post = tk.Frame(top, bg="#111c30")
        post.pack(fill="x", padx=12, pady=6)
        tk.Label(post, text="فعل مُغيّر (POST) — يتطلب «أصرّح»:",
                 bg="#111c30", fg="#fbbf24",
                 font=("Segoe UI", 10, "bold")).pack(anchor="e", padx=10)
        row = tk.Frame(post, bg="#111c30")
        row.pack(fill="x", padx=10, pady=2)
        tk.Label(row, text="الإجراء:", bg="#111c30", fg="#e2e8f0",
                 font=("Segoe UI", 9)).pack(side="right")
        self.act_v = tk.StringVar(value=base0 + "/login" if base0 else "")
        tk.Entry(row, textvariable=self.act_v, width=52,
                 font=("Consolas", 9)).pack(side="right", padx=4)
        tk.Label(row, text="الحقول k=v&..:", bg="#111c30", fg="#e2e8f0",
                 font=("Segoe UI", 9)).pack(side="right")
        self.fields_v = tk.StringVar(value="username=gx9&password=gx9")
        tk.Entry(row, textvariable=self.fields_v, width=24,
                 font=("Consolas", 9)).pack(side="right", padx=4)
        row2 = tk.Frame(post, bg="#111c30")
        row2.pack(fill="x", padx=10, pady=4)
        tk.Label(row2, text="حقل الملف + رمز العملية للرفع:",
                 bg="#111c30", fg="#e2e8f0",
                 font=("Segoe UI", 9)).pack(side="right")
        self.ff_v = tk.StringVar(value="file")
        tk.Entry(row2, textvariable=self.ff_v, width=10,
                 font=("Consolas", 9)).pack(side="right", padx=4)
        # الرمز كان حقلاً فارغًا دائمًا: لا شيء في التطبيق ينتج رمزًا،
        # فكان الرفع بلا عملية ولا أثر مسجّل (صامت). الآن نملؤه من آخر
        # عملية مفتوحة على هذا الهدف — من «شهادة الإثبات».
        self.tok_v = tk.StringVar(value=self._open_token())
        tk.Entry(row2, textvariable=self.tok_v, width=22,
                 font=("Consolas", 9)).pack(side="right", padx=4)
        app._mk_button(row2, "➕ عملية", self._new_engagement,
                       bg="#7c3aed", hover="#8b5cf6").pack(side="right",
                                                           padx=4)
        app._mk_button(row2, "📤 إرسال POST", self._post,
                       bg="#b45309", hover="#d97706").pack(side="right",
                                                          padx=4)
        app._mk_button(row2, "📎 رفع كناري", self._upload,
                       bg="#be123c", hover="#e11d48").pack(side="right",
                                                          padx=4)

        tk.Label(top, text="سجل الغرفة — كل فعل موثق في audit.jsonl:",
                 bg="#0b1220", fg="#34d399",
                 font=("Segoe UI", 9, "bold")).pack(anchor="w", padx=12)
        self.log = tk.Text(top, bg="#02060d", fg="#e2e8f0",
                           font=("Consolas", 9), wrap="word", height=12,
                           padx=10, pady=6)
        self.log.pack(fill="both", expand=True, padx=12, pady=(0, 10))
        self.log.config(state="disabled")

    def _base(self):
        return (self.app.target_var.get().strip() or "").rstrip("/")

    def _refresh_info(self, base):
        try:
            n = len(self.session.cookies()) if self.session else 0
            self.info.config(text=f"الهدف: {base or '—'} · "
                                  f"كوكيز الجلسة: {n}")
        except Exception:
            pass

    def _say(self, msg):
        self.log.config(state="normal")
        self.log.insert("end", msg + "\n")
        self.log.see("end")
        self.log.config(state="disabled")
        self.app._console(f"[تحكم] {msg}", "info")

    def _read(self):
        if self.session is None:
            return
        from viewer import PageViewer
        v = PageViewer(self.app, self.session, self._base())
        v.open(self.url_v.get().strip())
        try:
            log_control(self._base(), "read", self.url_v.get().strip())
        except Exception:
            pass
        self._say(f"📖 قراءة: {self.url_v.get().strip()}")
        self._refresh_info(self._base())

    def _run_bg(self, fn, *args):
        if self.session is None:
            return
        threading.Thread(target=self._work, args=(fn,) + args,
                         daemon=True).start()

    def _work(self, fn, *args):
        try:
            out = fn(*args)
        except Exception as e:
            out = {"error": str(e)}
        self.top.after(0, self._done, fn.__name__, out)

    def _done(self, name, out):
        if isinstance(out, dict) and out.get("error"):
            self._say(f"❌ {name}: {out['error']}")
            return
        if name == "_do_post":
            self._say(f"📤 POST {out.get('action')} → {out.get('status')} · "
                      f"كوكيز: {out.get('cookies')}")
        elif name == "_do_upload":
            self._say(f"📎 رفع: {out.get('detail')}")
        self._refresh_info(self._base())

    def _do_post(self, action, fields):
        import urllib.parse as _u
        f = dict(_u.parse_qsl(fields, keep_blank_values=True))
        out = submit_form(self.session, self._base(), action, f)
        try:
            log_control(self._base(), "post", action,
                        {"fields": sorted(f), "status": out.get("status")})
        except Exception:
            pass
        return out

    def _authorize_mutation(self, what: str) -> bool:
        """بوابة «أصرّح» الحقيقية للأفعال المغيّرة (كانت لافتة بلا حوار).

        - المختبر المحلي: يعمل فورًا بلا حوار.
        - هدف خارجي: حوار يطلب كتابة «أصرّح» + تصريح مالك مسجّل
          (intrusive_granted)، وإلا رفض صريح ولا يُرسَل شيء.
        """
        from tkinter import simpledialog
        from scoped import is_loopback, normalize_host
        from targets import intrusive_granted

        base = self._base()
        host = normalize_host(base.split("://", 1)[1]) if "://" in base else normalize_host(base)
        if is_loopback(host):
            return True
        a = simpledialog.askstring(
            "تصريح فعل مُغيّر",
            f"«{what}» يغيّر حالة الهدف الخارجي.\nاكتب كلمة: أصرّح")
        if not a or "أصرّح" not in a:
            self._say("❌ رُفض: الفعل المغيّر يتطلب كتابة «أصرّح».")
            return False
        if not intrusive_granted(base):
            self._say("❌ رُفض: لا يوجد تصريح مالك مسجّل لهذا الهدف "
                      "(intrusive_granted).")
            return False
        return True

    def _open_token(self) -> str:
        """آخر رمز عملية مفتوح لهذا الهدف — أو '' إن لم توجد عملية.

        نُعيد '' عمدًا بدل رمي: الغرفة تظل صالحة للاستخدام، لكنすべき
        على المستخدم أن يفتح عملية，否则 لن يُسجَّل أي أثر.
        """
        try:
            from proof import list_engagements
            base = self._base().rstrip("/")
            for e in reversed(list_engagements()):
                if (e.get("target", "").rstrip("/") == base
                        and e.get("token")):
                    return e["token"]
        except Exception:
            pass
        return ""

    def _new_engagement(self):
        """فتح عملية إثبات جديدة —Previously لا يوجد مسار لإنشائها إطلاقًا.

        هذه هي الحلقة المكسورة: record_plant في control.py يبحث عن عملية
        بالرمز، ولا عملية يمكن أن توجد لأن new_engagement لم يكن له زر.
        """
        from tkinter import messagebox, simpledialog
        try:
            from proof import new_engagement
        except Exception as e:
            messagebox.showerror("إثبات", f"محرك الإثبات غير متاح: {e}")
            return
        base = self._base()
        note = simpledialog.askstring(
            "عملية إثبات جديدة",
            f"الهدف: {base}\n\nبيان مختصر (يُطبع في الشهادة):",
            initialvalue="") or ""
        try:
            rec = new_engagement(base, note=note)
        except Exception as e:
            messagebox.showerror("إثبات", f"تعذّر فتح العملية: {e}")
            return
        self.tok_v.set(rec["token"])
        self._say(f"✅ فُتحت العملية {rec['id']} — الرمز في حقل الرفع. "
                  f"احفظه: {rec['token']}")
        messagebox.showinfo(
            "عملية إثبات",
            f"العملية: {rec['id']}\nالرمز الكامل: {rec['token']}\n\n"
            f"الرمز مُعبّأ في حقل الرفع. ارفع الكناري به ليتُسجَّل الأثر، "
            f"ثم افتح «شهادة الإثبات» لتقرر الإفصاح.")

    def _post(self):
        if not self._authorize_mutation("POST"):
            return
        self._run_bg(self._do_post, self.act_v.get().strip(),
                     self.fields_v.get().strip())

    def _do_upload(self, action, field, token):
        out = upload_canary(self.session, self._base(), action, field,
                            token or "MANUAL")
        try:
            log_control(self._base(), "upload", action,
                        {"ok": out.get("ok"),
                         "file": out.get("file", "")})
        except Exception:
            pass
        return out

    def _upload(self):
        if not self._authorize_mutation("رفع ملف"):
            return
        self._run_bg(self._do_upload, self.act_v.get().strip(),
                     self.ff_v.get().strip() or "file",
                     self.tok_v.get().strip())
