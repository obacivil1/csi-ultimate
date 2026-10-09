"""اختبارات مختبرات المنهجية: البنية + التحقق الحي لكل مختبر."""
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "learn"))
sys.path.insert(0, str(ROOT / "scanner"))

import pytest
from labs import LABS, REQUIRED_KEYS, get_lab, run_lab
from local_scan import CHECKS
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


def _factory():
    return Session(Scope(mode="loopback"))


def test_labs_shape_and_check_refs():
    assert len(LABS) >= 10
    codes = {c["code"] for c in CHECKS}
    ids = set()
    for lab in LABS:
        assert REQUIRED_KEYS <= set(lab), lab.get("id")
        assert lab["steps"], lab["id"]
        assert lab["url"].startswith("/"), lab["id"]
        assert lab["check"] in codes, lab["check"]
        assert lab["id"] not in ids
        ids.add(lab["id"])


def test_get_lab_rejects_unknown():
    with pytest.raises(ValueError):
        get_lab("nope")


@live
@pytest.mark.parametrize("lab", LABS, ids=[l["id"] for l in LABS])
def test_lab_validator_passes_live(lab):
    ok, msg = run_lab(_factory, BASE, lab["id"])
    assert ok is True, f"{lab['id']}: {msg}"
