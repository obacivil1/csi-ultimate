"""local-lab/run_target.py — يطلق الموقع المحلي في الخلفية (ويندوز) ويعيد PID."""
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PY = sys.executable


def stop_existing(port: int = 5001):
    import re
    import socket
    try:
        sock = socket.socket()
        sock.bind(("127.0.0.1", port))
        sock.close()
        return  # المنفذ حر
    except OSError:
        pass
    # اقتل كل العمليات المشغولة بالمنفذ (قد يتسابق أكثر من خادم قديم)
    out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True).stdout
    killed = []
    for line in out.splitlines():
        match = re.search(rf"TCP\s+127\.0\.0\.1:{port}\s+\S+\s+LISTENING\s+(\d+)", line)
        if match:
            pid = match.group(1)
            if pid in killed:
                continue
            subprocess.run(["taskkill", "/F", "/PID", pid], capture_output=True)
            killed.append(pid)
            time.sleep(0.4)
    return killed or None


def start():
    stopped = stop_existing(5001)
    log = ROOT / "target" / "server.log"
    with open(log, "w", encoding="utf-8") as fh:
        proc = subprocess.Popen(
            [PY, "-u", str(ROOT / "target" / "app.py")],
            cwd=ROOT.parent, stdout=fh, stderr=fh,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    time.sleep(2.5)
    alive = proc.poll() is None
    print(f"stopped_old={stopped} new_pid={proc.pid} alive={alive} log={log}")
    if not alive:
        print(Path(log).read_text(encoding="utf-8")[-2000:])


if __name__ == "__main__":
    start()