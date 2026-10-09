"""
local-lab/scanner/scoped.py — نطاق صارم للبيئات المرخصة.
========================================================
نسختان من القيد:
  - LOOPBACK (افتراضي): تعمل محليًا فقط (جهازك).
  - AUTHORIZED : نطاق دقيق هدف واحد مصرح (ALLOW_TARGETS) مع توكيد مكتوب "أؤكد".

أي مضيف خارج النطاق المصرح يُرفض فورًا قبل أي اتصال.
"""
import ipaddress
import re

LOOPBACK_OK = {"localhost", "127.0.0.1", "::1", "[::1]"}


def normalize_host(s: str) -> str:
    """يعيد المضيف متجردًا من مخطط/بورت/مسار."""
    if s is None:
        raise ValueError("مضيف مفقود")
    low = s.strip().lower()
    if "://" in low:
        low = low.split("://", 1)[1]
    if low.startswith("::1"):
        return "127.0.0.1"
    low = re.sub(r"(?<=[^:])[/:].*$", "", low)
    low = re.sub(r"^\[|\]$", "", low)
    if low in LOOPBACK_OK:
        return "127.0.0.1"
    return low


def is_loopback(host: str) -> bool:
    n = normalize_host(host)
    if n == "127.0.0.1":
        return True
    try:
        return ipaddress.ip_address(n).is_loopback
    except ValueError:
        return False


def split_target(url: str) -> tuple[str, str, int]:
    """يفكك رابطًا إلى (مخطط، مضيف معياري، منفذ) — المنفذ الافتراضي حسب المخطط.

    المنفذ جزء من النطاق المرخص: هدف:8000 ≠ هدف:9000 (سطح مختلف).
    """
    if "://" not in url:
        raise ValueError("رابط بلا مخطط.")
    scheme, rest = url.split("://", 1)
    scheme = scheme.lower()
    if scheme not in ("http", "https"):
        raise ValueError("بروتوكول غير معتمد.")
    hostport = rest.split("/", 1)[0]
    if hostport.startswith("["):  # IPv6 [::1]:port
        host, _, port_s = hostport[1:].partition("]:")
        host = host.rstrip("]")
    elif hostport.count(":") > 1 and not hostport.startswith("["):
        host, port_s = hostport, ""  # IPv6 بلا أقواس — بلا منفذ
    else:
        host, _, port_s = hostport.partition(":")
    host = normalize_host(host)
    try:
        port = int(port_s) if port_s else (443 if scheme == "https" else 80)
    except ValueError:
        raise ValueError(f"منفذ غير صالح: {port_s!r}")
    return scheme, host, port


def assert_target_allowed(raw_url: str, allowed: list[str], confirm: bool) -> str:
    """يتطلب:
       - الثلاثي (مخطط، مضيف، منفذ) ضمن allowed (بعد التطبيع)
       - confirm == True
    يعيد الجزء {scheme}://{host} لاستعماله لاحقًا. يرفع ValueError عند الرفض.
    """
    if not confirm:
        raise ValueError("توكيد مرتفع: هذا الهدف خارج الوضع المحلي ويتطلب موافقة صريحة.")
    scheme, host, port = split_target(raw_url)
    allowed_norm = set()
    for a in allowed:
        try:
            allowed_norm.add(split_target(a if "://" in a else f"{scheme}://{a}"))
        except ValueError:
            continue
    if (scheme, host, port) not in allowed_norm:
        show = sorted(f"{s}://{h}:{p}" for s, h, p in allowed_norm) or ["(فارغ)"]
        raise ValueError(
            f"مرفوض: {scheme}://{host}:{port} ليس ضمن نطاقك المرخص ({show})."
        )
    return f"{scheme}://{host}"


class Scope:
    """نطاق قابل للفحص في أيّ معاملة HTTP."""

    def __init__(self, mode: str = "loopback", allow: list[str] | None = None,
                 confirm: bool = False):
        self.mode = mode
        self.allowed = list(allow or [])
        self.confirm = confirm

    def check_url(self, url: str) -> str:
        """يرفض/يعوّد أي مضيف ليس في النطاق. يعيد host المعياري."""
        if "://" not in url:
            raise ValueError("رابط بلا مخطط.")
        scheme, rest = url.split("://", 1)
        if scheme not in ("http", "https"):
            raise ValueError("بروتوكول غير معتمد.")
        host = normalize_host(rest)
        if self.mode == "loopback":
            if not is_loopback(host):
                raise ValueError(
                    f"مرفوض (loopback): الهدف {host!r} ليس جهازك. "
                    "لأهداف مرخصة استخدم وضع authorized مع توكيد."
                )
            return host
        if self.mode == "authorized":
            return assert_target_allowed(url, self.allowed, self.confirm)
        raise ValueError("نمط نطاق غير معروف.")