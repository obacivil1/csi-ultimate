import http from "node:http";
const HTML = `<!DOCTYPE html><html lang="ar"><head><title>مكتب نور</title><meta charset="utf-8"></head><body>
<h1>مكتب نور للمحاماة</h1>
<p>الرياض حي الياسمين. تواصل عبر 0501234567 أو +971501234567 أو info@noor-law.sa</p>
<a href="https://wa.me/971501234567">واتساب</a>
<a href="https://www.linkedin.com/company/noor-law">لينكدإن</a>
<a href="https://twitter.com/noorlaw">تويتر</a>
<a href="/services">التخصصات</a>
</body></html>`;
const srv = http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); r.end(HTML); });
srv.listen(18113, "127.0.0.1", () => console.log("SERVER_UP"));
setInterval(() => {}, 3600000).unref();
setTimeout(() => process.exit(0), 120000).unref();
