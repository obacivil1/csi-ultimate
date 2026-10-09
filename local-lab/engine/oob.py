"""
engine/oob.py — خادم التفاعل خارج النطاق (Burp Collaborator مصغّر).
====================================================================
يثبت الثغرات العمياء (Blind SSRF/XXE) التي لا ترد في الاستجابة:
  - مستمع HTTP على loopback بمنفذ عشوائي: أي GET /<token> يُسجَّل.
  - مستمع DNS على 127.0.0.1:15353: أي استعلام يُسجَّل ويُجاب 127.0.0.1.
النمط: ولّد رمزًا → احقنه في حمولة → انتظر → اسأل poll(token).
كله loopback — لا يغادر جهازك أبدًا.
"""
import socket
import struct
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DNS_PORT = 15353


def _parse_qname(data, off=12):
    labels, i = [], off
    while i < len(data):
        n = data[i]
        if n == 0:
            i += 1
            break
        if n & 0xC0:
            ptr = struct.unpack(">H", data[i:i + 2])[0] & 0x3FFF
            sub, _ = _parse_qname(data, ptr)
            labels += sub
            i += 2
            break
        i += 1
        labels.append(data[i:i + n].decode("latin-1", "replace"))
        i += n
    return labels, i


class OOBServer:
    def __init__(self, host="127.0.0.1", dns_port=DNS_PORT):
        self.host = host
        self.dns_port = dns_port
        self.hits = []
        self._lock = threading.Lock()
        self._httpd = None
        self._hthread = None
        self._dns_sock = None
        self._dthread = None
        self._running = False
        self._seq = 0

    @property
    def http_port(self):
        return self._httpd.server_address[1] if self._httpd else 0

    def _record(self, kind, detail):
        with self._lock:
            self._seq += 1
            self.hits.append({"id": self._seq, "ts": time.strftime("%H:%M:%S"),
                              "kind": kind, "detail": detail})

    def token(self, prefix="oob"):
        self._seq += 1
        return f"{prefix}{self._seq}{int(time.time()) % 100000}"

    def http_url(self, token):
        return f"http://{self.host}:{self.http_port}/{token}"

    def dns_name(self, token):
        return f"{token}.oobtest"

    # ---------------------------------------------------------- التشغيل
    def start(self):
        parent = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "LocalLabOOB/1.0"

            def log_message(self, *a):
                pass

            def do_GET(self):
                parent._record("http", urllib.parse.unquote(self.path))
                body = b"oob-ok"
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except Exception:
                    pass

        self._httpd = ThreadingHTTPServer((self.host, 0), Handler)
        self._httpd.daemon_threads = True
        self._running = True
        self._hthread = threading.Thread(
            target=self._httpd.serve_forever, kwargs={"poll_interval": 0.2},
            daemon=True)
        self._hthread.start()
        self._dns_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._dns_sock.bind((self.host, self.dns_port))
        self._dns_sock.settimeout(0.5)
        self._dthread = threading.Thread(target=self._dns_loop, daemon=True)
        self._dthread.start()
        return self.http_port

    def _dns_loop(self):
        while self._running:
            try:
                data, addr = self._dns_sock.recvfrom(512)
            except socket.timeout:
                continue
            except Exception:
                break
            try:
                if len(data) < 12:
                    continue
                txid = data[:2]
                labels, off = _parse_qname(data)
                qname = ".".join(labels)
                qtype = struct.unpack(">H", data[off:off + 2])[0] \
                    if off + 4 <= len(data) else 0
                self._record("dns", f"{qname} (type {qtype})")
                flags = struct.pack(">H", 0x8180)
                resp = txid + flags + struct.pack(">HHHH", 1, 1, 0, 0)
                resp += data[12:off + 4]
                if qtype == 1:  # A -> 127.0.0.1
                    resp += b"\xc0\x0c" + struct.pack(">HHIH", 1, 1, 60, 4)
                    resp += socket.inet_aton("127.0.0.1")
                self._dns_sock.sendto(resp, addr)
            except Exception:
                continue

    def stop(self):
        self._running = False
        if self._httpd:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
        if self._dns_sock:
            try:
                self._dns_sock.close()
            except Exception:
                pass
            self._dns_sock = None

    # ---------------------------------------------------------- الاستعلام
    def poll(self, token):
        with self._lock:
            return [h for h in self.hits if token in h["detail"]]

    def clear(self):
        with self._lock:
            self.hits.clear()
