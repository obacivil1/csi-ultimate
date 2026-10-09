"""scanner/adaptive.py — طبقة اكتشاف المسارات وربطها بالفحوص.

لماذا هذا الملف موجود
---------------------
فحوص local_scan مبنية على مسارات المختبر بالاسم: ``{base}/search?q=``،
``{base}/blog/5``، ``{base}/api/whoami``. هذا يجعلها دقيقة على المختبر
وصامدة تمامًا على أي هدف آخر: 32 من 34 فحصًا مربوطة بمسار محدد، واثنان
فقط (FRAMING، CSPWEAK) يعملان على أي هدف.

الحل هنا ليس تعديل 32 فحصًا، بل قلب الاتجاه: **نكتشف المسارات أولًا،
ثم نستهدف كل فحص بما يناسبه**. كل فحص هنا عامّ (probes) يأخذ
(مسار، معامل) من الاستكشاف بدل أن يكون مكتوبًا على مسار بعينه.

المبدأ الحاكم
-------------
الربط لا بالتخمين: كل كود فحص له مُطابق صريح (CAPABILITY) يفحص
إشاراتٍ مرصودة (اسم المسار، وجود معامل، حقول نموذج، مقطع رقمي)،
وإن لم يجد المُطابق هدفًا يُفحص، يُقال «لا وجه» صراحةً ولا يُحسب
تغطيةً. التوصية إذن من قياسٍ لا من رغبة.
"""
import re
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "recon_lab"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scanner"))

from crawler import crawl, _parse_forms  # noqa: E402
from hostguard import assert_local  # noqa: E402

# ───────────────────────────── كلمات الإشارة في المسارات ─────────────────────
#: كلمات تدل على نموذج دخول (لا نخمّن: نبحث عن أسماء حقول حقيقية)
LOGIN_FIELDS = {"username", "user", "login", "email", "userid", "user_id",
                "pass", "password", "passwd", "pwd", "account", "handle"}
#: لواحق/أسياق تُلتقط بقاعدة «يحتوي» لا بالتساوي. أسماء مثل passphrase
#: أو pwd_hash شائعة في تطبيقات لا تعرف تسميتنا، والقاعدة تلتقطها.
#: ملاحظة: هذه قاعدة لغوية على أسماء مرصودة، لا تخمين لاسم معامل.
LOGIN_HINTS = ("user", "login", "email", "account", "handle", "member", "who")
PASS_HINTS = ("pass", "pwd", "secret", "pin")
#: أسماء معاملات شائعة للبحث/التصفية
SEARCH_FIELDS = {"q", "query", "search", "term", "keyword", "s", "text",
                 "name", "filter", "find", "criteria", "title"}
#: أسماء معاملات شائعة لإعادة التوجيه
REDIRECT_FIELDS = {"next", "redirect", "redirect_to", "redirectto", "url",
                   "return", "return_to", "returnto", "dest", "destination",
                   "continue", "target", "to", "redir", "relay", "forward", "r"}
#: أسماء معاملات شائعة لملف/مسار
FILE_FIELDS = {"file", "path", "name", "doc", "document", "filename", "filepath",
               "src", "resource", "template", "page", "include", "folder", "dir"}
#: أسماء معاملات تحمل مُعرّف سجل — وجه حقن/صلاحية مباشر.
ID_LIKE_FIELDS = {"id", "uid", "userid", "user_id", "item", "itemid", "no",
                  "num", "number", "order", "post", "article", "entry",
                  "record", "row", "pid", "sid", "gid"}
#: أسماء أزرار الإرسال — مقرونة بالمعرّف تعطي النمط `?id=1&Submit=Submit`.
SUBMIT_LIKE_FIELDS = {"submit", "go", "search", "find", "view", "show",
                      "get", "send", "ok", "apply", "filter", "query",
                      "بحث", "إرسال"}
#: كلمات في المسار تدل على ملف يُنزَّل
FILE_PATH_WORDS = ("download", "file", "files", "static-view", "asset",
                   "get-file", "attachment", "media", "export")
#: كلمات في المسار تدل على قالب/عرض مُصيَّر (SSTI)
TEMPLATE_PATH_WORDS = ("preview", "render", "template", "preview-template", "view")
#: كلمات تدل على واجهة إدارية حسّاسة
ADMIN_PATH_WORDS = ("admin", "graphql", "internal", "manage", "dashboard",
                    "actuator", "debug", "config", "metrics", "api")
#: مقطع رقمي في المسار ⇒ مرشّح IDOR
NUMERIC_SEG = re.compile(r"/(\d+)(?=/|$)")


def _words(path: str):
    return {w for w in re.split(r"[^a-z0-9]+", (path or "").lower()) if w}


#: لواحق ملف حقيقي. وجود مسار بهذه اللاحقة يثبت أن التطبيق يقدّم ملفات.
FILE_EXT = (".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
            ".txt", ".json", ".map", ".xml", ".pdf", ".woff", ".woff2")


def _file_hints(cmap, routes) -> list:
    """مسارات ملفات نتحقّق فعلًا أنها تُقدَّم بنجاح.

    لماذا: بروبرات اجتياز المسار لا تعرف اسم المعامل المحترم، فتطلق
    حمولاتها على كل مرشّح فتضيع. ملف نعرفه موجود (فحص المسارات الشائعة
    أثبت أنه يردّ 200) هو مِعيار يفصل المعامل الحيّ عن المهجور:
    المحترم يُعيد 200، والمهجور 404.
    """
    hints = []
    for url in (cmap.get("probed") or []):
        p = urllib.parse.urlsplit(url).path
        if p and p.lower().endswith(FILE_EXT) and p not in hints:
            hints.append(p)
    for entry in (cmap.get("scripts") or []):
        src = entry.get("src") if isinstance(entry, dict) else entry
        p = urllib.parse.urlsplit(src or "").path
        if p and p.lower().endswith(FILE_EXT) and p not in hints:
            hints.append(p)      # سكربت مرصود = ملف موجود فعلًا
    return hints[:3]


# ───────────────────────────────── الاستكشاف ─────────────────────────────────
def _forms_on(session, url):
    """يقرأ نماذج صفحة واحدة بلا زحف. (مساعدة للجولة الثانية)"""
    try:
        st, hdrs, raw = session.get(url, timeout=6)
    except Exception:
        return []
    if st != 200:
        return []
    ctype = next((v for k, v in hdrs if k.lower() == "content-type"), "")
    if "html" not in ctype:
        return []
    return _parse_forms(raw.decode("utf-8", "replace")) or []


def _second_form_pass(session, cmap, limit=12):
    """جولة ثانية: صفحات اكتشافها فحص المسارات ولم يزحفها الزاحف.

    صفحة الدخول نادرًا ما تُربط من شريط تنقّل — يكتشفها فحص
    `/signin` الشائع، لكن الزاحف لا يقرأ نموذجها لأنها خارج عمق
    الزحف، فيضيع حقن نموذج الدخول كله بلا سبب. الجولة تقرأ هذه
    الصفحات فقط، بلا تفرّع: تكلفة صفحات محدودة وفائدة عالية.
    """
    crawled = {urllib.parse.urlsplit(p["url"]).path
               for p in (cmap.get("pages") or [])}
    out = []
    for url in (cmap.get("probed") or [])[:limit]:
        path = urllib.parse.urlsplit(url).path or "/"
        if path in crawled:
            continue
        for f in _forms_on(session, url):
            action = f.get("action") or url
            out.append({"page": url,
                        "action": urllib.parse.urljoin(url, action),
                        "method": f.get("method") or "GET",
                        "inputs": f.get("inputs") or []})
    return out


def inventory(session, base: str, max_pages: int = 25) -> dict:
    """يبني جردًا للمسارات ومعاملاتها من زحف محدود على نفس المضيف.

    يعيد {routes, forms, scripts, params_by_path}. لا يخرج المضيف أبدًا
    (crawler نفسه يقيّد netloc، وassert_local هنا طبقة أولى).
    """
    root = base.rstrip("/") + "/"
    assert_local(urllib.parse.urlparse(root).hostname or "")

    cmap = {}
    try:
        cmap = crawl(session, root, max_pages=max_pages, max_depth=2,
                     probe_common=True, workers=1)
    except Exception:
        cmap = {}

    forms_all = list(cmap.get("forms") or [])
    try:
        forms_all += _second_form_pass(session, cmap)
    except Exception:
        pass

    routes: dict[str, dict] = {}

    def slot(path: str) -> dict:
        return routes.setdefault(path, {
            "path": path, "params": set(), "fields": set(),
            "methods": set(), "status": 0, "sources": set()})

    for url in (cmap.get("endpoints") or []):
        parts = urllib.parse.urlsplit(url)
        p = parts.path or "/"
        r = slot(p)
        r["sources"].add("crawl")
        for k, _ in urllib.parse.parse_qsl(parts.query):
            if k:
                r["params"].add(k)
        # نحفظ سلسلة استعلام مرصودة كما رآها التطبيق فعلًا.
        # لماذا: كثير من صفحات PHP لا تنفّذ الاستعلام إلا إذا وُجد زر
        # إرسال (`?id=1&Submit=Submit`). حقن `id` وحده بلا `Submit`
        # لا يصل إلى SQL إطلاقًا، فيصمت الفحص على صفحة مصابة فعلًا.
        # نعيد إنتاج الطلب المرصود ثم نعدّل معاملًا واحدًا.
        if parts.query and not r.get("sample_query"):
            r["sample_query"] = parts.query

    for form in forms_all:
        action = form.get("action") or ""
        p = urllib.parse.urlsplit(action).path or "/"
        r = slot(p)
        r["sources"].add("form")
        method = str(form.get("method") or "GET").upper()
        r["methods"].add(method)
        for i in (form.get("inputs") or []):
            if i.get("name"):
                # نموذج GET حقوله معاملات استعلام لا حقول POST.
                # الخلط بينهما يجعل البروبرات ترسل POST إلى مسار لا يقبله.
                if method == "POST":
                    r["fields"].add(i["name"])
                else:
                    r["params"].add(i["name"])

    # السكربتات قواميس {"page":..,"src":..} لا نصوص. معاملتها كنص
    # كان يفشل على أي موقع فيه سكربت خارجي — أي كل موقع تقريبًا،
    # ولم يظهر إلا حين أضاف الهدف وسم <script src>.
    for entry in (cmap.get("scripts") or []):
        src = entry.get("src") if isinstance(entry, dict) else entry
        if not src:
            continue
        p = urllib.parse.urlsplit(src).path
        if p:
            slot(p)["sources"].add("script")

    out = []
    for r in routes.values():
        out.append({
            "path": r["path"],
            "params": sorted(r["params"]),
            "fields": sorted(r["fields"]),
            "methods": sorted(r["methods"]),
            "sources": sorted(r["sources"]),
            "sample_query": r.get("sample_query") or "",
        })
    out.sort(key=lambda x: x["path"])
    return {
        "routes": out,
        "scripts": cmap.get("scripts") or [],
        "pages": len(cmap.get("pages") or []),
        "robots": cmap.get("robots") or [],
        "probed": cmap.get("probed") or [],
        # ملفات نعرف أنها تُقدَّم: تُستخدم كميزان لتمييز المعامل الحيّ.
        "file_hints": _file_hints(cmap, routes),
    }


# ─────────────────────────────── مُطابق القدرات ───────────────────────────────
#: لكل كود فحص: مُطابق صريح يقرر هل لهذا المسار وجه لذلك الضعف.
#: None تعني «لا وجه» — والحقيقة المسجّلة تبقى صفرًا، لا تغطيةً وهمية.
def _is_login(r):
    """نموذج دخول: اسم مستعار + سرّ، بالاسم المرصود أو بلاحقته."""
    f = {x.lower() for x in r["fields"]}
    if not f:
        return False
    if f & LOGIN_FIELDS:
        return True
    has_user = any(any(h in name for h in LOGIN_HINTS) for name in f)
    has_pass = any(any(h in name for h in PASS_HINTS) for name in f)
    return has_user and has_pass


def _is_search(r):
    """وجه «استعلام يعيد بيانات»: بحث نصي، أو جلب سجل بمعرّف.

    النمط الثاني هو الأهم عمليًا ولا تلتقطه أسماء الحقول وحدها: صفحة
    `?id=1&Submit=Submit` — أي زر إرسال + معرّف — هي وجه حقن SQL
    الكلاسيكي عند ملايين التطبيقات، واسم المعامل فيها `id` لا يشبه
    «بحث» أبدًا. DVWA مثال: ‎`/vulnerabilities/sqli/?id=` لم يكن
    matched لأن التطابق كان بالأسماء فقط، بينما رُبطت له صفحة XSS
    لأن حقلها اسمه `name` — عكس المتوقع تمامًا.
    """
    p = {x.lower() for x in r["params"]}
    f = {x.lower() for x in r["fields"]}
    w = _words(r["path"])
    if (p | f) & SEARCH_FIELDS:
        return True
    if w & {"search", "catalog", "catalogue", "browse", "find", "list",
            "products"}:
        return True
    # معرّف + زر إرسال/مشاهدة ⇒ جلب سجل بمعرّف (وجه حقن نموذجي)
    if (p | f) & ID_LIKE_FIELDS and (p | f) & SUBMIT_LIKE_FIELDS:
        return True
    if (p | f) & ID_LIKE_FIELDS and w & {"detail", "details", "view",
                                        "item", "product", "order",
                                        "profile", "record", "post",
                                        "article", "entry", "show"}:
        return True
    return False


def _is_file(r):
    p = {x.lower() for x in r["params"]}
    f = {x.lower() for x in r["fields"]}
    w = _words(r["path"])
    return bool((p | f) & FILE_FIELDS) or bool(w & set(FILE_PATH_WORDS))


def _is_redirect(r):
    p = {x.lower() for x in r["params"]}
    f = {x.lower() for x in r["fields"]}
    w = _words(r["path"])
    return bool((p | f) & REDIRECT_FIELDS) or bool(w & {"exit", "logout", "signout", "go", "leave"})


def _is_template(r):
    return bool(_words(r["path"]) & set(TEMPLATE_PATH_WORDS))


def _is_admin(r):
    w = _words(r["path"])
    return bool(w & set(ADMIN_PATH_WORDS))


def _has_id(r):
    return bool(NUMERIC_SEG.search(r["path"]))


#: (كود الفحص، اسم المسار، شرط إضافي) — الترتيب يحدد الأولوية
CAPABILITY = [
    ("SQLLOGIN",   "نموذج دخول",   _is_login),
    ("SQLSEARCH",  "بحث/تصفية",   _is_search),
    ("XSSREFLECT", "معامل يعكس",  _is_search),
    ("SSTI",       "قالب/عرض",    _is_template),
    ("PATH",       "ملف/مسار",    _is_file),
    ("OPENREDIR",  "إعادة توجيه", _is_redirect),
    ("IDOR",       "مقطع رقمي",   _has_id),
    ("APIAUTH",    "واجهة حسّاسة", _is_admin),
]


def match_targets(inv: dict, limit_per_code: int = 4) -> dict:
    """يربط كل كود فحص بالمسارات المرصودة التي تحتمل ذلك الضعف."""
    out: dict[str, list[dict]] = {}
    for code, why, pred in CAPABILITY:
        hits = []
        for r in inv["routes"]:
            if pred(r):
                hits.append(dict(r, why=why))
            if len(hits) >= limit_per_code:
                break
        if hits:
            out[code] = hits
    return out


# ──────────────────────────────── تسجيل الدخول للزحف ─────────────────────────
#: أسماء حقول شائعة لمُدخل المرقّم (لا نفترض تسمية واحدة).
USER_PREFS = ("username", "user", "login", "email", "handle", "account",
              "id", "name")
#: أسماء حقول شائعة للسرّ.
PASS_PREFS = ("password", "passphrase", "pass", "pwd", "secret", "passwd")
#: مسارات دخول شائعة، تُجرَّب فقط إن لم يُرصد نموذج من الزحف.
LOGIN_COMMON = ("/login", "/login.php", "/signin", "/auth", "/session",
                "/دخول")
#: زر الإرسال قد لا يكون input بل زر VALUE فقط.
SUBMIT_WORDS = ("login", "submit", "signin", "دخول", "تسجيل", "log in")


def _pick(names, prefs):
    """أقرب اسم حقل مطابق للتفضيلات (أو None)."""
    low = {str(n).lower(): n for n in names}
    for p in prefs:
        for lname, orig in low.items():
            if p in lname:
                return orig
    return None


def login(session, base: str, user: str, password: str,
          path: str | None = None, inv: dict | None = None):
    """يسجّل الدخول ويُعيد (نجاح، ملاحظة) لت تمكين زحفٍ مصادَق.

    لماذا هذه الخطوة لا رفاهية: في تطبيق حقيقي، **كل** ما يستحق
    الفحص خلف تسجيل الدخول. بدونه يرى الزاحف صفحة الدخول فقط فيُصدر
    تقريرًا فارغًا ويبدو التطبيق نظيفًا — وهو أسوأ أنواع الكذب في أداة
    فحص. DVWA مثال: 6 مسارات بلا دخول، ووجه vulnerabilities كامل
    خلف `/vuln/`.

    القواعد:
      * تُستخدم قيم النموذج المحصودة (توكن CSRF) كما هي.
      * لا يُخمَّن حقل: يُختار من أسماء مرصودة.
      * النجاح يُثبَت بأن الصفحة صارت تطلب تسجيل الخروج أو لم تعد
        تعرض نموذج دخول — لا بأن POST رجع 200.
    """
    # 1) أين نموذج الدخول؟
    if not path:
        path = None
        for r in (inv or {}).get("routes") or []:
            if _is_login(r):
                path = r["path"]
                break
        if not path:
            for p in LOGIN_COMMON:
                if any(r["path"].rstrip("/") == p for r in
                       (inv or {}).get("routes") or []):
                    path = p
                    break
    if not path:
        return False, "لم يُكتشف مسار دخول؛ مرّر --login-path"

    url = base.rstrip("/") + path
    try:
        st, hdrs, raw = session.get(url, timeout=6)
    except Exception as e:
        return False, f"تعذّر فتح صفحة الدخول ({e})"
    if st != 200:
        return False, f"صفحة الدخول رجعت {st}"
    html = raw.decode("utf-8", "replace")
    try:
        from probes import _input_fields
    except Exception:
        return False, "تعذّر استخراج حقول النموذج"
    full = _input_fields(html)

    u_key = _pick(list(full), USER_PREFS)
    p_key = _pick([k for k in full if k != u_key], PASS_PREFS)
    if not u_key or not p_key:
        return False, (f"حقول غير معروفة في نموذج الدخول "
                       f"(مُدخل={u_key!r} سرّ={p_key!r})")

    fields = dict(full)
    fields[u_key] = user
    fields[p_key] = password
    # زر الإرسال قد يكون input بلا قيمة أو زر VALUE فقط.
    if not any(k.lower() in SUBMIT_WORDS
               or (isinstance(v, str) and v.strip().lower() in SUBMIT_WORDS)
               for k, v in fields.items()):
        fields["Login"] = "Login"

    try:
        st2, _h, _r = session.post(url, fields=fields, timeout=6)
    except Exception as e:
        return False, f"فشل الإرسال ({e})"

    # 3) التحقق: هل صارت الصفحة داخلية (لا تطلب دخولًا)؟
    alive, why = session_alive(session, base)
    if alive:
        return True, f"دخول ناجح إلى {path} ({why})"
    return False, f"البيانات مرفوضة على {path} ({why})"


def session_alive(session, base):
    """هل الجلسة ما زالت فعّالة؟ يُرجع (حيّ، سبب).

    لماذا لا بد من الفحص: أي زحف يتابع رابط «تسجيل خروج» يفقد الجلسة،
    وبعدها يقيس كل فحص صفحة الدخول بدل صفحة الهدف فيصمت صمتًا. حادثة
    DVWA: بعد زحف واحد بلا حارس جاءت النتيجة 0 تأكيدًا على 30 مسارًا،
    والسبب أن logout.php قُرئ فعلًا.
    """
    try:
        st, _h, raw = session.get(base.rstrip("/") + "/", timeout=6)
    except Exception as e:
        return False, f"تعذّر فحص الصفحة الرئيسية ({e})"
    home = raw.decode("utf-8", "replace")
    low = home.lower()
    if any(w in low for w in ("logout", "log out", "خروج",
                              "تسجيل خروج")):
        return True, "تسجيل خروج ظاهر"
    if any(w in low for w in ("password", "passphrase", "دخول")):
        return False, "الصفحة الرئيسية تطلب دخولًا — الجلسة انتهت"
    # صفحة خطأ أو فارغة ليست دليلًا على نجاح الدخول. pathname صحيح
    # يُثبت الدخول؛ 404 أو صفحة فارغة لا تُثبت شيئًا، والقول بأنها
    # نجاحٌ هو الكذب الذي نبني عليه فحصًا لاحقًا فيُفقد كل معناه.
    if st != 200 or len(home) < 120 or any(
            w in low[:400] for w in ("404", "not found", "forbidden",
                                    "error")):
        return False, f"لا دليل على دخول ({st}، {len(home)} بايت)"
    return True, "لا نموذج دخول في الصفحة الرئيسية"
