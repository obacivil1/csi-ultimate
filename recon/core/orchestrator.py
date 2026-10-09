"""orchestrator.py — Subprocess wrapper for community tools."""
from __future__ import annotations

import asyncio
import logging
import math
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from recon.core.scope_validator import ScopeError, ScopeValidator

logger = logging.getLogger(__name__)


@dataclass
class ToolResult:
    tool: str
    exit_code: int
    stdout_path: Path
    lines: int
    duration_seconds: float
    skipped: bool = False
    skip_reason: str | None = None


class Orchestrator:
    """Run katana/httpx/nuclei/subfinder as subprocesses with scope filtering."""

    #: (flag RateLimit, flag Concurrency) لكل أداة. أدوات ProjectDiscovery
    #: تشترك في ‎-rl‎ للسرعة؛ اختلاف العمود الثاني في اسم التوازي.
    _PACING: dict[str, tuple[str, str]] = {
        "katana": ("-rl", "-c"),
        "httpx": ("-rl", "-t"),
        "nuclei": ("-rl", "-c"),
        "subfinder": ("-rl", "-t"),
    }

    def __init__(
        self,
        *,
        scope: ScopeValidator,
        out_dir: Path,
        tools: dict[str, str] | None = None,
        timeout_seconds: int = 300,
        robots: object | None = None,
    ) -> None:
        self._scope = scope
        self._out_dir = Path(out_dir)
        self._tools = tools or {}
        self._timeout = int(timeout_seconds)
        self._robots = robots
        self._max_rps = float(scope.scope.max_requests_per_second)
        self._max_per_host = int(scope.scope.max_requests_per_host)
        # التوازي لا يجوز أن يتجاوز السرعة المسموح��: ‎10 خيوط عند 2 طلب/ثانية
        # لا تعني 2 طلب/ثانية، بل دفعة كاملة كل 5 ثوانٍ.
        self._concurrency = max(1, min(int(math.ceil(self._max_rps)), 25))
        self._robots_unenforced = False

    def _pacing(self, binary: str) -> list[str]:
        """وسوم الإيقاع الممرَّرة لكل أداة خارجية.

        الأدوات الفرعية لا تمر عبر RateLimiter في HttpClient — فضاعتها
        كانت ‎-rl‎ غائبة، أي أن السرعة الافتراضية (150/ثانية لـ httpx)
        كانت تسري على الهدف المصرّح به دون إبطاء.
        """
        rl_flag, c_flag = self._PACING.get(binary, ("-rl", "-c"))
        return [rl_flag, str(max(1, int(self._max_rps))),
                c_flag, str(self._concurrency)]

    def _skip(self, tool: str, out: Path, reason: str) -> ToolResult:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("", encoding="utf-8")
        return ToolResult(tool=tool, exit_code=0, stdout_path=out, lines=0,
                          duration_seconds=0.0, skipped=True,
                          skip_reason=reason)

    async def _robots_gate(self, urls: list[str]) -> str | None:
        """يرجّع سبب المنع، أو None للإذن. بوابة على origins لا على كل طلب."""
        if self._robots is None:
            if not self._robots_unenforced:
                self._robots_unenforced = True
                logger.warning(
                    "orchestrator: no robots checker supplied; robots.txt is "
                    "not enforced for external tools")
            return None
        for u in urls:
            try:
                if not await self._robots.can_fetch(u):
                    return f"robots.txt disallows {u}"
            except Exception as exc:
                return f"robots check failed for {u}: {exc}"
        return None

    def _which(self, binary: str) -> str | None:
        # allow override via self._tools
        if binary in self._tools:
            return self._tools[binary]
        return shutil.which(binary)

    def _is_in_scope_line(self, line: str) -> bool:
        """Fail-closed output filter: keep a line only if it is provably in scope.

        A line is kept iff it is a full http(s) URL that passes
        scope.assert_allowed (scheme + host + port + denied-path), or a bare
        hostname exactly equal to an allowed host. Anything else — including
        lines that merely *contain* an allowed host as a substring — is dropped.
        """
        line = line.strip()
        if not line:
            return False
        try:
            p = urlparse(line)
            if p.scheme in ("http", "https") and p.hostname:
                try:
                    self._scope.assert_allowed(line)
                    return True
                except Exception:
                    return False
            # bare hostname (no scheme, no path): exact match only
            if not p.scheme and "/" not in line and " " not in line:
                return line.lower().rstrip(".") in self._scope.scope.allowed_hosts
            return False
        except Exception:
            return False

    def _filter_input_urls(self, urls: list[str]) -> list[str]:
        out = []
        for u in urls:
            try:
                self._scope.assert_allowed(u)
                out.append(u)
            except Exception:
                logger.debug("orchestrator input filtered out-of-scope %s", u)
                continue
        return out

    def _filter_output_file(self, path: Path) -> int:
        if not path.exists():
            return 0
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        kept = [l for l in lines if self._is_in_scope_line(l)]
        # overwrite with filtered
        path.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")
        return len(kept)

    def _read_filtered_urls(self, urls_file: Path) -> list[str]:
        kept: list[str] = []
        p = Path(urls_file)
        if not p.exists():
            return kept
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                self._scope.assert_allowed(line)
            except Exception:
                continue
            kept.append(line)
        return kept

    #: رسائل فشل بيئي (لا علاقة لها بالهدف) من أدوات ProjectDiscovery.
    #: غياب حزمة القوالب مثلًا كان يُسقط الفحص كاملًا ويُبتلع سببه.
    _SETUP_ERRORS = ("no templates provided", "no templates or workflows",
                     "please provide templates")

    async def _run(self, tool: str, binary: str, args: list[str], stdout_path: Path) -> ToolResult:
        start = time.monotonic()
        # Fail closed: external tools send real traffic, so they require the
        # same operator confirmation as HttpClient — not just the CLI layer.
        if not getattr(self._scope, "confirmed", False):
            raise ScopeError(
                "operator confirmation required before running external tools; "
                "call require_operator_confirmation(scope) first"
            )
        which = self._which(binary)
        if which is None:
            logger.info("tool %s not found, skipping", tool)
            return ToolResult(tool=tool, exit_code=0, stdout_path=stdout_path, lines=0, duration_seconds=0.0, skipped=True, skip_reason=f"{binary} not found")
        stdout_path.parent.mkdir(parents=True, exist_ok=True)
        # ensure output file exists empty
        stdout_path.write_text("", encoding="utf-8")
        # build command
        cmd = [which] + args
        logger.debug("orchestrator run %s: %s", tool, cmd)
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=self._timeout)
            except asyncio.TimeoutError:
                try:
                    proc.kill()
                except Exception:
                    pass
                try:
                    await proc.wait()
                except Exception:
                    pass
                duration = time.monotonic() - start
                logger.warning("tool %s timeout after %s", tool, self._timeout)
                return ToolResult(tool=tool, exit_code=-1, stdout_path=stdout_path, lines=0, duration_seconds=duration, skipped=False, skip_reason="timeout")
            # write stdout to file
            # stdout is bytes
            text = stdout.decode("utf-8", errors="ignore") if stdout else ""
            stdout_path.write_text(text, encoding="utf-8")
            # stderr كان مهمَلاً: فشل nuclei كان يظهر كـexit 1 بلا سبب مُفسَّر.
            err_text = stderr.decode("utf-8", errors="ignore") if stderr else ""

            if err_text.strip():
                stdout_path.with_suffix(".stderr.txt").write_text(
                    err_text, encoding="utf-8")
            low = err_text.lower()
            setup_hit = next((e for e in self._SETUP_ERRORS if e in low), None)
            if setup_hit is not None:
                # عطل إعداد لا خطأ في الهدف: نتخطى بدل إسقاط المسار كله.
                return ToolResult(tool=tool, exit_code=proc.returncode or 0,
                                  stdout_path=stdout_path, lines=0,
                                  duration_seconds=time.monotonic() - start,
                                  skipped=True, skip_reason=setup_hit)
            # filter output
            lines = self._filter_output_file(stdout_path)
            duration = time.monotonic() - start
            return ToolResult(tool=tool, exit_code=proc.returncode or 0, stdout_path=stdout_path, lines=lines, duration_seconds=duration)
        except FileNotFoundError:
            return ToolResult(tool=tool, exit_code=0, stdout_path=stdout_path, lines=0, duration_seconds=time.monotonic() - start, skipped=True, skip_reason=f"{binary} not found")
        except Exception as exc:
            logger.error("orchestrator error %s: %s", tool, exc)
            return ToolResult(tool=tool, exit_code=-1, stdout_path=stdout_path, lines=0, duration_seconds=time.monotonic() - start, skipped=False, skip_reason=str(exc))

    async def run_katana(self, targets: list[str]) -> ToolResult:
        out = self._out_dir / "raw" / "katana" / "katana.txt"
        filtered = self._filter_input_urls(targets)[: self._max_per_host]
        blocked = await self._robots_gate(filtered)
        if blocked or not filtered:
            return self._skip("katana", out, blocked or "no in-scope targets")
        # spec template: katana -u {url} -jc -d 2 -silent -o {out} ; for multiple, we use first url (or join)
        # We handle single url case per spec; for multiple, we pass first and filter will apply
        url = filtered[0]
        args = ["-u", url, "-jc", "-d", "2", "-silent", "-o", str(out)]
        args += self._pacing("katana")
        return await self._run("katana", "katana", args, out)

    async def run_httpx(self, urls_file: Path) -> ToolResult:
        out = self._out_dir / "raw" / "httpx" / "httpx.txt"
        filtered_lines = self._read_filtered_urls(urls_file)[: self._max_per_host]
        blocked = await self._robots_gate(filtered_lines)
        if blocked or not filtered_lines:
            return self._skip("httpx", out, blocked or "no in-scope urls")
        # write filtered temp
        tmp_in = self._out_dir / "raw" / "httpx" / "input_filtered.txt"
        tmp_in.parent.mkdir(parents=True, exist_ok=True)
        tmp_in.write_text("\n".join(filtered_lines) + "\n", encoding="utf-8")
        args = ["-l", str(tmp_in), "-status-code", "-title", "-tech-detect",
                "-silent", "-o", str(out)]
        args += self._pacing("httpx")
        return await self._run("httpx", "httpx", args, out)

    async def run_nuclei(self, urls_file: Path, *, severity: str = "medium,high,critical") -> ToolResult:
        out = self._out_dir / "raw" / "nuclei" / "nuclei.txt"
        filtered_lines = self._read_filtered_urls(urls_file)[: self._max_per_host]
        blocked = await self._robots_gate(filtered_lines)
        if blocked or not filtered_lines:
            return self._skip("nuclei", out, blocked or "no in-scope urls")
        tmp_in = self._out_dir / "raw" / "nuclei" / "input_filtered.txt"
        tmp_in.parent.mkdir(parents=True, exist_ok=True)
        tmp_in.write_text("\n".join(filtered_lines) + "\n", encoding="utf-8")
        args = ["-l", str(tmp_in), "-severity", severity, "-silent",
                "-o", str(out), "-t", "exposures/", "-t", "misconfiguration/"]
        args += self._pacing("nuclei")
        return await self._run("nuclei", "nuclei", args, out)

    async def run_subfinder(self, domain: str) -> ToolResult:
        """Subdomain enumeration — مقيدة بثلاث بوابات.

        1) allow_subdomain_enum في ملف النطاق: بدونه لا يُشغَّل إطلاقًا
           (استعلامات DNS لأسماء شقيقة = مرور خارج النطاق).
        2) يجب أن يكون المج��ل مذكورًا *حرفيًا* في allowed_hosts. فحص
           `endswith("." + h)` السابق كان يسمح بتمرير النطاق الأم، وهو
           يوسّع النطاق بصمت.
        3) المخرجات تمر على _filter_output_file → assert_allowed بمطابقة
           تامة، فلا يُستخدم إلا ما هو مصرّح به فعلًا.
        """
        out = self._out_dir / "raw" / "subfinder" / "subfinder.txt"

        def _skip(reason: str) -> ToolResult:
            return self._skip("subfinder", out, reason)

        if not self._scope.scope.allow_subdomain_enum:
            return _skip("allow_subdomain_enum is false in scope")

        host = (domain or "").strip().lower().rstrip(".")
        if host not in self._scope.scope.allowed_hosts:
            return _skip(f"domain not literally in allowed_hosts: {host!r}")

        blocked = await self._robots_gate([f"https://{host}/"])
        if blocked:
            return _skip(blocked)

        args = ["-d", host, "-silent", "-o", str(out)]
        args += self._pacing("subfinder")
        return await self._run("subfinder", "subfinder", args, out)
