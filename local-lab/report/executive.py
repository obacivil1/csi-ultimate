"""
report/executive.py — تقرير تنفيذي عربي للطباعة (تسليم العملاء).
===================================================================
صفحة HTML واحدة RTL ب CSS طباعة (@media print): غلاف، ملخص إداري
مُركَّب آليًا بلغة غير تقنية، أشرطة مخاطر CSS، المنهجية، جدول
النتائج، البطاقات التقنية، أولويات الإصلاح، وإخلاء النطاق.
"""
import html as _html

try:
    from bounty import build_cards
except ImportError:
    from .bounty import build_cards

SEV_AR = {"critical": "حرجة", "high": "عالية", "medium": "متوسطة",
          "low": "منخفضة", "info": "معلوماتية"}
SEV_COL = {"critical": "#dc2626", "high": "#ea580c", "medium": "#ca8a04",
           "low": "#16a34a", "info": "#0284c7"}


def _summary_text(s, top):
    parts = []
    c, h, m = (s["by_severity"].get(k, 0)
               for k in ("critical", "high", "medium"))
    if c:
        parts.append(f"توجد {c} ثغرة حرجة تتطلب تدخلًا فوريًا")
    if h:
        parts.append(f"{h} ثغرة عالية الخطورة")
    if m:
        parts.append(f"{m} ثغرة متوسطة")
    if not parts:
        return ("لم تُؤكَّد ثغرات جوهرية في نطاق هذا الفحص. "
                "يُنصح بالمراقبة الدورية.")
    names = "، ".join(f"«{t}»" for t in top[:3])
    return ("أظهر الفحص " + " و".join(parts) + f" (الدرجة {s['score']}). "
            f"أخطر ما وُجد: {names}. "
            "التوصية: معالجة الحرجة أولًا ثم العالية وفق جدول الأولويات أدناه.")


def to_html(scan_report, researcher="LocalLab",
            scope_note="فحص مصرح ضمن النطاق المتفق عليه فقط.",
            evidence_map=None):
    m = scan_report["meta"]
    s = scan_report["summary"]
    esc = _html.escape
    cards = build_cards(scan_report, evidence_map or {})
    top = [c["title"] for c in cards[:5]]
    bars = "".join(
        f"<div class='brow'><span>{SEV_AR[k]}</span>"
        f"<div class='bar'><div style='width:{min(100, v * 12)}%;"
        f"background:{SEV_COL[k]}'></div></div><b>{v}</b></div>"
        for k, v in (("critical", s["by_severity"].get("critical", 0)),
                     ("high", s["by_severity"].get("high", 0)),
                     ("medium", s["by_severity"].get("medium", 0)),
                     ("low", s["by_severity"].get("low", 0))))
    rows = "".join(
        f"<tr><td>{esc(c['title'])}</td><td>{SEV_AR.get(c['severity'], '?')}</td>"
        f"<td>CVSS {c['cvss']}</td><td>{esc(c['cwe'])}</td></tr>"
        for c in cards)
    detail = "".join(
        f"<div class='fcard'><h3>{esc(c['title'])} "
        f"<span class='badge' style='background:{SEV_COL.get(c['severity'], '#64748b')}'>"
        f"{SEV_AR.get(c['severity'], '?')} · CVSS {c['cvss']}</span></h3>"
        f"<p><b>الأثر:</b> {esc(c['impact'])}</p>"
        f"<p><b>الإصلاح:</b> {esc(c['fix'])}</p>"
        f"<p class='mono' dir='ltr'>{esc(c['vector'])}</p></div>"
        for c in cards)
    return f"""<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>تقرير تنفيذي — {esc(m['target'])}</title>
<style>
body{{font-family:Segoe UI,Tahoma,Arial,sans-serif;background:#f1f5f9;color:#0f172a;margin:0}}
.cover{{background:#0f172a;color:#fff;padding:48px 40px}}
.wrap{{max-width:900px;margin:auto;padding:24px}}
h1{{margin:0}}h2{{border-bottom:3px solid #0ea5e9;padding-bottom:6px}}
.card{{background:#fff;border:1px solid #cbd5e1;border-radius:10px;padding:16px;margin:12px 0}}
.brow{{display:flex;align-items:center;gap:10px;margin:6px 0}}
.brow span{{width:70px}}.bar{{flex:1;background:#e2e8f0;border-radius:6px;height:14px}}
.bar div{{height:14px;border-radius:6px}}
table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #cbd5e1;padding:8px;text-align:right}}
th{{background:#0f172a;color:#fff}}
.fcard{{background:#fff;border:1px solid #cbd5e1;border-right:6px solid #0ea5e9;border-radius:8px;padding:12px;margin:10px 0}}
.badge{{color:#fff;padding:2px 10px;border-radius:12px;font-size:13px}}
.mono{{font-family:Consolas,monospace;font-size:12px;color:#475569}}
.small{{color:#475569;font-size:13px}}
@media print{{.cover{{-webkit-print-color-adjust:exact;print-color-adjust:exact}}}}
</style></head><body>
<div class="cover"><div class="wrap">
<p>تقرير اختبار اختراق — تنفيذي</p>
<h1>{esc(m['target'])}</h1>
<p>الباحث: {esc(researcher)} · التاريخ: {esc(m['generated_at'][:10])} · النمط: {esc(m['mode'])}</p>
</div></div><div class="wrap">
<h2>الملخص الإداري</h2>
<div class="card"><p>{esc(_summary_text(s, top))}</p>
<p>الدرجة الإجمالية: <b>{s['score']}</b> ({esc(s['grade'])}) —
{s['findings']} ثغرة مؤكدة من {s['checks_total']} فحصًا.</p></div>
<h2>مستوى المخاطر</h2><div class="card">{bars}</div>
<h2>المنهجية</h2>
<div class="card"><ol>
<li>الاستطلاع: خريطة الموقع والبصمة والترويسات.</li>
<li>المسح الآلي: فحوصات OWASP مصنفة بالخطورة.</li>
<li>المسح النشط: حقن مصنف للنقاط المكتشفة.</li>
<li>إثبات السيطرة (PoC) وتوثيق الأدلة الخام.</li>
<li>التقييم CVSS 3.1 وتوصيات الإصلاح مرتبة بالأولوية.</li>
</ol></div>
<h2>جدول النتائج</h2>
<table><tr><th>الثغرة</th><th>الخطورة</th><th>CVSS</th><th>CWE</th></tr>{rows or '<tr><td colspan="4">لا ثغرات مؤكدة.</td></tr>'}</table>
<h2>التفاصيل التقنية</h2>{detail or '<div class="card">لا تفاصيل.</div>'}
<h2>إخلاء النطاق</h2>
<div class="card small">{esc(scope_note)} جميع الأنشطة موثقة بسجل تدقيق hash-chain.</div>
</div></body></html>"""
