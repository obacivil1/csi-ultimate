"""
report/pdfexport.py — تصدير PDF أصلي بخط عربي (reportlab).
============================================================
يحتاج: pip install reportlab arabic-reshaper python-bidi
(متوفرة هنا؛ الواجهة ترشد عند غيابها). الخط: Tahoma من ويندوز
(يدعم العربية) وإلا Helvetica مع تنبيه.
"""
from pathlib import Path

try:
    from bounty import build_cards
except ImportError:
    from .bounty import build_cards

SEV_AR = {"critical": "حرجة", "high": "عالية", "medium": "متوسطة",
          "low": "منخفضة", "info": "معلوماتية"}


def _ar(text):
    """تشكيل العربية (reshape + bidi) للعرض الصحيح في PDF."""
    s = "" if text is None else str(text)
    try:
        from arabic_reshaper import reshape
        from bidi.algorithm import get_display
        return get_display(reshape(s))
    except Exception:
        return s


def _register_font():
    """يسجل Tahoma (عربي) وإلا يرجع Helvetica مع علم."""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    for cand in (r"C:\Windows\Fonts\tahoma.ttf",
                 r"C:\Windows\Fonts\arial.ttf"):
        if Path(cand).exists():
            try:
                pdfmetrics.registerFont(TTFont("AR", cand))
                bd = cand.replace(".ttf", "bd.ttf")
                try:
                    pdfmetrics.registerFont(TTFont("AR-B", bd
                                                   if Path(bd).exists()
                                                   else cand))
                except Exception:
                    pass
                return "AR", "AR-B", True
            except Exception:
                pass
    return "Helvetica", "Helvetica-Bold", False


def export_pdf(scan_report, pdf_path, researcher="LocalLab"):
    """يولّد تقرير PDF تنفيذي-تقني. يعيد مسار الملف."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import (Paragraph, SimpleDocTemplate, Spacer,
                                    Table, TableStyle)
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_RIGHT

    font, font_b, has_ar = _register_font()
    m = scan_report["meta"]
    s = scan_report["summary"]
    cards = build_cards(scan_report)

    st = lambda name, size, bold=False, color=None: ParagraphStyle(
        name, fontName=font_b if bold else font, fontSize=size,
        leading=size + 4, alignment=TA_RIGHT,
        textColor=color or colors.HexColor("#0f172a"))
    story = []
    A = lambda t, size=11, bold=False, color=None: story.append(
        Paragraph(_ar(t), st(f"s{len(story)}", size, bold, color)))
    A(f"تقرير اختبار اختراق — {m['target']}", 18, True)
    A(f"الباحث: {researcher} · التاريخ: {m['generated_at'][:10]} · "
      f"النمط: {m['mode']}", 11)
    story.append(Spacer(1, 0.4 * cm))
    A(f"الملخص: {s['findings']} ثغرة مؤكدة من {s['checks_total']} فحصًا · "
      f"الدرجة {s['score']} ({s['grade']})", 12, True)
    if not has_ar:
        A("تنبيه: لا خط عربي — ثبّت Tahoma لعرض سليم.", 10,
          color=colors.red)
    story.append(Spacer(1, 0.3 * cm))

    head = [_ar("الثغرة"), _ar("الخطورة"), _ar("CVSS"), _ar("CWE")]
    rows = [head] + [[_ar(c["title"]), _ar(SEV_AR.get(c["severity"], "?")),
                      str(c["cvss"]), c["cwe"]] for c in cards]
    t = Table(rows, colWidths=[8 * cm, 2.5 * cm, 2.5 * cm, 3 * cm],
              repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), font_b),
        ("FONTNAME", (0, 1), (-1, -1), font),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(t)
    story.append(Spacer(1, 0.5 * cm))

    for c in cards:
        A(f"{c['title']} — {SEV_AR.get(c['severity'], '?')} · "
          f"CVSS {c['cvss']} ({c['cvss_rating']}) · {c['cwe']}", 12, True)
        A(f"الأثر: {c['impact']}", 10)
        A(f"الإصلاح: {c['fix']}", 10)
        A(f"المتجه: {c['vector']}", 9)
        story.append(Spacer(1, 0.3 * cm))

    pdf_path = str(pdf_path)
    doc = SimpleDocTemplate(pdf_path, pagesize=A4, rightMargin=1.5 * cm,
                            leftMargin=1.5 * cm, topMargin=1.5 * cm,
                            bottomMargin=1.5 * cm, title="تقرير نِطاق")

    def _foot(canvas, _doc):
        canvas.saveState()
        canvas.setFont(font, 9)
        canvas.setFillColor(colors.grey)
        canvas.drawString(2 * cm, 1 * cm,
                          _ar(f"نِطاق — {m['target']} · صفحة {_doc.page}"))
        canvas.restoreState()

    doc.build(story, onFirstPage=_foot, onLaterPages=_foot)
    return pdf_path
