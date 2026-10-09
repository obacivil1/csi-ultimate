"""اختبارات المرحلة 5: الإضافات + حدّ المعدل + المشاريع."""
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "plugins"))
sys.path.insert(0, str(ROOT / "scanner"))
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT / "util"))

import pytest
from loader import discover, validate
from ratelimit import RateLimiter
from project import load as project_load, save as project_save
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


# ---------------------------------------------------------- loader
def test_discover_example_plugin_shape():
    loaded, errors = discover(ROOT / "plugins" / "checks")
    assert not errors, errors
    codes = {m["code"] for m in loaded}
    assert "METHODS" in codes
    m = next(x for x in loaded if x["code"] == "METHODS")
    assert callable(m["fn"])


def test_loader_rejects_broken_plugin(tmp_path):
    (tmp_path / "bad.py").write_text("PLUGIN = {'code': 'X'}\n",
                                     encoding="utf-8")
    loaded, errors = discover(tmp_path)
    assert loaded == [] and len(errors) == 1


def test_loader_skips_disabled():
    loaded, _ = discover(ROOT / "plugins" / "checks", enabled=set())
    assert loaded == []


@live
def test_example_plugin_runs_live():
    from local_scan import run_check
    loaded, _ = discover(ROOT / "plugins" / "checks")
    m = next(x for x in loaded if x["code"] == "METHODS")
    row = run_check(m, Session(), BASE, "verify")
    assert row["code"] == "METHODS"
    assert row["verdict"] is False  # المختبر يرفض TRACE — سليم موثّق
    assert "TRACE" in row["note"]


@live
def test_load_plugins_idempotent():
    import local_scan
    n1 = len(local_scan.CHECKS)
    n, errs = local_scan.load_plugins()
    assert not errs, errs
    assert len(local_scan.CHECKS) == n1 + n and n >= 1
    n2, _ = local_scan.load_plugins()
    assert n2 == 0  # المكرر يُتجاهَل
    assert len(local_scan.CHECKS) == n1 + n


# ---------------------------------------------------------- ratelimit
def test_ratelimiter_burst_then_throttles():
    lim = RateLimiter(2, burst=2)
    t0 = time.monotonic()
    lim.wait()
    lim.wait()
    fast = time.monotonic() - t0
    assert fast < 0.5
    lim.wait()
    assert time.monotonic() - t0 >= 0.4


def test_ratelimiter_rejects_bad_rate():
    with pytest.raises(ValueError):
        RateLimiter(0)


@live
def test_fuzz_accepts_limiter():
    from intruder import fuzz
    s = Session(Scope(mode="loopback"))
    base, rows = fuzz(s, {"method": "GET",
                          "url": BASE + "search?q=FUZZ"},
                      ["a", "b"], workers=1,
                      limiter=RateLimiter(10, burst=10), timeout=8)
    assert len(rows) == 2 and base["status"] == 200


# ---------------------------------------------------------- project
def test_project_save_load_roundtrip(tmp_path):
    rows = [{"code": "X", "verdict": True}]
    p = project_save(tmp_path / "p.json", BASE, "verify", "loopback",
                     rows, ["Y", "Z"], extra={"note": "t"})
    st = project_load(p)
    assert st["target"] == BASE and st["pending"] == ["Y", "Z"]
    assert st["rows_done"] == rows and st["mode"] == "verify"


def test_project_rejects_tampered(tmp_path):
    p = tmp_path / "p.json"
    project_save(p, BASE, "verify", "loopback", [], [])
    txt = p.read_text(encoding="utf-8").replace("verify", "full")
    p.write_text(txt, encoding="utf-8")
    with pytest.raises(ValueError):
        project_load(p)
