"""
local-lab/api/server.py — واجهة REST محلية للأداة (الأتمتة والتكامل).
======================================================================
تُربَط على 127.0.0.1 فقط. نموذج jobs غير متزامن (الفحص يستغرق عشرات
الثواني): POST يُنشئ مهمة، وGET يستعلم حالتها.
التفويض المرخص نصي وصريح: {"confirm": "أؤكد"} — يُرفَض بدونه (403)
ويُسجَّل في audit. بلا confirm = loopback فقط.
"""
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

LAB = Path(__file__).resolve().parents[1]
for _d in ("scanner", "engine", "recon_lab", "report", "util"):
    _p = str(LAB / _d)
    if _p not in sys.path:
        sys.path.insert(0, _p)

from flask import Flask, jsonify, request

VERSION = "5.0.0"
JOBS = {}
JOBS_LOCK = threading.Lock()


def _new_job(kind, target, mode):
    jid = uuid.uuid4().hex[:12]
    with JOBS_LOCK:
        JOBS[jid] = {"id": jid, "kind": kind, "target": target,
                     "mode": mode, "status": "queued",
                     "created_at": datetime.now(timezone.utc).isoformat(),
                     "result": None, "error": None}
    return jid


def _set_job(jid, **kw):
    with JOBS_LOCK:
        if jid in JOBS:
            JOBS[jid].update(kw)


def _scope_for(target, mode, confirm):
    """يشتق النطاق من الهدف: loopback بلا توكيد، وخارجي بتوكيد «أؤكد»."""
    from scoped import Scope, is_loopback, normalize_host
    url = target if "://" in target else "http://" + target
    host = normalize_host(url.split("://", 1)[1])
    if is_loopback(host):
        scope = Scope(mode="loopback")
    else:
        if confirm != "أؤكد":
            raise PermissionError("هدف خارجي: التفويض يتطلب confirm='أؤكد'.")
        scope = Scope(mode="authorized", allow=[target], confirm=True)
    scope.check_url(url)
    return scope


def _run_scan(jid, target, mode, confirm):
    from local_scan import AuditLog, build_report
    t0 = time.time()
    try:
        from session import Session
        from scoped import is_loopback, normalize_host
        from targets import find_target, intrusive_granted

        scope = _scope_for(target, mode, confirm)
        base = f"{target.rstrip('/')}/"
        url = target if "://" in target else "http://" + target
        host = normalize_host(url.split("://", 1)[1])
        loopback = is_loopback(host)

        if loopback:
            # Local lab: the invasive loopback check set is correct here.
            from local_scan import run_check, CHECKS

            s = Session(scope)
            rows = []
            for meta in CHECKS:
                try:
                    rows.append(run_check(meta, s, base, mode))
                except Exception as e:
                    rows.append({"code": meta["code"], "name": meta["name"],
                                 "owasp": meta["owasp"],
                                 "severity": meta["severity"],
                                 "family": meta["family"], "sub_status": 0,
                                 "status": "خطأ", "verdict": False,
                                 "note": str(e)[:200], "evidence": "",
                                 "mode": mode})
            rep = build_report(rows, base, target, f"api-{mode}",
                               datetime.now(timezone.utc))
            rep["check_set"] = "local_scan.CHECKS (loopback lab)"
        else:
            # External target: NEVER run invasive lab checks. Use the read-only
            # generic set, exactly like run_external() in local_scan.py.
            from generic import audit_target
            from targets import canonical as _canonical

            canon = _canonical(target)
            rec = find_target(canon)
            deep = bool(rec and rec.get("intrusive")) and intrusive_granted(canon)
            rep = audit_target(scope, base, mode=mode, auth_record=rec)
            rep["check_set"] = ("generic.GENERIC_CHECKS + DEEP_CHECKS" if deep
                                else "generic.GENERIC_CHECKS (read-only)")

        aud = AuditLog(LAB / "reports" / "audit.jsonl")
        _summary_findings = (rep.get("summary", {}) or {}).get("findings")
        if _summary_findings is None:
            _summary_findings = len(rep.get("findings", []) or [])
        aud.append({"event": "api-scan", "target": base, "mode": mode,
                    "confirm": confirm == "أؤكد",
                    "loopback": loopback,
                    "check_set": rep.get("check_set"),
                    "findings": _summary_findings})
        _set_job(jid, status="done", result=rep,
                 elapsed=round(time.time() - t0, 1))
    except PermissionError as e:
        _set_job(jid, status="denied", error=str(e))
    except ValueError as e:
        _set_job(jid, status="denied", error=str(e))
    except Exception as e:
        _set_job(jid, status="error", error=str(e)[:300])


def _run_crawl(jid, target, mode, confirm):
    t0 = time.time()
    try:
        from session import Session
        from crawler import crawl
        scope = _scope_for(target, mode, confirm)
        m = crawl(Session(scope), f"{target.rstrip('/')}/",
                  max_pages=25, max_depth=2)
        _set_job(jid, status="done",
                 result={"pages": len(m["pages"]),
                         "endpoints": m["endpoints"],
                         "forms": len(m["forms"])},
                 elapsed=round(time.time() - t0, 1))
    except PermissionError as e:
        _set_job(jid, status="denied", error=str(e))
    except Exception as e:
        _set_job(jid, status="error", error=str(e)[:300])


def create_app():
    app = Flask("locallab-api")

    @app.get("/api/health")
    def health():
        return jsonify({"ok": True, "version": VERSION,
                        "time": datetime.now(timezone.utc).isoformat()})

    @app.get("/api/openapi.json")
    def openapi():
        import json as _json
        spec = Path(__file__).resolve().parent / "openapi.json"
        return jsonify(_json.loads(spec.read_text(encoding="utf-8")))

    @app.get("/api/checks")
    def checks():
        from local_scan import CHECKS
        return jsonify([{"code": c["code"], "name": c["name"],
                         "owasp": c["owasp"], "severity": c["severity"]}
                        for c in CHECKS])

    @app.post("/api/scan")
    def scan():
        data = request.get_json(force=True, silent=True) or {}
        target = (data.get("target") or "").strip()
        mode = data.get("mode", "verify")
        confirm = data.get("confirm", "")
        if not target:
            return jsonify({"error": "target إجباري"}), 400
        if mode not in ("detect", "verify"):
            return jsonify({"error": "mode: detect|verify"}), 400
        try:
            _scope_for(target, mode, confirm)
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        jid = _new_job("scan", target, mode)
        _set_job(jid, status="running")
        threading.Thread(target=_run_scan, args=(jid, target, mode, confirm),
                         daemon=True).start()
        return jsonify({"job_id": jid, "status": "running"}), 202

    @app.post("/api/crawl")
    def crawl_route():
        data = request.get_json(force=True, silent=True) or {}
        target = (data.get("target") or "").strip()
        confirm = data.get("confirm", "")
        if not target:
            return jsonify({"error": "target إجباري"}), 400
        try:
            _scope_for(target, "verify", confirm)
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        jid = _new_job("crawl", target, "verify")
        _set_job(jid, status="running")
        threading.Thread(target=_run_crawl,
                         args=(jid, target, "verify", confirm),
                         daemon=True).start()
        return jsonify({"job_id": jid, "status": "running"}), 202

    @app.get("/api/jobs/<jid>")
    def job(jid):
        with JOBS_LOCK:
            j = JOBS.get(jid)
            if not j:
                return jsonify({"error": "مهمة غير موجودة"}), 404
            out = dict(j)
        if out["status"] == "done" and out["kind"] == "scan":
            rep = out.pop("result")
            # local_scan reports use "summary"; generic reports use "findings".
            if isinstance(rep.get("summary"), dict):
                out["summary"] = rep["summary"]
            else:
                out["summary"] = {
                    "findings": len(rep.get("findings", []) or []),
                    "checks": rep.get("meta", {}).get("checks"),
                }
            out["check_set"] = rep.get("check_set")
            out["findings"] = [
                {"code": r.get("code"), "name": r.get("name"),
                 "severity": r.get("severity"), "note": r.get("note")}
                for r in (rep.get("findings") or [])
            ]
        return jsonify(out)

    return app


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=5051, debug=False)
