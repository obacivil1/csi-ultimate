"""
local-lab/scanner/hostguard.py — قيد صارم للمحلي فقط
---------------------------------------------------
أي هدف خارج 127.0.0.1/localhost/::1 يُرفض فورًا قبل أي إجراء.
هدفه: ضمانة ميكانيكية أن هذه الأداة لا تُوجّه أبدًا لجهاز آخر.
"""
import ipaddress
import re

ALLOWED_HOSTS = {"localhost", "127.0.0.1", "::1"}


def assert_local(host: str) -> str:
    """يرفض أي مضيف ليس محليًا. يعيد المضيف المعياري (127.0.0.1)."""
    if host is None:
        raise ValueError("مضيف مفقود")
    low = host.strip().lower()
    # نزيل أي مخطط (http://)
    if "://" in low:
        low = low.split("://", 1)[1]
    # نعالج loopback قبل قطع النقطتين
    if low in {"localhost", "::1", "[::1]", "localhost:5001", "[::1]:5001"} or low.startswith("::1"):
        return "127.0.0.1"
    # أي بورت/مسار متبقٍّ
    low = re.sub(r"[:/].*$", "", low)
    if low == "127.0.0.1":
        return "127.0.0.1"
    try:
        ip = ipaddress.ip_address(low)
    except ValueError:
        raise ValueError(f"مضيف غير معروف: {host!r}")
    if not ip.is_loopback:
        raise ValueError(f"مُرفض: الهدف {host!r} ليس محليًا (loopback فقط مسموح).")
    return str(ip)


def parse_base(raw: str) -> str:
    """يحلّل http://IP:port → 127.0.0.1:port، مع فرض loopback."""
    if not raw:
        raise ValueError("رابط فارغ")
    if "://" in raw:
        raw = raw.split("://", 1)[1]
    hostpart = raw
    port = 5001
    if "/" in raw:
        hostpart = raw.split("/", 1)[0]
    if ":" in hostpart:
        h, _, p = hostpart.rpartition(":")
        hostpart = h or "127.0.0.1"
        port = int(p)
    ip = assert_local(hostpart)
    return f"{ip}:{port}"