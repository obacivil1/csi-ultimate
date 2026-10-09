"""target/app2_safe.py — نفس مسارات app2 بالضبط، لكن بإصلاحات سليمة.

هذا هو شريك الاختبار في الاتجاه العكسي. لو كان app2 يعطي نتائج لأن
الفحوص تعرف أسماءه، فسيعطي app2_safe النتائج نفسها — والفرق الوحيد
بين الهدفين هو وجود الثغرات نفسها:

| المسار       | app2 (مصاب)          | app2_safe (آمن)              |
|--------------|----------------------|------------------------------|
| /signin      | استعلام مبني بدمج نص | استعلام بمعاملات، وتحويل بعد نجاح حقيقي |
| /catalog     | LIKE مبني بدمج نص    | LIKE بمعاملات + تهريب المخرجات |
| /member/<id> | يقرأ أي سجلّ          | يطلب مصادقة (403 بلا جلسة)   |
| /vault/…     | resolve بلا حدّ جذر   | resolve + تحقق الاحتواء      |
| /render      | render_template_string| يهرّب النص فقط               |
| /exit        | redirect للمُدخل      | يقبل المسارات النسبية فقط   |
| /admin/…     | مفتوح                | يطلب مصادقة                  |

القاعدة: الفحص على الآمن يجب أن يعطي **صفرًا مؤكد**. صفر لا «مؤشّر».
المنفذ 5005، loopback فقط.
"""
import html
import os
import sqlite3
import sys
from pathlib import Path

from flask import Flask, redirect, request, session

ROOT = Path(__file__).resolve().parent
DATA2 = ROOT / "data2"
DATA2.mkdir(exist_ok=True)
DB2 = DATA2 / "vault_safe.db"
PORT = int(os.environ.get("APP2_PORT", "5005"))

app = Flask(__name__)
app.secret_key = "safe-variant-not-a-real-secret"   # مفتاح محلي للاختبار


def db2():
    conn = sqlite3.connect(str(DB2))
    conn.row_factory = sqlite3.Row
    return conn


def init2():
    conn = db2()
    conn.execute("""CREATE TABLE IF NOT EXISTS members (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     handle TEXT UNIQUE, email TEXT, secret TEXT)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS items (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     label TEXT, note TEXT)""")
    if not conn.execute("SELECT COUNT(*) FROM members").fetchone()[0]:
        conn.executemany(
            "INSERT INTO members(handle,email,secret) VALUES(?,?,?)",
            [("ada", "ada@vault.test", "ada-private-note"),
             ("linus", "linus@vault.test", "linus-private-note"),
             ("grace", "grace@vault.test", "grace-private-note")])
    if not conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]:
        conn.executemany("INSERT INTO items(label,note) VALUES(?,?)",
                         [("widget", "a widget"), ("gadget", "a gadget"),
                          ("sprocket", "a sprocket")])
    conn.commit()
    conn.close()
    seed = DATA2 / "readme.txt"
    if not seed.exists():
        seed.write_text("vault data files\nline two\nline three\n",
                        encoding="utf-8")


def page(body, title="Vault"):
    return f"""<!doctype html><html><head><meta charset='utf-8'>
<title>{html.escape(title)}</title><script src='/static/app2.js'></script>
</head><body>
<nav><a href='/'>home</a> <a href='/catalog'>catalog</a>
<a href='/member/1'>member</a> <a href='/vault/download'>download</a>
<a href='/render'>render</a> <a href='/exit'>exit</a></nav>
{body}</body></html>"""


@app.route("/")
def home():
    return page("<h1>Vault</h1><p>internal demo (safe)</p>")


@app.route("/signin", methods=["GET", "POST"])
def signin():
    err = ""
    if request.method == "POST":
        handle = request.form.get("handle", "")
        passwd = request.form.get("passphrase", "")
        # إصلاح: استعلام بمعاملات، لا بدمج نص.
        conn = db2()
        row = conn.execute(
            "SELECT * FROM members WHERE handle=? AND secret=?",
            (handle, passwd)).fetchone()
        conn.close()
        if row:
            session["uid"] = row["id"]
            return redirect("/member/%d" % row["id"])
        err = "<p class='err'>بيانات خاطئة</p>"
    return page(f"""<h2>دخول</h2>{err}
<form method='post'><input name='handle' placeholder='اسم'>
<input name='passphrase' type='password' placeholder='كلمة'>
<button>دخول</button></form>""", "دخول")


@app.route("/catalog")
def catalog():
    q = request.args.get("term", "")
    rows = []
    if q:
        # إصلاح: معاملات + تهريب المخرجات.
        conn = db2()
        rows = conn.execute(
            "SELECT * FROM items WHERE label LIKE ?",
            (f"%{q}%",)).fetchall()
        conn.close()
    listing = "".join(
        f"<li>{html.escape(r['label'])} — {html.escape(r['note'])}</li>"
        for r in rows)
    return page(f"""<h2>الكتالوج</h2>
<form method='get'><input name='term' placeholder='ابحث'><button>بحث</button></form>
<ul>{listing}</ul>
<div class='echo'>بحثك: {html.escape(q)}</div>""", "كتالوج")


@app.route("/member/<int:mid>")
def member(mid):
    # إصلاح: لا قراءة سجلّ بلا جلسة. الفحص يقارن معرّفين، وكلاهما 403.
    if "uid" not in session:
        return page("<p>يلزم تسجيل الدخول</p>"), 403
    if session.get("uid") != mid:
        return page("<p>هذا السجلّ ليس لك</p>"), 403
    conn = db2()
    row = conn.execute("SELECT * FROM members WHERE id=?", (mid,)).fetchone()
    conn.close()
    if not row:
        return page("<p>لا يوجد</p>"), 404
    return page(f"""<h2>{html.escape(row['handle'])}</h2>
<p>بريد: {html.escape(row['email'])}</p>
<p>سرّي: {html.escape(row['secret'])}</p>""", row["handle"])


@app.route("/vault/download")
def download():
    name = request.args.get("asset", "")
    # إصلاح: تطبيع + تحقق احتواء داخل جذر المجلد المُخدَم.
    root = DATA2.resolve()
    target = (root / name).resolve()
    if root != target and root not in target.parents:
        return "مرفوض", 403
    try:
        return target.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return "لا يوجد", 404


@app.route("/render")
def render_page():
    tpl = request.args.get("tmpl", "")
    # إصلاح: تهريب كامل، بلا تصيير قالب من مُدخل المستخدم.
    return page(f"<p>{html.escape(tpl)}</p>", "render")


@app.route("/exit")
def leave():
    dest = request.args.get("handoff", "")
    # إصلاح: الوجهة النسبية فقط. لا "//host" ولا "http://".
    if dest.startswith("/") and not dest.startswith("//") and ":" not in dest:
        return redirect(dest)
    return redirect("/")


@app.route("/admin/metrics")
def admin_metrics():
    if "uid" not in session:
        return page("<p>يلزم تسجيل الدخول</p>"), 403
    conn = db2()
    n = conn.execute("SELECT COUNT(*) FROM members").fetchone()[0]
    conn.close()
    return page(f"<h2>metrics</h2><p>members: {n}</p>", "metrics")


init2()

if __name__ == "__main__":
    sys.exit(app.run(host="127.0.0.1", port=PORT, debug=False,
                     use_reloader=False))