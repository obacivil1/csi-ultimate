"""target/app2.py — هدف بمسارات مختلفة تمامًا عن app.py.

هذا هو شريك الاختبار في طبقة الاستكشاف. لو كانت الفحوص تعمل لأنها
«تعرف» أسماء المسارات، فستنجح هنا أيضًا. وال Names هنا مخالفة عمدًا:

    /signin          (لا /login)
    /catalog          (لا /search)
    /member/<id>      (لا /profile/<id>)
    /vault/download   (لا /download)
    /render           (لا /preview)
    /exit             (لا /go)

ويحوي نفس أصناف النقص: SQLi منطقي، XSS منعكس، اجتياز مسار، SSTI،
IDOR، إعادة توجيه مفتوحة. الغرض قياس الاكتشاف لا حفظ الإجابات.

loopback فقط على المنفذ 5003.
"""
import os
import sqlite3
import sys
from pathlib import Path

from flask import Flask, redirect, request

ROOT = Path(__file__).resolve().parent
DATA2 = ROOT / "data2"
DATA2.mkdir(exist_ok=True)
DB2 = DATA2 / "vault.db"
PORT = int(os.environ.get("APP2_PORT", "5003"))

app = Flask(__name__)


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
    # نقطة التنزيل تخدم ملفات فعلًا: هذا واقع كل تطبيق فيه تنزيل،
    # ويمنح الفحص ملفًا معروفًا يقيس عليه أيّ معامل هو المحترم.
    seed = DATA2 / "readme.txt"
    if not seed.exists():
        seed.write_text("vault data files\nline two\nline three\n",
                        encoding="utf-8")


def page(body, title="Vault"):
    return f"""<!doctype html><html><head><meta charset='utf-8'>
<title>{title}</title><script src='/static/app2.js'></script></head><body>
<nav><a href='/'>home</a> <a href='/catalog'>catalog</a>
<a href='/member/1'>member</a> <a href='/vault/download'>download</a>
<a href='/render'>render</a> <a href='/exit'>exit</a></nav>
{body}</body></html>"""


@app.route("/")
def home():
    return page("<h1>Vault</h1><p>internal demo</p>")


@app.route("/signin", methods=["GET", "POST"])
def signin():
    err = ""
    if request.method == "POST":
        handle = request.form.get("handle", "")
        passwd = request.form.get("passphrase", "")
        # ضعف مقصود (SQLi): حقن منطقي في استعلام الدخول.
        conn = db2()
        try:
            row = conn.execute(
                f"SELECT * FROM members WHERE handle='{handle}' "
                f"AND secret='{passwd}'").fetchone()
        except sqlite3.Error as e:
            row = None
            err = f"<p class='err'>db: {e}</p>"
        conn.close()
        if row:
            return redirect("/member/%d" % row["id"])
        err += "<p class='err'>بيانات خاطئة</p>"
    return page(f"""<h2>دخول</h2>{err}
<form method='post'><input name='handle' placeholder='اسم'>
<input name='passphrase' type='password' placeholder='كلمة'>
<button>دخول</button></form>""", "دخول")


@app.route("/catalog")
def catalog():
    q = request.args.get("term", "")
    rows = []
    if q:
        # ضعف مقصود (SQLi): حقن في بحث الكتالوج + انعكاس خام.
        conn = db2()
        try:
            rows = conn.execute(
                f"SELECT * FROM items WHERE label LIKE '%{q}%'").fetchall()
        except sqlite3.Error:
            rows = []
        conn.close()
    listing = "".join(f"<li>{r['label']} — {r['note']}</li>" for r in rows)
    return page(f"""<h2>الكتالوج</h2>
<form method='get'><input name='term' placeholder='ابحث'><button>بحث</button></form>
<ul>{listing}</ul>
<div class='echo'>بحثك: {q}</div>""", "كتالوج")


@app.route("/member/<int:mid>")
def member(mid):
    # ضعف مقصود (IDOR): أي سجلّ يُقرأ بلا فحص ملكية.
    conn = db2()
    row = conn.execute("SELECT * FROM members WHERE id=?", (mid,)).fetchone()
    conn.close()
    if not row:
        return page("<p>لا يوجد</p>"), 404
    return page(f"""<h2>{row['handle']}</h2>
<p>بريد: {row['email']}</p><p>سرّي: {row['secret']}</p>""", row["handle"])


@app.route("/vault/download")
def download():
    name = request.args.get("asset", "")
    # ضعف مقصود (Path Traversal): اسم الملف يُدمج بلا تطبيع.
    target = (ROOT / "data2" / name).resolve()
    try:
        return target.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return "لا يوجد", 404


@app.route("/render")
def render_page():
    tpl = request.args.get("tmpl", "")
    # ضعف مقصود (SSTI): تصيير القالب من مُدخل المستخدم.
    from flask import render_template_string
    try:
        return render_template_string(f"<p>{tpl}</p>")
    except Exception:
        return "خطأ", 400


@app.route("/exit")
def leave():
    # ضعف مقصود (Open Redirect): وجهة التحويل من المُدخل بلا تحقق.
    dest = request.args.get("handoff", "")
    return redirect(dest) if dest else redirect("/")


@app.route("/admin/metrics")
def admin_metrics():
    # واجهة إدارية بلا مصادقة (مرشّح APIAUTH).
    conn = db2()
    n = conn.execute("SELECT COUNT(*) FROM members").fetchone()[0]
    conn.close()
    return page(f"<h2>metrics</h2><p>members: {n}</p>", "metrics")


init2()

if __name__ == "__main__":
    sys.exit(app.run(host="127.0.0.1", port=PORT, debug=False,
                     use_reloader=False))