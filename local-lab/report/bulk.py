"""
report/bulk.py — التصدير الجماعي لمحفظة Bounty متعددة الأهداف.
================================================================
المدخل: عناصر [{report, evidence_map?, label?}] حيث report إما
  - تقرير build_report جاهز، أو
  - ملف مشروع محفوظ (util/project) يُعاد بناؤه تقريرًا، أو
  - مسار ملف JSON لأي منهما.
المخرج: مجلد مؤرخ يحوي index.html + index.md + summary.csv +
صفحات MD/HTML لكل هدف.
"""
import csv
import html as _html
import io
import json
from datetime import datetime, timezone
from pathlib import Path

try:
    from bounty import build_cards, to_html, to_markdown
except ImportError:
    from .bounty import build_cards, to_html, to_markdown

SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


def _as_report(item):
    """يعيد (report, evidence_map, label) من أي شكل مدعوم."""
    if isinstance(item, dict) and "report" in item:
        rep = item["report"]
        if isinstance(rep, (str, Path)) and Path(rep).exists():
            rep = json.loads(Path(rep).read_text(encoding="utf-8"))
        if isinstance(rep, dict) and "rows_done" in rep:
            rep = _project_to_report(rep)
        if not isinstance(rep, dict) or "meta" not in rep:
            raise ValueError("تقرير غير صالح في التصدير الجماعي.")
        return rep, item.get("evidence_map") or {}, \
            item.get("label") or rep["meta"]["target"]
    if isinstance(item, (str, Path)) and Path(item).exists():
        data = json.loads(Path(item).read_text(encoding="utf-8"))
        if "rows_done" in data:
            rep = _project_to_report(data)
            return rep, {}, rep["meta"]["target"]
        return data, {}, data["meta"]["target"]
    raise ValueError("عنصر غير مدعوم في التصدير الجماعي.")


def _project_to_report(state):
    """يعيد بناء تقرير build_report من ملف مشروع محفوظ."""
    try:
        from local_scan import build_report
    except ImportError:
        from scanner.local_scan import build_report
    rows = list(state.get("rows_done", []))
    base = state.get("target", "?")
    return build_report(rows, base, base, state.get("mode", "?"),
                        datetime.now(timezone.utc))


def _slug(label, i):
    safe = "".join(c if (c.isalnum() or c in "-_") else "_" for c in label)
    if not safe.strip("_"):
        safe = f"site{i}"  # تسميات غير لاتينية خالصة (عربية) تُرقَّم
    return f"target_{i:02d}_{(safe[:30] or 'site')}"


def export_bulk(outdir, items, researcher="LocalLab"):
    """يصدّر المحفظة. يعيد {dir, index_html, index_md, csv, targets:[...]}."""
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    targets = []
    csv_rows = []
    for i, item in enumerate(items, 1):
        rep, evmap, label = _as_report(item)
        cards = build_cards(rep, evmap)
        slug = _slug(label, i)
        md = to_markdown(rep, cards, researcher)
        ht = to_html(rep, cards, researcher)
        (outdir / f"{slug}.md").write_text(md, encoding="utf-8")
        (outdir / f"{slug}.html").write_text(ht, encoding="utf-8")
        s = rep["summary"]
        targets.append({"label": label, "slug": slug,
                        "findings": s["findings"],
                        "total": s["checks_total"], "score": s["score"],
                        "grade": s["grade"],
                        "by_severity": dict(s["by_severity"])})
        for c in cards:
            csv_rows.append({"target": label, "code": c["code"],
                             "title": c["title"],
                             "severity": c["severity"], "cvss": c["cvss"],
                             "rating": c["cvss_rating"], "cwe": c["cwe"],
                             "owasp": c["owasp"]})
    cards_sorted = sorted(targets, key=lambda t: -t["score"])
    (outdir / "index.md").write_text(_index_md(cards_sorted, researcher),
                                     encoding="utf-8")
    (outdir / "index.html").write_text(_index_html(cards_sorted, researcher),
                                       encoding="utf-8")
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["target", "code", "title",
                                        "severity", "cvss", "rating",
                                        "cwe", "owasp"])
    w.writeheader()
    for r in sorted(csv_rows, key=lambda r: (
            SEV_ORDER.get(r["severity"], 9), -float(r["cvss"] or 0))):
        w.writerow(r)
    (outdir / "summary.csv").write_text("\ufeff" + buf.getvalue(),
                                        encoding="utf-8")
    return {"dir": str(outdir),
            "index_html": str(outdir / "index.html"),
            "index_md": str(outdir / "index.md"),
            "csv": str(outdir / "summary.csv"),
            "targets": len(targets),
            "findings": len(csv_rows)}


def _index_md(targets, researcher):
    L = [f"# محفظة Bounty — {researcher}", "",
         f"الأهداف: {len(targets)} · "
         f"مجموع الثغرات: {sum(t['findings'] for t in targets)}", "",
         "| الهدف | ثغرات | الدرجة | حرجة | عالية | التقرير |",
         "|---|---|---|---|---|---|"]
    for t in targets:
        b = t["by_severity"]
        L.append(f"| {t['label']} | {t['findings']}/{t['total']} | "
                 f"{t['score']} ({t['grade']}) | {b.get('critical', 0)} | "
                 f"{b.get('high', 0)} | [{t['slug']}]({t['slug']}.md) |")
    return "\n".join(L) + "\n"


def _index_html(targets, researcher):
    esc = _html.escape
    rows = "".join(
        f"<tr><td>{esc(t['label'])}</td><td>{t['findings']}/{t['total']}</td>"
        f"<td>{t['score']} ({esc(t['grade'])})</td>"
        f"<td>{t['by_severity'].get('critical', 0)}</td>"
        f"<td>{t['by_severity'].get('high', 0)}</td>"
        f"<td><a href='{t['slug']}.html'>HTML</a> · "
        f"<a href='{t['slug']}.md'>MD</a></td></tr>"
        for t in targets)
    return f"""<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>محفظة Bounty — {esc(researcher)}</title>
<style>body{{font-family:Segoe UI,Tahoma,sans-serif;background:#0f172a;color:#e2e8f0}}
.wrap{{max-width:960px;margin:auto;padding:24px}}
table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #334155;padding:8px;text-align:right}}
th{{background:#1e293b;color:#7dd3fc}}a{{color:#38bdf8}}</style></head>
<body><div class="wrap"><h1>محفظة Bounty — {esc(researcher)}</h1>
<p>الأهداف: {len(targets)} · مجموع الثغرات: {sum(t['findings'] for t in targets)}</p>
<table><tr><th>الهدف</th><th>ثغرات</th><th>الدرجة</th><th>حرجة</th><th>عالية</th><th>التقرير</th></tr>
{rows}</table></div></body></html>"""
