"""
engine/activescan.py — المسح النشط بأسلوب ZAP/Burp.
====================================================
من خريطة الزاحف إلى الحقن التلقائي:
  1. استخراج نقاط الحقن (معاملات URL + حقول النماذج).
  2. حقن فئات مصنفة لكل نقطة (XSS/SQLi-boolean/traversal/SSTI/redirect/CMDI/SSRF).
  3. تصعيد ذكي: boolean مؤكد → مسبار زمني واحد (لا إغراق).
  4. تصنيف + إزالة تكرار + أدلة خام لكل اكتشاف.
كل الطلبات عبر الجلسة الممررة (مقيّدة النطاق).
"""
import time
import urllib.parse
import urllib.request

try:
    from payloads import boolean_pairs, sqlite_fast_payload, sqlite_time_payload
except ImportError:
    from .payloads import (boolean_pairs, sqlite_fast_payload,
                           sqlite_time_payload)

XSS_PROBES = ["<b>AS9</b>", "<script>alert(9)</script>",
              '" autofocus onfocus=AS9 x="', "';alert(9)//"]
# درس مقيس: الحمولة المجرّدة تفحص المسارات المعتمدة على الجذر فقط.
# /download يحلّ name مقابل DATA_DIR      => lab.db ملف شقيق  => تكفي.
# /static-view يحلّ مقابل DATA_DIR/uploads => يحتاج ../lab.db   => كانت تُفوَّت.
# /page يحلّ مقابل target/pages           => lab.db في data/ يحتاج عمقين.
#
# الفاحص الحقيقي يصعّد العمق. ونمطا الفاصلين ليسا متساويين:
# على POSIX يهمّ ../ فقط، وعلى Windows يهمّ ..\ — لأن '/' داخل اسم الملف
# ليس فاصلًا، بينما '\' فاصل حقيقي ويطوي '..' إلى segment فعلي.
# لذلك نجرب الاثنين لا واحدًا.
TRAVERSAL_TARGETS = [("lab.db", "SQLite format 3"), ("/etc/passwd", "root:")]
_TRAVERSAL_DEPTHS = ("", "../", "../../", "../../../",
                     "..\\", "..\\..\\", "..\\..\\..\\",
                     "....//....//", "....\\\\....\\\\")


def _traversal_probes() -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for d in _TRAVERSAL_DEPTHS:
        for t, mark in TRAVERSAL_TARGETS:
            out.append((t if not d else d + t, mark))
    return out


TRAVERSAL_PROBES = _traversal_probes()
SSTI_PROBES = ["{{7*7}}"]
CMDI_PROBES = ["; echo AScan9k", "| echo AScan9k"]
CMDI_MARK = "AScan9k"
REDIRECT_PROBES = ["https://example.com/"]
BENIGN = "0"

CMD_NAMES = {"host", "ip", "cmd", "command", "exec", "ping", "target",
             "hostname", "addr"}
URL_NAMES = {"url", "redirect", "next", "return", "continue", "dest",
             "u", "link"}
# أسماء بدلالة جلب (SSRF): الخادم هو من يجلب — أما next/redirect فتوجيه
# يتبعه العميل (الجلب من جهته يضلّل الكشف).
FETCH_NAMES = {"url", "uri", "fetch", "feed", "src", "image", "img"}
FILE_NAMES = {"file", "path", "read", "load", "page", "template", "name"}

CODE_OF = {"xss": "XSSREFLECT", "sqli-boolean": "SQLBLIND",
           "sqli-time": "SQLTIME", "traversal": "PATH", "cmdi": "CMDI",
           "ssti": "SSTI", "ssrf": "SSRF", "redirect": "OPENREDIR",
           "error": "INFO"}

# درس الزاحف: النقاط غير المربوطة بروابط/نماذج لا تُرى — تُضاف بتلميحات
# مسارات (forced-browse + قاموس معاملات)، قابلة للتوسعة لأي هدف.
PARAM_HINTS = {
    "/download": ["file"],
    "/static-view": ["file"],
    "/page": ["lang"],
    "/api/ping": ["host"],
    "/preview": ["template"],
    "/go": ["next"],
    "/api/fetch": ["url"],
    "/search": ["q"],
    "/reset": ["email"],
}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _nofollow(session, url, timeout=8):
    """GET بلا متابعة توجيه (duck-typed على أي جلسة بجرة وحارس)."""
    try:
        session._guard(url)
    except AttributeError:
        pass
    opener = urllib.request.build_opener(
        _NoRedirect, urllib.request.HTTPCookieProcessor(session.jar))
    t0 = time.time()
    try:
        with opener.open(urllib.request.Request(url, method="GET"),
                         timeout=timeout) as resp:
            out = (resp.status, list(resp.getheaders()), resp.read())
    except urllib.error.HTTPError as e:
        out = (e.code, list(e.headers.items()), e.read())
    except Exception as e:
        out = (0, [], str(e).encode())
    return out, round((time.time() - t0) * 1000, 1)


_ROW_TAGS = ("<li", "<tr", "<td", "<option", "<dd")


def _rows(txt: str) -> int:
    """عدد عناصر النتائج المتكرّرة (قائمة/جدول/خيار).

    إشارة بنيوية لا حجمية. قيست على /search: 4 نتائج = 184 بايت فقط،
    أي **أقل** من عتبة الحجم (197)، بينما عدد <li> ينتقل 0 → 4. حجم
    الصفحة أعمى لأن النتائج تُبنى في سطر واحد، والبنية لا.
    """
    return sum(txt.count(t) for t in _ROW_TAGS)


def extract_points(crawlmap):
    """يستخرج نقاط الحقن من خريطة الزاحف (يزيل التكرار)."""
    points, seen = [], set()
    for e in crawlmap.get("endpoints", []):
        p = urllib.parse.urlsplit(e)
        qs = urllib.parse.parse_qsl(p.query, keep_blank_values=True)
        if not qs:
            continue
        base = urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, "", ""))
        key = ("GET", base, tuple(sorted(k for k, _ in qs)))
        if key in seen:
            continue
        seen.add(key)
        points.append({"kind": "query", "method": "GET", "url": base,
                       "params": [k for k, _ in qs]})
    for f in crawlmap.get("forms", []):
        names = [i["name"] for i in f.get("inputs", [])
                 if i.get("name") and i.get("type", "text").lower() not in
                 ("submit", "button", "file", "hidden", "checkbox", "radio",
                  "image")]
        if not names:
            continue
        key = (f.get("method", "GET").upper(), f["action"], tuple(names))
        if key in seen:
            continue
        seen.add(key)
        points.append({"kind": "form", "method": key[0], "url": f["action"],
                       "params": names})
    # نقاط التلميح: تُبنى على الجذر مباشرة — المسار العاري قد يرد 404
    # وهو يحتاج معاملًا ليعمل (درس: forced-browse يفوّت نقاط المعاملات).
    root = crawlmap.get("start", "") or ""
    rp = urllib.parse.urlsplit(root)
    base_root = f"{rp.scheme}://{rp.netloc}" if rp.netloc else ""
    if base_root:
        for path, hints in PARAM_HINTS.items():
            url = base_root + path
            key = ("GET", url, tuple(hints))
            if key in seen:
                continue
            seen.add(key)
            points.append({"kind": "hint", "method": "GET", "url": url,
                           "params": list(hints)})
    return points


def _send(session, point, values, timeout=8):
    """يرسل نقطة بقيم محددة. يعيد (status, text, ms)."""
    t0 = time.time()
    try:
        if point["method"] == "GET":
            q = urllib.parse.urlencode(values)
            url = point["url"] + ("?" + q if q else "")
            st, _, body = session.get(url, timeout=timeout)
        else:
            st, _, body = session.post(point["url"], fields=dict(values),
                                       timeout=timeout)
    except Exception as e:
        return 0, str(e), round((time.time() - t0) * 1000, 1)
    txt = body.decode("utf-8", "replace") if isinstance(body, bytes) else body
    return st, txt, round((time.time() - t0) * 1000, 1)


def _raw(point, values):
    if point["method"] == "GET":
        q = urllib.parse.urlencode(values)
        return f"GET {point['url']}{'?' + q if q else ''} HTTP/1.1"
    body = urllib.parse.urlencode(values)
    return (f"POST {point['url']} HTTP/1.1\n"
            f"Content-Type: application/x-www-form-urlencoded\n\n{body}")


def active_scan(session, crawlmap, base, include_time=False, max_points=25,
                timeout=8):
    """يمسح النقاط المكتشفة. يعيد {findings, stats}."""
    t_start = time.time()
    points = extract_points(crawlmap)[:max_points]
    host = urllib.parse.urlsplit(base).netloc
    findings, seen, reqs = [], set(), [0]

    def add(point, param, category, payload, reason, st, size, raw, snip):
        key = (point["url"], param, category)
        if key in seen:
            return
        seen.add(key)
        findings.append({
            "code": CODE_OF.get(category, "INFO"), "category": category,
            "url": point["url"], "method": point["method"], "param": param,
            "payload": payload, "reason": reason, "status": st, "size": size,
            "request": raw, "response": (snip or "")[:800]})

    def benign(point):
        st, txt, ms = _send(session, point,
                            [(p, BENIGN) for p in point["params"]],
                            timeout=timeout)
        reqs[0] += 1
        return st, txt, ms

    for point in points:
        b_st, b_txt, b_ms = benign(point)
        if b_st in (0,) or b_st >= 500:
            continue
        boosted = []  # (param) مرشحة للتصعيد الزمني
        for param in point["params"]:
            lname = param.lower()
            # --- XSS: انعكاس خام لوسم ---
            for pl in XSS_PROBES:
                st, txt, _ = _send(
                    session, point,
                    [(p, pl if p == param else BENIGN) for p in point["params"]],
                    timeout=timeout)
                reqs[0] += 1
                if st == 200 and pl in txt:
                    add(point, param, "xss", pl, "انعكاس HTML خام",
                        st, len(txt),
                        _raw(point, [(p, pl if p == param else BENIGN)
                                     for p in point["params"]]), txt)
                    break
            # --- SQLi boolean: صحيح/خاطئ ---
            t_txt, f_txt = None, None
            for tq, fq in boolean_pairs():
                _, t_txt, _ = _send(
                    session, point,
                    [(p, tq if p == param else BENIGN) for p in point["params"]],
                    timeout=timeout)
                _, f_txt, _ = _send(
                    session, point,
                    [(p, fq if p == param else BENIGN) for p in point["params"]],
                    timeout=timeout)
                reqs[0] += 2
                # عتبة الفرق بالحجم: 12% من الأساس وأرضية 150.
                gap = abs(len(t_txt) - len(f_txt))
                len_hit = gap > max(150, len(b_txt) * 12 // 100)
                # عتبة البنية: عدد عناصر النتائج. الكاذب يجب أن يشبه
                # الضابط (b_txt) وإلا فهو dinاميكية لا حقن — وهذا ما
                # يمنع كل نقطة سليمة من أن تُعلَم.
                rows_t, rows_f, rows_b = _rows(t_txt), _rows(f_txt), _rows(b_txt)
                rows_hit = abs(rows_t - rows_f) >= 2 and abs(rows_f - rows_b) <= 1
                if len_hit or rows_hit:
                    how = []
                    if len_hit:
                        how.append(f"فرق صحيح/خاطئ ({len(t_txt)} مقابل {len(f_txt)})")
                    if rows_hit:
                        how.append(f"فرق عناصر ({rows_t} مقابل {rows_f})")
                    add(point, param, "sqli-boolean", tq,
                        " · ".join(how),
                        200, len(t_txt),
                        _raw(point, [(p, tq if p == param else BENIGN)
                                     for p in point["params"]]), t_txt)
                    boosted.append(param)
                    break
            # --- traversal في كل معامل (الحكم للعلامة فقط — آمن) ---
            for pl, mark in TRAVERSAL_PROBES:
                st, txt, _ = _send(
                    session, point,
                    [(p, pl if p == param else BENIGN)
                     for p in point["params"]], timeout=timeout)
                reqs[0] += 1
                if st == 200 and mark in txt:
                    add(point, param, "traversal", pl,
                        f"علامة نظام ظاهرة ({mark[:20]})",
                        st, len(txt),
                        _raw(point, [(p, pl if p == param else BENIGN)
                                     for p in point["params"]]), txt)
                    break
            # --- SSTI: حساب حي ---
            for pl in SSTI_PROBES:
                st, txt, _ = _send(
                    session, point,
                    [(p, pl if p == param else BENIGN) for p in point["params"]],
                    timeout=timeout)
                reqs[0] += 1
                if st == 200 and txt.strip() == "49":
                    add(point, param, "ssti", pl, "القالب حُسب (49)",
                        st, len(txt),
                        _raw(point, [(p, pl if p == param else BENIGN)
                                     for p in point["params"]]), txt)
                    break
            # --- موجّهة بالاسم: أوامر ---
            if lname in CMD_NAMES:
                for pl in CMDI_PROBES:
                    st, txt, _ = _send(
                        session, point,
                        [(p, pl if p == param else BENIGN)
                         for p in point["params"]], timeout=timeout)
                    reqs[0] += 1
                    if CMDI_MARK in txt:
                        add(point, param, "cmdi", pl, "علامة الأمر عادت",
                            st, len(txt),
                            _raw(point, [(p, pl if p == param else BENIGN)
                                         for p in point["params"]]), txt)
                        break
            # --- موجّهة بالاسم: توجيه + SSRF (للأسماء الدالة فقط) ---
            if lname in URL_NAMES:
                for pl in REDIRECT_PROBES:
                    vals = [(p, pl if p == param else BENIGN)
                            for p in point["params"]]
                    q = urllib.parse.urlencode(vals)
                    url = point["url"] + ("?" + q if q else "")
                    (st, hdrs, body), _ = _nofollow(session, url, timeout)
                    reqs[0] += 1
                    loc = next((v for k, v in hdrs if k.lower() == "location"),
                               "")
                    if st in (301, 302, 303, 307, 308) and \
                            urllib.parse.urlsplit(loc).netloc and \
                            urllib.parse.urlsplit(loc).netloc != host:
                        add(point, param, "redirect", pl,
                            f"توجيه خارجي إلى {loc[:60]}", st, len(body),
                            f"GET {url} HTTP/1.1", loc)
                        break
            if lname in FETCH_NAMES:
                probe = f"http://{host}/api/me"
                st, txt, _ = _send(
                    session, point,
                    [(p, probe if p == param else BENIGN)
                     for p in point["params"]], timeout=timeout)
                reqs[0] += 1
                if st == 200 and "admin_area" in txt:
                    add(point, param, "ssrf", probe,
                        "الخادم جلب نقطة داخلية (admin_area)",
                        st, len(txt),
                        _raw(point, [(p, probe if p == param else BENIGN)
                                     for p in point["params"]]), txt)
        # --- تصعيد زمني فقط للنقاط المرشحة ---
        if include_time:
            for param in boosted:
                t0 = time.time()
                st, txt, _ = _send(
                    session, point,
                    [(p, sqlite_time_payload() if p == param else BENIGN)
                     for p in point["params"]], timeout=30)
                slow = time.time() - t0
                reqs[0] += 1
                if slow >= 1.2:
                    add(point, param, "sqli-time", "UNION عدّ ثقيل",
                        f"تأخر {slow:.1f}s", st, len(txt),
                        _raw(point, [(p, "UNION-HEAVY" if p == param else BENIGN)
                                     for p in point["params"]]), txt[:200])
    cats = {}
    for f in findings:
        cats[f["category"]] = cats.get(f["category"], 0) + 1
    return {"findings": findings,
            "stats": {"points": len(points), "requests": reqs[0],
                      "findings": len(findings), "by_category": cats,
                      "elapsed": round(time.time() - t_start, 1)}}
