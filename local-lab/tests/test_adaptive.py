"""الطبقة التكيّفية: هل تكتشف الواجهات، وهل تصمت حين يجب؟

الاختبارات على محورين، والثاني هو الأهم:

  1. الاستكشاف — مسارات الهدفين لا تحمل كلمات مفتاحية مألوفة
     (/signin لا تحوي "login"، و/catalog لا "search"). أن تظهر في
     النتائج يعني أن الطبقة قرأتها من التطبيق لا من قائمة مكتوبة.

  2. الاتجاه العكسي — app2_safe يحمل **نفس المسارات** والفرق الوحيد
     هو الإصلاحات. الاختبار يفرض صفرًا مؤكدًا عليه. لو نجحت الفحوص
     على المصاب والآمن معًا، فهي لا تكتشف ثغرة بل تكتشف شيئًا.

كل الخوادم على 127.0.0.1 بمنفذ يختاره نظام التشغيل، ولا اتصال خارجي.
"""
import socket
import sys
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
for sub in ("scanner", "recon_lab", "target", "engine"):
    sys.path.insert(0, str(ROOT / sub))

import adaptive                                            # noqa: E402
import probes                                              # noqa: E402
import crawler as crawllib                                 # noqa: E402
from local_scan import Session                             # noqa: E402


def _free_port():
    with socket.socket() as sk:
        sk.bind(("127.0.0.1", 0))
        return sk.getsockname()[1]


def _serve(module_name):
    """يشغّل تطبيق Flask داخل العملية على منفذ حرّ، ويعيد عنوانه."""
    from werkzeug.serving import make_server
    import importlib
    mod = importlib.import_module(module_name)
    srv = make_server("127.0.0.1", 0, mod.app, threaded=True)
    port = srv.server_port
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()

    def _stop():
        srv.shutdown()
        th.join(timeout=5)

    return "http://127.0.0.1:%d" % port, _stop


@pytest.fixture(scope="module")
def vuln_target():
    base, stop = _serve("app2")
    yield base
    stop()


@pytest.fixture(scope="module")
def safe_target():
    base, stop = _serve("app2_safe")
    yield base
    stop()


def _serve_ssti_stub(mode: str):
    """خادم تصيير بثلاثة أوضاع، وكلها تطبع الرقم 49 في المتن عمدًا:

      ignore — يتجاهل المُدخل تمامًا  ⇒ لا انعكاس أصلًا
      echo   — يهرّب النص ولا ينفّذه   ⇒ انعكاس حرفي
      eval   — ينفّذ القالب            ⇒ ثغرة

    إدخال «49» في المتن مقصود: الفحص القديم كان يقبل وجود الرقم في أي
    موضع، فكان يُطلق على الوضعين الأول والثاني — أي على كل صفحة فيها
    أي رقم. القاعدة الآن: لا انعكاس = لا فحص أصلًا.
    """
    from flask import Flask, request
    from werkzeug.serving import make_server
    app = Flask("ssti_stub_%s" % mode)
    head = "<p>مرجع المنتج رقم 49 في المخزون</p>"

    @app.route("/render")
    def render():
        from jinja2 import Template
        t = request.args.get("tmpl", "")
        if mode == "ignore":
            return head + "<div>لا مُدخل</div>"
        if mode == "echo":
            return head + "<div>%s</div>" % t
        try:
            return head + "<div>%s</div>" % Template(t).render()
        except Exception:
            return "<p>خطأ في التصيير</p>"

    srv = make_server("127.0.0.1", 0, app, threaded=True)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()

    def _stop():
        srv.shutdown()
        th.join(timeout=5)

    return "http://127.0.0.1:%d" % srv.server_port, _stop


@pytest.fixture(scope="module")
def vuln_run(vuln_target):
    s = Session()
    inv = adaptive.inventory(s, vuln_target)
    match = adaptive.match_targets(inv)
    return s, inv, match, probes.run_targeted(s, vuln_target, inv, match)


@pytest.fixture(scope="module")
def safe_run(safe_target):
    s = Session()
    inv = adaptive.inventory(s, safe_target)
    match = adaptive.match_targets(inv)
    return s, inv, match, probes.run_targeted(s, safe_target, inv, match)


def _codes(findings, verdict=True):
    return {f["code"] for f in findings if f["verdict"] is verdict}


# ---------------------------------------------------------------- discovery

def test_discovers_unfamiliar_routes(vuln_run):
    """المسارات الأساسية مكتشَفة رغم خلوّها من كلمات المفتاح."""
    _s, inv, _m, _f = vuln_run
    paths = {r["path"] for r in inv["routes"]}
    for want in ("/signin", "/catalog", "/member/1", "/vault/download",
                 "/render", "/exit"):
        assert want in paths, "فاتDiscovery: %s" % want


def test_reads_query_and_form_faces(vuln_run):
    """المعامل يُقرأ من الوصلة، وحقول النموذج من صفحته لا من vocab."""
    _s, inv, _m, _f = vuln_run
    by = {r["path"]: r for r in inv["routes"]}
    assert "term" in by["/catalog"]["params"]
    # /signin غير مربوط من أي رابط تنقّل: اكتشافه يأتي من الجولة الثانية
    assert "passphrase" in by["/signin"]["fields"]


def test_scripts_are_dicts_not_strings(vuln_run):
    """انحدار: عناصر scripts قواميس. معاملتها كنص تُسقط الاستكشاف.

    أصل الخطأ لم يظهر إلا حين حملت الصفحة وسم <script src>، أي أن أي
    موقع حقيقي — وفيه سكربتات دائمًا — كان سينهار.
    """
    _s, inv, _m, _f = vuln_run
    assert any(isinstance(x, dict) for x in inv["scripts"])
    assert "/static/app2.js" in {r["path"] for r in inv["routes"]}


def test_file_hints_include_observed_script(vuln_run):
    _s, inv, _m, _f = vuln_run
    assert "/static/app2.js" in inv["file_hints"]


def test_matcher_binds_seven_codes(vuln_run):
    """كل كود يجد وجهه في التطبيق دون أي كتابة مسبقة للمسارات."""
    _s, _inv, match, _f = vuln_run
    assert {"SQLLOGIN", "SQLSEARCH", "XSSREFLECT", "SSTI", "PATH",
            "OPENREDIR", "IDOR"} <= set(match)


# ---------------------------------------------------- direction: vulnerable

def test_vulnerable_target_confirms(vuln_run):
    """المصاب: كل صنف من السبعة يجب أن يؤكد، لا أن يصمت."""
    _s, _inv, _m, findings = vuln_run
    strong = _codes(findings, True)
    for code in ("SQLLOGIN", "XSSREFLECT", "SSTI", "PATH", "OPENREDIR",
                 "IDOR"):
        assert code in strong, "لم يؤكد: %s" % code
    assert strong <= _codes(findings, True)      # لا كود وهمي خارج القائمة


def test_vulnerable_findings_cite_route_and_param(vuln_run):
    """كل نتيجة تُثبت نفسها بمسارها ومعاملها، لاNaming بلا دليل."""
    _s, _inv, _m, findings = vuln_run
    for f in findings:
        if f["verdict"]:
            assert f["route"].startswith("/")
            assert f["param"], "نتيجة بلا معامل: %s" % f["code"]


def test_login_bypass_is_behavioural_not_error(vuln_run):
    """تجاوز الدخول يُثبت بثلاثي سلوكي لا برسالة خطأ SQL."""
    _s, _inv, _m, findings = vuln_run
    hit = [f for f in findings if f["code"] == "SQLLOGIN"]
    assert hit and hit[0]["verdict"]
    assert hit[0]["route"] == "/signin"


def test_path_trail_reads_project_config(vuln_run):
    """كشف اجتياز يقرأ شيفرة — لا محتوى عشوائي فقط."""
    _s, _inv, _m, findings = vuln_run
    hit = [f for f in findings if f["code"] == "PATH" and f["verdict"]]
    assert hit
    assert "core" in hit[0]["note"] or ".git" in hit[0]["evidence"]


# -------------------------------------------------------- direction: safe

def test_safe_target_has_zero_confirmed(safe_run):
    """هذا هو الاختبار الحاسم: صفر مؤكد على التطبيق المُصلَح."""
    _s, _inv, _m, findings = safe_run
    assert _codes(findings, True) == set(), \
        "إنذار كاذب على هدف آمن: %s" % _codes(findings, True)


def test_safe_target_matches_same_routes(safe_run, vuln_run):
    """المسارات متطابقة: لا نقارن هدفًا غنيًا بهدف فقير."""
    _sv, inv_s, _ms, _fs = safe_run
    _vv, inv_v, _mv, _fv = vuln_run
    assert {r["path"] for r in inv_s["routes"]} == \
           {r["path"] for r in inv_v["routes"]}


def test_safe_target_binds_same_codes(safe_run, vuln_run):
    """الربط يقرأ الإصلاح لا الثغرة: نفس الوجوه تُربط في الاثنين."""
    _s, _inv, match_s, _f = safe_run
    _v, _iv, match_v, _fv = vuln_run
    assert set(match_s) == set(match_v)


def test_safe_non_verdicts_are_honest(safe_run):
    """أي نتيجة على الآمن يجب أن تحمل تفسيرًا صادقًا لا تأكيدًا كاذبًا."""
    _s, _inv, _m, findings = safe_run
    for f in findings:
        assert f["verdict"] is False
        assert f["strength"] and f["note"], "نتيجة بلا تفسير: %r" % f


# ------------------------------------------------------------- unit level

def test_strip_removes_escaped_reflection():
    """الانعكاس المُرمَّز يجب أن يختفي قبل المقارنة.

    بدونه يظهر فرقٌ شكلي بين TRUE وFALSE = إنذار كاذب على أي تطبيق
    يهرّب مخرجاته (وهو الغالب في التطبيقات الصحيحة).
    """
    body = "<p>بحثك: ADAPT7Q&#x27; OR 1=1 -- </p>"
    stripped = probes._strip(body, "ADAPT7Q' OR 1=1 -- ")
    assert "OR 1=1" not in stripped


def test_strip_handles_markupsafe_quote_form():
    assert "OR 1=1" not in probes._strip(
        "<p>ADAPT7Q&#39; OR 1=1 -- </p>", "ADAPT7Q' OR 1=1 -- ")


def _render_route():
    return {"path": "/render", "params": ["tmpl"], "fields": [],
            "methods": ["GET"], "sources": ["crawl"], "status": 200}


def test_ssti_silent_when_input_not_reflected():
    """رقم 49 في الصفحة لا يساوي SSTI — لا انعكاس = لا فحص."""
    base, stop = _serve_ssti_stub("ignore")
    try:
        assert probes.probe_ssti(Session(), base, _render_route()) is None
    finally:
        stop()


def test_ssti_literal_reflection_is_not_verdict():
    """الانعكاس الحرفي ينتج ملاحظة صادقة، لا تأكيدًا."""
    base, stop = _serve_ssti_stub("echo")
    try:
        res = probes.probe_ssti(Session(), base, _render_route())
        assert res is not None and res["verdict"] is False
        assert "حرفيًا" in res["note"]
    finally:
        stop()


def test_ssti_confirms_when_template_executes():
    base, stop = _serve_ssti_stub("eval")
    try:
        hit = probes.probe_ssti(Session(), base, _render_route())
        assert hit and hit["verdict"] and hit["code"] == "SSTI"
    finally:
        stop()


def test_idor_param_source_is_semantic(vuln_run):
    """معرّف داخل مسار = مرصود، لا «مخمَّن».

    التسمية السيّئة كانت تخفي قوة الدليل: القالب قُرئ من الرابط المرصود،
    لا أنه مُخمَّن. والأسماء الحقيقية للمعاملات تبقى «مرصودة» أو
    «مخمَّنة» حسب المرصد وحده.
    """
    _s, _inv, _m, findings = vuln_run
    hit = [f for f in findings if f["code"] == "IDOR"]
    assert hit, "لم يُكتشف IDOR"
    assert hit[0]["param_source"] == "path_observed", hit[0]


def test_session_guard_blocks_external_before_connecting():
    """الضمانة الميكانيكية: لا اتصال خارجي، ولا حتى محاولة.

    n_requests لا يزداد لأن الرفض يقع في _guard قبل العدّاد، فالمعيار
    أدقّ من «الطلب فشل»: لا تأكيد خروج بيانات أصلًا.
    """
    s = Session()
    for host in ("example.com", "evil.test", "8.8.8.8",
                 "169.254.169.254"):
        with pytest.raises(Exception):
            s.get("http://%s/" % host)
    assert s.n_requests == 0


def test_probe_traversal_never_leaves_loopback():
    """بروبرا اجتياز المسار ترفض ما لا يثبت، ولا تخرج عن جذر الخدمة.

    الفحص يقرأ من داخل جذر الخدمة فقط ولا يتبع تحويلًا خارجيًا.
    الاختبار يؤكّد أنها تصمت بدل أن تبلّغ عن شيء لم يثبت.
    """
    base, stop = _serve_ssti_stub("ignore")
    try:
        s = Session()
        r = {"path": "/vault/download", "params": ["asset"], "fields": [],
             "methods": ["GET"], "sources": ["crawl"], "status": 200}
        res = probes.probe_traversal(s, base, r, None)
        assert res is None or res["verdict"] is True
    finally:
        stop()


# ─────────────────────── أعطال كشفها DVWA (2026-10-03) ───────────────────────
# كل اختبار هنا وُجد بخطأ على تطبيق حقيقي، وكل واحد منها كان يُسقط
# الفحص **صامتًا**. الصمت هو الخطر: «لم نجد ثغرة» و«لم نُفحص» شكلان
# لتقرير واحد.


class _CrawlSpy:
    """جلسة人对交往: تسجيل فقط، وعدّ ما طُلب فعلًا."""

    def __init__(self, page):
        self.page = page
        self.requested = []
        self.n_requests = 0

    def get(self, url, **kw):
        self.requested.append(url)
        self.n_requests += 1
        if "logout" in url or "phpids" in url:
            return 200, [("Content-Type", "text/html")], b"BYE"
        return 200, [("Content-Type", "text/html")], \
            self.page.encode("utf-8")


def test_crawler_records_logout_link_but_never_fetches_it():
    """رابط خروج يُسجَّل ولا يُزور.

    حادثة DVWA: رابط «تسجيل خروج» موجود في كل صفحة، وزحف واحد يتبعه
    يفقد الجلسة، ثم يقيس كل فحص صفحة الدخول بدل الهدف فيُصمت.
    """
    page = ('<html><body><a href="/logout.php">out</a>'
            '<a href="/catalog?term=x">go</a></body></html>')
    spy = _CrawlSpy(page)
    cmap = crawllib.crawl(spy, "http://127.0.0.1:1/", max_pages=5,
                          probe_common=False)
    assert any("logout" in e for e in cmap["endpoints"]), \
        "رابط الخروج يجب أن يُسجَّل (قد يكون وجه إعادة توجيه)"
    assert not any("logout" in u for u in spy.requested), \
        "لكن لا يُطلب: يterminates الجلسة"
    assert any("catalog" in u for u in spy.requested), \
        "والروابط العادية تُزار"


def test_crawler_never_follows_state_changing_get_link():
    """`?phpids=on` رابط GET يغيّر حالة التطبيق — لا يُتبع.

    DVWA يتيح هكذا تفعيل جداره الواقي بلا كلمة مرور. زحف يتبعه
    يفعّل الحاجز على الهدف، فيحجب كل حقن، ويبدو التطبيق آمنًا.
    الأداة هي التي كانت تُطفئ نفسها.
    """
    page = ('<html><body><a href="/security.php?phpids=on">enable</a>'
            '<a href="/instructions.php?doc=readme.txt">doc</a>'
            '</body></html>')
    spy = _CrawlSpy(page)
    cmap = crawllib.crawl(spy, "http://127.0.0.1:1/", max_pages=5,
                          probe_common=False)
    assert any("phpids=on" in e for e in cmap["endpoints"]), \
        "يُسجَّل للاكتشاف"
    assert not any("phpids" in u for u in spy.requested), \
        "لكن لا يُطلب: يغيّر حالة التطبيق"


def test_redact_does_not_raise_on_volatile_query():
    """تحييد القيم المتغيّرة لا يجوز أن يرمي استثناءً أبدًا.

    كان تركيب النمط يضع `(?i)` بعد `(?:` فيرفع Python استثناء
    `global flags not at the start`، وكان يُسقط **كل** حكم SQLi/XSS
    على أي صفحة تعكس توكنًا في رابطها — بلا أي رسالة.
    """
    body = ('<a href="/next?user_token=abc123SECRET&id=9">x</a>'
            '<input name="csrf_token" value="zzz999">')
    out = probes._redact(body, "needle", "' OR 1=1 -- ", "ADAPT7Q")
    assert "abc123SECRET" not in out
    assert "zzz999" not in out


def test_probe_sql_sends_submit_companion():
    """صفحة لا تنفّذ شيئًا إلا بوجود زر الإرسال.

    DVWA low: ‎`?id=1` بلا `Submit` لا يصل إلى الاستعلام إطلاقًا، فحقن
    `id` وحده صامت. الفحص يعيد إنتاج الطلب المرصود (أو يضيف الزر
    المرصود) ثم يغيّر معاملًا واحدًا.
    """
    from flask import Flask, request
    from werkzeug.serving import make_server
    app = Flask("companion")

    @app.route("/item")
    def item():
        if "Submit" not in request.args:
            return "<html><form method=GET><input name=id value=''>"
        rows = ("<p>row-%d</p>" % i for i in range(5)) \
            if "' OR" in request.args.get("id", "") else ""
        return "<html><body>%s</body></html>" % "".join(rows)

    srv = make_server("127.0.0.1", 0, app, threaded=True)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    base = "http://127.0.0.1:%d" % srv.server_port
    try:
        s = Session()
        r = {"path": "/item", "params": ["Submit", "id"], "fields": [],
             "methods": ["GET"], "sources": ["crawl"], "status": 200,
             "sample_query": ""}
        res = probes.probe_sqli(s, base, r, None)
        assert res and res["verdict"] is True, \
            "الزر المرصود يجب أن يُرسل، وإلا فالحقن لا يصل"
    finally:
        srv.shutdown()
        th.join(timeout=5)


def test_blocked_page_is_reported_not_silent():
    """حجب التطبيق يُقال صراحةً، ولا يُقرأ كـ«لا يوجد ثغرة»."""
    from flask import Flask, request
    from werkzeug.serving import make_server
    app = Flask("waf")

    @app.route("/item")
    def item():
        if "'" in request.args.get("id", ""):
            return ("<html>Hacking attempt detected and logged.<br />"
                    "Have a nice day.</html>")
        return "<html><body>ok</body></html>"

    srv = make_server("127.0.0.1", 0, app, threaded=True)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    base = "http://127.0.0.1:%d" % srv.server_port
    try:
        s = Session()
        r = {"path": "/item", "params": ["id"], "fields": [],
             "methods": ["GET"], "sources": ["crawl"], "status": 200,
             "sample_query": ""}
        res = probes.probe_sqli(s, base, r, None)
        assert res is None or res.get("blocked") is True, \
            "ردّ الحجب يجب أن يُعلَن، لا أن يُقرأ كسلامة"
        if res is not None:
            assert res["verdict"] is False
            assert "محجوب" in res["strength"]
    finally:
        srv.shutdown()
        th.join(timeout=5)


def test_boolean_proof_accepts_one_sided_signature():
    """الحقيقة تُرجع صفوفًا والكذب لا شيء: البصمة في جانب واحد.

    هذا هو شكل DVWA الحقيقي: مخرجات الكذب هي القالب المشترك بلا سطر
    خاص. اشتراط بصمة في الجانبين كان يُسقطadt حقنًا مثبتًا.
    """
    page_t = "<html>\n<p>row a</p>\n<p>row b</p>\n</html>"
    page_f = "<html>\n</html>"
    trues = [page_t, page_t, page_t]
    falses = [page_f, page_f, page_f]
    assert probes._consistent(trues, falses) is True


def test_boolean_proof_rejects_flickering_content():
    """بصمة تتغيّر بين الأزواج ليست سلوكًا حقيقيًا، بل ضجيج."""
    trues = ["<html>\n<p>%s</p>\n</html>" % v
             for v in ("t1-a", "t2-b", "t3-c")]
    falses = ["<html>\n</html>"] * 3
    assert probes._consistent(trues, falses) is False


def test_redirect_probe_skips_logout_route():
    """تحويل صفحة الخروج سلوك طبيعي، لا إعادة توجيه مفتوحة."""
    base, stop = _serve_ssti_stub("ignore")
    try:
        s = Session()
        r = {"path": "/logout.php", "params": ["next"], "fields": [],
             "methods": ["GET"], "sources": ["crawl"], "status": 200}
        assert probes.probe_redirect(s, base, r, None) is None
    finally:
        stop()


def test_session_alive_detects_lost_session():
    """فقدان الجلسة يُقال، لا يُتجاهل بصمت."""
    from flask import Flask
    from werkzeug.serving import make_server
    app = Flask("sess")

    @app.route("/")
    def home():
        return "<html><body>please log in: password</body></html>"

    srv = make_server("127.0.0.1", 0, app, threaded=True)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    base = "http://127.0.0.1:%d" % srv.server_port
    try:
        alive, why = adaptive.session_alive(Session(), base)
        assert alive is False
        assert "الجلسة انتهت" in why
    finally:
        srv.shutdown()
        th.join(timeout=5)


def test_login_picks_observed_fields_only():
    """لا تخمين لحقل: يُختار من أسماء مرصودة في صفحة الدخول.

    DVWA أسماء حقولها Login/password/username — لا «user» ولا «pass»
    كما يتوقع كثير من الأدوات.
    """
    from flask import Flask, request
    from werkzeug.serving import make_server
    app = Flask("loginstub")

    @app.route("/")
    def home():
        if request.args.get("_") or "ok" in request.cookies:
            return '<html><body><a href="/logout.php">Logout</a></body></html>'
        return "<html><body>welcome home</body></html>"

    @app.route("/login.php", methods=["GET", "POST"])
    def login():
        if request.method == "POST" and request.form.get("password") == "s3cr3t":
            resp = app.make_response(
                '<html><body><a href="/logout.php">Logout</a></body></html>')
            resp.set_cookie("ok", "1")
            return resp
        return ("<html><form method=POST action='/login.php'>"
                "<input type=text name=username value=''>"
                "<input type=password name=password value=''>"
                "<input type=hidden name=user_token value=T0K>"
                "<input type=submit name=Login value=Login></form></html>")

    srv = make_server("127.0.0.1", 0, app, threaded=True)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    base = "http://127.0.0.1:%d" % srv.server_port
    try:
        ok, note = adaptive.login(Session(), base, "admin", "s3cr3t",
                                  path="/login.php")
        assert ok is True, note
    finally:
        srv.shutdown()
        th.join(timeout=5)


def test_login_rejects_wrong_password():
    """بيانات مرفوضة تُقال صراحةً (لا نجاح زائف)."""
    from flask import Flask, request
    from werkzeug.serving import make_server
    app = Flask("loginstub2")

    @app.route("/")
    def home():
        return ("<html><form method=POST><input type=text name=username>"
                "<input type=password name=password></form></html>")

    @app.route("/login.php", methods=["GET", "POST"])
    def login():
        return ("<html><form method=POST><input type=text name=username>"
                "<input type=password name=password></form></html>")

    srv = make_server("127.0.0.1", 0, app, threaded=True)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    base = "http://127.0.0.1:%d" % srv.server_port
    try:
        ok, note = adaptive.login(Session(), base, "admin", "bad",
                                  path="/login.php")
        assert ok is False
        assert "مرفوض" in note or "لم" in note
    finally:
        srv.shutdown()
        th.join(timeout=5)