"""hypothesis_builder.py — تحويل الملاحظات إلى فروض قابلة للفحص اليدوي.

الفكرة: بعد أن رتّبنا العناوين ووجدنا التكرار والشواذ، ندمج الإشارات
ونقترح عليك جملًا مثل: «هذا الباب قد يكون مفتوحًا — افحصه بنفسك بحسابين».
العقل يقترح فقط. أنت تختبر يدويًا. لا شبكة هنا أبدًا.
"""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

# مقطع رقمي كامل في المسار، مثل /123
_NUMERIC_SEGMENT_RE = re.compile(r"^\d+$")
# قيمة رقمية كاملة في الاستعلام، مثل ?id=5
_NUMERIC_VALUE_RE = re.compile(r"^\d+$")
# نسخة API في المسار
_VERSION_RE = re.compile(r"/v\d+/", re.IGNORECASE)
# أسماء المعاملات الحساسة التي تستحق فرضية صلاحيات
_SENSITIVE_PARAMS = frozenset({"id", "user", "uid", "account", "token"})

# ترتيب الثقة للفرز: العالية أولًا
_CONFIDENCE_ORDER = {"high": 0, "medium": 1, "low": 2}

# حد أقصى لعدد الفروض حتى تبقى القائمة قابلة للقراءة
_MAX_HYPOTHESES = 20


def _has_numeric_identifier(url: str) -> str | None:
    """هل في العنوان رقم يصلح للتجربة؟ تعيد وصفه أو None."""
    parsed = urlparse(url)
    segments = [s for s in (parsed.path or "/").split("/") if s]
    if any(_NUMERIC_SEGMENT_RE.match(s) for s in segments):
        return "مقطع رقمي في المسار"
    values = [v for vs in parse_qs(parsed.query).values() for v in vs]
    if any(_NUMERIC_VALUE_RE.match(v.strip()) for v in values):
        return "قيمة رقمية في الاستعلام"
    return None


def _normalize_version(url: str) -> str:
    """وحّد النسخة للمقارنة: /v1/ و /v2/ تصبح /vX/."""
    parsed = urlparse(url)
    norm_path = _VERSION_RE.sub("/vX/", parsed.path or "/")
    return norm_path


def build_hypotheses(
    ranked: list[dict],
    patterns: dict,
    anomalies: list[dict],
) -> list[dict]:
    """ادمج إشارات الوحدات الثلاث واقترح فروضًا مرتبة (20 كحد أقصى)."""
    hyps: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def add(category: str, url: str, title: str, what_to_test: str, why: str, confidence: str) -> None:
        # منع التكرار: نفس الفئة ونفس العنوان مرة واحدة فقط
        key = (category, url)
        if key in seen:
            return
        seen.add(key)
        hyps.append({
            "title": title,
            "what_to_test": what_to_test,
            "url": url,
            "why": why,
            "confidence": confidence,
            "category": category,
        })

    # أ) فرضية IDOR: رقم + درجة 5 فأكثر → ثقة عالية
    for entry in ranked or []:
        url = str(entry.get("url", ""))
        try:
            score = int(entry.get("score", 0))
        except (TypeError, ValueError):
            score = 0
        if score < 5:
            continue
        evidence = _has_numeric_identifier(url)
        if evidence is None:
            continue
        add(
            "idor", url,
            title=f"احتمال IDOR في {url}",
            what_to_test=f"اختبر تغيير الرقم في {url} بحسابين مختلفين",
            why=f"العنوان حصل على درجة {score} وفيه {evidence}",
            confidence="high",
        )

    # ب) فرضية الانكشاف: رد فارغ أو خطأ خادم → ثقة متوسطة
    for a in anomalies or []:
        reason = str(a.get("reason", ""))
        if reason not in ("unusually_small_200", "server_error"):
            continue
        url = str(a.get("url", ""))
        add(
            "exposure", url,
            title=f"رد غير معتاد في {url}",
            what_to_test=f"افحص {url} يدويًا — يبدو أنه يعيد شيئًا غير معتاد",
            why=f"كاشف الشواذ سجل «{reason}» لهذا العنوان",
            confidence="medium",
        )

    # ج) فرضية النسخ: موجود في v1 وليس v2 (أو العكس) → ثقة منخفضة
    versioned = (patterns or {}).get("versioned_endpoints", {}) or {}
    by_norm: dict[str, dict[str, str]] = {}
    for ver, urls in versioned.items():
        if ver == "unversioned":
            continue
        for u in urls or []:
            by_norm.setdefault(_normalize_version(str(u)), {})[ver] = str(u)
    for norm, vers in by_norm.items():
        if len(vers) == 1:
            only_ver = next(iter(vers))
            url = vers[only_ver]
            other = "v2" if only_ver == "v1" else "v1"
            add(
                "logic", url,
                title=f"فرق نسخ محتمل في {norm}",
                what_to_test=f"قارن سلوك /{only_ver} مع /{other} في {norm} — قد تختلف الصلاحيات",
                why=f"المسار موجود في {only_ver} فقط وليس في النسخة الأخرى",
                confidence="low",
            )

    # د) فرضية المعامل المتكرر: اسم حساس في 3 مسارات فأكثر → ثقة متوسطة
    for item in (patterns or {}).get("repeated_query_params", []) or []:
        name = str(item.get("name", ""))
        try:
            count = int(item.get("count", 0))
        except (TypeError, ValueError):
            count = 0
        if count < 3 or name.lower() not in _SENSITIVE_PARAMS:
            continue
        endpoints = item.get("endpoints", []) or []
        url = sorted(endpoints)[0] if endpoints else ""
        add(
            "auth", url,
            title=f"المعامل «{name}» يتكرر في {count} مسارات",
            what_to_test=f"المعامل {name} يظهر في {count} مسارات — افحص الصلاحيات في كل منها",
            why=f"كاشف الأنماط وجد المعامل الحساس «{name}» في {count} عناوين",
            confidence="medium",
        )

    # الفرز: العالية ثم المتوسطة ثم المنخفضة، والثبات أبجديًا
    hyps.sort(key=lambda h: (_CONFIDENCE_ORDER[h["confidence"]], h["url"]))
    # الحد الأقصى 20 فرضية
    return hyps[:_MAX_HYPOTHESES]
