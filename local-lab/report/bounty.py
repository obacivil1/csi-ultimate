"""
report/bounty.py — مولّد تقارير بأسلوب HackerOne (MD + HTML).
================================================================
المدخل: تقرير build_report + خريطة أدلة اختيارية {code: {request, response, steps}}.
المخرج: ملفا .md و .html بترويسة باحث، بطاقة لكل ثغرة (الخطورة + CVSS +
CWE + خطوات إعادة الإنتاج + الأثر + الإصلاح + الدليل الخام).
"""
import html as _html
import json
from datetime import datetime, timezone
from pathlib import Path

try:
    from cvss import score as cvss_score, suggest
except ImportError:
    from .cvss import score as cvss_score, suggest

CWE = {
    "SQLLOGIN": "CWE-89", "SQLSEARCH": "CWE-89", "SQLBLIND": "CWE-89",
    "SQLTIME": "CWE-89",
    "XSSREFLECT": "CWE-79", "XSSSTORED": "CWE-79",
    "IDOR": "CWE-639", "PATH": "CWE-22", "UPLOAD": "CWE-434",
    "CMDI": "CWE-78", "SSTI": "CWE-1336", "SSRF": "CWE-918",
    "OPENREDIR": "CWE-601", "CSRF": "CWE-352",     "WEAKCOOKIE": "CWE-614",
    "JWTNONE": "CWE-287", "JWTWEAK": "CWE-798",
    "NOLOCK": "CWE-307", "INFOLEAK": "CWE-209",
      "AUTHENUM": "CWE-204", "SESSFIX": "CWE-384",
      "GRAPHQL": "CWE-862", "NOSQLI": "CWE-943",
      "FRAMING": "CWE-444",
    "XSSATTR": "CWE-79", "XSSJS": "CWE-79", "XSSPOLY": "CWE-79",
    "CSPWEAK": "CWE-693",
    "APIAUTH": "CWE-862", "SECHDRS": "CWE-693",
}
CWE_URL = "https://cwe.mitre.org/data/definitions/{}.html"

FIXES = {
    "SQLLOGIN": "عبارات SQL مُعامَلة (parameterized) وفصل الكود عن البيانات.",
    "SQLSEARCH": "تقييد معاملات البحث + عبارات مُعامَلة.",
    "SQLBLIND": "نفس علاج الحقن + رسائل خطأ موحدة لا تسرّب boolean.",
    "SQLTIME": "نفس علاج الحقن + حدّ زمني لتنفيذ الاستعلامات.",
    "XSSREFLECT": "ترميز الإخراج (escape) + CSP صارمة.",
    "XSSSTORED": "تنقية المخزّن + ترميز عند العرض.",
    "IDOR": "تحقق صلاحية على كل كائن (AuthZ) لا الاكتفاء بالرقم.",
    "PATH": "حصر المسار بجذر مع Path.resolve ومنع ..",
    "UPLOAD": "قائمة امتدادات مسموحة + فحص MIME + تخزين خارج جذر التنفيذ.",
    "CMDI": "استدعاء بلا shell (قائمة وسيطات) + تحقق صارم من المدخل.",
    "SSTI": "لا قوالب من إدخال المستخدم أبدًا + sandbox.",
    "WEAKCOOKIE": "Secure + HttpOnly + SameSite + كلمات مجهّأة (bcrypt).",
    "JWTNONE": "قائمة خوارزميات مسموحة + رفض alg=none صراحة.",
    "JWTWEAK": "سر 256-بت عشوائي من مدير أسرار + تدوير دوري.",
    "NOLOCK": "حدّ معدل + قفل تدريجي + captcha.",
      "AUTHENUM": "رسالة واحدة وزمن ثابت + تأخير للمستخدم غير الموجود.",
      "SESSFIX": "معرّف جديد عند كل دخول + تجاهل معرّف العميل + HttpOnly/Secure/SameSite.",
      "GRAPHQL": "تفويض على مستوى الحقل + تعطيل introspection في الإنتاج + تحديد تكلفة الاستعلام.",
      "NOSQLI": "لا تدمج مُدخلات المستخدم كعوامل؛ تحقّق من النوع وابنِ المرشّح من قائمة مسموحة.",
      "FRAMING": "ارفض CL مع TE معًا بـ400، ووحّد تحليل الطلب في طبقة واحدة.",
    "INFOLEAK": "رسائل عامة للمستخدم + التفاصيل في السجلات.",
    "XSSATTR": "ترميز الاقتباسات في السمات + CSP.",
    "XSSJS": "JSON آمن بدل الدمج في JS + ترميز سياقي.",
    "XSSPOLY": "ترميز سياقي لكل موضع + CSP صارمة.",
    "CSPWEAK": "مصادر محددة + nonces + object-src 'none'.",
    "APIAUTH": "مصادقة وتفويض على كل واجهة.",
    "SSRF": "قائمة عناوين مسموحة + حظر الشبكات الداخلية + مهلة.",
    "OPENREDIR": "وجهات نسبية داخلية فقط أو قائمة مسموحة.",
    "CSRF": "رمز CSRF لكل نموذج + SameSite + تحقق Origin.",
    "SECHDRS": "CSP + X-Frame-Options + nosniff + Referrer-Policy.",
}

SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
SEV_AR = {"critical": "حرجة", "high": "عالية", "medium": "متوسطة",
          "low": "منخفضة", "info": "معلوماتية"}


def finding_card(row, evidence=None, cvss_override=None):
    ev = evidence or {}
    code = row["code"]
    if cvss_override:
        s, r, vec = cvss_score(cvss_override)
    else:
        got = suggest(code)
        s, r, vec = got if got else (0.0, "None", "")
    steps = ev.get("steps") or [
        f"افتح الهدف: {row.get('evidence') or code}",
        f"الدليل المسجل: {row.get('note') or '—'}",
        "كرر الخطوات اليدوية من درس الواجهة ثم زر «تحقق بنفسي».",
    ]
    return {"code": code, "title": row["name"], "owasp": row["owasp"],
            "severity": row["severity"], "severity_ar": SEV_AR.get(row["severity"], "?"),
            "cvss": s, "cvss_rating": r, "vector": vec,
            "cwe": CWE.get(code, "CWE-693"),
            "steps": steps, "impact": row.get("note") or "",
            "fix": FIXES.get(code, "راجع توجيهات OWASP."),
            "request": ev.get("request", ""),
            "response": (ev.get("response", "") or "")[:1500]}


def build_cards(scan_report, evidence_map=None, cvss_overrides=None):
    evidence_map = evidence_map or {}
    cvss_overrides = cvss_overrides or {}
    cards = [finding_card(r, evidence_map.get(r["code"]),
                          cvss_overrides.get(r["code"]))
             for r in scan_report.get("findings", [])]
    cards.sort(key=lambda c: (SEV_ORDER.get(c["severity"], 9), -c["cvss"]))
    return cards


def to_markdown(scan_report, cards, researcher="LocalLab"):
    m = scan_report["meta"]
    s = scan_report["summary"]
    L = [f"# تقرير ثغرات — {m['target']}", "",
         f"- **الباحث**: {researcher}",
         f"- **التاريخ**: {m['generated_at']}",
         f"- **النمط**: {m['mode']}",
         f"- **الملخص**: {s['findings']} ثغرة · الدرجة {s['score']} ({s['grade']})",
         "", "## الملخص التنفيذي", "",
         "ثغرات مؤكدة بأدلة إثبات (PoC) داخل نطاق مرخّص/محلي. كل بطاقة أدناه "
         "تحمل خطورتها ودرجة CVSS وخطوات إعادة الإنتاج والإصلاح المقترح.", ""]
    for c in cards:
        L += [f"## [{c['severity_ar']}] {c['title']} — CVSS {c['cvss']} ({c['cvss_rating']})", "",
              f"- **الكود**: `{c['code']}` · **OWASP**: {c['owasp']} · **CWE**: [{c['cwe']}]({CWE_URL.format(c['cwe'].split('-')[1])})",
              f"- **المتجه**: `{c['vector']}`", "",
              "### خطوات إعادة الإنتاج"] + \
             [f"{i + 1}. {st}" for i, st in enumerate(c["steps"])] + \
             ["", f"**الأثر**: {c['impact']}", "", f"**الإصلاح**: {c['fix']}", ""]
        if c["request"]:
            L += ["<details><summary>الدليل الخام</summary>", "",
                  "```http", c["request"], "```", ""]
            if c["response"]:
                L += ["```", c["response"], "```", ""]
            L += ["</details>", ""]
    L += ["> أُنتج آليًا بأداة المختبر المحلي — النطاق: loopback/مرخّص فقط.", ""]
    return "\n".join(L)


def to_html(scan_report, cards, researcher="LocalLab"):
    m = scan_report["meta"]
    s = scan_report["summary"]
    esc = _html.escape
    colors = {"critical": "#dc2626", "high": "#ea580c", "medium": "#ca8a04",
              "low": "#16a34a", "info": "#0284c7"}
    parts = [f"""<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>تقرير ثغرات — {esc(m['target'])}</title>
<style>body{{font-family:Segoe UI,Tahoma,sans-serif;background:#0f172a;color:#e2e8f0;margin:0}}
.wrap{{max-width:900px;margin:auto;padding:24px}}
.card{{background:#1e293b;border-radius:12px;padding:18px;margin:14px 0;border-right:6px solid}}
.badge{{display:inline-block;padding:3px 12px;border-radius:20px;color:#fff;font-weight:bold}}
pre{{background:#020617;padding:12px;border-radius:8px;overflow:auto;direction:ltr;text-align:left}}
a{{color:#38bdf8}}</style></head><body><div class="wrap">
<h1>تقرير ثغرات</h1>
<p>الباحث: <b>{esc(researcher)}</b> · الهدف: <b>{esc(m['target'])}</b> · {esc(m['generated_at'])}</p>
<p>الملخص: <b>{s['findings']} ثغرة</b> · الدرجة {s['score']} ({esc(s['grade'])})</p>"""]
    for c in cards:
        col = colors.get(c["severity"], "#64748b")
        steps = "".join(f"<li>{esc(x)}</li>" for x in c["steps"])
        raw = ""
        if c["request"]:
            raw = f"<details><summary>الدليل الخام</summary><pre>{esc(c['request'])}</pre>"
            if c["response"]:
                raw += f"<pre>{esc(c['response'])}</pre>"
            raw += "</details>"
        parts.append(f"""<div class="card" style="border-color:{col}">
<span class="badge" style="background:{col}">{esc(c['severity_ar'])} · CVSS {c['cvss']}</span>
<h2>{esc(c['title'])}</h2>
<p><code>{esc(c['code'])}</code> · {esc(c['owasp'])} · {esc(c['cwe'])}<br>
<code dir="ltr">{esc(c['vector'])}</code></p>
<h3>خطوات إعادة الإنتاج</h3><ol>{steps}</ol>
<p><b>الأثر:</b> {esc(c['impact'])}</p>
<p><b>الإصلاح:</b> {esc(c['fix'])}</p>{raw}</div>""")
    parts.append("</div></body></html>")
    return "\n".join(parts)


def write_reports(outdir, scan_report, evidence_map=None, cvss_overrides=None,
                  researcher="LocalLab"):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    cards = build_cards(scan_report, evidence_map, cvss_overrides)
    md = to_markdown(scan_report, cards, researcher)
    ht = to_html(scan_report, cards, researcher)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    mdp = outdir / f"bounty_report_{ts}.md"
    htp = outdir / f"bounty_report_{ts}.html"
    mdp.write_text(md, encoding="utf-8")
    htp.write_text(ht, encoding="utf-8")
    (outdir / "bounty_cards.json").write_text(
        json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"md": str(mdp), "html": str(htp), "cards": len(cards)}
