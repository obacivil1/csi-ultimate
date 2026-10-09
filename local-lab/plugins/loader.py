"""
plugins/loader.py — تحميل إضافات الفحص من ملفات بايثون.
========================================================
يكتشف *.py في مجلد، يستوردها بأمان، ويتحقق من عقد PLUGIN ثم يعيد
قوائم جاهزة بنفس شكل CHECKS (تعمل مع run_check مباشرة).
"""
import importlib.util
import sys
from pathlib import Path

REQUIRED = {"code", "name", "owasp", "severity", "family"}
SEV = {"critical", "high", "medium", "low", "info"}


def _load_module(path: Path):
    name = f"_plugin_{path.stem}"
    spec = importlib.util.spec_from_file_location(name, str(path))
    if spec is None or spec.loader is None:
        raise ValueError(f"تعذّر تحميل: {path.name}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def validate(plugin: dict, run_fn, source: str):
    missing = REQUIRED - set(plugin)
    if missing:
        raise ValueError(f"{source}: حقول ناقصة {sorted(missing)}")
    if plugin["severity"] not in SEV:
        raise ValueError(f"{source}: حرجية غير صالحة")
    if not callable(run_fn):
        raise ValueError(f"{source}: run ليست دالة")
    return True


def discover(plugindir, enabled=None):
    """يفحص المجلد ويعيد (loaded[{...check}], errors[{file, error}])."""
    plugindir = Path(plugindir)
    loaded, errors = [], []
    if not plugindir.is_dir():
        return loaded, [{"file": str(plugindir), "error": "المجلد غير موجود"}]
    for path in sorted(plugindir.glob("*.py")):
        if path.name.startswith("_"):
            continue
        if enabled is not None and path.stem not in enabled:
            continue
        try:
            mod = _load_module(path)
            plugin = getattr(mod, "PLUGIN", None)
            if plugin is None:
                raise ValueError("لا يوجد قاموس PLUGIN")
            run_fn = getattr(mod, "run", None)
            validate(plugin, run_fn, path.name)
            loaded.append({"code": plugin["code"], "name": plugin["name"],
                           "owasp": plugin["owasp"],
                           "severity": plugin["severity"],
                           "family": plugin["family"],
                           "require": plugin.get("require"),
                           "fn": run_fn, "source": path.name})
        except Exception as e:
            errors.append({"file": path.name, "error": str(e)[:200]})
    return loaded, errors
