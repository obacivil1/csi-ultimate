"""
engine/evidence.py — التقاط الأدلة تلقائيًا (طلب/استجابة لكل فحص).
====================================================================
RecordingSession: غلاف شفاف حول أي Session (يمرّر _guard/jar/opener/
cookies بالتفويض) ويسجّل كل تبادل (حتى 6) — يحتفظ الأخير كدليل PoC.
run_check_evidence(meta, session, base, mode) -> (row, evidence)
حيث evidence = {request, response, exchanges, time_ms}.
"""
import time
import urllib.parse
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # لmypy: تعريف واحد صريح (وقت التشغيل يختار أدناه)
    from local_scan import run_check

CAP = 4096


def _raw_request(method: str, url: str, headers: dict | None,
                 body) -> str:
    p = urllib.parse.urlsplit(url)
    path = p.path or "/"
    if p.query:
        path += "?" + p.query
    lines = [f"{method} {path} HTTP/1.1", f"Host: {p.netloc}"]
    for k, v in (headers or {}).items():
        if k.lower() not in ("host", "content-length"):
            lines.append(f"{k}: {v}")
    out = "\r\n".join(lines) + "\r\n\r\n"
    if body:
        out += (body.decode("utf-8", "replace") if isinstance(body, bytes)
                else str(body))[:CAP]
    return out


def _raw_response(status: int, headers: list, body) -> str:
    lines = [f"HTTP {status}"]
    for k, v in (headers or [])[:20]:
        lines.append(f"{k}: {v}")
    out = "\r\n".join(lines) + "\r\n\r\n"
    raw = body if isinstance(body, bytes) else str(body).encode("utf-8",
                                                                "replace")
    out += raw[:CAP].decode("utf-8", "replace")
    return out


class RecordingSession:
    """غلاف تسجيل شفاف: نفس واجهة Session + سجل exchanges."""

    def __init__(self, session):
        object.__setattr__(self, "_s", session)
        object.__setattr__(self, "exchanges", [])

    def __getattr__(self, name):
        return getattr(object.__getattribute__(self, "_s"), name)

    def request(self, method: str, url: str, data: bytes | None = None,
                headers: dict | None = None, timeout: float = 6):
        s = object.__getattribute__(self, "_s")
        t0 = time.time()
        try:
            st, hdrs, body = s.request(method, url, data=data,
                                       headers=headers, timeout=timeout)
        except Exception as e:
            st, hdrs, body = 0, [], str(e).encode()
        ms = round((time.time() - t0) * 1000, 1)
        ex = {"method": method, "url": url, "headers": dict(headers or {}),
              "body": data if isinstance(data, bytes)
                      else (str(data or "").encode()),
              "status": st, "resp_headers": list(hdrs), "resp_body": body,
              "time_ms": ms}
        self.exchanges.append(ex)
        del self.exchanges[:-6]
        return st, hdrs, body

    def get(self, url: str, **kw):
        return self.request("GET", url, **kw)

    def post(self, url: str, fields: dict | None = None,
             files: dict | None = None, **kw):
        return self._post(url, fields, files, kw)

    def _post(self, url, fields, files, kw):
        # نعيد بناء الجسم لتوثيقه ثم نمرر عبر request المسجَّل.
        import urllib.parse as _up
        s = object.__getattribute__(self, "_s")
        if files:
            # multipart معقد — نوثّق الأسماء ونمرر الأصلي.
            names = (list((fields or {})) +
                     [f"{k}={fn}" for k, (fn, _) in files.items()])
            st, hdrs, body = s.post(url, fields=fields, files=files, **kw)
            ex = {"method": "POST", "url": url,
                  "headers": {"Content-Type": "multipart/form-data"},
                  "body": ("fields: " + ", ".join(names)).encode(),
                  "status": st, "resp_headers": list(hdrs),
                  "resp_body": body, "time_ms": 0.0}
            self.exchanges.append(ex)
            del self.exchanges[:-6]
            return st, hdrs, body
        data = _up.urlencode(fields or {}).encode()
        return self.request("POST", url, data=data, headers={
            "Content-Type": "application/x-www-form-urlencoded"}, **kw)

    def last_evidence(self) -> dict:
        """الدليل: أول طلب (الإثبات) + آخر استجابة (النتيجة)."""
        if not self.exchanges:
            return {"request": "", "response": "", "exchanges": 0,
                    "time_ms": 0.0}
        first, last = self.exchanges[0], self.exchanges[-1]
        req = _raw_request(first["method"], first["url"], first["headers"],
                           first["body"])
        resp = _raw_response(last["status"], last["resp_headers"],
                             last["resp_body"])
        if len(self.exchanges) > 1:
            resp += (f"\n\n… سلسلة من {len(self.exchanges)} تبادلات "
                     f"(أولها طلب الإثبات {first['time_ms']}ms، "
                     f"وآخرها النتيجة {last['time_ms']}ms)")
        return {"request": req, "response": resp,
                "exchanges": len(self.exchanges), "time_ms": last["time_ms"]}


def run_check_evidence(meta: dict, session, base: str, mode: str) -> tuple:
    """ينفّذ الفحص مع تسجيل الدليل. يعيد (row, evidence)."""
    if not TYPE_CHECKING:
        try:
            from local_scan import run_check
        except ImportError:
            from scanner.local_scan import run_check
    rec = session if isinstance(session, RecordingSession) \
        else RecordingSession(session)
    row = run_check({"code": meta["code"], "name": meta["name"],
                     "owasp": meta["owasp"], "severity": meta["severity"],
                     "family": meta["family"], "fn": meta["fn"]},
                    rec, base, mode)
    return row, rec.last_evidence()
