"""اختبارات اعتراض HTTPS: نفق CONNECT + فكّ TLS الكامل (MITM)."""
import socket
import ssl
import sys
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT / "scanner"))

import pytest
from ca import HAVE_TLS, ensure_ca, leaf_cert
from proxy import CaptureProxy
from session import Session
from scoped import Scope

LAB_BASE = "http://127.0.0.1:5001"


def _target_up():
    try:
        urllib.request.urlopen(LAB_BASE + "/", timeout=2).close()
        return True
    except Exception:
        return False


def live(fn):
    return pytest.mark.skipif(not _target_up(),
                              reason="الهدف غير مفتوح")(fn)


def _sess():
    return Session(Scope(mode="loopback"))


def _connect_tunnel(proxy_port, target, timeout=10):
    """عميل CONNECT خام يعيد المقبس بعد 200."""
    s = socket.create_connection(("127.0.0.1", proxy_port), timeout=timeout)
    s.sendall(f"CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n".encode())
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = s.recv(4096)
        if not chunk:
            break
        data += chunk
    assert b" 200 " in data.split(b"\r\n", 1)[0], data[:60]
    return s


@live
def test_connect_relay_to_allowed_target():
    px = CaptureProxy(_sess(), LAB_BASE, port=0)
    port = px.start()
    try:
        s = _connect_tunnel(port, "127.0.0.1:5001")
        s.sendall(b"GET / HTTP/1.1\r\nHost: 127.0.0.1:5001\r\n"
                  b"Connection: close\r\n\r\n")
        body = b""
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            body += chunk
        s.close()
        assert body.startswith(b"HTTP/1.1 200") and len(body) > 500
        hist = px.snapshot()
        assert hist and hist[-1]["method"] == "CONNECT"
        assert hist[-1]["status"] == 200
    finally:
        px.stop()


@live
def test_connect_rejects_outside_base():
    import time
    px = CaptureProxy(_sess(), LAB_BASE, port=0)
    port = px.start()
    try:
        s = socket.create_connection(("127.0.0.1", port), timeout=8)
        s.sendall(b"CONNECT evil.example:443 HTTP/1.1\r\n"
                  b"Host: evil.example\r\n\r\n")
        data = s.recv(4096)
        s.close()
        assert b"403" in data
        deadline = time.time() + 5
        hist = []
        while time.time() < deadline:
            hist = px.snapshot()
            if hist:
                break
            time.sleep(0.05)
        assert hist and hist[-1]["blocked"] is True
    finally:
        px.stop()


class _SecretHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        body = b"SECRET-TLS-OK"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.mark.skipif(not HAVE_TLS, reason="لا توجد cryptography")
@live
def test_mitm_decrypts_local_https(tmp_path):
    server_ca = tmp_path / "srv_ca"
    cert, key = leaf_cert("127.0.0.1", str(server_ca))
    httpd = HTTPServer(("127.0.0.1", 0), _SecretHandler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    t = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.1},
                         daemon=True)
    t.start()
    sport = httpd.server_address[1]
    try:
        proxy_ca = tmp_path / "pca"
        ensure_ca(str(proxy_ca))  # توليد مسبق كما يفعل المشغّل (ثبّت CA أولًا)
        px = CaptureProxy(_sess(), f"https://127.0.0.1:{sport}", port=0,
                          tls_decrypt=True, verify_upstream=False,
                          ca_path=str(proxy_ca))
        pport = px.start()
        try:
            s = _connect_tunnel(pport, f"127.0.0.1:{sport}")
            _, ca_pem = ensure_ca(str(proxy_ca))
            cctx = ssl.create_default_context(cafile=ca_pem)
            tls = cctx.wrap_socket(s, server_hostname="127.0.0.1")
            tls.sendall(b"GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
            body = b""
            while True:
                chunk = tls.recv(65536)
                if not chunk:
                    break
                body += chunk
            tls.close()
            assert b"SECRET-TLS-OK" in body
            hist = px.snapshot()
            assert hist and hist[-1].get("note") == "TLS-decrypted"
            assert b"SECRET-TLS-OK" in hist[-1]["resp_body"]
        finally:
            px.stop()
    finally:
        httpd.shutdown()
        httpd.server_close()


@pytest.mark.skipif(not HAVE_TLS, reason="لا توجد cryptography")
def test_ca_and_leaf_generation(tmp_path):
    key_p, cert_p = ensure_ca(str(tmp_path / "ca"))
    assert Path(key_p).exists() and Path(cert_p).exists()
    lp, kp = leaf_cert("example.test", str(tmp_path / "ca"))
    assert Path(lp).exists() and Path(kp).exists()
    lp2, _ = leaf_cert("example.test", str(tmp_path / "ca"))
    assert lp2 == lp  # مخبأة


@pytest.mark.skipif(not HAVE_TLS, reason="لا توجد cryptography")
def test_leaf_regenerates_when_ca_rotates(tmp_path):
    """تجديد الـ CA يُبطل الورقة المخبأة (تثبيت البصمة)."""
    from cryptography.x509 import load_pem_x509_certificate
    cadir = str(tmp_path / "ca")
    lp1, _ = leaf_cert("example.test", cadir)
    # دوّر الـ CA: احذف ملفاتها وأعد التوليد
    for p in Path(cadir).glob("ca_*"):
        p.unlink()
    ensure_ca(cadir)
    lp2, _ = leaf_cert("example.test", cadir)
    assert lp2 != lp1, "ورقة قديمة مع CA جديد = سلسلة مكسورة"
    _, ca_pem = ensure_ca(cadir)
    ca = load_pem_x509_certificate(Path(ca_pem).read_bytes())
    presented = load_pem_x509_certificate(Path(lp2).read_bytes())
    assert presented.issuer == ca.subject
    from cryptography.hazmat.primitives.asymmetric import padding
    ca.public_key().verify(presented.signature,
                            presented.tbs_certificate_bytes,
                            padding.PKCS1v15(),
                            presented.signature_hash_algorithm)
