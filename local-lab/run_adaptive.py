"""local-lab/run_adaptive.py — تشغيل الطبقة التكيّفية على أي هدف محلي.

هذا هو المدخل الرسمي الذي كان ناقصًا: يطبع جرد المسارات وربط
القدرات والنتائج، ويخزّنها JSON ليمكن مقارنتها بين هدف وآخر على
المقياس نفسه.

    python run_adaptive.py http://127.0.0.1:4280
    python run_adaptive.py http://127.0.0.1:5005 --json safe.json

القيود: يقرأ من session التي تفرض loopback، فأي هدف غير محلي يُرفض
قبل أي اتصال. لا يتجاوز حدود المعدل، ويطبع دائمًا أرقام القياس:
عدد الطلبات، والمؤكد، والمؤشّر — حتى لا يُقرأ غياب النتائج نجاحًا.
"""
import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
for sub in ("scanner", "recon_lab", "engine"):
    sys.path.insert(0, str(ROOT / sub))

from adaptive import (inventory, match_targets,       # noqa: E402
                      login as adaptive_login,
                      session_alive as adaptive_session_alive)
from local_scan import Session                     # noqa: E402
from probes import run_targeted                    # noqa: E402


def report(base, inv, match, findings, n_requests, elapsed):
    print("  الاستكشاف: %d مسار في %.1fs"
          % (len(inv["routes"]), elapsed))
    print("  الربط: %d كود له وجه" % len(match))
    print("  الفحوص: %d نتيجة" % len(findings))
    print()
    print("  المسارات المكتشَفة:")
    for r in inv["routes"][:40]:
        bits = []
        if r["params"]:
            bits.append("params=" + ",".join(r["params"][:4]))
        if r["fields"]:
            bits.append("fields=" + ",".join(r["fields"][:4]))
        print("    %-34s %s" % (r["path"], " ".join(bits)))
    if len(inv["routes"]) > 40:
        print("    … و%d مسارًا آخر" % (len(inv["routes"]) - 40))
    print()
    print("  الربط (كود -> وجه):")
    for code in sorted(match):
        print("    %-12s -> %s"
              % (code, ", ".join(t["path"] for t in match[code][:4])))
    print()
    strong = [f for f in findings if f["verdict"]]
    weak = [f for f in findings if not f["verdict"]]
    print("  النتائج:")
    for f in sorted(strong, key=lambda x: x["code"]):
        print("    [مؤكد]  %-11s %s?%s  (%s)"
              % (f["code"], f["route"], f.get("param") or "",
                 f.get("param_source")))
        print("              %s" % f["note"])
    for f in sorted(weak, key=lambda x: x["code"]):
        print("    [مؤشّر]  %-11s %s  (%s)"
              % (f["code"], f["route"], f.get("param_source")))
        print("              %s" % f["note"])
    print()
    print("  الخلاصة: %d مؤكد، %d مؤشّر، %d مسار، %d طلب"
          % (len(strong), len(weak), len(inv["routes"]), n_requests))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("base", help="http://127.0.0.1:PORT/")
    ap.add_argument("--json", help="مسار حفظ النتائج")
    ap.add_argument("--max-pages", type=int, default=25)
    ap.add_argument("--login", metavar="USER:PASS",
                    help="تسجيل دخول قبل الزحف (يغطّي ما خلف الدخول)")
    ap.add_argument("--login-path", help="مسار صفحة الدخول إن لم تُرصد")
    args = ap.parse_args(argv)

    base = args.base.rstrip("/")
    s = Session()

    # مرحلة ١: زحف أول بلا دخول — لالتقاط نموذج الدخول نفسه.
    inv0 = inventory(s, base, max_pages=args.max_pages)
    if args.login:
        user, _, pwd = args.login.partition(":")
        ok, note = adaptive_login(s, base, user, pwd,
                                  path=args.login_path, inv=inv0)
        print("  المصادقة: %s — %s" % ("نجحت" if ok else "فشلت", note))
        if not ok:
            print("  تحذير: نتائج ما بعد الدخول ستكون لزائر فقط.")

    t0 = time.time()
    inv = (inv0 if not args.login
           else inventory(s, base, max_pages=args.max_pages))
    t1 = time.time()

    # حارس الجلسة: زحف قد يمرّ على رابط خروج أو تنتهي صلاحيته. إن
    # حدث ذلك بعد جرد المسارات، كل فحص قادم سيقيس صفحة الدخول بدل
    # الهدف فيصمت صمتًا — وهو أسوأ من الفشل الصريح. نعيد الدخول
    # مرة واحدة ونعلن ذلك.
    if args.login:
        alive, why = adaptive_session_alive(s, base)
        if not alive:
            user, _, pwd = args.login.partition(":")
            ok2, note2 = adaptive_login(s, base, user, pwd,
                                        path=args.login_path, inv=inv0)
            print("  ⚠ الجلسة انتهت أثناء الزحف (%s) → إعادة دخول: %s"
                  % (why, "نجحت" if ok2 else "فشلت — " + note2))
            if ok2:
                inv = inventory(s, base, max_pages=args.max_pages)

    match = match_targets(inv)
    errors = []
    findings = run_targeted(s, base, inv, match, errors=errors)
    for e in errors:
        print("  ✗ تعذّر فحص %s على %s (%s)"
              % (e["code"], e["route"], e["error"]))

    # الحجب يخصّ الجلسة لا التطبيق: بعد عدة حقن تردّ تطبيقات مثل
    # DVWA بصفحة حظر في كل الطلبات التالية، فيصمت الفحص ويبدو
    # التطبيق آمنًا. الحل العملي: جلسة نظيفة ثم إعادة الفحص.
    blocked = [f for f in findings if f.get("blocked")]
    if blocked:
        print("  ⛔ حجب التطبيق %d فحصًا — إعادة الجلسة وإعادة الفحص"
              % len(blocked))
        if args.login:
            user, _, pwd = args.login.partition(":")
            ok3, note3 = adaptive_login(s, base, user, pwd,
                                        path=args.login_path, inv=inv0)
            print("    جلسة جديدة: %s" % ("نجحت" if ok3 else "فشلت — " + note3))
        findings = [f for f in findings if not f.get("blocked")] \
            if (args.login and ok3) else findings
        errors = []
        retry = run_targeted(s, base, inv, match, errors=errors)
        for e in errors:
            print("  ✗ تعذّر فحص %s على %s (%s)"
                  % (e["code"], e["route"], e["error"]))
        keep = {(f.get("code"), f.get("route")) for f in findings}
        findings += [f for f in retry
                     if (f.get("code"), f.get("route")) not in keep]

    if args.login:
        alive2, why2 = adaptive_session_alive(s, base)
        if not alive2:
            print("  ⚠ الجلسة انتهت أثناء الفحص (%s) — النتائج ناقصة" % why2)

    report(base, inv, match, findings, s.n_requests, t1 - t0)

    if args.json:
        payload = {"base": base, "routes": inv["routes"],
                   "scripts": inv["scripts"], "file_hints": inv["file_hints"],
                   "match": {k: [t["path"] for t in v]
                             for k, v in match.items()},
                   "findings": findings, "n_requests": s.n_requests}
        Path(args.json).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8")
        print("  حُفظت النتائج في %s" % args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())