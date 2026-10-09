"""تصريح فحص عميق لا يتسرّب بين الأهداف.

الاختبارات الموجودة في test_deep.py تختبر هدفًا واحدًا: منح →
استعمال → سحب. الغائب هو الطرف الخطير: أن تمنح لـa.example فتحصل
على تفويض لـb.example. هذا الملف يثبت أن التصريح مثبَّت على
scheme://host:port بوحده، وأن البوابة ترفض حين يكون التفويض لغير
الهدف المطلوب.

كل النطاقات هنا وهمية على الورق: لا اتصال شبكي إطلاقًا — السجل
ملفّ، وطلبات الـrepeater تُحبس في جلسة فخّ.
"""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
for p in ("engine", "scanner"):
    sys.path.insert(0, str(ROOT / p))

from raw import RawRequest  # noqa: E402
from repeater import RepeaterRefused, check_manual_request  # noqa: E402
from targets import (add_target, canonical, intrusive_granted,  # noqa: E402
                     set_intrusive)

PHRASE = "أصرّح"
CONFIRM = "أؤكد"


@pytest.fixture()
def reg(tmp_path):
    return tmp_path / "targets.json"


def _register(reg, *urls):
    for u in urls:
        add_target(u, confirm_text=CONFIRM, path=reg)


def _grant(reg, url):
    return set_intrusive(url, True, phrase=PHRASE, path=reg)


# ------------------------------------------------------------- الهوية
def test_identity_includes_port(reg):
    """المنفذ جزء من الهوية: تصريح 5001 لا يفتح 5002."""
    _register(reg, "http://127.0.0.1:5001", "http://127.0.0.1:5002")
    _grant(reg, "http://127.0.0.1:5001")
    assert intrusive_granted("http://127.0.0.1:5001", path=reg)
    assert intrusive_granted("http://127.0.0.1:5002", path=reg) is None


def test_identity_includes_scheme(reg):
    _register(reg, "http://127.0.0.1:5001", "https://127.0.0.1:5001")
    _grant(reg, "http://127.0.0.1:5001")
    assert intrusive_granted("https://127.0.0.1:5001", path=reg) is None


def test_host_alias_is_normalized_to_one_identity(reg):
    """localhost و127.0.0.1 هدف واحد عمدًا.

    توحيد الأسماء المستعارة أمان لا خلل: لا يمكن الحصول على تصريح
    لـ127.0.0.1 ثم استخدامه على localhost — لأنهما نفس السجل.
    """
    _register(reg, "http://127.0.0.1:5001")
    _grant(reg, "http://127.0.0.1:5001")
    assert intrusive_granted("http://localhost:5001/any", path=reg)


def test_distinct_hosts_keep_separate_identities(reg):
    _register(reg, "http://alpha.test:5001", "http://beta.test:5001")
    _grant(reg, "http://alpha.test:5001")
    assert intrusive_granted("http://beta.test:5001", path=reg) is None


def test_subdomain_does_not_inherit_grant(reg):
    """النطاق الفرعي لا يرث تصريح الأصل: تسريب صامت."""
    _register(reg, "http://example.test:5001", "http://api.example.test:5001")
    _grant(reg, "http://example.test:5001")
    assert intrusive_granted("http://api.example.test:5001", path=reg) is None


def test_grant_ignores_unregistered_host(reg):
    """مضيف غير مسجَّل إطلاقًا لا يحمل تصريحًا، ولا يُخترع له واحد."""
    _register(reg, "http://127.0.0.1:5001")
    _grant(reg, "http://127.0.0.1:5001")
    assert intrusive_granted("http://evil.test:5001", path=reg) is None


# ---------------------------------------------------------- عزل فعلي
def test_two_hosts_keep_separate_grants(reg):
    _register(reg, "http://127.0.0.1:5001", "http://127.0.0.1:5002")
    _grant(reg, "http://127.0.0.1:5001")
    assert set_intrusive("http://127.0.0.1:5002", True, phrase=PHRASE,
                         path=reg)["intrusive"]["granted"] is True
    assert intrusive_granted("http://127.0.0.1:5001", path=reg)
    assert intrusive_granted("http://127.0.0.1:5002", path=reg)


def test_revoking_one_host_leaves_the_other(reg):
    _register(reg, "http://127.0.0.1:5001", "http://127.0.0.1:5002")
    _grant(reg, "http://127.0.0.1:5001")
    _grant(reg, "http://127.0.0.1:5002")
    set_intrusive("http://127.0.0.1:5001", False, path=reg)
    assert intrusive_granted("http://127.0.0.1:5001", path=reg) is None
    assert intrusive_granted("http://127.0.0.1:5002", path=reg), \
        "سحب تصريح الأول أسقط تصريح الثاني"


# -------------------------------------------- تنسيق العنوان لا يُلتفّ
def test_equivalent_spellings_share_one_grant(reg):
    """التطبيع يمنع الالتفاف: كل هذه صيغ لنفس الهدف قانونيًا."""
    _register(reg, "http://127.0.0.1:5001")
    _grant(reg, "http://127.0.0.1:5001/")
    for variant in ("http://127.0.0.1:5001", "http://127.0.0.1:5001/",
                    "http://127.0.0.1:5001/deep/page"):
        assert intrusive_granted(variant, path=reg), variant
    assert canonical("HTTP://127.0.0.1:5001/x") == "http://127.0.0.1:5001"


# ------------------------------------------------ البوابة طرفًا لطرف
class _TrapSession:
    """لو مرّر الطلب، يسجّل ذلك — ونفشل."""

    def __init__(self):
        self.sent = []

    def request(self, method, url, *a, **k):
        self.sent.append((method, url))
        return 200, [], b"ok"


def _gate(method, url, reg):
    return check_manual_request(
        RawRequest(method=method, url=url, name="t"),
        granted=intrusive_granted(url, path=reg),
    )


def test_gate_refuses_when_grant_belongs_to_another_host(reg):
    """الاختبار الحاسم: تصريحُ a لا يحرّر طلبًا إلى b."""
    _register(reg, "http://127.0.0.1:5001", "http://127.0.0.1:5002")
    _grant(reg, "http://127.0.0.1:5001")
    with pytest.raises(RepeaterRefused):
        _gate("POST", "http://127.0.0.1:5002/api/x", reg)


def test_gate_allows_the_granted_host(reg):
    _register(reg, "http://127.0.0.1:5001", "http://127.0.0.1:5002")
    _grant(reg, "http://127.0.0.1:5002")
    assert _gate("POST", "http://127.0.0.1:5002/api/x", reg) == "state"


def test_read_only_needs_no_grant(reg):
    """القراءة بلا تصريح مقصودة — البوابة لا توسّع."""
    assert _gate("GET", "http://127.0.0.1:5002/anything", reg) == "read_only"


def test_grant_cannot_be_forged_by_string_form(reg):
    """لا يُقرأ التصريح من نص يمرّ كأنه مرخّص."""
    _register(reg, "http://127.0.0.1:5001", "http://127.0.0.1:5002")
    _grant(reg, "http://127.0.0.1:5001")
    assert intrusive_granted("http://127.0.0.1:5002", path=reg) is None
    #Target outside any registry must not be granted either
    assert intrusive_granted("http://attacker.test:5001", path=reg) is None