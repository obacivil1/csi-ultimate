"""
engine/proxy.py — وكيل التقاط وتمرير (Burp History + Intercept).
=================================================================
وكيل HTTP أمامي على 127.0.0.1 فقط:
  - يمرّر الطلبات إلى قاعدة الهدف المسموحة فقط (أي مضيف آخر → 403).
  - يسجّل كل طلب/استجابة في سجل تاريخ آمن للخيوط (History).
  - وضع الاعتراض الاختياري: يجمّد الطلب حتى تُطلقه/تعدّله/تحظره.
كل تمرير يمر عبر Session(scope) — فلا خروج عن النطاق المرخّص أبدًا.
ملاحظة: HTTP فقط (لا MITM لHTTPS — خارج نطاق المختبر المحلي).
"""
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate",
              "proxy-authorization", "te", "trailer", "transfer-encoding",
              "upgrade"}


class InterceptQueue:
    """طابور اعتراض: hold → release(modified?) / drop، مع مهلة أمان."""

    def __init__(self, timeout=120):
        self.timeout = timeout
        self._lock = threading.Lock()
        self._pending = {}
        self._seq = 0

    def hold(self, item):
        with self._lock:
            self._seq += 1
            rid = self._seq
            self._pending[rid] = {"item": item, "event": threading.Event(),
                                  "action": ("release", None)}
        return rid

    def release(self, rid, modified=None):
        with self._lock:
            p = self._pending.get(rid)
            if not p:
                return False
            p["action"] = ("release", modified)
            p["event"].set()
            return True

    def drop(self, rid):
        with self._lock:
            p = self._pending.get(rid)
            if not p:
                return False
            p["action"] = ("drop", None)
            p["event"].set()
            return True

    def wait(self, rid):
        with self._lock:
            p = self._pending.get(rid)
        if not p:
            return "release", None
        p["event"].wait(self.timeout)
        with self._lock:
            action = self._pending.pop(rid, {"action": ("release", None)})["action"]
        return action

    def pending_ids(self):
        with self._lock:
            return [rid for rid, p in self._pending.items()
                    if not p["event"].is_set()]


class CaptureProxy:
    def __init__(self, session, allow_base, host="127.0.0.1", port=0,
                 tls_decrypt=False, verify_upstream=True, ca_path=None):
        self.session = session
        self.allow_base = allow_base.rstrip("/")
        parsed = urllib.parse.urlsplit(self.allow_base)
        self.allow_host = (parsed.hostname or "").lower()
        self.allow_port = parsed.port or (443 if parsed.scheme == "https" else 80)
        self.host, self.port = host, port
        self.history = []
        self._hlock = threading.Lock()
        self._flock = threading.Lock()
        self._seq = 0
        self.intercept_enabled = False
        self.queue = InterceptQueue()
        self.tls_decrypt = tls_decrypt
        self.verify_upstream = verify_upstream
        self.ca_path = ca_path
        self._server = None
        self._thread = None

    # ---------------------------------------------------------- التشغيل
    @property
    def bound_port(self):
        return self._server.server_address[1] if self._server else self.port

    def start(self):
        # توليد مسبق لشهادات MITM: يمنع سباقًا بين عميل سريع يولّد CA
        # خاصًا به وخيط CONNECT (نفس الاسم CN بمفاتيح مختلفة = فشل تحقق).
        if self.tls_decrypt:
            try:
                from ca import HAVE_TLS, ensure_ca, leaf_cert
            except ImportError:
                from .ca import HAVE_TLS, ensure_ca, leaf_cert
            if not HAVE_TLS:
                raise RuntimeError(
                    "فكّ TLS يحتاج مكتبة cryptography (pip install cryptography).")
            ensure_ca(self.ca_path)
            try:
                leaf_cert(self.allow_host, self.ca_path)
            except Exception:
                pass
        proxy = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "LocalLabProxy/1.0"

            def log_message(self, *a):
                pass

            def _handle(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length > 0 else b""
                proxy._serve(self, body)

            do_GET = _handle
            do_POST = _handle
            do_PUT = _handle
            do_DELETE = _handle
            do_HEAD = _handle
            do_PATCH = _handle
            do_OPTIONS = _handle

            def do_CONNECT(self):
                proxy._connect(self)

        self._server = ThreadingHTTPServer((self.host, self.port), Handler)
        self._server.daemon_threads = True
        self._thread = threading.Thread(target=self._server.serve_forever,
                                        kwargs={"poll_interval": 0.2},
                                        daemon=True)
        self._thread.start()
        return self.bound_port

    def stop(self):
        if self._server:
            self._server.shutdown()
            self._server.server_close()
            self._server = None
        if self._thread:
            self._thread.join(timeout=3)
            self._thread = None

    # ---------------------------------------------------------- المعالجة
    def _serve(self, handler, body):
        url = handler.path
        if not url.startswith("http://") and not url.startswith("https://"):
            # طلب مباشر (غير وكيل) — نبنيه على القاعدة المسموحة
            url = self.allow_base + (url if url.startswith("/") else "/" + url)
        parsed = urllib.parse.urlsplit(url)
        if ((parsed.hostname or "").lower() != self.allow_host
                or (parsed.port or 80) != self.allow_port):
            # نسجّل قبل الرد (لا يعتمد عليه) — يلغي سباق القراءة.
            self._record(handler.command, url, dict(handler.headers), body,
                         403, b"blocked", 0.0, blocked=True)
            handler.send_response(403)
            handler.send_header("Content-Type", "text/plain; charset=utf-8")
            handler.end_headers()
            handler.wfile.write("مرفوض: خارج القاعدة المسموحة.".encode("utf-8"))
            return

        method = handler.command
        headers = {k: v for k, v in handler.headers.items()
                   if k.lower() not in HOP_BY_HOP and k.lower() != "content-length"}
        intercepted = False
        if self.intercept_enabled:
            intercepted = True
            rid = self.queue.hold({"method": method, "url": url,
                                   "headers": headers, "body": body})
            action, modified = self.queue.wait(rid)
            if action == "drop":
                handler.send_response(403)
                handler.end_headers()
                handler.wfile.write(b"dropped by intercept")
                self._record(method, url, headers, body, 403, b"dropped",
                             0.0, intercepted=True, blocked=True)
                return
            if modified:
                method = modified.get("method", method)
                url = modified.get("url", url)
                headers = modified.get("headers", headers)
                body = modified.get("body", body)

        t0 = time.time()
        with self._flock:
            try:
                status, rhdrs, rbody = self.session.request(
                    method, url, data=body or None, headers=headers, timeout=10)
            except Exception as e:
                status, rhdrs, rbody = 502, [], str(e).encode()
        ms = round((time.time() - t0) * 1000, 1)
        handler.send_response(status)
        for k, v in rhdrs:
            if k.lower() in HOP_BY_HOP:
                continue
            try:
                handler.send_header(k, v)
            except Exception:
                pass
        handler.send_header("Content-Length", str(len(rbody)))
        handler.end_headers()
        if method != "HEAD":
            handler.wfile.write(rbody)
        self._record(method, url, headers, body, status, rbody, ms,
                     intercepted=intercepted)

    def _record(self, method, url, req_headers, req_body, status,
                resp_body, ms, intercepted=False, blocked=False, note=""):
        with self._hlock:
            self._seq += 1
            self.history.append({
                "id": self._seq, "ts": time.strftime("%H:%M:%S"),
                "method": method, "url": url,
                "req_headers": dict(req_headers),
                "req_body": bytes(req_body or b""),
                "status": status, "resp_body": bytes(resp_body or b""),
                "resp_size": len(resp_body or b""), "time_ms": ms,
                "intercepted": intercepted, "blocked": blocked,
                "note": note,
            })
            if len(self.history) > 500:
                del self.history[:len(self.history) - 500]

    def snapshot(self):
        with self._hlock:
            return [dict(h) for h in self.history]

    def clear(self):
        with self._hlock:
            self.history.clear()

    # ---------------------------------------------------------- CONNECT
    def _connect(self, handler):
        """نفق CONNECT: للقاعدة المسموحة فقط (وإلا 403).

        يعمل متزامنًا داخل خيط المعالجة (آمن مع ThreadingHTTPServer).
        tls_decrypt=True يفكّ TLS بشهادة CA المحلية ويسجّل البايتات
        المفكوكة في السجل (يتطلب تثبيت ca.pem في المتصفح).
        """
        target = (handler.path or "").strip()
        host, _, port_s = target.partition(":")
        try:
            port = int(port_s or 443)
        except ValueError:
            port = 443
        allowed = (host.lower() == self.allow_host and port == self.allow_port)
        if not allowed:
            self._record("CONNECT", target, dict(handler.headers), b"",
                         403, b"blocked", 0.0, blocked=True)
            handler.send_response(403)
            handler.send_header("Content-Type", "text/plain; charset=utf-8")
            handler.end_headers()
            try:
                handler.wfile.write(b"CONNECT refused: out of scope")
            except Exception:
                pass
            return
        try:
            handler.send_response(200, "Connection Established")
            handler.end_headers()
        except Exception:
            return
        sock = handler.connection
        sock.settimeout(30)
        t0 = time.time()
        try:
            if self.tls_decrypt:
                c2s, s2c = self._relay_mitm(sock, host, port)
                note = "TLS-decrypted"
            else:
                c2s, s2c = self._relay_blind(sock, host, port)
                note = "tunnel-blind"
        except Exception as e:
            self._record("CONNECT", target, dict(handler.headers), b"",
                         502, str(e).encode()[:200], 0.0, blocked=True)
            return
        ms = round((time.time() - t0) * 1000, 1)
        status, head, body = self._split_http(s2c)
        self._record("CONNECT", target, {}, c2s[:65536], status,
                     (head + body)[:65536], ms, note=note)

    @staticmethod
    def _split_http(stream):
        """يفصل أول استجابة HTTP من دفق البايتات (أفضل جهد)."""
        idx = stream.find(b"\r\n\r\n")
        head = stream[:idx] if idx >= 0 else stream[:512]
        body = stream[idx + 4:] if idx >= 0 else b""
        status = 200
        try:
            first = head.split(b"\r\n", 1)[0].decode("latin-1")
            status = int(first.split(" ", 2)[1])
        except Exception:
            pass
        return status, head, body

    def _relay_blind(self, client, host, port):
        """ترحيل TCP أعمى ثنائي الاتجاه. يعيد (بايتات صاعدة، نازلة)."""
        import select
        import socket as _socket
        up = _socket.create_connection((host, port), timeout=10)
        up.settimeout(30)
        c2s, s2c = bytearray(), bytearray()
        end = time.time() + 120
        try:
            while time.time() < end:
                r, _, _ = select.select([client, up], [], [], 5)
                if not r:
                    continue
                for src, dst, buf in ((client, up, c2s), (up, client, s2c)):
                    if src in r:
                        try:
                            chunk = src.recv(65536)
                        except Exception:
                            return bytes(c2s), bytes(s2c)
                        if not chunk:
                            return bytes(c2s), bytes(s2c)
                        try:
                            dst.sendall(chunk)
                        except Exception:
                            return bytes(c2s), bytes(s2c)
                        if len(buf) < 262144:
                            buf += chunk
                        end = time.time() + 30
        finally:
            try:
                up.close()
            except Exception:
                pass
        return bytes(c2s), bytes(s2c)

    def _relay_mitm(self, client, host, port):
        """يفكّ TLS من جهة العميل، يعيد تشفيره نحو الهدف، ويسجّل المفكوك."""
        import select
        import socket as _socket
        import ssl as _ssl
        try:
            from ca import HAVE_TLS, leaf_cert
        except ImportError:
            from .ca import HAVE_TLS, leaf_cert
        if not HAVE_TLS:
            raise RuntimeError("لا توجد cryptography — استعمل النفق الأعمى.")
        cert, key = leaf_cert(host, self.ca_path)
        sctx = _ssl.SSLContext(_ssl.PROTOCOL_TLS_SERVER)
        sctx.load_cert_chain(cert, key)
        try:
            tls_client = sctx.wrap_socket(client, server_side=True)
        except Exception as e:
            raise RuntimeError(f"فشل مصافحة العميل: {e}")
        uctx = _ssl.create_default_context()
        if not self.verify_upstream:
            uctx.check_hostname = False
            uctx.verify_mode = _ssl.CERT_NONE
        try:
            raw = _socket.create_connection((host, port), timeout=10)
            raw.settimeout(10)
            tls_up = uctx.wrap_socket(raw, server_hostname=host)
        except Exception as e:
            try:
                tls_client.close()
            except Exception:
                pass
            raise RuntimeError(f"فشل الاتصال بالهدف: {e}")
        tls_client.settimeout(30)
        tls_up.settimeout(30)
        c2s, s2c = bytearray(), bytearray()
        end = time.time() + 120
        try:
            while time.time() < end:
                r, _, _ = select.select([tls_client, tls_up], [], [], 5)
                if not r:
                    continue
                for src, dst, buf in ((tls_client, tls_up, c2s),
                                      (tls_up, tls_client, s2c)):
                    if src in r:
                        try:
                            chunk = src.recv(65536)
                        except Exception:
                            return bytes(c2s), bytes(s2c)
                        if not chunk:
                            return bytes(c2s), bytes(s2c)
                        try:
                            dst.sendall(chunk)
                        except Exception:
                            return bytes(c2s), bytes(s2c)
                        if len(buf) < 262144:
                            buf += chunk
                        end = time.time() + 30
        finally:
            for s_ in (tls_client, tls_up):
                try:
                    s_.close()
                except Exception:
                    pass
        return bytes(c2s), bytes(s2c)
