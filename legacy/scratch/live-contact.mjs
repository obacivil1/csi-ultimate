import http from "http";
import { execFileSync } from "child_process";

const html = `<!DOCTYPE html><html lang="ar"><head><meta charset="utf-8"><meta name="description" content="مكتب نور — استشارات قانونية وتجارية في الرياض"><title>مكتب نور للمحاماة</title></head><body>
<h1>مكتب نور للمحاماة</h1>
<p>حي الياسمين، شارع الملك فهد، الرياض. تواصل: <b>contact@noor-law.sa</b> أو <b>0112345678</b> أو <b>0502345678</b>.</p>
<p>للتواصل عبر واتساب في أي وقت.</p>
<a href="https://wa.me/9660502345678">واتساب</a>
<a href="https://www.linkedin.com/company/noor-law">لينكدإن</a>
<a href="https://twitter.com/noorlaw">تويتر</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=x">مشاركة فيسبوك</a>
<a href="/services">الخدمات</a>
<a href="/team">الفريق</a>
</body></html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
});

server.listen(18113, "127.0.0.1", () => {
  console.log("server up");
  setTimeout(() => {
    try {
      execFileSync(process.execPath, ["scripts/general-mission.mjs", "--urls", "http://127.0.0.1:18113/", "--title", "فحص جهات تماس حي", "--out", "temp/contact-verify/live"], { stdio: "inherit" });
    } finally {
      server.close();
    }
  }, 400);
});
