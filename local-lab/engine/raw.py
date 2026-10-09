"""
engine/raw.py — تمثيل طلبات HTTP الخام وبناء الجسم/الرؤوس تلقائيًا.
===================================================================
يدعم:
  - بنية dict: {method, url, headers{dict}, body(str/bytes), pipelined}
  - لصق طلب خام من Burp (سطور: METHOD PATH HTTP/1.1 + Header: v + سطر فارغ + body)
إعادة استجابة: ConnectionResult {status, headers, body, time_ms}.
"""
import re
import time
import urllib.parse


class RawRequest:
    def __init__(self, method="GET", url="", headers=None, body="", name="طلب"):
        self.method = method.upper()
        self.url = url
        self.headers = dict(headers or {})
        self.body = "" if body is None else body
        self.name = name

    def as_request_ready(self):
        """يحدد Length تلقائيًا ويعيد (method, url, data, headers) جاهزًا للـ Session."""
        data = None
        headers = dict(self.headers)
        if self.method in ("POST", "PUT", "PATCH") or self.body:
            data = self.body if isinstance(self.body, bytes) else self.body.encode("utf-8")
        if data is not None:
            headers.pop("Content-Length", None)
            headers["Content-Length"] = str(len(data))
        elif self.method == "GET":
            headers.pop("Content-Length", None)
        return self.method, self.url, data, headers

    def to_raw_text(self) -> str:
        """يعيد صيغة نصية واضحة (للنسخ إلى Burp أو للعرض)."""
        parsed = urllib.parse.urlsplit(self.url)
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        lines = [f"{self.method} {path} HTTP/1.1", f"Host: {parsed.netloc}"]
        for k, v in (self.headers or {}).items():
            if k.lower() != "host":
                lines.append(f"{k}: {v}")
        text = "\r\n".join(lines) + "\r\n\r\n"
        if self.body:
            text += (self.body if isinstance(self.body, str) else
                     self.body.decode("utf-8", "replace"))
        return text

    def clone(self):
        return RawRequest(self.method, self.url, dict(self.headers), self.body, self.name)


def parse_raw_text(raw: str) -> RawRequest:
    """يحوّل طلبًا خامًا (Burp-style) إلى RawRequest."""
    lines = raw.split("\r\n")
    first = lines[0].split(" ")
    method = first[0] if len(first) > 0 else "GET"
    path = first[1] if len(first) > 1 else "/"
    host = ""
    headers = {}
    body = ""
    i = 1
    for i in range(1, len(lines)):
        line = lines[i]
        if line == "":
            body = "\r\n".join(lines[i + 1:])
            break
        if ":" in line:
            k, v = line.split(":", 1)
            v = v.lstrip(" ")
            if k.strip().lower() == "host":
                host = v
            elif k.strip().lower() != "content-length":
                headers[k.strip()] = v
    if not re.match(r"^https?://", path):
        scheme = "http"
        if not host:
            raise ValueError("لا يوجد Host في الطلب الخام.")
        url = f"{scheme}://{host}{path}"
    else:
        url = path
    return RawRequest(method, url, headers, body, "من لصق خام")


def send(template, session, follow=False, timeout=6):
    """يرسل RawRequest عبر Session (مقيّد النطاق) ويعيد ConnectionResult."""
    rq = template if isinstance(template, RawRequest) else RawRequest(**template)
    method, url, data, headers = rq.as_request_ready()
    t0 = time.time()
    try:
        status, hdrs, body = session.request(
            method, url, data=data, headers=headers, timeout=timeout)
        if follow and status in (301, 302, 303, 307, 308):
            loc = next((v for k, v in hdrs if k.lower() == "location"), None)
            if loc:
                if loc.startswith("/"):
                    loc = urllib.parse.urljoin(url, loc)
                status, hdrs, body = session.request("GET", loc, timeout=timeout)
    except Exception as e:
        return ConnectionResult(0, [], str(e).encode(), round((time.time() - t0) * 1000, 1))
    return ConnectionResult(status, hdrs, body, round((time.time() - t0) * 1000, 1))


class ConnectionResult:
    def __init__(self, status, headers, body, time_ms):
        self.status = status
        self.headers = headers
        self.body = body if isinstance(body, bytes) else body.encode("utf-8", "replace")
        self.time_ms = time_ms

    @property
    def size(self):
        return len(self.body)

    def headers_dict(self):
        return {k: v for k, v in self.headers}

    def text(self, limit=None):
        s = self.body.decode("utf-8", "replace")
        return s[:limit] if limit else s

    def hashes(self):
        import hashlib
        return hashlib.md5(self.body).hexdigest()[:12]