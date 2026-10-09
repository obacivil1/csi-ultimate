"""
engine/domxss.py — كشف DOM-XSS استاتيكي (بلا متصفح).
=====================================================
يحلل نص JS بحثًا عن تدفق مصدر → مصرف:
  مصادر: location.hash/search, document.URL/URLUnencoded, document.referrer,
         postMessage, localStorage, name
  مصارف: innerHTML/outerHTML, document.write, eval, setTimeout(نص),
         Function(, location=, insertAdjacentHTML, jQuery.html/append
القاعدة: نفس المعرف/التعبير يظهر في مصدر ومصرف (تتبع مبسط بصدق مُعلن:
قد يفوّت تدفقات غير مباشرة — يُستعمل للترشيح لا للحكم النهائي).
"""
import re

SOURCES = [
    "location.hash", "location.search", "document.URL",
    "document.documentURI", "document.referrer", "window.name",
    "localStorage", "postMessage",
]
SINKS = {
    "innerHTML": "حقن DOM",
    "outerHTML": "حقن DOM",
    "document.write": "كتابة DOM",
    "document.writeln": "كتابة DOM",
    "eval(": "تنفيذ كود",
    "insertAdjacentHTML": "حقن DOM",
    ".html(": "حقن jQuery",
    ".append(": "حقن jQuery",
    "setTimeout(": "مؤقت نصي؟",
    "setInterval(": "مؤقت نصي؟",
    "Function(": "بناء دالة",
}


def _lines_with(js_text, needle):
    return [i for i, l in enumerate(js_text.splitlines(), 1)
            if needle in l]


def analyze_js(js_text, url=""):
    """يعيد [{source, sink, kind, src_line, sink_line, snippet}]."""
    findings = []
    text = js_text or ""
    for src in SOURCES:
        src_lines = _lines_with(text, src)
        if not src_lines:
            continue
        # معرفات مشتقة من المصدر: var x = ...source... / x = ...source...
        idents = set()
        for i, l in enumerate(text.splitlines(), 1):
            if src in l:
                m = re.search(r"(?:var|let|const)?\s*([A-Za-z_$][\w$]*)\s*=",
                              l)
                if m:
                    idents.add(m.group(1))
        for sink, kind in SINKS.items():
            for ln in _lines_with(text, sink):
                line = text.splitlines()[ln - 1]
                if src in line:
                    how = "مباشر"
                else:
                    carriers = [v for v in idents
                                if re.search(r"\b%s\b" % re.escape(v), line)]
                    if not carriers:
                        continue
                    how = "عبر متغير (%s)" % ", ".join(sorted(carriers))
                findings.append({
                    "source": src, "sink": sink, "kind": kind,
                    "src_line": src_lines[0], "sink_line": ln,
                    "flow": how,
                    "snippet": line.strip()[:120],
                    "url": url,
                })
                break
    # إزالة التكرار (مصدر+مصرف)
    seen, out = set(), []
    for f in findings:
        k = (f["source"], f["sink"])
        if k not in seen:
            seen.add(k)
            out.append(f)
    return out
