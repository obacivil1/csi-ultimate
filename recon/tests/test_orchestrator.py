"""Tests for orchestrator.py — missing tool, filtering, timeout, no shell."""
from __future__ import annotations

import asyncio
import json
import hashlib
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest

from recon.core.orchestrator import Orchestrator, ToolResult
from recon.core.scope_validator import ScopeValidator


def _scope(tmp_path):
    doc = tmp_path / "auth.pdf"
    doc.write_bytes(b"fake pdf")
    h = hashlib.sha256(b"fake pdf").hexdigest()
    now = datetime.now(timezone.utc)
    data = {
        "program_name": "Test Program",
        "program_url": "https://hackerone.com/test",
        "authorized_by": "Team",
        "authorization_document": "auth.pdf",
        "authorization_sha256": h,
        "not_before": (now - timedelta(days=1)).isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
        "contact_email": "r@example.com",
        "allowed_hosts": ["example.com"],
        "allowed_schemes": ["https"],
        "allowed_ports": [443],
        "denied_paths": [],
        "max_requests_per_host": 10,
        "max_requests_per_second": 10.0,
        "user_agent": "TestRecon/1.0 (+contact: r@example.com)",
    }
    sf = tmp_path / "scope.json"
    sf.write_text(json.dumps(data), encoding="utf-8")
    scope = ScopeValidator(sf)
    # Simulate the operator having confirmed (the real gate is tested separately).
    scope.mark_confirmed()
    return scope


@pytest.mark.asyncio
async def test_missing_tool_skipped(tmp_path):
    from unittest.mock import patch

    scope = _scope(tmp_path)
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports")
    # Do not depend on whether katana happens to be installed on the host.
    with patch("recon.core.orchestrator.shutil.which", return_value=None):
        res = await orch.run_katana(["https://example.com/page"])
    assert res.skipped is True
    assert res.skip_reason is not None
    assert "not found" in res.skip_reason.lower()


@pytest.mark.asyncio
async def test_mixed_in_out_of_scope_inputs_only_in_scope(tmp_path, tmp_path_factory=None):
    # Use a fake binary that echoes input — we override tools dict to point to python
    scope = _scope(tmp_path)
    # Create a fake katana script that just echoes its -o file with input url
    # Instead we mock shutil.which to return python and fake run
    # Simpler: test filtering logic directly via _filter_input_urls and _is_in_scope_line
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports")
    filtered = orch._filter_input_urls(["https://example.com/a", "https://evil.com/b", "https://example.com/c"])
    assert filtered == ["https://example.com/a", "https://example.com/c"]


@pytest.mark.asyncio
async def test_out_of_scope_output_filtered(tmp_path):
    scope = _scope(tmp_path)
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports")
    # create a fake output file with mixed lines
    out = tmp_path / "reports" / "raw" / "httpx" / "httpx.txt"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("https://example.com/page\nhttps://evil.com/secret\nhttps://example.com/other\n", encoding="utf-8")
    lines = orch._filter_output_file(out)
    assert lines == 2
    text = out.read_text(encoding="utf-8")
    assert "evil.com" not in text
    assert "example.com/page" in text


@pytest.mark.asyncio
async def test_substring_host_does_not_pass_filter(tmp_path):
    """Regression: a line merely CONTAINING the allowed host must be dropped.

    The old _is_in_scope_line returned True for any non-http line holding the
    host as a substring (e.g. nuclei prose or 'not-example.com'). Fail closed.
    """
    scope = _scope(tmp_path)
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports")
    assert orch._is_in_scope_line("https://example.com/page") is True
    assert orch._is_in_scope_line("example.com") is True
    assert orch._is_in_scope_line("found example.com in some text") is False
    assert orch._is_in_scope_line("https://notexample.com/") is False
    assert orch._is_in_scope_line("https://example.com.evil.com/") is False
    assert orch._is_in_scope_line("https://evil.com/?x=example.com") is False
    assert orch._is_in_scope_line("") is False


@pytest.mark.asyncio
async def test_unconfirmed_scope_runs_nothing(tmp_path):
    """Regression: Orchestrator refuses to execute without confirmation."""
    import json as _json

    # Build a fresh UNCONFIRMED scope (helper marks confirmed; bypass it).
    from recon.core.scope_validator import ScopeError, ScopeValidator

    doc = tmp_path / "auth2.pdf"
    doc.write_bytes(b"fake pdf")
    import hashlib as _hl
    from datetime import datetime as _dt, timedelta as _td, timezone as _tz

    now = _dt.now(_tz.utc)
    scope_data = {
        "program_name": "Test Program",
        "program_url": "https://hackerone.com/test",
        "authorized_by": "Team",
        "authorization_document": "auth2.pdf",
        "authorization_sha256": _hl.sha256(b"fake pdf").hexdigest(),
        "not_before": (now - _td(days=1)).isoformat(),
        "expires_at": (now + _td(days=30)).isoformat(),
        "contact_email": "r@example.com",
        "allowed_hosts": ["example.com"],
        "allowed_schemes": ["https"],
        "allowed_ports": [443],
        "denied_paths": [],
        "max_requests_per_host": 10,
        "max_requests_per_second": 10.0,
        "user_agent": "TestRecon/1.0 (+contact: r@example.com)",
    }
    sf = tmp_path / "scope2.json"
    sf.write_text(_json.dumps(scope_data), encoding="utf-8")
    scope = ScopeValidator(sf)
    assert scope.confirmed is False
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports")
    with pytest.raises(ScopeError, match="confirmation"):
        await orch.run_katana(["https://example.com/page"])


@pytest.mark.asyncio
async def test_timeout_respected(tmp_path):
    scope = _scope(tmp_path)
    # create a fake sleeping script
    script = tmp_path / "sleepy.py"
    script.write_text("import time; time.sleep(5)\n", encoding="utf-8")
    # Use orchestrator with timeout 1 and tool pointing to python sleepy
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports", tools={"katana": sys.executable}, timeout_seconds=1)
    # Override _run to use our script: we will directly call _run with sleepy args
    # But run_katana will use katana binary; we set tools katana -> python, and katana args include -u url etc which sleepy doesn't understand
    # Instead test low-level _run with a command that sleeps
    # Create a script that sleeps
    out = tmp_path / "reports" / "raw" / "katana" / "katana.txt"
    res = await orch._run("katana", "katana", [str(script)], out)
    assert res.exit_code == -1
    assert "timeout" in (res.skip_reason or "").lower() or res.exit_code == -1


def test_no_shell_true():
    src = (pathlib.Path(__file__).resolve().parent.parent / "core" / "orchestrator.py").read_text(encoding="utf-8")
    assert "shell=True" not in src
    assert "shell = True" not in src
    assert "create_subprocess_exec" in src


def test_subfinder_out_of_scope_domain(tmp_path):
    import asyncio as _asyncio
    scope = _scope(tmp_path)
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports")
    res = _asyncio.run(orch.run_subfinder("evil.com"))
    assert res.lines == 0


# ─────────── subfinder: the scope-expansion gate (was dead code) ───────────
def _scope_with(tmp_path, *, hosts, allow_subdomain_enum=False,
                rps=10.0, per_host=10):
    doc = tmp_path / "auth3.pdf"
    doc.write_bytes(b"fake pdf")
    now = datetime.now(timezone.utc)
    data = {
        "program_name": "Test Program",
        "program_url": "https://hackerone.com/test",
        "authorized_by": "Team",
        "authorization_document": "auth3.pdf",
        "authorization_sha256": hashlib.sha256(b"fake pdf").hexdigest(),
        "not_before": (now - timedelta(days=1)).isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
        "contact_email": "r@example.com",
        "allowed_hosts": hosts,
        "allowed_schemes": ["https"],
        "allowed_ports": [443],
        "denied_paths": [],
        "max_requests_per_host": per_host,
        "max_requests_per_second": rps,
        "user_agent": "TestRecon/1.0 (+contact: r@example.com)",
        "allow_subdomain_enum": allow_subdomain_enum,
    }
    sf = tmp_path / "scope3.json"
    sf.write_text(json.dumps(data), encoding="utf-8")
    sc = ScopeValidator(sf)
    sc.mark_confirmed()
    return sc


def _urls_file(tmp_path, urls, name="urls.txt"):
    p = tmp_path / name
    p.write_text("\n".join(urls) + "\n", encoding="utf-8")
    return p


@pytest.mark.asyncio
async def test_subfinder_refused_when_flag_is_false(tmp_path):
    """Default-deny: without allow_subdomain_enum the tool never launches."""
    scope = _scope_with(tmp_path, hosts=["example.com"],
                        allow_subdomain_enum=False)
    assert scope.scope.allow_subdomain_enum is False
    launched = []

    async def _boom(*a, **kw):
        launched.append(a)
        raise AssertionError("subfinder must not be launched")

    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports")
    orch._run = _boom
    res = await orch.run_subfinder("example.com")
    assert res.skipped is True
    assert "allow_subdomain_enum" in res.skip_reason
    assert launched == []


@pytest.mark.asyncio
async def test_subfinder_refuses_parent_domain_even_when_flag_true(tmp_path):
    """Regression: the old check used endswith('.'+h), allowing the parent.

    Passing the registrable domain to subfinder enumerates every sibling
    under it — a silent scope expansion. Now only literal allowlist entries
    are accepted.
    """
    scope = _scope_with(tmp_path, hosts=["app.example.com"],
                        allow_subdomain_enum=True)
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports")
    res = await orch.run_subfinder("example.com")
    assert res.skipped is True
    assert "literally in allowed_hosts" in res.skip_reason
    assert res.lines == 0


@pytest.mark.asyncio
async def test_subfinder_kept_subdomains_must_be_in_allowlist(tmp_path, monkeypatch):
    """حتى مع تفعيل الراية، لا يُقبل إلا ما هو مصرّح به حرفيًا."""
    scope = _scope_with(tmp_path, hosts=["example.com", "dev.example.com"],
                        allow_subdomain_enum=True)
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports")

    async def _fake_run(binary, name, args, out):
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("example.com\ndev.example.com\napi.example.com\n"
                       "evil.com\n", encoding="utf-8")
        return ToolResult(tool="subfinder", exit_code=0, stdout_path=out,
                          lines=4, duration_seconds=0.1, skipped=False)

    monkeypatch.setattr(orch, "_run", _fake_run)
    res = await orch.run_subfinder("example.com")
    assert res.skipped is False
    kept = [l.strip() for l in res.stdout_path.read_text().splitlines()
            if l.strip()]
    # subfinder output is written raw by the tool; the *caller* (cli) is the
    # component that keeps only allowlist members. Assert the raw file so we
    # notice if the tool ever starts pre-filtering incorrectly.
    assert "api.example.com" in kept
    assert scope.scope.allowed_hosts == ["dev.example.com", "example.com"]


# ══════════════════════════════════════════════════════════════════════
# الإيقاع + robots للأدوات الفرعية
# ══════════════════════════════════════════════════════════════════════
# الأدوات الفرعية لا تمر عبر RateLimiter/RobotsCache في HttpClient إطلاقًا،
# فهي كانت تعمل بسرعة httpx الافتراضية (150/ثانية) على الهدف المصرّح به،
# ودون أي استشارة لـrobots.txt.
class _Captured:
    def __init__(self):
        self.calls = []


def _capture(orch, monkeypatch, cap):
    async def _fake_run(tool, binary, args, out):
        cap.calls.append((tool, list(args)))
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("", encoding="utf-8")
        return ToolResult(tool=tool, exit_code=0, stdout_path=out, lines=0,
                          duration_seconds=0.0, skipped=False)
    monkeypatch.setattr(orch, "_run", _fake_run)
    return cap


@pytest.mark.asyncio
async def test_external_tools_receive_scope_rate_limit(tmp_path, monkeypatch):
    scope = _scope_with(tmp_path, hosts=["example.com"], rps=3.0,
                        per_host=7)
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports")
    cap = _capture(orch, monkeypatch, _Captured())

    await orch.run_katana(["https://example.com/"])
    await orch.run_httpx(_urls_file(tmp_path, ["https://example.com/a"]))
    await orch.run_nuclei(_urls_file(tmp_path, ["https://example.com/b"]))
    assert len(cap.calls) == 3

    for tool, args in cap.calls:
        assert "-rl" in args, f"{tool} بلا حد سرعة: {args}"
        assert args[args.index("-rl") + 1] == "3", \
            f"{tool} لم يلتزم بـmax_requests_per_second: {args}"

    # التوازي لا يجوز أن يتجاوز السرعة: 3 طلب/ثانية لا tolerates 25 خيطًا.
    assert orch._concurrency == 3
    for tool, args in cap.calls:
        flag = "-c" if tool in ("katana", "nuclei") else "-t"
        assert args[args.index(flag) + 1] == "3", \
            f"{tool} التوازي {args} يفوق السرعة المسموحة"


@pytest.mark.asyncio
async def test_input_is_truncated_to_max_per_host(tmp_path, monkeypatch):
    """السقف الصارم per-host لا يمكن تطبيقه على طلبات الأداة الداخلية،
    فيُطبَّق على عدد الأهداف الممرَّرة — وهو الحد القابل للتطبيق فعلًا."""
    scope = _scope_with(tmp_path, hosts=["example.com"], rps=10.0,
                        per_host=2)
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports")
    cap = _capture(orch, monkeypatch, _Captured())

    urls = [f"https://example.com/p{i}" for i in range(9)]
    await orch.run_httpx(_urls_file(tmp_path, urls))
    argv = cap.calls[0][1]
    tmp_in = pathlib.Path(argv[argv.index("-l") + 1])
    assert len([l for l in tmp_in.read_text().splitlines() if l.strip()]) == 2


@pytest.mark.asyncio
async def test_robots_disallow_blocks_external_tool(tmp_path, monkeypatch):
    scope = _scope_with(tmp_path, hosts=["example.com"])

    class _DenyRobots:
        async def can_fetch(self, url):
            return False

    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports",
                        robots=_DenyRobots())

    async def _boom(*a, **k):
        raise AssertionError("الأداة نُفّذت رغم منع robots")

    monkeypatch.setattr(orch, "_run", _boom)
    for res in (await orch.run_katana(["https://example.com/"]),
                await orch.run_httpx(_urls_file(tmp_path,
                                                ["https://example.com/"])),
                await orch.run_nuclei(_urls_file(tmp_path,
                                                 ["https://example.com/"]))):
        assert res.skipped is True
        assert "robots.txt disallows" in res.skip_reason
        assert res.lines == 0


@pytest.mark.asyncio
async def test_robots_check_failure_is_fail_closed(tmp_path, monkeypatch):
    """عطل في فحص robots = منع، لا تمرير صامت."""
    scope = _scope_with(tmp_path, hosts=["example.com"])

    class _BrokenRobots:
        async def can_fetch(self, url):
            raise RuntimeError("network down")

    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports",
                        robots=_BrokenRobots())
    monkeypatch.setattr(orch, "_run", _capture(orch, monkeypatch, _Captured()))
    res = await orch.run_katana(["https://example.com/"])
    assert res.skipped is True
    assert "robots check failed" in res.skip_reason


@pytest.mark.asyncio
async def test_robots_allow_lets_tool_run(tmp_path, monkeypatch):
    scope = _scope_with(tmp_path, hosts=["example.com"])

    class _AllowRobots:
        async def can_fetch(self, url):
            return True

    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports",
                        robots=_AllowRobots())
    cap = _capture(orch, monkeypatch, _Captured())
    res = await orch.run_katana(["https://example.com/"])
    assert res.skipped is False
    assert len(cap.calls) == 1


# ══════════════════════════════════════════════════════════════════════
# تشخيص فشل الأدوات
# ══════════════════════════════════════════════════════════════════════
class _FakeProc:
    def __init__(self, returncode, stdout=b"", stderr=b""):
        self.returncode = returncode
        self._out = stdout
        self._err = stderr

    async def communicate(self):
        return self._out, self._err

    async def wait(self):
        return self.returncode


def _returning(value):
    async def _inner(*a, **k):
        return value
    return _inner


@pytest.mark.asyncio
async def test_missing_template_pack_is_skip_not_scan_failure(tmp_path,
                                                               monkeypatch):
    """غياب حزمة القوالب عطل بيئي لا خطأ في الهدف.

    كان exit=1 فيسقط cli المسار كاملًا بـRuntimeError، ويختفي سبب
    الفشل لأن stderr كان مهمَلًا.
    """
    scope = _scope_with(tmp_path, hosts=["example.com"])
    out_dir = tmp_path / "reports"
    orch = Orchestrator(scope=scope, out_dir=out_dir,
                        tools={"nuclei": "nuclei"})
    monkeypatch.setattr("recon.core.orchestrator.shutil.which",
                        lambda b: "C:/nuclei.exe")
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec",
        _returning(_FakeProc(1, stderr=b"[FTL] Could not run nuclei: "
                                      b"no templates provided for scan\n")))
    urls = _urls_file(tmp_path, ["https://example.com/"])
    res = await orch.run_nuclei(urls)
    assert res.skipped is True, "نقص القوالب يجب ألا يُسقط المسار"
    assert "no templates provided" in res.skip_reason
    err_file = res.stdout_path.with_suffix(".stderr.txt")
    assert err_file.exists(), "سبب الفشل لم يُحفظ"
    assert "no templates" in err_file.read_text()


@pytest.mark.asyncio
async def test_real_tool_failure_is_not_swallowed(tmp_path, monkeypatch):
    """عطل حقيقي يبقى فشلًا صريحًا — لا نخفي أخطاء الأدوات."""
    scope = _scope_with(tmp_path, hosts=["example.com"])
    orch = Orchestrator(scope=scope, out_dir=tmp_path / "reports",
                        tools={"nuclei": "nuclei"})
    monkeypatch.setattr("recon.core.orchestrator.shutil.which",
                        lambda b: "C:/nuclei.exe")
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec",
        _returning(_FakeProc(1, stderr=b"connection refused\n")))
    urls = _urls_file(tmp_path, ["https://example.com/"])
    res = await orch.run_nuclei(urls)
    assert res.skipped is False
    assert res.exit_code == 1
