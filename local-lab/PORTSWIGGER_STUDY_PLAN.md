# خطة الدراسة: نِطاق المحلي + أكاديمية PortSwigger

> القاعدة: **النظرية في الأكاديمية (مجانية بحسابك)، والتطبيق هنا.**
> كل درس في تبويب 🎓 التعلم يقابله مختبر أكاديمية بزر «🎓 PortSwigger».

## الترتيب المقترح (أساس → متقدم)

| # | الموضوع | الأكاديمية | مختبرنا |
|---|---|---|---|
| 1 | حقن SQL (دخول/بحث) | SQL injection: UNION + login bypass | SQLLOGIN, SQLSEARCH |
| 2 | الحقن الأعمى والزمني | Blind boolean + time delays | SQLBLIND, SQLTIME |
| 3 | XSS منعكسة ومخزنة | Reflected + Stored | XSSREFLECT, XSSSTORED |
| 4 | سياقات XSS | Contexts (attribute/JS) | XSSATTR, XSSJS, XSSPOLY |
| 5 | التحكم بالوصول | IDOR labs | IDOR, APIAUTH |
| 6 | المسارات والرفع | Traversal + Upload | PATH, UPLOAD |
| 7 | أوامر النظام | OS command injection | CMDI |
| 8 | المصادقة والجلسات | Password-based + brute-force | WEAKCOOKIE, NOLOCK |
| 9 | JWT | None + weak secret | JWTNONE, JWTWEAK |
| 10 | SSRF وSSTI | localhost SSRF + Jinja2 | SSRF, SSTI |
| 11 | CSRF وCORS وHost | labs المقابلة | CSRF, CORS, HOSTHDR |
| 12 | التوجيه والترويسات | (تغطية محلية) + clickjacking | OPENREDIR, SECHDRS, CSPWEAK, INFOLEAK |

## كيف تذاكر الدرس الواحد (30-45 دقيقة)

1. اقرأ موضوع الأكاديمية وحل مختبرًا واحدًا هناك.
2. افتح الدرس المقابل في تبويب 🎓 التعلم وطبّق نفس الفكرة على `127.0.0.1:5001`.
3. اضغط «تحقق بنفسي» ثم نفّذ مهمة PoC ذات الصلة.
4. صدّر بطاقة Bounty للثغرة (تبويب 📤 التقارير) — ملف إنجازك.

## ملاحظة النطاق

مختبرات الأكاديمية تعمل على نطاق PortSwigger المصرح (حسابك) — لا توجه
أداتنا إلا لأهداف `loopback` أو هدف مرخص بتوكيد «أؤكد».
