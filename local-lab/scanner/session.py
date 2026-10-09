"""
local-lab/scanner/session.py — جلسة HTTP موثوقة تلتزم بالنطاق.
===============================================================
تُستخدم في الواجهة الرسومية. كل طلب يمر عبر Scope.check_url أولًا.
loopback الافتراضي. للمواقع المرخصة: Scope(mode="authorized", allow=[...], confirm=True).
"""
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from http.cookiejar import CookieJar
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # لmypy: تعريف واحد صريح (وقت التشغيل يختار أدناه)
    from scoped import Scope
else:
    try:
        from .scoped import Scope
    except ImportError:  # عند التشغيل المباشر/الاختبارات خارج الحزمة
        from scoped import Scope


class _GuardedRedirect(urllib.request.HTTPRedirectHandler):
    """يمنع هروب النطاق عبر التوجيه: كل قفزة تُفحص قبل اتباعها."""

    def __init__(self, guard: Callable[[str], str]):
        self._guard = guard

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = urllib.parse.urljoin(req.full_url, newurl)
        self._guard(new)  # يرفع ValueError فيُجهض الاتباع
        return super().redirect_request(req, fp, code, msg, headers,
                                        newurl)


RespTriple = tuple[int, list, bytes]


class Session:
    def __init__(self, scope: Scope | None = None, ua: str | None = None):
        self.scope = scope or Scope()          # loopback افتراضيًا
        self.jar = CookieJar()
        self.n_requests = 0  # عدّاد ميداني: كل طلب محسوب ومعلَن
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar),
            _GuardedRedirect(self.scope.check_url),
        )
        # بصمة معلنة افتراضيًا؛ التخصيص للنظافة المهنية (تجنب حجب
        # توقيع افتراضي) — لا للإخفاء عن جهة مرخصة.
        self.opener.addheaders = [("User-Agent",
                                   ua or "LocalLab/1.0 (+local-only)")]

    def _guard(self, url: str) -> None:
        self.scope.check_url(url)  # يرفض خارج النطاق قبل أي اتصال

    def request(self, method: str, url: str, data: bytes | None = None,
                headers: dict | None = None, timeout: float = 6) -> RespTriple:
        self._guard(url)
        self.n_requests += 1
        req = urllib.request.Request(url, data=data, method=method,
                                     headers=headers or {})
        try:
            with self.opener.open(req, timeout=timeout) as resp:
                return resp.status, resp.getheaders(), resp.read()
        except urllib.error.HTTPError as e:
            return e.code, (e.headers.items() or []), e.read()
        except urllib.error.URLError as e:
            return 0, [], str(e).encode()

    def get(self, url: str, **kw) -> RespTriple:
        return self.request("GET", url, **kw)

    def post(self, url: str, fields: dict | None = None,
             files: dict | None = None, **kw) -> RespTriple:
        if files:
            boundary = "----LocalLab" + "x"
            parts = []
            for k, v in (fields or {}).items():
                parts.append(
                    (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\""
                     f"\r\n\r\n{v}\r\n").encode()
                )
            for k, (fname, content) in files.items():
                parts.append(
                    (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; "
                     f"filename=\"{fname}\"\r\nContent-Type: text/plain\r\n\r\n").encode()
                    + content + b"\r\n"
                )
            parts.append(f"--{boundary}--\r\n".encode())
            body = b"".join(parts)
            kw["headers"] = dict(kw.get("headers") or {},
                                 **{"Content-Type": f"multipart/form-data; boundary={boundary}"})
            return self.request("POST", url, data=body, **kw)
        body = urllib.parse.urlencode(fields or {}).encode()
        return self.request("POST", url, data=body, headers={
            "Content-Type": "application/x-www-form-urlencoded"}, **kw)

    def cookies(self):
        return [(c.name, c.value, c.secure, c.has_nonstandard_attr("HttpOnly"))
                for c in self.jar]