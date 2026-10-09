"""
local-lab/target/app.py — منصة أعمال افتراضية احترافية (داخل جهازك فقط).
======================================================================
مضيّف: 127.0.0.1:5001 — لا يُخدم على شبكة خارجية أبدًا.
قاعدة بيانات: local-lab/data/lab.db (SQLite) — تتولد تلقائيًا عند أول تشغيل.

المنصة تحاكي موقع أعمال حقيقي (لوحة تحكم، ملفات شخصية، بحث، مقالات، رفع ملفات، API)
وتحتوي على ثغرات OWASP مقصودة للتعلم. كل ثغرة معلّمة بتعليق عربي "ضعف مقصود".

الثغرات (OWASP Top 10):
  A1 حقن SQL        -> /login  و /search (عادي + أعمى Boolean)
  A3 XSS            -> /search (منعكسة) و /settings + /profile (مخزونة)
  A1 IDOR           -> /profile/<id> بدون تحقق من صلاحية الولوج
  A1 مسار تخترق     -> /download?file=
  A1 رفع ملف خبيث   -> /upload (أي امتداد يُحفظ بلا فحص)
  A5 ضعف تحكم الوصول -> /api/me بدون مصادقة صحيحة
  A7 Command Injection -> /api/ping?host=
  A2 كلمات مرور ضعيفة/جلسات -> /login بلا rate-limit + cookie متنبأ بها
  A10 SSRF          -> /api/fetch?url= (الخادم يجلب عنك)
  A1 SSTI           -> /preview?template= (قالب من إدخالك)
  A10 Open Redirect -> /go?next= (توجيه بلا تحقق)
  A1 CSRF           -> /settings بلا رمز حماية (طلب عبر-موقعي ينجح)
   A5 ترويسات ناقصة  -> غياب CSP/X-Frame-Options عمدًا
   A4 XXE           -> POST /api/xml (كيانات خارجية تُحلّ)
   A1 LFI           -> /page?lang= (تضمين ملف بلا حصر)
   A1 تعيين جماعي   -> POST /api/profile (حقل is_admin مقبول)
   A5 CORS عاكس     -> /api/data (يعكس أي Origin مع اعتماد)
"""
import base64
import hashlib
import hmac
import json
import os
import re
import sqlite3
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

from flask import (Flask, make_response, redirect, render_template_string,
                   request, session as flask_session, url_for)

from png_util import default_logo

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR.parent / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "lab.db"

app = Flask(__name__)
app.secret_key = "intentionally-Weak-LocalLab"
app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024

# ------------------------------ قاعدة البيانات ------------------------------
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    logo = UPLOADS_DIR / "logo_current.png"
    if not logo.exists():
        logo.write_bytes(default_logo())
    conn = db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT,
            password TEXT,
            bio TEXT DEFAULT '',
            is_admin INTEGER DEFAULT 0,
            is_public INTEGER DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            title TEXT,
            content TEXT
        );
        """
    )
    if not conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
        conn.executemany(
            "INSERT INTO users(username,email,password,bio,is_admin,is_public) VALUES(?,?,?,?,?,?)",
            [
                ("admin", "admin@local.test", "Admin@123", "مدير المنصة.", 1, 1),
                ("omari", "omari@local.test", "user123", "مطور ويب.", 0, 1),
                ("rawaa", "rawaa@local.test", "user123", "منافسة مخفية.", 0, 1),
                ("privacy", "privacy@local.test", "secret123", "ملف خاص لا يظهر للعموم.", 0, 0),
            ],
        )
        conn.executemany(
            "INSERT INTO posts(user_id,title,content) VALUES(?,?,?)",
            [
                (1, "أهلا بالمنصة", "محتوى تجريبي للمقال الأول."),
                (2, "خارطة طريق المطور", "نصائح للمبتدئين في أمن الويب."),
            ],
        )
    conn.commit()
    conn.close()


# ------------------------------ أدوات مساعدة ------------------------------
LAYOUT = """
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>نِطاق — منصة الأعمال الافتراضية</title>
<style>
  body{font-family:Segoe UI,Tahoma,Arial,sans-serif;margin:0;background:#0f172a;color:#e2e8f0}
  header{background:#1e293b;padding:14px 24px;display:flex;justify-content:space-between;align-items:center}
  a{color:#38bdf8;text-decoration:none} a:hover{text-decoration:underline}
  .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin:16px 24px}
  .btn{background:#0284c7;color:#fff;border:0;padding:8px 16px;border-radius:8px;cursor:pointer}
  input,textarea{width:100%;padding:8px;margin:6px 0;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#e2e8f0}
  .muted{color:#94a3b8;font-size:13px}
  table{border-collapse:collapse;width:100%} th,td{border:1px solid #334155;padding:8px;text-align:right}
  .ok{color:#34d399}.bad{color:#f87171}
</style></head><body>
<header>
  <div><img src="/logo" alt="logo" style="height:36px;vertical-align:middle"> <b>نِطاق</b> <span class="muted">| منصة أعمال افتراضية (تعليمية)</span></div>
  <div>
    {nav}
  </div>
</header>
{body}
<script src="/static/app.js"></script>
<script src="/static/vuln.js"></script>
</body></html>
"""


def render(body: str, title: str = "", nav: str = "") -> str:
    if not nav:
        u = flask_session.get("user")
        nav = '<a href="/">الرئيسية</a> | <a href="/search">بحث</a> | <a href="/blog">مقالات</a>'
        if u:
            nav += f' | مرحبا <a href="/profile/{u["id"]}">{u["username"]}</a> | <a href="/logout">خروج</a>'
        else:
            nav += ' | <a href="/login">دخول</a> | <a href="/register">تسجيل</a>'
    return LAYOUT.replace("{nav}", nav).replace("{body}", body)


# ------------------------------ الصفحات العامة ------------------------------
@app.route("/")
def index():
    conn = db()
    posts = conn.execute("SELECT * FROM posts ORDER BY id DESC").fetchall()
    conn.close()
    rows = "".join(
        f'<div class="card"><b><a href="/blog/{p["id"]}">{p["title"]}</a></b>'
        f'<p class="muted">#{p["id"]}</p><p>{p["content"]}</p></div>'
        for p in posts
    )
    return render(
        f"<div class='card'><h1>مرحبا بك في منصة نِطاق</h1>"
        f"<p class='muted'>موقع افتراضي داخل جهازك فقط — صمم ليتعلم به المختبرون.</p></div>{rows}"
    )


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "")
        email = request.form.get("email", "")
        password = request.form.get("password", "")
        conn = db()
        try:
            conn.execute(
                "INSERT INTO users(username,email,password) VALUES(?,?,?)",
                (username, email, password),
            )
            conn.commit()
            out = redirect("/login")
        except sqlite3.IntegrityError:
            # درس هندسي: بلا rollback+close هنا يتسرب الاتصال بمعاملة
            # مفتوحة (يُمسَك عبر traceback الخيط) فيُقفل قاعدة البيانات!
            conn.rollback()
            out = render("<div class='card'>الاسم موجود مسبقا.</div>",
                         nav='<a href="/login">دخول</a>')
        finally:
            conn.close()
        return out
    return render(
        """
        <div class="card"><h2>إنشاء حساب</h2>
        <form method="post">
          <label>اسم المستخدم</label><input name="username">
          <label>البريد</label><input name="email">
          <label>كلمة المرور</label><input name="password" type="password">
          <button class="btn">تسجيل</button>
        </form></div>
        """,
        nav='<a href="/login">دخول</a>',
    )


@app.route("/login", methods=["GET", "POST"])
def login():
    # ضعف مقصود (SQLi): يُدمج الإدخال مباشرة في استعلام SQL بدون مَعلمة.
    if request.method == "POST":
        u = request.form.get("username", "")
        p = request.form.get("password", "")
        conn = db()
        try:
            row = conn.execute(
                f"SELECT * FROM users WHERE username='{u}' AND password='{p}'"
            ).fetchone()  # E.g. u = ' OR '1'='1' -- -> دخول بدون كلمة مرور
        except sqlite3.Error:
            row = None
        finally:
            conn.close()
        if row:
            flask_session["user"] = dict(row)
            return redirect("/dashboard")
        return render("<div class='card' class='bad'>بيانات الدخول خاطئة.</div>", nav='<a href="/login">دخول</a>')
    return render(
        """
        <div class="card"><h2>دخول</h2>
        <form method="post">
          <label>اسم المستخدم</label><input name="username">
          <label>كلمة المرور</label><input name="password" type="password">
          <button class="btn">دخول</button>
        </form>
        <p class="muted">جرّب: omari / user123 — أو لاحظ الاستعلام الهش.</p></div>
        """,
        nav='<a href="/register">تسجيل</a>',
    )


@app.route("/logout")
def logout():
    flask_session.clear()
    return redirect("/")


@app.route("/dashboard")
def dashboard():
    u = flask_session.get("user")
    if not u:
        return redirect("/login")
    return render(
        f"<div class='card'><h2>لوحة التحكم</h2>"
        f"<p>اسمك: <b>{u['username']}</b> — بريدك: {u['email']}</p>"
        f"<p><a href='/settings'>تحديث الملف</a> | <a href='/blog/new'>مقال جديد</a></p></div>"
    )


# ------------------------------ البحث (SQLi + XSS) ------------------------------
@app.route("/search", methods=["GET", "POST"])
def search():
    q = request.args.get("q", "")
    results_html = ""
    if q:
        # ضعف مقصود (SQLi): حقن في استعلام بحث المقالات.
        conn = db()
        try:
            rows = conn.execute(
                f"SELECT * FROM posts WHERE title LIKE '%{q}%'"
            ).fetchall()
        except sqlite3.Error:
            rows = []
        conn.close()
        if rows:
            results_html = "<ul>" + "".join(
                f"<li><a href='/blog/{r['id']}'>{r['title']}</a></li>" for r in rows
            ) + "</ul>"
        else:
            results_html = "<p class='muted'>لا نتائج.</p>"
        # ضعف مقصود (Reflected XSS): إظهار البحث بلا تحرير.
        results_html += f"<div class='card'>بحثك: {q}</div>"
        # ضعف مقصود (XSS سياق السمة): نفس الإدخال داخل value="..." بلا تحرير.
        results_html += f"<input type='hidden' name='lastq' value=\"{q}\">"
    return render(
        f"""
        <div class='card'><h2>بحث</h2>
        <form method='get'><input name='q' placeholder='كلمة البحث'><button class='btn'>بحث</button></form>
        </div>
        {results_html}
        """
    )


# ------------------ حقن عوامل NoSQL في مرشّح مستندات (محاكاة) ------------------
# ضعف مقصود (NoSQL Operator Injection): مرشّح مستندات يقبل عوامل $.
# التطبيق لا يستخدم Mongo، لكنه يبني قاموس ترشيح من المُدخل ثم يدمج
# عوامل $ne/$gt كأنها أوامر استعلام. هذا هو النمط نفسه الذي يجعل
# حقن عوامل NoSQL ممكنًا في مستودع مستندات حقيقي.
@app.route("/directory", methods=["GET", "POST"])
def directory():
    # ضعف مقصود (NoSQL Operator Injection): المُدخل يُحلَّل كـ JSON ويُدمج
    # في الترشيح بدل أن يُعامل كسلسلة نصية.
    raw = request.values.get("user", "")
    criteria = {"username": raw}
    if raw.startswith("{"):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                criteria = parsed
        except json.JSONDecodeError:
            criteria = {"username": raw}
    conn = db()
    rows = []
    for row in conn.execute(
            "SELECT username,email FROM users WHERE is_public=1"):
        # ترشيح على النمط «مستودع مستندات»: العامل يقرر قبل المطابقة.
        keep = True
        for field, want in criteria.items():
            have = row[field] if field in row.keys() else None
            if isinstance(want, dict) and "$ne" in want:
                keep = keep and (have != want["$ne"])
            elif isinstance(want, dict) and "$gt" in want:
                keep = keep and (have is not None and str(have) > str(want["$gt"]))
            elif isinstance(want, dict) and "$exists" in want:
                keep = keep and ((have is not None) == bool(want["$exists"]))
            else:
                keep = keep and (str(have) == str(want))
        if keep:
            rows.append({"username": row["username"], "email": row["email"]})
        if len(rows) >= 3:
            break
    conn.close()
    return {"criteria": criteria, "count": len(rows), "results": rows}


# ---------------------------- GraphQL: تفويض ناقص على مستوى الحقل ----------------------------
# ضعف مقصود (GraphQL): استكشاف مخطط مفتوح + غياب تفويض على مستوى الحقل.
# فحص واحد يغطّي الصنفين: الاستكشاف يكشف المخطط، وغياب التفويض على
# الحقل يحوّل الاستكشاف إلى قراءة بيانات الآخرين.
_INTROSPECTION = {"query": "{ __schema { queryType { name } } }"}
_USER_QUERY = {"query": "{ user(username:\"omari\") { username email bio } }"}


def _graphql_resolve(query: str):
    """مُحلِّل مصغّر: يكفي لاختبار التفويض على مستوى الحقل."""
    if "__schema" in query:
        return {"data": {"__schema": {
            "queryType": {"name": "Query"},
            "types": [{"name": "User"},
                      {"name": "Post"},
                      {"name": "Secret"}]}}}
    m = re.search(r'user\s*\(\s*username\s*:\s*"([^"]+)"', query)
    if m:
        # ضعف مقصود (GraphQL): يعيد سجلّ أي مستخدم بلا فحص صلاحية.
        conn = db()
        row = conn.execute(
            "SELECT username,email,bio FROM users WHERE username=?",
            (m.group(1),)).fetchone()
        conn.close()
        if row:
            return {"data": {"user": {"username": row["username"],
                                      "email": row["email"],
                                      "bio": row["bio"]}}}
        return {"data": {"user": None}}
    return {"errors": [{"message": "unsupported field"}]}


@app.route("/graphql", methods=["POST"])
def graphql():
    # ضعف مقصود (GraphQL): الاستكشاف مفتوح والحقول بلا تفويض.
    payload = request.get_json(silent=True) or {}
    query = payload.get("query", "") if isinstance(payload, dict) else ""
    if not query:
        return {"errors": [{"message": "no query"}]}, 400
    return _graphql_resolve(query)


# ------------------------------ المقالات (Stored XSS) ------------------------------
@app.route("/blog")
def blog():
    conn = db()
    rows = conn.execute("SELECT * FROM posts ORDER BY id DESC").fetchall()
    conn.close()
    cards = "".join(
        f'<div class="card"><b><a href="/blog/{r["id"]}">{r["title"]}</a></b>'
        f'<p>{r["content"]}</p></div>'
        for r in rows
    )
    return render(f"<h2 style='margin:16px'>المقالات</h2>{cards}")


@app.route("/blog/<int:pid>")
def blog_view(pid):
    conn = db()
    row = conn.execute("SELECT * FROM posts WHERE id=?", (pid,)).fetchone()
    conn.close()
    if not row:
        return render("<div class='card'>لا يوجد مقال.</div>")
    # ضعف مقصود (Stored XSS): عرض محتوى المقال بلا تحرير.
    return render(f"<div class='card'><h2>{row['title']}</h2><p>{row['content']}</p></div>")


@app.route("/blog/new", methods=["GET", "POST"])
def blog_new():
    u = flask_session.get("user")
    if not u:
        return redirect("/login")
    if request.method == "POST":
        conn = db()
        conn.execute(
            "INSERT INTO posts(user_id,title,content) VALUES(?,?,?)",
            (u["id"], request.form.get("title", ""), request.form.get("content", "")),
        )
        conn.commit()
        conn.close()
        return redirect("/blog")
    return render(
        """
        <div class="card"><h2>مقال جديد</h2>
        <form method="post">
          <label>العنوان</label><input name="title">
          <label>المحتوى</label><textarea name="content" rows="5"></textarea>
          <button class="btn">نشر</button>
        </form></div>
        """
    )


# ------------------------------ الملف الشخصي (IDOR) ------------------------------
@app.route("/profile/<int:uid>")
def profile(uid):
    conn = db()
    row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    conn.close()
    if not row:
        return render("<div class='card'>لا يوجد مستخدم.</div>")
    # ضعف مقصود (IDOR): صفحة الملف تظهر حتى لو المستخدم خاص وغير مسجل دخول.
    private = " <span class='bad'>[ملف خاص]</span>" if not row["is_public"] else ""
    return render(
        f'<div class="card"><h2>{row["username"]}{private}</h2>'
        f'<p>البريد: {row["email"]}</p><p class="muted">{row["bio"]}</p></div>'
    )


@app.route("/settings", methods=["GET", "POST"])
def settings():
    u = flask_session.get("user")
    if not u:
        return redirect("/login")
    if request.method == "POST":
        bio = request.form.get("bio", "")
        conn = db()
        conn.execute("UPDATE users SET bio=? WHERE id=?", (bio, u["id"]))
        conn.commit()
        conn.close()
        flask_session["user"]["bio"] = bio
        return redirect(f"/profile/{u['id']}")
    return render(
        """
        <div class="card"><h2>تحديث الملف</h2>
        <form method="post">
          <label>نبذة</label><textarea name="bio" rows="3"></textarea>
          <button class="btn">حفظ</button>
        </form></div>
        """
    )


# ------------------------------ تحميل الملفات (رفع خبيث) ------------------------------
@app.route("/upload", methods=["GET", "POST"])
def upload():
    if request.method == "POST":
        f = request.files.get("file")
        if not f or not f.filename:
            return render("<div class='card'>لم تختر ملفا.</div>")
        # ضعف مقصود: حفظ الاسم كما هو — أي امتداد (ws/jsp/php...) مقبول.
        name = re.sub(r"[/\\]", "_", f.filename)
        path = UPLOADS_DIR / name
        f.save(path)
        return render(
            f"<div class='card'><b>تم الرفع بنجاح</b><br>"
            f'<a href="/uploads/{name}">{name}</a> | '
            f'<a href="/static-view?file={name}">عرض مباشر</a></div>'
        )
    return render(
        """
        <div class="card"><h2>رفع ملف</h2>
        <form method="post" enctype="multipart/form-data">
          <input type="file" name="file"><br>
          <button class="btn">رفع</button>
        </form></div>
        """
    )


@app.route("/uploads/<name>")
def uploaded(name):
    p = UPLOADS_DIR / name
    if not p.exists():
        return make_response("404", 404)
    return p.read_bytes()


@app.route("/logo")
def logo():
    """يقدّم شعار المنصة الحالي من ملف — وذلك الملف نفسه قابل للاستبدال عبر /upload."""
    p = UPLOADS_DIR / "logo_current.png"
    if not p.exists():
        p.write_bytes(default_logo())
    return make_response(p.read_bytes(), 200, {"Content-Type": "image/png"})


@app.route("/static-view")
def static_view():
    # ضعف مقصود (Path Traversal): file مباشرة من إدخال المستخدم.
    name = request.args.get("file", "")
    p = (UPLOADS_DIR / name).resolve()
    if not p.exists():
        return make_response("<div class='card'>لا يوجد.</div>", 404)
    try:
        return f"<pre>{p.read_text(encoding='utf-8', errors='replace')}</pre>"
    except Exception:
        return f"<pre>[ثنائي — {p}]</pre>"


@app.route("/download")
def download():
    # ضعف مقصود (Path Traversal): يقرأ أي ملف من المسار الممرر.
    name = request.args.get("file", "")
    p = (DATA_DIR / name).resolve()
    if p.exists() and p.is_file():
        return p.read_bytes()
    return make_response("<div class='card'>لا يوجد ملف.</div>", 404)


# ------------------------------ واجهات API ------------------------------
@app.route("/api/me")
def api_me():
    # ضعف مقصود: يرجع بيانات المستخدم الأول دون تحقق من الهوية.
    conn = db()
    row = conn.execute("SELECT id,username,email FROM users ORDER BY id LIMIT 1").fetchone()
    conn.close()
    if not row:
        return {"error": "none"}
    return {"user": dict(row), "admin_area": "/api/admin"}


@app.route("/api/ping")
def api_ping():    # ضعف مقصود (Command Injection): معلمة host تُمرر لأمر shell.
    host = request.args.get("host", "127.0.0.1")
    # تقييد المضيف ليكون مثالًا آمنًا محليًا (ولمنع خروج الضعف عن اللعب).
    if not re.fullmatch(r"[\w\-.&|;() ]+", host or ""):
        return {"output": "invalid"}
    cmd = f"echo 4192 -- {host} -- end"
    try:
        out = subprocess.check_output(cmd, shell=True, text=True, timeout=3,
                                      errors="replace").strip()
    except Exception as e:
        out = f"error: {e}"
    return {"host": host, "output": out}


# ------------------------------ ثغرات المرحلة 3 (متقدمة) ------------------------------
@app.route("/api/fetch")
def api_fetch():
    # ضعف مقصود (SSRF): الخادم يجلب أي URL يمرّره المستخدم من جهته.
    url = request.args.get("url", "")
    if not url.startswith(("http://", "https://")):
        return {"error": "http(s) only"}
    try:
        with urllib.request.urlopen(url, timeout=4) as r:
            data = r.read(4096)
        return {"url": url, "length": len(data),
                "sample": data[:400].decode("utf-8", "replace")}
    except Exception as e:
        return {"url": url, "error": str(e)[:120]}


@app.route("/preview")
def preview():
    # ضعف مقصود (SSTI): قالب Jinja مباشرة من إدخال المستخدم.
    tpl = request.args.get("template", "hello")
    try:
        return render_template_string(tpl)  # E.g. ?template={{7*7}} -> 49
    except Exception as e:
        return f"template error: {e}"


@app.route("/go")
def go():
    # ضعف مقصود (Open Redirect): إعادة توجيه لأي وجهة بلا تحقق.
    nxt = request.args.get("next", "/")
    return redirect(nxt)


@app.after_request
def _cors_lab(resp):
    # ضعف مقصود (CORS): أي أصل يُقبَل على واجهات /api.
    # /api/data يعكس الأصل بنفسه — لا نطغى عليه.
    if request.path.startswith("/api/") and \
            "Access-Control-Allow-Origin" not in resp.headers:
        resp.headers["Access-Control-Allow-Origin"] = "*"
    return resp


@app.route("/reset")
def reset():    # ضعف مقصود (Host Header): رابط الاستعادة يُبنى من ترويسة Host بلا تحقق.
    email = request.args.get("email", "user@local.test")
    host = request.headers.get("Host", "127.0.0.1:5001")
    link = f"http://{host}/reset?token=LABTOKEN&email={email}"
    return render(
        f"<div class='card'><h2>استعادة كلمة المرور</h2>"
        f"<p>أُرسل رابط الاستعادة إلى {email}:</p>"
        f"<p><a href='{link}'>{link}</a></p></div>"
    )


# ------------------------------ وحدات حقل التجارب (المرحلة 10) ------------------------------
@app.route("/api/xml", methods=["POST"])
def api_xml():
    # ضعف مقصود (Request Smuggling): سيرفر التطوير يقبل طلبًا فيه
    # Content-Length وTransfer-Encoding معًا بدل رفضه (CWE-444) —
    # بِدء smuggle محتمل، والقياس في فحص FRAMING.
    # ضعف مقصود (XXE): كيانات XML خارجية تُحلّ (قراءة ملفات الخادم).
    import io
    import xml.sax
    import xml.sax.handler
    data = request.data.decode("utf-8", "replace")[:4000]

    out = []

    class _H(xml.sax.handler.ContentHandler):
        def characters(self, content):
            out.append(content)

    try:
        parser = xml.sax.make_parser()
        parser.setFeature(xml.sax.handler.feature_external_ges, True)
        parser.setContentHandler(_H())
        parser.parse(io.StringIO(data))
        return {"parsed": "".join(out)[:2000]}
    except Exception as e:
        return {"error": f"xml error: {e}"}


@app.route("/page")
def page():
    # ضعف مقصود (LFI): تضمين ملف لغات من مسار المستخدم بلا حصر.
    lang = request.args.get("lang", "ar.html")
    p = BASE_DIR / "pages" / lang
    try:
        return make_response(open(p, encoding="utf-8",
                                  errors="replace").read(),
                             200, {"Content-Type": "text/html"})
    except Exception:
        return make_response("<div class='card'>لا يوجد ملف.</div>", 404)


@app.route("/api/profile", methods=["POST"])
def api_profile():
    # ضعف مقصود (Mass Assignment): أي حقل JSON يُقبَل بما فيه is_admin.
    u = flask_session.get("user")
    if not u:
        return {"error": "login first"}, 401
    data = request.get_json(force=True, silent=True) or {}
    allowed = {"email", "bio", "is_admin"}  # الخلل: is_admin مقبول
    sets = [(k, data[k]) for k in data if k in allowed]
    if not sets:
        return {"error": "nothing to update"}, 400
    conn = db()
    try:
        conn.execute(
            f"UPDATE users SET {', '.join(f'{k}=?' for k, _ in sets)} "
            "WHERE id=?", [v for _, v in sets] + [u["id"]])
        conn.commit()
        row = conn.execute("SELECT id,username,email,is_admin FROM users "
                           "WHERE id=?", (u["id"],)).fetchone()
    finally:
        conn.close()
    return {"ok": True, "user": dict(row)}


@app.route("/api/data")
def api_data():
    # ضعف مقصود (CORS): يعكس أي Origin مع بيانات + بيانات اعتماد.
    origin = request.headers.get("Origin", "")
    resp = make_response({"note": "LAB-ONLY",
                          "for": origin or "same-origin"})
    if origin:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Credentials"] = "true"
    return resp


# ------------------------------ JWT ضعيف (مقصود) ------------------------------
JWT_SECRET = "secret123"  # ضعف مقصود: سر قصير قاموسي


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64u_dec(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


@app.route("/api/token")
def api_token():
    # ضعف مقصود مزدوج: سر ضعيف + قبول alg=none عند الإصدار.
    user = request.args.get("user", "omari")
    alg = request.args.get("alg", "HS256")
    hb = _b64u(json.dumps({"alg": alg, "typ": "JWT"}).encode())
    pb = _b64u(json.dumps({"user": user, "admin": user == "admin",
                           "exp": int(time.time()) + 3600}).encode())
    if alg == "none":
        return {"token": f"{hb}.{pb}."}
    sig = _b64u(hmac.new(JWT_SECRET.encode(), f"{hb}.{pb}".encode(),
                         hashlib.sha256).digest())
    return {"token": f"{hb}.{pb}.{sig}"}


@app.route("/api/whoami")
def api_whoami():
    # ضعف مقصود: يثق بـ alg=none ويقبل أي توقيع مطابق للسر الضعيف.
    tok = request.args.get("token", "")
    parts = tok.split(".")
    if len(parts) < 2:
        return {"error": "bad token"}, 401
    try:
        header = json.loads(_b64u_dec(parts[0]))
        payload = json.loads(_b64u_dec(parts[1]))
    except Exception:
        return {"error": "bad token"}, 401
    if header.get("alg") == "none":
        return {"user": payload.get("user"), "admin": payload.get("admin"),
                "via": "none"}
    if len(parts) == 3:
        expect = _b64u(hmac.new(JWT_SECRET.encode(),
                                f"{parts[0]}.{parts[1]}".encode(),
                                hashlib.sha256).digest())
        if hmac.compare_digest(expect, parts[2]):
            return {"user": payload.get("user"),
                    "admin": payload.get("admin"), "via": "hs256"}
    return {"error": "bad signature"}, 401


@app.route("/greet")
def greet():
    # ضعف مقصود (XSS سياق JS): الاسم داخل سلسلة جافاسكربت بلا تحرير.
    name = request.args.get("name", "زائر")
    return render(
        f"<div class='card'><h2>مرحبا {name}</h2>"
        f"<script>var who='{name}';</script></div>"
    )


@app.route("/dom")
def dom():
    # ضعف مقصود (DOM-XSS): حزمة vuln.js تحقن location.hash في innerHTML.
    # جرّب: /dom#<img src=x onerror=alert(1)>
    return render(
        "<div class='card'><h2>بحث فوري (DOM)</h2>"
        "<div id='dom-box'>اكتب بحثك بعد # في الرابط.</div></div>"
        "<script src='/static/vuln.js'></script>"
    )


@app.route("/csp-demo")
def csp_demo():    # ضعف مقصود (CSP ضعيفة): unsafe-inline يُبطل مفعول السياسة.
    x = request.args.get("x", "")
    resp = make_response(render(f"<div class='card'>معاينة: {x}</div>"))
    resp.headers["Content-Security-Policy"] = \
        "script-src 'self' 'unsafe-inline'"
    return resp


@app.route("/.well-known/security.txt")
def security_txt():
    # ممارسة ناضجة (RFC 9116): قناة تبليغ معلنة — يتحقق منها الفاحص.
    return (("Contact: mailto:security@local.test\n"
             "Expires: 2027-12-31T00:00:00Z\n"
             "Preferred-Languages: ar, en\n"),
            200, {"Content-Type": "text/plain"})


@app.route("/api/dns")
def api_dns():
    # سلوك مقصود للتدريب: يحلّل اسمًا عبر خادم DNS محلي (للتدرب على OOB).
    # في الواقع: تطبيقات تحلّل مضيفًا من إدخالك = قناة تسريب DNS.
    host = request.args.get("host", "localhost")
    if not re.fullmatch(r"[A-Za-z0-9.\-]+", host or ""):
        return {"error": "bad host"}
    try:
        import socket as _sock
        import struct as _st

        def _enc(name):
            out = b""
            for part in name.split("."):
                out += bytes([len(part)]) + part.encode()
            return out + b"\x00"

        q = _st.pack(">HHHHHH", 0x1234, 0x0100, 1, 0, 0, 0) + _enc(host) + \
            _st.pack(">HH", 1, 1)
        s = _sock.socket(_sock.AF_INET, _sock.SOCK_DGRAM)
        s.settimeout(3)
        try:
            s.sendto(q, ("127.0.0.1", 15353))
            data, _ = s.recvfrom(512)
        finally:
            s.close()
        ips = []
        try:
            _, off = _dec_name(data, 12)
            pos = off + 4
            ancount = _st.unpack(">H", data[6:8])[0]
            for _ in range(ancount):
                _, pos = _dec_name(data, pos)
                rtype, _, _, rdlen = _st.unpack(">HHIH", data[pos:pos + 10])
                pos += 10
                if rtype == 1 and rdlen == 4:
                    ips.append(".".join(str(b) for b in data[pos:pos + 4]))
                pos += rdlen
        except Exception:
            pass
        return {"host": host, "answers": ips}
    except Exception as e:
        return {"host": host, "error": str(e)[:100]}


def _dec_name(data, off):
    labels = []
    i = off
    while i < len(data):
        n = data[i]
        if n == 0:
            return ".".join(labels), i + 1
        if n & 0xC0:
            ptr = int.from_bytes(data[i:i + 2], "big") & 0x3FFF
            sub, _ = _dec_name(data, ptr)
            labels.append(sub)
            return ".".join(labels), i + 2
        labels.append(data[i + 1:i + 1 + n].decode("latin-1"))
        i += 1 + n
    return ".".join(labels), i


@app.errorhandler(404)
def e404(_):
    return make_response("<div class='card'>404 — غير موجود.</div>", 404)


if __name__ == "__main__":
    init_db()
    # threaded=True إلزامي: فحص SSRF يجعل الخادم يطلب نفسه (طلب داخل طلب).
    app.run(host="127.0.0.1", port=5001, debug=False, threaded=True)