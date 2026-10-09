"""scanner/probes.py — فحوص عامة تُوجَّه بمسارات مرصودة لا بمسارات مكتوبة.

كل دالة هنا تأخذ (مسار، معامل) من adaptive.inventory وتختبر صنف ثغرة
على أي تطبيق يحوي ذلك الوجه. لا شيء هنا يعرف «مختبرنا».

قاعدة الإبلاغ: ما لا يُثبت بصمت لا يُحسب. لكل بروبرات ثلاث حالات —
مؤكد (verdict)، مؤشّر (لا يُحتسب تغطية)، ولا وجه (لا يُفحص أصلًا).
"""
import html
import re
import urllib.parse

# نقرأ الثوابت من مفاتيح الاختبار بدل تكرارها
try:
    from engine_payloads import BOOLEAN_PAIRS  # type: ignore
except Exception:                                   # pragma: no cover
    BOOLEAN_PAIRS = [
        ("' OR 1=1 -- ", "' AND 1=2 -- "),
        ("%' OR 1=1 -- ", "%' AND 1=2 -- "),
        ("' OR 1=1#", "' AND 1=2#"),
    ]

SQL_SIGNS = ("sql syntax", "mysql", "ora-", "sqlite", "psycopg2", "pg_query",
             "odbc", "jdbc", "adodb", "unterminated", "quoted string",
             "sqlstate", "conversion failed", "warning: mysqli",
             "operationalerror", "syntax error", "near ", "query failed")

CANARY = "ADAPT7Q"
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def _hdrs_map(hdrs):
    """يحوّل ترويسات استجابة إلى قاموس قابل للقراءة.

    الاستجابات لا تأتي دائماً بالشكل نفسه: `getheaders()` قائمة
    أزواج، ورسائل الأخطاء قد تُعيد `headers.items()`، وقد تحوي أزواجًا
    ناقصة. كسرُ الفحص بسبب شكل ترويسة يُسقط الفحص بصمت — وهذا أسوأ
    من الفحص الفاشل، لأنه يبدو «لا يوجد ثغرة».
    """
    out = {}
    try:
        items = hdrs.items() if hasattr(hdrs, "items") else (hdrs or [])
    except Exception:
        return {}
    for item in items:
        try:
            k, v = item
        except Exception:
            continue
        if k is not None:
            out[str(k).lower()] = v
    return out


def _text(resp):
    st, hdrs, raw = resp
    try:
        body = raw.decode("utf-8", "replace")
    except Exception:
        body = ""
    return st, body, _hdrs_map(hdrs)


def _send_nofollow(s, base, r, key, value, form=None, extra=None):
    """يرسل الطلب ولا يتبع التحويل — فنرى الوجهة كما قرّرها الخادم.

    السبب: الجلسة الاعتيادية تتبع التحويل، فيتحوّل 302 إلى 200 ونفقد
    الدليل الوحيد الذي يثبت التجاوز. ويتبع التحويل غالبًا أن يقيّم
    وجهة خارجية — وهو ما نتحقق من خطورته، فلا نتبعه.
    """
    from local_scan import fetch_no_follow
    url = _build_url(base, r["path"], key, value,
                     _companions(r, key) if form else None)
    data = None
    headers = {}
    if form:
        fields, _user = _harvest_form(s, base, r)
        fields = dict(fields)
        fields.update(extra or {})
        fields[key] = value
        data = urllib.parse.urlencode(fields).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif r.get("methods") and "GET" not in {str(m).upper()
                                            for m in r["methods"]}:
        data = urllib.parse.urlencode({key: value}).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    return _text(fetch_no_follow(s, url, data=data or None,
                                 headers=headers or None))


def _build_url(base, path, key, value, companions=None):
    params = dict(companions or {})
    params[key] = value
    sep = "&" if "?" in path else "?"
    return base.rstrip("/") + path + sep + urllib.parse.urlencode(params)


def _location(headers):
    for k, v in (headers or {}).items():
        if k.lower() == "location":
            return v
    return ""


#: قائمة تخمين صغيرة لكل صنف — تُجرَّب بعد المعامل المرصود فقط.
#: سببonicsالحدّ: كل تخمين طلبان على الأقل، والهدف مُقيّد بمعدل.
GUESS_PARAMS = {
    "sql": ["q", "query", "search", "term", "name", "user", "username",
            "email", "handle", "id", "title", "keyword", "s"],
    "file": ["file", "name", "path", "asset", "doc", "src", "filename",
             "template", "include", "page", "dir", "folder", "resource"],
    "redirect": ["next", "redirect", "url", "returnurl", "return_url",
                 "returnto", "return_to", "dest", "destination", "target",
                 "to", "continue", "redir", "relay", "goto", "out", "u",
                 "handoff", "handoff_url", "back", "goto_url", "r", "gurl"],
    "template": ["template", "tmpl", "tpl", "q", "name", "text", "content",
                 "expr", "expression", "page", "view", "snippet"],
    "xss": ["q", "query", "search", "term", "name", "msg", "message",
            "title", "text", "comment", "keyword"],
}

#: حدّ أعلى لإجمالي المرشّحات. الصنف الرخيص (إعادة توجيه) يستخدمه كاملًا،
#: والأصناف المكلفة (SQL/ملفات) تقطعها بسقوفها الأضيق.
MAX_GUESS = 14


def _observed(r, prefs):
    """المعامل المرصود لهذا المسار (تفضيل المميّز)."""
    params = [p for p in r.get("params") or []]
    fields = [f for f in r.get("fields") or []]
    for pool, kind in ((params, "param"), (fields, "field")):
        for want in prefs:
            for got in pool:
                if got.lower() == want:
                    return got, kind
    for pool, kind in ((params, "param"), (fields, "field")):
        if pool:
            return pool[0], kind
    return None, None


def _candidates(r, prefs, kind):
    """المعاملات المرشّحة للتجربة: المرصود أولًا ثم التخمين.

    kind == "field" يعني إرسال POST form (الحقول في نموذج)،
    و"param" يعني GET query.

    الترتيب يحترم prefs قبل قائمة التخمين: لو فضّل الفحص «asset» فلا
    يجوز أن تأتي بعد «file» و«name» و«path» فقط لأن ترتيب القائمة
    العام حُذف تحتها ضمن السقف.
    """
    seen = []

    def add(name):
        if name and name not in seen and len(seen) < MAX_GUESS:
            seen.append(name)

    obs, obs_kind = _observed(r, prefs)
    if obs and obs_kind == kind:
        add(obs)
    for want in prefs:
        add(want)
    for guess in GUESS_PARAMS[kind]:
        add(guess)
    return seen


def _is_form_post(r):
    """هل المسار يستقبل POST؟

    لا يكفي وجود «حقول»: حقول نموذج GET تبقى في params لا fields.
    الخلط كان يُرسل POST إلى مسار لا يقبله فيردّ 405 ويموت الفحص صامتًا.
    """
    return "POST" in {str(m).upper() for m in (r.get("methods") or [])}


#: حقول قيمها لا معنى لها في المقارنة: توكن CSRF، nonce، معرّف جلسة.
VOLATILE_FIELD_RE = re.compile(
    r'(?i)(user[_-]?token|csrf[_-]?token|_?csrf|authenticity[_-]?token|'
    r'nonce|_token|xsrf|state)')

#: قيم عالية العشوائية تُحيَّد حتى لو كانت في سمة غير مسمّاة.
HASH_RE = re.compile(
    r'(?i)\b(?:[0-9a-f]{24,}|[A-Za-z0-9+/]{28,}={0,2}|'
    r'[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9:.+Z-]{6,}|[0-9]{10,})\b')


def _redact(body, *needles):
    """يُخفي القيم المتغيّرة بين طلبين ثم يُسقط الحمولة.

    لماذا هذا بُعدي: توكن CSRF يتغيّر في كل طلب، فكل ردّين «مختلفان»
    حتى بلا حقن. أي فحص يحكم على الفرق — دون تحييد — يُطلق على كل
    نموذج دخول فيه CSRF (DVWA وDjango وRails وLaravel)، وعلى كل رابط
    يحمل توكنًا. الفرق لا بد أن يُحسب على أساس ثابت.
    """
    out = body or ""
    # 1) قيم حقول مسمّاة volatile داخل وسم input
    def _blank(m):
        return re.sub(r"(value\s*=\s*['\"])[^'\"]*",
                      lambda mm: mm.group(1) + "__VOLATILE__", m.group(0))

    for m in re.finditer(r'(?is)<input[^>]*>', out):
        if VOLATILE_FIELD_RE.search(m.group(0)):
            out = out.replace(m.group(0), _blank(m))
    # 2) قيم volatile في سلسلة الاستعلام
    #
    # النمط يُبنى هنا لا داخل الاستدعاء، وبلا راية مضمّنة: لو ضُمن
    # `(?i)` بعد `(?:` رفع Python استثناء `global flags not at the
    # start`، وكان يُسقط **كل** حكم SQLi/XSS على أي صفحة تعكس
    # توكنًا في رابطها — بصمت. تحييد قيمة تحسينٌ؛ أن يفشل يجب ألّا
    # يُسقط الفحص، ولهذا كلّ خطوة هنا محصونة.
    try:
        out = _VOLATILE_QUERY_RE.sub(r"\1__VOLATILE__", out)
    except Exception:
        pass
    # 3) معرّفات جلسة في الكوكيز والروابط
    out = re.sub(r'(?i)\b(PHPSESSID|JSESSIONID|csrftoken|sessionid)='
                 r'[A-Za-z0-9._%-]+', r'\1=__VOLATILE__', out)
    # 4) قيم عشوائية طويلة بالشكل لا بالاسم
    try:
        out = HASH_RE.sub("__HASH__", out)
    except Exception:
        pass
    # 5) أخيرًا: إسقاط الحمولة بكل صيغها
    return _strip(out, *needles)


#: قيم volatile داخل سلسلة استعلام — يُبنى مرة واحدة عند الاستيراد،
#: بلا راية `(?i)` مضمّنة (انظر `_redact` لتفصيل الكارثة).
_VOLATILE_QUERY_RE = re.compile(
    r"([?&](?:" + re.sub(r"\(\?i\)", "", VOLATILE_FIELD_RE.pattern) +
    r")=)[^&#'\"\s]+", re.IGNORECASE)


def _input_fields(html_text, user_only=False):
    """يستخرج حقول النموذج من HTML: الاسم والقيمة الحالية.

    لماذا القيم الحالية تحديدًا: أغلب نماذج الدخول الحديثة تحمل
    توكن CSRF يُولَّد لكل صفحة ويُتحقَّق منه عند الإرسال. إرسال النموذج
    بلا التوكن = رفضٌ تام، فينجح الحقن ولا يُرى — أي أن الفحص يُسكت
    على كل تطبيق محميّ بـCSRF (DVWA وDjango وRails وLaravel معًا).

    user_only: يرجع حقول الإدخال البشري فقط (نص/كلمة مرور/textarea)،
    ويُسقط المخفية وأزرار الإرسال. هذا ما يملأه الفحص بقيمة حميدة؛
    فملء حقل مخفي بـ«x7x» يهدم توكن CSRF ويقتل الحقن بصمت.
    """
    from html.parser import HTMLParser

    class P(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.fields = {}

        def handle_starttag(self, tag, attrs):
            if tag not in ("input", "textarea", "select"):
                return
            a = {k.lower(): (v or "") for k, v in attrs}
            name = a.get("name")
            if not name:
                return
            typ = (a.get("type") or
                   ("text" if tag == "input" else tag)).lower()
            if user_only:
                if typ not in ("text", "password", "email", "search",
                               "tel", "number", "url", "textarea", "select"):
                    return
                if VOLATILE_FIELD_RE.search(name):
                    return
            if typ in ("checkbox", "radio") and "checked" not in a:
                return
            self.fields.setdefault(name, a.get("value", ""))

    p = P()
    try:
        p.feed(html_text or "")
    except Exception:
        pass
    return p.fields


#: ذاكرة مؤقتة للنموذج لكل (جلسة، مسار). تُملأ مرة واحدة ثم تُعاد.
_FORM_CACHE: dict = {}


def _harvest_form(s, base, r):
    """GET لصفحة النموذج ثم استخراج حقوله بقيمها السليمة (مع تخزين مؤقت).

    يبني قاموسين: كامل (للإرسال) و«إنساني» (للتعبئة الحميدة فقط).
    """
    ck = (id(s), r["path"])
    if ck in _FORM_CACHE:
        return _FORM_CACHE[ck]
    full, user = {}, {}
    try:
        st, body, _ = _text(s.get(f"{base}{r['path']}", timeout=6))
        if st == 200:
            full = _input_fields(body)
            user = _input_fields(body, user_only=True)
    except Exception:
        full, user = {}, {}
    _FORM_CACHE[ck] = (full, user)
    return full, user


def _benign_fields(s, base, r, key):
    """قيم حميدة لكل حقول الإدخال البشري ما عدا المعامل المحقون.

    لا نلمس الحقول المخفية ولا أزرار الإرسال: هي جزء من آلية الحماية
    لا من بيانات المستخدم، وتغييرها يهدم توكن CSRF.
    """
    try:
        _full, user = _harvest_form(s, base, r)
    except Exception:
        user = {}
    return {f: "x7x" for f in user
            if not key or f.lower() != str(key).lower()}


#: أسماء معاملات لأزرار الإرسال. زر HTML لا يظهر في العنوان، لكن
#: التطبيق غالبًا لا ينفّذ شيئًا إلا به: `?id=1` بلا `Submit` لا يصل
#: إلى الاستعلام إطلاقًا (DVWA low). القيمة الافتراضية للزر هي اسمه.
SUBMIT_NAMES = {"submit", "go", "search", "find", "view", "show", "get",
                "send", "ok", "apply", "filter", "query", "login", "signin",
                "signup", "register", "btnsubmit", "dologin"}


def _companions(r, key):
    """معاملات مرافقة من السلسلة المرصودة، بلا المعامل المحقون.

    لماذا: صفحة `?id=1&Submit=Submit` لا تنفّذ الاستعلام إلا بوجود
    `Submit`. حقن `id` وحده لا يصل إلى قاعدة البيانات، فيسكت الفحص
    على صفحة مصابة تمامًا (سلوك DVWA low). نُعيد إنتاج الطلب الذي
    رآه التطبيق فعلًا ثم نغيّر معاملًا واحدًا.

   إذا لم تتوفّر سلسلة مرصودة، نضيف أزرار الإرسال المرصودة بقيمة اسمها
    (الافتراضي في HTML). بدونها: صمت على صفحة مصابة.
    """
    q = dict(urllib.parse.parse_qsl(r.get("sample_query") or ""))
    q.pop(str(key), None)
    if not q:
        for p in (r.get("params") or ()):
            if str(p).lower() in SUBMIT_NAMES:
                q[str(p)] = str(p)
    return q


def _send(s, base, r, key, value, form=None, extra=None):
    """يرسل الطلب بالطريقة المناسبة: form POST إن كان النموذج_requires.

    في حالة النموذج تُحصد قيم الحقول المخفية أولًا (توكن CSRF غالبًا)
    ثم تُدمج مع extra ثم تُحقن القيمة. الترتيب مقصود: المحصود يملأ
    ما لا يعرفه الفحص، وextra يملأ ما يعرفه بقيم حميدة، والحقنة
    تتقدّم على الاثنين.

    extra: بقية حقول النموذج بقيمة حميدة — لازم لحقن الدخول، فالتطبيق
    يختبر اسمًا وسرًّا معًا، وحقل ناقص يُبقي الاستعلام «غير محقون».
    """
    if form is None:
        form = _is_form_post(r)
    if form:
        data, _user = _harvest_form(s, base, r)
        data = dict(data)
        data.update(_companions(r, key))
        data.update(extra or {})
        data[key] = value
        return s.post(f"{base}{r['path']}", fields=data, timeout=6)
    params = _companions(r, key)
    params[key] = value
    if extra:
        params.update(extra)
    url = f"{base}{r['path']}?" + urllib.parse.urlencode(params)
    return s.get(url, timeout=6)


def _url(base, path, key=None, value=None, method="GET"):
    q = urllib.parse.urlencode({key: value}) if key else ""
    return f"{base}{path}" + (f"?{q}" if q else "")


def _strip(body, *needles):
    """يزيل الحمولة من الردّ قبل المقارنة.

    بلا هذه الخطوة يكون الفارق بين TRUE وFALSE مجرد انعكاس الحمولة
    (كلاهما يعكسها)، فيُقرأ كحقن وهي ليست كذلك — أو يُقرأ خطأً.

    نزيل أيضًا الصيغة المُرمَّزة (html.escape) لا الخام فقط: الهدف
    الآمن الذي يهرّب المخرجات يجعل الردّ مختلفًا نصًّا لا معنى،
    فيُنتج إنذارًا كاذبًا على تطبيق صحيح تمامًا.
    """
    out = body
    for needle in needles:
        if not needle:
            continue
        for variant in _variants(needle):
            out = out.replace(variant, "")
    return out


def _variants(needle):
    """صيغ الحمولة الممكنة في الردّ.

    فخّ حقيقي: مكتبة الإخراج تهرّب الاقتباس المفرد إلى `&#x27;`، وأخرى
    إلى `&#39;`. ومن دون الصيغتين لا يُزال الانعكاس من bodies
    فيبقى فرقٌ شكلي بين TRUE وFALSE = **إنذار كاذب على تطبيق آمن**.
    """
    seen = [needle]
    for quote in (True, False):
        try:
            seen.append(html.escape(needle, quote=quote))
        except Exception:
            pass
    seen.append(needle.replace("'", "&#39;").replace('"', "&quot;"))
    try:
        dec = urllib.parse.unquote(needle)
        if dec != needle:
            seen += [dec, html.escape(dec), dec.replace("'", "&#39;")]
    except Exception:
        pass
    out = []
    for v in seen:
        if v and v not in out:
            out.append(v)
    return out


def _sql_error(body):
    low = body.lower()
    return next((s for s in SQL_SIGNS if s in low), None)


def _looks_like_file(body):
    if "<html" in body.lower() or "<div" in body.lower():
        return False
    lines = [l for l in body.splitlines() if l.strip()]
    return len(lines) >= 2


# ─────────────────────────────── SQLi منطقي ───────────────────────────────────
def _is_login_route(r):
    """نستعير مُطابق «الدخول» من طبقة القدرات بدل تكراره هنا.

    تكرار القاعدة في مكانين يعني انحرافًا صامتًا بينهما عند أول تعديل.
    """
    try:
        from adaptive import _is_login
        return bool(_is_login(r))
    except Exception:
        f = {x.lower() for x in (r.get("fields") or [])}
        return bool(f) and any("pass" in x for x in f)


#: كلمة تدل على «دخلتَ» في ردّ Successful: تحويل، أو محتوى خاص.
PRIVATE_HINTS = ("member", "profile", "account", "dashboard", "secret",
                 "logged", "welcome", "panel", "بيانات", "سري")


#: علامات تطبيق حجب الفحص. الخطر ليس «لم نجد ثغرة» بل «الخادم
#: قرّر أن يوقفنا» — ردّان متطابقان عند كل الحقن يعني الحجب لا
#: الأمان. DVWA: بعد عدة حقن في الجلسة نفسها يردّ بـ«Hacking
#: attempt detected» ثم يصمت الفحص ويبدو التطبيق آمنًا.
BLOCK_MARKERS = ("hacking attempt", "have a nice day", "attack detected",
                 "request blocked", "you have been blocked", "blocked by",
                 "temporarily blocked", "too many requests",
                 "rate limit", "rate-limit", "captcha required",
                 "suspicious activity", "account suspended",
                 "ip has been banned", "forbidden by security")


def _blocked(body) -> bool:
    """هل التطبيق يردّ بصفحة حجب/حظر بدل ردّه الحقيقي؟"""
    low = (body or "").lower()
    return any(m in low for m in BLOCK_MARKERS)


#: الردّان «متماثلان» إن تقاطع أسطرهما ≥ هذا (الأسطر هي وحدة
#: المعنى: صفحات النتائج تتطابق بنصًا وتختلف بأسطر البيانات)
SAME = 0.995
#: تشابه بصمة الاختلاف بين زوجين: نفس الفارق يتكرّر ⇒ سلوك حقيقي
SIG = 0.7


def _lines(b):
    return {ln.strip() for ln in (b or "").splitlines() if ln.strip()}


def _jac(A, B):
    """تقاطع مجموعتَي أسطر على جAccard — لا كلفة Edit-distance."""
    if not A and not B:
        return 1.0
    return len(A & B) / float(len(A | B) or 1)


def _jaccard(a, b):
    return _jac(_lines(a), _lines(b))


def _consistent(trues, falses):
    """هل يدلّ شكل الفروق على سلوك حقيقي أم على ضجيج؟

    الفارق المطلق بين T وF غير موثوق: صفحة نتائج فيها 100 سطر قالب
    وسطران بيانات differs Jaccard≈0.96 أي «يشبهان»، بينما الاختلاف
    الحقيقي هناك. فالموثوق ليس مقدار الفرق، بل **تكراره** بنفس
    الشكل عبر أزواج مستقلة:

      * بصمة الاختلاف: الأسطر الحاضرة في T وغير الحاضرة في F ( والعكس)
        يجب أن تتكرر في كل زوج تالٍ. تكرار البصمة لا تفسره صدفة.
      * وبصمة فارغة ⇐ لا فرق ⇐ لا تأكيد (هذا ما يمنع الإنذار
        الكاذب على تطبيق آمن يحقن حمولاتنا بلا أثر).

    فرق واحد منفرد قد ينتج عن توكن متجدّد أو طابع زمني؛ ثلاثة أزواج
    متسقة البصمة تعني سلوكًا حقيقيًا.
    """
    if len(trues) < 2 or len(falses) < 2:
        return False
    sig_t = _lines(trues[0]) - _lines(falses[0])
    sig_f = _lines(falses[0]) - _lines(trues[0])
    # لا فرق في أي جانب ⇐ لا تأكيد (وهو ما يمنع الإنذار الكاذب على
    # تطبيق آمن يحقن حمولاتنا بلا أثر).
    if not sig_t and not sig_f:
        return False
    # بصمة من جانب واحد كافية: استعلام يُرجع صفوفًا يجعل «الحقيقة»
    # أغنى من «الكذب»، فيبقى جانب الكذب القالب المشترك بلا سطر خاص.
    for t, f in list(zip(trues, falses))[1:]:
        ut = _lines(t) - _lines(f)
        uf = _lines(f) - _lines(t)
        if sig_t:
            if not ut or _jac(sig_t, ut) < SIG:
                return False
        if sig_f:
            if not uf or _jac(sig_f, uf) < SIG:
                return False
    return True


def probe_sqli(s, base, r, hints=None):
    """حقن منطقي. وضعان لأن إشارة النجاح فيهما مختلفة:

    * بحث/عرض: الردّان 200، والفرق في **المحتوى** بعد إسقاط الحمولة.
    * دخول:    النجاح = **تحويل إلى صفحة خاصة**، لأن استعلامًا
      `WHERE handle=… OR 1=1` يُرجع صفًّا فيحوّل التطبيق صاحبه.
      لذلك اشتراط 200 كان يقتل SQLLOGIN بصمت: الحقن صحيح، والخطأ
      في معيار الحكم.
    """
    login_like = _is_login_route(r)
    code = "SQLLOGIN" if login_like else "SQLSEARCH"
    form = _is_form_post(r)
    prefs = ("q", "query", "search", "term", "name", "user",
             "username", "email", "title", "handle", "login", "account",
             "id", "uid", "no", "num", "item")
    keys = _candidates(r, prefs, "sql")
    if not _observed(r, prefs)[0]:
        keys = keys[:GUESS_CAP + 2]

    for key in keys:
        extra = (_benign_fields(s, base, r, key) if login_like else None)

        # خط الأساس: بلا أي حقن. بدونه لا يمكن معرفة إن كان الفرق
        # سببه الحقن أم حالة التطبيق أصلًا. DVWA قبل تهيئة قاعدة
        # بياناته يسرّب «mysql» في صفحة الدخول لكل طلب — فبلا خط أساس
        # يُنسب تسريب معلومات إلى الحقن، ويُمنح إنذارًا كاذبًا باسمه.
        try:
            _, b_base, _ = _text(_send(s, base, r, key, CANARY, form, extra))
        except Exception:
            continue
        err_base = _sql_error(b_base)
        # حجب الفحص: إن كان التطبيق يردّ بصفحة حظر **بلا حقن** فالنتيجة
        # اللاحقة بلا قيمة، والقول «لا حقن» كذبٌ freckles. نقولها
        # صراحةً: حجب. DVWA يردّ «Hacking attempt detected» بعد عدة
        # محاولات في الجلسة نفسها.
        if _blocked(b_base):
            return {"code": code, "route": r["path"], "param": key,
                    "verdict": False, "strength": "محجوب",
                    "blocked": True,
                    "note": ("التطبيق حجب الفحص (صفحة حظر حتى بلا حقن) — "
                             "الحقيقة غير موثوقة، لا تعني أمانًا"),
                    "evidence": f"{key}=<بلا حقن>"}
        leak = None
        true_sides, false_sides = [], []

        for true_p, false_p in BOOLEAN_PAIRS:
            value_t = CANARY + true_p
            value_f = CANARY + false_p
            try:
                st1, b1, h1 = _text(_send(s, base, r, key, value_t, form,
                                         extra))
                st2, b2, h2 = _text(_send(s, base, r, key, value_f, form,
                                         extra))
            except Exception:
                continue

            err = _sql_error(b2) or _sql_error(b1)
            # خطأ **جديد** يظهر مع الحقن فقط ⇒ دليل مباشر.
            if err and err != err_base:
                return {"code": code, "route": r["path"], "param": key,
                        "verdict": True, "strength": "مؤكد",
                        "note": f"رسالة خطأ SQL مكشوفة في الاستجابة ({err})",
                        "evidence": f"{key}={value_f}"}
            # الخطأ موجود بلا حقن ⇒ تسريب معلومات لا حقن. لا نحكم الآن:
            # قد يثبته الفحص السلوكي، والحكم المبكّر يُسقط حقيقيًا.
            if err_base and not err and leak is None:
                leak = {"code": code, "route": r["path"], "param": key,
                        "verdict": False, "strength": "غير مؤكد",
                        "note": ("رسالة خطأ SQL تظهر في الردّ حتى بلا حقن "
                                 f"({err_base}) — تسريب معلومات لا حقن"),
                        "evidence": f"{key}=<بلا حقن>"}
            # خطأ مطابق لخط الأساس ⇒ لا معلومة. **لا نخرج**: الخروج كان
            # يقتل الفحص السلوكي كليًا في أي صفحة تعرض شيفرة استعلامها
            # (DVWA تعرض مصدر PHP فيه «mysqli» دائمًا).

            if login_like:
                # إثبات التجاوز: الخادم يحوّلني **بعيدًا عن صفحة الدخول**.
                # هذا تعريف التجاوز، ولا يحتاج استنتاجًا من الفروق.
                #
                # الاعتماد على اختلاف الردود خطأ شائع وخطير: توكن CSRF
                # يتجدّد كل طلب في DVWA وDjango وRails، فيبدو كل ردّين
                # مختلفين ويُطلق الفحص على أي معامل — حتى المهجول منها.
                # التحويل إشارة صريحة لا لبس فيها.
                loc_t = _location(_send_nofollow(
                    s, base, r, key, value_t, form, extra)[2])
                try:
                    loc_f = _location(_send_nofollow(
                        s, base, r, key, value_f, form, extra)[2])
                    loc_0 = _location(_send_nofollow(
                        s, base, r, key, CANARY, form, extra)[2])
                except Exception:
                    continue

                def _lands_elsewhere(loc):
                    """تحويل إلى مسار غير صفحة الدخول نفسها."""
                    if not loc:
                        return False
                    p = urllib.parse.urlsplit(loc).path or "/"
                    here = r["path"].rstrip("/") or "/"
                    return p.rstrip("/") != here

                if _lands_elsewhere(loc_t) and not _lands_elsewhere(loc_f) \
                        and not _lands_elsewhere(loc_0):
                    return {"code": code, "route": r["path"], "param": key,
                            "verdict": True, "strength": "مؤكد",
                            "note": ("تجاوز مصادقة: الحقن المنطقي وحده يحوّل "
                                     "الخادم بعيدًا عن صفحة الدخول، والكاذب "
                                     "والحميد يعودان إليها"),
                            "evidence": f"{key}=T→{loc_t} F→{loc_f or 'stay'}"}
                continue

            if st1 != 200 or st2 != 200:
                continue
            clean_t = _redact(b1, value_t, true_p, CANARY)
            clean_f = _redact(b2, value_f, false_p, CANARY)
            if _jaccard(clean_t, clean_f) >= SAME:
                continue                      # لا فرق:Conditions غير مفعّلة
            true_sides.append(clean_t)
            false_sides.append(clean_f)
            # اثنان متكافئان على كل جانب، ومختلفان بينهما ⇒ سلوك حقيقي.
            # فرق واحد وحده قد يكون تمويعة CSRF أو طابعًا زمنيًا؛ ثلاثة
            # أزواج متسقة الاتجاه لا تُفسّرها صدفة.
            if _consistent(true_sides, false_sides):
                return {"code": code, "route": r["path"], "param": key,
                        "verdict": True, "strength": "مؤكد",
                        "note": ("حقن منطقي مؤكد: %d أزواج متسقة — مخرجات "
                                 "الحقيقة تشبه بعضها وتختلف عن مخرجات "
                                 "الكذب بعد إسقاط الحمولة والقيم المتغيّرة"
                                 % len(true_sides)),
                        "evidence": (f"{key}={value_t!r} vs {value_f!r}")}

        # لا تأكيد سلوكي: يبقى تسريب المعلومات إن وُجد، غير محسوب حقنًا.
        if leak is not None:
            return leak
    return None


# ──────────────────────────── XSS منعكس بسياقه ───────────────────────────────
def probe_xss(s, base, r, hints=None):
    marker = "<b>ADAPT7X</b>"
    form = _is_form_post(r)
    prefs = ("q", "query", "search", "term", "name", "title", "msg")
    keys = _candidates(r, prefs, "xss")
    if not _observed(r, prefs)[0]:
        keys = keys[:GUESS_CAP]
    for key in keys:
        try:
            st, body, _ = _text(_send(s, base, r, key, marker, form))
        except Exception:
            continue
        if st == 200 and marker in body:
            break
    else:
        return None
    if "&lt;b&gt;" in body or "&amp;lt;" in body:
        return {"code": "XSSREFLECT", "route": r["path"], "param": key,
                "verdict": False, "strength": "غير مؤكد",
                "note": "المُدخل ينعكس مُرمَّزًا — لا حقن",
                "evidence": f"{key}={marker}"}
    ctx = "Reflected XSS"
    if re.search(r"<script[^>]*>[^<]*" + re.escape(CANARY[:2]), body, re.I):
        ctx = "XSS في سياق JS"
    elif re.search(r"=\s*[\"']?[^\"'>\n]*" + re.escape("<b>ADAPT7X"), body, re.I):
        ctx = "XSS في سياق السمة"
    code = {"XSS في سياق JS": "XSSJS", "XSS في سياق السمة": "XSSATTR"}.get(ctx, "XSSREFLECT")
    return {"code": code, "route": r["path"], "param": key, "verdict": True,
            "strength": "مؤكد", "note": f"الوسم ينعكس خامًا — {ctx}",
            "evidence": f"?{key}={marker}"}


# ──────────────────────────── اجتياز المسارات ─────────────────────────────────
#: حماولات مربوطة بجذر النظام (تعمل حيثما كان الهدف).
TRAVERSAL_TRIES = [
    ("..\\" * 12 + "Windows\\win.ini", "[fonts]"),
    ("../" * 12 + "etc/passwd", "root:"),
    ("....//" * 6 + "etc/passwd", "root:"),
    ("%2e%2e%2f" * 12 + "etc/passwd", "root:"),
    ("../" * 12 + "etc/hostname", None),
]

#: ملفات مصاحبة للتثبيت، وتوقيعاتها ثابتة يمكن التنبؤ بها.
#: سببها اختباري لا افتراضي: على قرص غير نظام (E:) تصل `..\` إلى جذر
#: القرص فقط، وE:\Windows\win.ini غير موجود — فحمولة واحدة عميقة
#: تُسقط الفحص مهما كانت صحيحة. مسح العمق 1..8 يستعيد ملف المشروع.
PROJECT_TRIES = [
    (n, "../" * n + ".git/config", "[core]") for n in range(1, 9)
]

#: كم مرشّحًا نجرّبه للوجه الواحد عند غياب معامل مرصود. 13×5 طلبًا
#: على مسار واحد يستنزف الهدف ويبتلع الميزانية بلا فائدة.
GUESS_CAP = 3


#: أسماء ملفات متعارف عليها داخل مجلد بيانات. الغرض ليس قراءة محتوى
#: النظام، بل **اكتشاف المعامل المحترم**: المعامل الذي يقرأ أحد هذه
#: الأسماء يردّ 200، والمهجول يردّ 404. بعدها فقط تُطلق حمولات الاجتياز
#: على معامل واحد بدل بثها على كل المرشحات.
SEED_NAMES = ("readme.txt", "index.html", "data.csv", "export.csv",
              "notes.txt", "info.txt", "data.json", "report.txt",
              "brochure.txt", "file.txt")


def probe_traversal(s, base, r, hints=None):
    """اجتياز مسار على معامل واحد حيّ لا على كل المرشّحات.

    الطور:
      1) ميزان: ملف نعرفه موجود (``file_hints``) أو اسم متعارف عليه
         داخل المجلد المُخدَم ← لنسأل: أيّ معامل يُعيد 200.
      2) حمولات: تُطلق على ذلك المعامل وحده.
    السبب: إطلاق خمس حمولات على خمسة مرشّحات = 25 طلبًا ونتيجة واحدة
    غائبة، بينما ميزان واحد + حمولة واحدة = 6 طلبات ونتيجة قابلة للقياس.
    """
    form = _is_form_post(r)
    prefs = ("file", "path", "name", "asset", "doc", "src", "template",
             "include", "page", "dir")
    keys = _candidates(r, prefs, "file")
    if not _observed(r, prefs)[0]:
        keys = keys[:5]

    seeds = [h.lstrip("/") for h in (hints or [])][:2] + list(SEED_NAMES)
    honored = None
    for key in keys:
        for seed in seeds:
            try:
                st0, b0, _ = _text(_send(s, base, r, key, seed, form))
            except Exception:
                continue
            if st0 == 200:
                honored = (key, b0)
                break
        if honored:
            break
        if not (hints or []):
            # بلا أي ملف معروف ولا اسم متعارف: لا ميزان، فنحاول أول
            # مرشّح بلا ميزان ثم نتوقف بدل إغراق الهدف.
            try:
                st0, b0, _ = _text(_send(s, base, r, key,
                                         "nonexistent-9183.txt", form))
            except Exception:
                break
            honored = (key, b0)
            break
    if not honored:
        return None
    key, b0 = honored

    for payload, signature in TRAVERSAL_TRIES:
        try:
            st, body, _ = _text(_send(s, base, r, key, payload, form))
        except Exception:
            continue
        if st != 200 or body == b0:
            continue
        if signature and signature in body:
            return {"code": "PATH", "route": r["path"], "param": key,
                    "verdict": True, "strength": "مؤكد",
                    "note": f"ملف نظام يُقرأ عبر المعامل ({signature})",
                    "evidence": f"{key}={payload}"}
        if _looks_like_file(body):
            return {"code": "PATH", "route": r["path"], "param": key,
                    "verdict": False, "strength": "مؤشّر",
                    "note": "المعامل يقرأ ملفات خارج جذر الويب (محتوى بلا وسوم) — يحتاج توقيعًا",
                    "evidence": f"{key}={payload}"}

    # مسح عمق: يبحث عن ملف تهيئة المشروع على أي عمق.
    for _depth, payload, signature in PROJECT_TRIES:
        try:
            st, body, _ = _text(_send(s, base, r, key, payload, form))
        except Exception:
            continue
        if st == 200 and body != b0 and signature in body:
            return {"code": "PATH", "route": r["path"], "param": key,
                    "verdict": True, "strength": "مؤكد",
                    "note": ("ملف تهيئة المشروع يُقرأ عبر المعامل "
                             f"({signature}) — كشف شيفرة لا محتوى فقط"),
                    "evidence": f"{key}={payload}"}
    return None


# ──────────────────────────── إعادة توجيه مفتوحة ─────────────────────────────
#: مسارات خروج/دخول — تحويلها سلوك طبيعي لا إعادة توجيه مفتوحة.
_LOGOUT_RE = re.compile(r"(?i)(logout|logoff|signout|sign-out|login|signin"
                        r"|logout\.php)")

def _no_follow(s, url):
    """GET بلا متابعة تحويل.

    السبب: الجلسة الاعتيادية تتبع التحويل، فإذا كانت الوجهة خارجية
    رفضها الحارس وارتفع الاستثناء فنخسر النتيجة. وأيضًا: اتباع
    التحويل يعني اتصالًا هو من يقيمه — وهو ما نتحقق من خطورته.
    """
    try:
        from local_scan import fetch_no_follow
        return fetch_no_follow(s, url, timeout=6)
    except ImportError:
        pass
    except Exception:
        return None
    try:
        return s.get(url, timeout=6)
    except Exception:
        return None


def _off_host(loc, base):
    """هل Location يشير إلى مضيف غير مضيف الهدف؟

    هذا هو تعريف إعادة التوجيه المفتوحة، لا «هل ظهرت كلمة الكاناري».
    الوجهة النسبية أو نفس المضيف سلوك آمن.
    """
    if not loc:
        return False, ""
    try:
        p = urllib.parse.urlsplit(loc)
    except Exception:
        return False, ""
    if not p.netloc:            # مسار نسبي
        return False, loc
    try:
        base_host = (urllib.parse.urlsplit(base).hostname or "").lower()
        loc_host = (p.hostname or "").lower()
    except Exception:
        return False, loc
    return (bool(loc_host) and loc_host != base_host), loc


def probe_redirect(s, base, r, hints=None):
    # صفحة خروج/دخول تُعيد التوجيه **بطبيعتها**؛ حقن معامل فيها لا
    # يعني إعادة توجيه مفتوحة، بل سلوكها العادي. DVWA: ‎`logout.php`
    # يردّ على أي معامل غير معروف بتحويل إلى صفحة الدخول — فإطلاق
    # «إعادة توجيه» عليها ضجيج يخفض ثقة المستخدم بكل إنذارات الأداة.
    if _LOGOUT_RE.search(r.get("path") or ""):
        return None
    canary = "http://adaptive-canary.invalid/landing"
    prefs = ("next", "redirect", "url", "returnurl", "returnto", "dest",
             "destination", "target", "to", "continue", "handoff", "handoff_url",
             "redir", "relay", "goto", "out", "back", "r")
    keys = _candidates(r, prefs, "redirect")
    if not _observed(r, prefs)[0]:
        # طلب واحد لكل مرشّح، فالسقف الأوسع مقبول.
        keys = keys[:MAX_GUESS]
    reflected = None
    for key in keys:
        url = f"{base}{r['path']}?" + urllib.parse.urlencode({key: canary})
        resp = _no_follow(s, url)
        if not resp:
            continue
        st, body, hdrs = _text(resp)
        loc = (hdrs or {}).get("location", "")
        if 300 <= st < 400 and loc:
            off, where = _off_host(loc, base)
            if off:
                return {"code": "OPENREDIR", "route": r["path"], "param": key,
                        "verdict": True, "strength": "مؤكد",
                        "note": ("الخادم يحوّل إلى مضيف خارجي بلا تحقق "
                                 "(الوجهة .invalid لا تُحلّ فلا صفرية)"),
                        "evidence": f"{key}={canary} → {st} Location: {loc}"}
            # تحويل إلى نفس المضيف أو نسبي = آمن. نتحقق أن العنوان
            # فعلاً usa المعامل، وإلا فهو تحويل شرطي لا ثغرة.
            if where == loc and where not in ("", "/") and reflected is None:
                reflected = (key, st, where)
        if canary in body and reflected is None:
            # تحويل بالـJavaScript أو meta refresh لا يظهر في Location.
            reflected = (key, st, "تحويل داخل الصفحة")
    if reflected:
        key, st, where = reflected
        return {"code": "OPENREDIR", "route": r["path"], "param": key,
                "verdict": False, "strength": "مؤشّر",
                "note": f"المعامل يصل إلى تحويل ({where}) — يحتاج مراجعة يدوية",
                "evidence": f"{key}={canary} → {st}"}
    return None


# ──────────────────────────────────── SSTI ────────────────────────────────────
def probe_ssti(s, base, r, hints=None):
    """SSTI بعلامة نering.Documentedللحقن، لا بحثًا عن رقم في الصفحة.

    كان الفحصOld يقبل وجود «49» في أي موضع — أي رقم في أي صفحة يجعله
    إنذارًا كاذبًا. القاعدة الآن: العلامة تنعكس، والنتيجة **قريبة منها**.
    Jinja يطبع `{{7*7}}` → 49 فلا يبقى النص الحرفي، فنبحث عن العلامة
    المجرّدة ثم النافذة التي بعدها. الهدف الذي يهرّب يطبع العلامة
    كاملة (بما فيها الأقواس) فلا تحقّق النافذة.
    """
    marker = "ADAPT7T"
    payload = marker + "{{7*7}}"
    form = _is_form_post(r)
    prefs = ("template", "tmpl", "name", "q", "content", "text", "page")
    keys = _candidates(r, prefs, "template")
    if not _observed(r, prefs)[0]:
        keys = keys[:GUESS_CAP]
    for key in keys:
        try:
            st, body, _ = _text(_send(s, base, r, key, payload, form))
        except Exception:
            continue
        if st != 200 or marker not in body:
            continue                      # لا انعكاس أصلًا = لا حقن
        idx = body.find(marker)
        window = body[idx: idx + 80]
        if "49" in window:
            return {"code": "SSTI", "route": r["path"], "param": key,
                    "verdict": True, "strength": "مؤكد",
                    "note": "القالب نفّذ التعبير {{7*7}} → 49 عند موضع العلامة",
                    "evidence": f"{key}={payload}"}
        if payload in window or "{{7*7}}" in window:
            return {"code": "SSTI", "route": r["path"], "param": key,
                    "verdict": False, "strength": "غير مؤكد",
                    "note": "المُدخل ينعكس حرفيًا — القالب لا ينفّذه",
                    "evidence": f"{key}={payload}"}
    return None


# ──────────────────────────────────── IDOR ────────────────────────────────────
def probe_idor(s, base, r, hints=None):
    m = re.search(r"/(\d+)(?=/|$)", r["path"])
    if not m:
        return None
    first = int(m.group(1))
    values = []
    for ident in (first, first + 1):
        target = r["path"].replace(f"/{first}", f"/{ident}", 1)
        try:
            st, body, _ = _text(s.get(f"{base}{target}", timeout=6))
        except Exception:
            return None
        if st != 200:
            return None
        mail = EMAIL_RE.findall(body)
        values.append((ident, body, mail))
    if len(values) != 2:
        return None
    (i1, b1, m1), (i2, b2, m2) = values
    if b1 == b2:
        return None
    private = [x for x in (m1[:1] + m2[:1]) if x]
    if len(set(private)) >= 2:
        return {"code": "IDOR", "route": r["path"], "param": f"path#{first}",
                "verdict": True, "strength": "مؤكد",
                "note": f"معرّفان يُقرآن بلا مصادقة وكلٌّ reveals سجلًّا خاصًا ({private[0]} / {private[-1]})",
                "evidence": f"{r['path'].replace(str(first), str(i1))} vs ...{i2} بلا جلسة"}
    return None


# ─────────────────────── واجهة حسّاسة بلا مصادقة ─────────────────────────────
def probe_unauth(s, base, r, hints=None):
    if not r.get("sources"):
        return None
    try:
        st, body, _ = _text(s.get(f"{base}{r['path']}", timeout=6))
    except Exception:
        return None
    if st in (200, 301, 302):
        return {"code": "APIAUTH", "route": r["path"], "param": None,
                "verdict": False, "strength": "مؤشّر",
                "note": f"واجهة حسّاسة ({r['path']}) تردّ {st} بلا مصادقة — هل فيها بيانات؟",
                "evidence": f"GET {r['path']} → {st}"}
    return None


PROBES = {
    "SQLLOGIN": probe_sqli, "SQLSEARCH": probe_sqli,
    "XSSREFLECT": probe_xss, "XSSATTR": probe_xss, "XSSJS": probe_xss,
    "SSTI": probe_ssti,
    "PATH": probe_traversal,
    "OPENREDIR": probe_redirect,
    "IDOR": probe_idor,
    "APIAUTH": probe_unauth,
}


def run_targeted(session, base, inv, match, max_findings_per_code=3,
                  errors=None):
    """يشغّل البروبرات على الروابط التي match_targets رآها.

    `errors`: قائمة اختيارية تُجمع فيها الأعطال. ابتلاع استثناء داخل
    `except: got = None` يجعل العطل يبدو «لا توجد ثغرة» — وهو أسوأ
    من الفشل: صامت ويقنع المستخدم بأن التطبيق نظيف بينما لم يُفحص
    شيء. كل عطل يُجمَع ويُعرض.
    """
    hints = inv.get("file_hints") or []
    findings = []
    for code, targets in match.items():
        probe = PROBES.get(code)
        if not probe:
            continue
        hits = 0
        for r in targets:
            try:
                got = probe(session, base, r, hints)
            except Exception as e:
                got = None
                if errors is not None:
                    errors.append({"code": code, "route": r.get("path"),
                                   "error": "%s: %s" % (type(e).__name__, e)})
            if not got:
                continue
            got["code"] = got.get("code") or code
            # مصدر المعامل جزء من الحكم: معامل مخمَّن أضعف دليلًا من
            # معامل مرصود في نموذج أو رابط، ويحقّ للمدقق أن يزنه.
            #
            # معامل المسار استثناء: اسمه واحد في كل تطبيق تقريبًا، فمرصده
            # في الرابط لا يدل على شيء. نقارن بالشكل لا بالاسم:
            # br(ID)#(u) أو member/1 ⇒ مرصود؛ jinja2.Template ⇒ مخمَّن.
            observed = set(r.get("params") or []) | set(r.get("fields") or [])
            param = got.get("param")
            if param in observed:
                got["param_source"] = "observed"
            elif got.get("code") == "IDOR" and re.search(r"[#(]", param or ""):
                # مسار بمعرّف داخله: قالب قُرئ من الرابط لا مخمَّنًا.
                got["param_source"] = "path_observed"
            else:
                got["param_source"] = "guessed"
            findings.append(got)
            hits += 1
            if got.get("verdict") and hits >= max_findings_per_code:
                break
            if hits >= max_findings_per_code:
                break
    return findings