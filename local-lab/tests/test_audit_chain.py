"""سلامة سجل الأثر — الطلبات اليدوية كانت بلا سلسلة.

الاختبارات هنا تُثبت خاصية أمنية لا شكلًا: أن التعديل أو الحذف من
وسط سجل الأثر *يُكتشف*. لو مرّت هذه الاختبارات مع كود يكتب سطورًا
سليمة الشكل بلا prev/hash لكان ذلك فشلًا صامتًا.
"""
import hashlib
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
for p in ("engine", "scanner"):
    sys.path.insert(0, str(ROOT / p))

from repeater import replay, verify_audit  # noqa: E402

BASE = "http://127.0.0.1:5001/"


class _Sess:
    def request(self, *a, **k):
        return 200, [], b"ok"


def _rec(ap, name=None):
    replay(_Sess(), {"method": "GET", "url": BASE + (name or "/"),
                     "name": "t"}, audit_path=ap)


def _rewrite(path, mutate):
    lines = [l for l in Path(path).read_text(encoding="utf-8").splitlines()
             if l.strip()]
    lines = mutate(lines)
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_repeater_writes_chained_entries(tmp_path):
    """كل سطر يحمل prev/hash — بصمة رابطه بالسابق."""
    ap = tmp_path / "manual.jsonl"
    _rec(ap, "/a")
    _rec(ap, "/b")
    recs = [json.loads(l) for l in
            ap.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(recs) == 2
    assert all("hash" in r and "prev" in r for r in recs)
    #genesis
    assert recs[0]["prev"] == "0" * 64
    #linking
    assert recs[1]["prev"] == recs[0]["hash"]
    ok, msg = verify_audit(ap)
    assert ok, msg


def test_verify_audit_passes_on_honest_log(tmp_path):
    ap = tmp_path / "manual.jsonl"
    for i in range(5):
        _rec(ap, f"/p{i}")
    ok, msg = verify_audit(ap)
    assert ok, msg


def test_tampered_url_is_detected(tmp_path):
    """تعديل عنوان طلب ليوحي عملية لم تحدث — يجب أن يُكتشف."""
    ap = tmp_path / "manual.jsonl"
    _rec(ap, "/a")
    _rec(ap, "/b")

    def mutate(lines):
        obj = json.loads(lines[1])
        obj["url"] = BASE + "/innocent"
        lines[1] = json.dumps(obj, ensure_ascii=False)
        return lines

    _rewrite(ap, mutate)
    ok, msg = verify_audit(ap)
    assert not ok
    assert "بصمة" in msg or "كسر" in msg


def test_deleted_middle_entry_is_detected(tmp_path):
    ap = tmp_path / "manual.jsonl"
    for p in ("/a", "/b", "/c"):
        _rec(ap, p)
    _rewrite(ap, lambda ls: [ls[0], ls[2]])
    ok, msg = verify_audit(ap)
    assert not ok


def test_tampered_status_is_detected(tmp_path):
    """الأهم أمنيًا: تعديل النتيجة بعد حدوثها."""
    ap = tmp_path / "manual.jsonl"
    _rec(ap, "/a")

    def mutate(lines):
        obj = json.loads(lines[0])
        obj["status"] = 404          #طلب نجح 200، لكن السجل يقول 404
        lines[0] = json.dumps(obj, ensure_ascii=False)
        return lines

    _rewrite(ap, mutate)
    ok, _ = verify_audit(ap)
    assert not ok


def test_empty_and_missing_logs_are_ok(tmp_path):
    assert verify_audit(tmp_path / "nope.jsonl")[0]
    empty = tmp_path / "empty.jsonl"
    empty.write_text("", encoding="utf-8")
    assert verify_audit(empty)[0]


def test_unwritten_audit_is_reported_not_silent(tmp_path, capsys):
    """تعطّل الكتابة كان صامتًا: Operator يظن أن الأُثر وُثّق."""
    blocked = tmp_path / "dir_as_file"
    blocked.write_text("x", encoding="utf-8")      #file where a dir is needed
    replay(_Sess(), {"method": "GET", "url": BASE + "/", "name": "t"},
           audit_path=blocked / "sub" / "audit.jsonl")
    err = capsys.readouterr().err
    assert "الأثر" in err, err


def test_repeater_and_scan_share_one_chain(tmp_path):
    """الشرط الأصلي: أن يمتد أثر الـrepeater في نفس سلسلة audit.jsonl.

الـsidecar المنفصل كان معقولًا من حيث الشكل، لكنه يعني مسارَي تدقيق
لا يمكن التحقق منهما معًا. التنسيقان الآن متطابقان، فيمكن أن
يجلسا في ملف واحد ويفحصه مدقّق واحد.
    """
    from local_scan import AuditLog

    shared = tmp_path / "audit.jsonl"
    log = AuditLog(shared)
    log.append({"event": "scan", "target": BASE})
    _rec(shared, "/manual")
    log.append({"event": "api-scan", "target": BASE})

    #Both readers must accept it.
    assert log.verify_tail(), "local_scan يرفض السلسلة المشتركة"
    ok, msg = verify_audit(shared)
    assert ok, msg

    #And a tamper anywhere must be caught by both.
    def mutate(lines):
        obj = json.loads(lines[1])
        obj["url"] = BASE + "/forged"
        lines[1] = json.dumps(obj, ensure_ascii=False)
        return lines

    _rewrite(shared, mutate)
    assert not log.verify_tail()
    assert not verify_audit(shared)[0]


def test_hash_matches_documented_algorithm(tmp_path):
    """الصيغة مثبّتة عمدًا: إعادة حساب البصمة يدويًا.

    يثبّت الاختبار أن الخوارزمية هي sha256(prev + canonical entry)،
    فيمنع انزلاق صامت في ترتيب المفاتيح لاحقًا.
    """
    ap = tmp_path / "manual.jsonl"
    _rec(ap, "/a")
    rec = json.loads(ap.read_text(encoding="utf-8").splitlines()[0])
    entry = {k: v for k, v in rec.items() if k not in ("hash", "prev")}
    payload = json.dumps(entry, ensure_ascii=False, sort_keys=True).encode()
    expect = hashlib.sha256(("0" * 64).encode() + payload).hexdigest()
    assert rec["hash"] == expect
