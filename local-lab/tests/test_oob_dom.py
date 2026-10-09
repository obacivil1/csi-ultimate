"""اختبارات OOB + محلل DOM (عمياء مثبتة بلا محتوى رد)."""
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT / "scanner"))

import pytest
from oob import DNS_PORT, OOBServer
from domxss import analyze_js
from session import Session
from scoped import Scope

BASE = "http://127.0.0.1:5001/"


def _target_up():
    try:
        urllib.request.urlopen(BASE, timeout=2).close()
        return True
    except Exception:
        return False


def live(fn):
    return pytest.mark.skipif(not _target_up(),
                              reason="الهدف غير مفتوح")(fn)


def test_oob_http_records_hit():
    o = OOBServer()
    o.start()
    try:
        tok = o.token()
        st = urllib.request.urlopen(o.http_url(tok), timeout=5).status
        assert st == 200
        assert o.poll(tok) and o.poll("nope-" + tok) == []
    finally:
        o.stop()


def test_oob_dns_records_query():
    import socket
    import struct
    o = OOBServer()
    o.start()
    try:
        q = struct.pack(">HHHHHH", 0x4321, 0x0100, 1, 0, 0, 0)
        for part in b"tok9.oobtest".split(b"."):
            q += bytes([len(part)]) + part
        q += b"\x00" + struct.pack(">HH", 1, 1)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(4)
        s.sendto(q, ("127.0.0.1", DNS_PORT))
        data, _ = s.recvfrom(512)
        s.close()
        assert struct.unpack(">H", data[2:4])[0] & 0x8000
        time.sleep(0.3)
        assert o.poll("tok9")
    finally:
        o.stop()


@live
def test_blind_ssrf_proven_by_hit_not_content():
    o = OOBServer()
    o.start()
    try:
        tok = o.token()
        u = BASE + "api/fetch?url=" + urllib.parse.quote(o.http_url(tok))
        urllib.request.urlopen(u, timeout=8)
        assert o.poll(tok), "الخادم جلب دون أن نحتاج محتوى الرد"
    finally:
        o.stop()


@live
def test_dns_exfiltration_channel():
    o = OOBServer()
    o.start()
    try:
        tok = o.token()
        body = urllib.request.urlopen(
            BASE + f"api/dns?host={tok}.oobtest", timeout=8).read().decode()
        assert "127.0.0.1" in body
        assert o.poll(tok), "الاستعلام وصل لخادمنا"
    finally:
        o.stop()


def test_domxss_finds_sink_flow_and_ignores_safe():
    vuln = ("var data = window.location.hash.slice(1);\n"
            "document.getElementById('x').innerHTML = data;")
    f = analyze_js(vuln, "v.js")
    assert len(f) == 1
    assert f[0]["source"] == "location.hash"
    assert f[0]["sink"] == "innerHTML"
    assert "data" in f[0]["flow"]
    safe = "el.textContent = location.hash;"
    assert analyze_js(safe) == []


@live
def test_domxss_on_lab_bundle():
    js = urllib.request.urlopen(BASE + "static/vuln.js",
                                timeout=5).read().decode()
    f = analyze_js(js, "vuln.js")
    assert any(x["sink"] == "innerHTML" for x in f)
    appjs = urllib.request.urlopen(BASE + "static/app.js",
                                   timeout=5).read().decode()
    assert analyze_js(appjs) == []
