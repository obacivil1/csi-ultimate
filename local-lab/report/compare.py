"""
report/compare.py — مقارنة تقريرين (قبل/بعد الإصلاح، مرحلي/إنتاج).
====================================================================
compare_reports(rep_a, rep_b, label_a, label_b) -> قاموس المقارنة:
  مصفوفة كل فحص (الحالة في كل نسخة + الوضع: جديد/مُصلح/مستمر/سليم)،
  فرق الدرجة والتقدير، وقوائم new/fixed/persisting/changed.
to_markdown / to_html لصفحة مقارنة جاهزة للعميل.
"""
import html as _html
from datetime import datetime, timezone

STATE_AR = {"new": "🆕 جديد", "fixed": "✅ أُصلح", "persisting": "🔁 مستمر",
            "changed": "✏️ تغيّر", "clear": "— سليم"}


def compare_reports(rep_a, rep_b, label_a="قبل", label_b="بعد"):
    ma = {r["code"]: r for r in rep_a.get("all_checks", [])}
    mb = {r["code"]: r for r in rep_b.get("all_checks", [])}
    matrix, new, fixed, persisting, changed, clear = [], [], [], [], [], []
    for code in sorted(set(ma) | set(mb)):
        a, b = ma.get(code), mb.get(code)
        av = bool(a and a["verdict"])
        bv = bool(b and b["verdict"])
        row = {"code": code, "name": (a or b)["name"],
               "severity": (a or b)["severity"],
               "a": "✓" if av else "—", "b": "✓" if bv else "—"}
        if bv and not av:
            row["state"] = "new"
            new.append(code)
        elif av and not bv:
            row["state"] = "fixed"
            fixed.append(code)
        elif av and bv:
            if (a.get("note") or "") != (b.get("note") or ""):
                row["state"] = "changed"
                changed.append(code)
            else:
                row["state"] = "persisting"
                persisting.append(code)
        else:
            row["state"] = "clear"
            clear.append(code)
        matrix.append(row)
    sa, sb = rep_a["summary"], rep_b["summary"]
    return {"label_a": label_a, "label_b": label_b,
            "target": rep_b["meta"].get("target", "?"),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "score_a": sa["score"], "score_b": sb["score"],
            "delta": sb["score"] - sa["score"],
            "grade_a": sa["grade"], "grade_b": sb["grade"],
            "findings_a": sa["findings"], "findings_b": sb["findings"],
            "new": new, "fixed": fixed, "persisting": persisting,
            "changed": changed, "clear": clear, "matrix": matrix}


def to_markdown(comp):
    L = [f"# مقارنة فحصين — {comp['target']}", "",
         f"- **{comp['label_a']}**: {comp['findings_a']} ثغرة · "
         f"الدرجة {comp['score_a']} ({comp['grade_a']})",
         f"- **{comp['label_b']}**: {comp['findings_b']} ثغرة · "
         f"الدرجة {comp['score_b']} ({comp['grade_b']})",
         f"- **الفرق**: {'+' if comp['delta'] >= 0 else ''}{comp['delta']}",
         f"- 🆕 جديد: {', '.join(comp['new']) or '—'}",
         f"- ✅ أُصلح: {', '.join(comp['fixed']) or '—'}",
         f"- 🔁 مستمر: {', '.join(comp['persisting']) or '—'}", "",
         f"| الكود | الثغرة | الخطورة | {comp['label_a']} | "
         f"{comp['label_b']} | الوضع |",
         "|---|---|---|---|---|---|"]
    for r in comp["matrix"]:
        L.append(f"| {r['code']} | {r['name']} | {r['severity']} | {r['a']} | "
                 f"{r['b']} | {STATE_AR[r['state']]} |")
    return "\n".join(L) + "\n"


def to_html(comp):
    esc = _html.escape
    d = comp["delta"]
    dcls = "#dc2626" if d > 0 else ("#16a34a" if d < 0 else "#94a3b8")
    rows = "".join(
        f"<tr><td><code>{r['code']}</code></td><td>{esc(r['name'])}</td>"
        f"<td>{r['severity']}</td><td>{r['a']}</td><td>{r['b']}</td>"
        f"<td>{STATE_AR[r['state']]}</td></tr>"
        for r in comp["matrix"])
    return f"""<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>مقارنة فحصين</title>
<style>body{{font-family:Segoe UI,Tahoma,sans-serif;background:#0f172a;color:#e2e8f0}}
.wrap{{max-width:960px;margin:auto;padding:24px}}
table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #334155;padding:8px;text-align:right}}
th{{background:#1e293b;color:#7dd3fc}}.delta{{font-size:28px;font-weight:bold;color:{dcls}}}</style>
</head><body><div class="wrap"><h1>مقارنة فحصين — {esc(comp['target'])}</h1>
<p>{esc(comp['label_a'])}: <b>{comp['findings_a']}</b> ثغرة (درجة {comp['score_a']}) ←
{esc(comp['label_b'])}: <b>{comp['findings_b']}</b> ثغرة (درجة {comp['score_b']})</p>
<p class="delta">الفرق: {'+' if d >= 0 else ''}{d}</p>
<p>🆕 جديد: {esc(', '.join(comp['new'])) or '—'}<br>
✅ أُصلح: {esc(', '.join(comp['fixed'])) or '—'}<br>
🔁 مستمر: {esc(', '.join(comp['persisting'])) or '—'}</p>
<table><tr><th>الكود</th><th>الثغرة</th><th>الخطورة</th><th>{esc(comp['label_a'])}</th>
<th>{esc(comp['label_b'])}</th><th>الوضع</th></tr>{rows}</table></div></body></html>"""
