"""orchestrator.py — Subprocess wrapper for community tools."""
from __future__ import annotations

import asyncio
import logging
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from recon.core.scope_validator import ScopeValidator

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

    def __init__(
        self,
        *,
        scope: ScopeValidator,
        out_dir: Path,
        tools: dict[str, str] | None = None,
        timeout_seconds: int = 300,
    ) -> None:
        self._scope = scope
        self._out_dir = Path(out_dir)
        self._tools = tools or {}
        self._timeout = int(timeout_seconds)

    def _which(self, binary: str) -> str | None:
        # allow override via self._tools
        if binary in self._tools:
            return self._tools[binary]
        return shutil.which(binary)

    def _is_in_scope_line(self, line: str) -> bool:
        line = line.strip()
        if not line:
            return False
        # try parse as URL
        try:
            # If line contains URL, extract host
            # Try urlparse directly
            p = urlparse(line)
            host = (p.hostname or "").lower().rstrip(".")
            if host and host in self._scope.scope.allowed_hosts:
                return True
            # also check if any allowed host substring in line
            low = line.lower()
            for h in self._scope.scope.allowed_hosts:
                if h.lower() in low:
                    # verify via extracting host from any URL in line
                    # simple: if host substring present, keep but also check path not denied?
                    # check full line as URL if it looks like URL
                    if line.startswith("http"):
                        try:
                            self._scope.assert_allowed(line)
                            return True
                        except Exception:
                            return False
                    return True
            # if not URL but contains host, we already handled
            # Try to see if line itself is a URL without scheme: treat as https://line
            if not p.scheme and "/" not in line:
                # maybe just host
                if line.lower().rstrip(".") in self._scope.scope.allowed_hosts:
                    return True
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

    async def _run(self, tool: str, binary: str, args: list[str], stdout_path: Path) -> ToolResult:
        start = time.monotonic()
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
        filtered = self._filter_input_urls(targets)
        out = self._out_dir / "raw" / "katana" / "katana.txt"
        if not filtered:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text("", encoding="utf-8")
            return ToolResult(tool="katana", exit_code=0, stdout_path=out, lines=0, duration_seconds=0.0, skipped=False, skip_reason="no in-scope targets")
        # spec template: katana -u {url} -jc -d 2 -silent -o {out} ; for multiple, we use first url (or join)
        # We handle single url case per spec; for multiple, we pass first and filter will apply
        url = filtered[0]
        args = ["-u", url, "-jc", "-d", "2", "-silent", "-o", str(out)]
        return await self._run("katana", "katana", args, out)

    async def run_httpx(self, urls_file: Path) -> ToolResult:
        out = self._out_dir / "raw" / "httpx" / "httpx.txt"
        # read and filter input file
        filtered_lines = []
        if Path(urls_file).exists():
            for line in Path(urls_file).read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    self._scope.assert_allowed(line)
                    filtered_lines.append(line)
                except Exception:
                    continue
        # write filtered temp
        tmp_in = self._out_dir / "raw" / "httpx" / "input_filtered.txt"
        tmp_in.parent.mkdir(parents=True, exist_ok=True)
        tmp_in.write_text("\n".join(filtered_lines) + ("\n" if filtered_lines else ""), encoding="utf-8")
        args = ["-l", str(tmp_in), "-status-code", "-title", "-tech-detect", "-silent", "-o", str(out)]
        return await self._run("httpx", "httpx", args, out)

    async def run_nuclei(self, urls_file: Path, *, severity: str = "medium,high,critical") -> ToolResult:
        out = self._out_dir / "raw" / "nuclei" / "nuclei.txt"
        # filter input similarly
        filtered_lines = []
        if Path(urls_file).exists():
            for line in Path(urls_file).read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    self._scope.assert_allowed(line)
                    filtered_lines.append(line)
                except Exception:
                    continue
        tmp_in = self._out_dir / "raw" / "nuclei" / "input_filtered.txt"
        tmp_in.parent.mkdir(parents=True, exist_ok=True)
        tmp_in.write_text("\n".join(filtered_lines) + ("\n" if filtered_lines else ""), encoding="utf-8")
        args = ["-l", str(tmp_in), "-severity", severity, "-silent", "-o", str(out), "-t", "exposures/", "-t", "misconfiguration/"]
        return await self._run("nuclei", "nuclei", args, out)

    async def run_subfinder(self, domain: str) -> ToolResult:
        out = self._out_dir / "raw" / "subfinder" / "subfinder.txt"
        # domain should be in scope? Filter
        # domain is like example.com, check if in allowed_hosts or subdomain of allowed?
        # Spec says filter every input URL through scope.allowed_hosts — for subfinder domain, check allowed
        allowed = False
        for h in self._scope.scope.allowed_hosts:
            if domain == h or domain.endswith("." + h):
                allowed = True
                break
        if not allowed:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text("", encoding="utf-8")
            return ToolResult(tool="subfinder", exit_code=0, stdout_path=out, lines=0, duration_seconds=0.0, skipped=False, skip_reason="domain out-of-scope")
        args = ["-d", domain, "-silent", "-o", str(out)]
        return await self._run("subfinder", "subfinder", args, out)
