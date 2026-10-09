"""اختبارات قيد الـ loopback — الضمانة الأولى: لا شيء خارج جهازك."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scanner"))

import pytest
from hostguard import assert_local, parse_base


def test_allows_localhost():
    assert assert_local("localhost") == "127.0.0.1"
    assert assert_local("127.0.0.1") == "127.0.0.1"
    assert assert_local("::1") == "127.0.0.1"
    assert assert_local("[::1]") == "127.0.0.1"


def test_strips_scheme_and_port():
    assert assert_local("http://127.0.0.1:5001/") == "127.0.0.1"
    assert assert_local("127.0.0.1:5001") == "127.0.0.1"


@pytest.mark.parametrize("bad", [
    "8.8.8.8", "192.168.1.10", "172.16.0.1", "10.0.0.5",
    "example.com", "engineer.ahladalil.com", "http://google.com/",
    "fe80::1", "192.168.0.5:80",
])
def test_rejects_external(bad):
    with pytest.raises(ValueError):
        assert_local(bad)


def test_parse_base_normalizes():
    assert parse_base("http://127.0.0.1:5001/") == "127.0.0.1:5001"
    assert parse_base("localhost/path") == "127.0.0.1:5001"
    assert parse_base("127.0.0.1:5001") == "127.0.0.1:5001"