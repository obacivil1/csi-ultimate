"""اختبارات المعايير: OpenAPI + security.txt (RFC 9116)."""
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "plugins"))
sys.path.insert(0, str(ROOT / "scanner"))

import pytest
from server import create_app
from loader import discover
from local_scan import run_check
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


def test_openapi_matches_routes():
    client = create_app().test_client()
    spec = client.get("/api/openapi.json").json
    assert spec["openapi"].startswith("3.0")
    assert set(spec["paths"]) == {"/api/health", "/api/checks", "/api/scan",
                                  "/api/crawl", "/api/jobs/{jid}",
                                  "/api/openapi.json"}
    code_paths = {str(r) for r in create_app().url_map.iter_rules()
                  if str(r).startswith("/api/") and "static" not in str(r)}
    assert code_paths == {"/api/health", "/api/checks", "/api/scan",
                          "/api/crawl", "/api/jobs/<jid>",
                          "/api/openapi.json"}
    assert "LocalLab" in spec["info"]["title"]


@live
def test_security_txt_live_and_plugin():
    body = urllib.request.urlopen(BASE + ".well-known/security.txt",
                                  timeout=5).read().decode()
    assert "Contact:" in body and "Expires:" in body
    loaded, errs = discover(ROOT / "plugins" / "checks")
    assert not errs, errs
    m = next(x for x in loaded if x["code"] == "SECTXT")
    row = run_check(m, Session(Scope(mode="loopback")), BASE, "verify")
    assert row["verdict"] is True and row["severity"] == "info"


@live
def test_wordlist_covers_security_txt():
    sys.path.insert(0, str(ROOT / "engine"))
    from payloads import load_wordlist
    assert ".well-known/security.txt" in load_wordlist("common_paths")
