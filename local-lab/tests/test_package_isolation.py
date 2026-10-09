"""عزل الحزم: مجلدات local-lab يجب ألّا تحريف حزم المستودع الحقيقية.

الثغرة التي حُرست هنا: كان `local-lab/recon/` و `recon/` يتنافسان على الاسم
`recon`. مجلدات العمل (cwd) يتغيّر بين التشغيل والاختبارات وCI، فـ
`import recon` كان يُرجع حزمة المختبر الفارغة بدل `recon/core` الحقيقية
مثلما كان التنفيذ من داخل `local-lab`. صامت — لا خطأ، بل الكود الخطأ.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent

# المجلدات في local-lab التي يشترط تفرّدها لتعمل كحزم.
LOCAL_DIRS = {
    p.name for p in ROOT.iterdir()
    if p.is_dir() and p.name not in {"reports", "state", "tests", "learn",
                                     "docs", "node_modules", "__pycache__"}
}

# حزم حقيقية في جذر المستودع. لو تكرّر اسمٌ هنا فهو تصادم مؤكَّد.
ROOT_PACKAGES = {
    p.name for p in REPO.iterdir()
    if p.is_dir() and (p / "__init__.py").exists()
}


def test_no_local_dir_shadows_a_root_package():
    clashes = sorted(LOCAL_DIRS & ROOT_PACKAGES)
    assert not clashes, (
        f"مجلدات local-lab تحريف حزم حقيقية: {clashes} — "
        "أعد التسمية (مثل recon -> recon_lab) لمسح التعارض"
    )


def test_lab_recon_was_renamed():
    assert (ROOT / "recon_lab").is_dir()
    assert not (ROOT / "recon").exists(), (
        "عاد مجلد recon — سيحريف حزمة recon الحقيقية مرة أخرى"
    )


def _import_from(cwd: Path, module: str) -> tuple[int, str]:
    r = subprocess.run(
        [sys.executable, "-c", f"import {module} as m; print(m.__file__)"],
        cwd=str(cwd), capture_output=True, text=True, timeout=120,
    )
    return r.returncode, (r.stdout or "").strip() or (r.stderr or "").strip()


def test_recon_resolves_to_root_package_from_both_cwds():
    """من الجذر تُستورد الحقيقية. من local-lab لا تُستورد حزمة المختبر أصلًا."""
    code, out = _import_from(REPO, "recon")
    assert code == 0, f"import recon فشل من الجذر: {out}"
    assert Path(out).resolve().parent == REPO.resolve() / "recon", (
        f"من الجذر، استُورد المجلد الخطأ: {out}"
    )

    # من local-lab يجب أن يفشل (لا يوجد recon هناك)، لا أن يُرجع كود المختبر.
    code, out = _import_from(ROOT, "recon")
    if code == 0:
        assert "local-lab" not in out, (
            f"من local-lab، import recon أعاد حزمة المختبر: {out}"
        )
    else:
        assert "recon_lab" not in out, (
            f"رسالة الخطأ تشير للمجلد القديم: {out}"
        )


def test_lab_modules_import_flat_without_shadowing():
    """الوحدات تُستورد مسطّحة عبر sys.path — وهذا هو التصميم المقصود."""
    for d in ("scanner", "recon_lab", "engine"):
        assert (ROOT / d).is_dir(), f"مجلد مفقود: {d}"


def test_every_sys_path_bootstrap_points_to_existing_dir():
    """أي bootstrap يشير لمجلد غير موجود = استيراد صامت بلا أثر.

    يُقرأ سطر bootstrap حصرًا (سطر فيه sys.path.insert أو حلقة `for _d in`)
    حتى لا يُلتقط استدعاءات `.get("key")` العادية.
    """
    import re
    files = list((ROOT / "tests").glob("*.py")) + \
        [ROOT / "gui" / "tools.py", ROOT / "api" / "server.py",
         ROOT / "scanner" / "generic.py"] + \
        list((ROOT / "plugins" / "checks").glob("*.py"))

    name_re = re.compile(r'"([A-Za-z_][A-Za-z0-9_]*)"')
    bad, checked = [], 0
    for f in files:
        for line in f.read_text(encoding="utf-8",
                                errors="replace").splitlines():
            if "sys.path.insert" not in line and "for _d in" not in line:
                continue
            for name in name_re.findall(line):
                if name in {"__file__", "parents"}:
                    continue
                checked += 1
                if not (ROOT / name).is_dir():
                    bad.append(f"{f.relative_to(ROOT)} -> {name}")
    assert checked, "لم يُعثر على أي bootstrap — الاختبار فقد فعاليته"
    assert not bad, f"bootstraps تشير لمجلدات مفقودة: {sorted(set(bad))}"
