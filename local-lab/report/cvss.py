"""
report/cvss.py — حاسبة CVSS v3.1 الرسمية (Base فقط).
====================================================
المعادلات من مواصفة FIRST الرسمية:
  ISS = 1 - [(1-C)(1-I)(1-A)]
  Scope Unchanged: Impact = 6.42 * ISS
  Scope Changed:   Impact = 7.52*(ISS-0.029) - 3.25*(ISS-0.029)^15
  Exploitability = 8.22 * AV * AC * PR * UI
  Unchanged: Base = roundup(min(Impact + Exploitability, 10))
  Changed:   Base = roundup(min(1.08*(Impact + Exploitability), 10))
التقييم: None 0.0 / Low 0.1-3.9 / Medium 4.0-6.9 / High 7.0-8.9 / Critical 9.0-10.0
"""
from decimal import Decimal, ROUND_CEILING

AV = {"N": 0.85, "A": 0.62, "L": 0.55, "P": 0.2}
AC = {"L": 0.77, "H": 0.44}
UI = {"N": 0.85, "R": 0.62}
CIA = {"N": 0.0, "L": 0.22, "H": 0.56}
PR_U = {"N": 0.85, "L": 0.62, "H": 0.27}   # Scope Unchanged
PR_C = {"N": 0.85, "L": 0.68, "H": 0.5}    # Scope Changed
ORDER = ["AV", "AC", "PR", "UI", "S", "C", "I", "A"]


def roundup(value: float) -> float:
    """أصغر رقم بعشر واحد ≥ القيمة (يتحمّل غبار float عبر Decimal)."""
    d = (Decimal(str(value)) * 10).to_integral_value(rounding=ROUND_CEILING)
    return float(d) / 10.0


def rating(score: float) -> str:
    if score <= 0.0:
        return "None"
    if score <= 3.9:
        return "Low"
    if score <= 6.9:
        return "Medium"
    if score <= 8.9:
        return "High"
    return "Critical"


def parse_vector(vector: str) -> dict:
    """يحلّل 'CVSS:3.1/AV:N/...' إلى قاموس مقاييس مع تحقق صارم."""
    v = vector.strip()
    if v.startswith("CVSS:3.1/"):
        v = v[len("CVSS:3.1/"):]
    parts = v.split("/")
    m = {}
    for p in parts:
        if ":" not in p:
            raise ValueError(f"مقطع ناقص: {p!r}")
        k, val = p.split(":", 1)
        m[k] = val
    if set(m) != {"AV", "AC", "PR", "UI", "S", "C", "I", "A"}:
        raise ValueError(f"مقاييس ناقصة/زائدة: {sorted(m)}")
    if m["AV"] not in AV or m["AC"] not in AC or m["UI"] not in UI:
        raise ValueError("قيمة AV/AC/UI غير صالحة")
    if m["PR"] not in PR_U or m["S"] not in ("U", "C"):
        raise ValueError("قيمة PR/S غير صالحة")
    if m["C"] not in CIA or m["I"] not in CIA or m["A"] not in CIA:
        raise ValueError("قيمة C/I/A غير صالحة")
    return m


def build_vector(m: dict) -> str:
    return "CVSS:3.1/" + "/".join(f"{k}:{m[k]}" for k in ORDER)


def score(metrics) -> tuple:
    """يعيد (base_score, rating, vector). يقبل قاموسًا أو سلسلة متجه."""
    m = parse_vector(metrics) if isinstance(metrics, str) else dict(metrics)
    iss = 1 - ((1 - CIA[m["C"]]) * (1 - CIA[m["I"]]) * (1 - CIA[m["A"]]))
    changed = m["S"] == "C"
    if not changed:
        impact = 6.42 * iss
    else:
        impact = 7.52 * (iss - 0.029) - 3.25 * ((iss - 0.029) ** 15)
    pr = (PR_C if changed else PR_U)[m["PR"]]
    exploit = 8.22 * AV[m["AV"]] * AC[m["AC"]] * pr * UI[m["UI"]]
    if impact <= 0:
        base = 0.0
    elif not changed:
        base = roundup(min(impact + exploit, 10))
    else:
        base = roundup(min(1.08 * (impact + exploit), 10))
    return base, rating(base), build_vector(m)


# ------------------------------------------------------------------ اقتراحات
# متجهات افتراضية محافظة لأكواد فحوصات المختبر (تقبل التجاوز اليدوي).
SUGGESTED = {
    "SQLLOGIN":  "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    "SQLSEARCH": "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N",
    "SQLBLIND":  "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N",
    "SQLTIME":   "AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N",
    "XSSREFLECT": "AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
    "XSSSTORED": "AV:N/AC:L/PR:L/UI:R/S:C/C:L/I:L/A:N",
    "IDOR":      "AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:L/A:N",
    "PATH":      "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N",
    "UPLOAD":    "AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:H",
    "CMDI":      "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    "SSTI":      "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    "WEAKCOOKIE": "AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:N",
    "JWTNONE":  "AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:H/A:N",
    "JWTWEAK":   "AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:H/A:N",
    "NOLOCK":    "AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:L",
      "AUTHENUM":  "AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N",
      "SESSFIX":   "AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:H/A:N",
      "GRAPHQL":   "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N",
      "NOSQLI":    "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N",
      "FRAMING":   "AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H",
    "INFOLEAK":  "AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N",
    "XSSATTR":   "AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
    "XSSJS":     "AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
    "XSSPOLY":   "AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
    "CSPWEAK":   "AV:N/AC:H/PR:N/UI:R/S:U/C:N/I:L/A:N",
    "APIAUTH":   "AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N",
    "SSRF":      "AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:L/A:N",
    "OPENREDIR": "AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
    "CSRF":      "AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:L/A:N",
    "SECHDRS":   "AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N",
    "XXE":       "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:L",
    "LFI":       "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N",
    "MASSASSIGN": "AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:H/A:N",
    "CORSLAB":   "AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
}


def suggest(code: str):
    """يعيد (score, rating, vector) للكود أو None إن لم يُعرَف."""
    v = SUGGESTED.get(code)
    if not v:
        return None
    s, r, vec = score(parse_vector(v))
    return s, r, vec
