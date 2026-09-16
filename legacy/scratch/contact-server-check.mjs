import http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
const HTML = `<!DOCTYPE html><html lang="ar"><head><title>مكتب نور</title><meta charset="utf-8"></head><body>
<h1>مكتب نور للمحاماة</h1>
<p>الرياض حي الياسمين. تواصل عبر 0501234567 أو +971501234567 أو info@noor-law.sa</p>
<a href="https://wa.me/971501234567">واتساب</a>
<a href="https://www.linkedin.com/company/noor-law">لينكدإن</a>
<a href="https://twitter.com/noorlaw">تويتر</a>
<a href="/services">التخصصات</a>
</body></html>`;
const srv = http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); r.end(HTML); });
srv.listen(18113, "127.0.0.1", () => {
  const out = "temp/contact-verify/live2";
  if (!existsSync(out)) mkdirSync(out, { recursive: true });
  try {
    execFileSync(process.execPath, ["scripts/general-mission.mjs", "--urls", "http://127.0.0.1:18113/", "--title", "فحص جهات تماس حي", "--out", out], { stdio: "inherit", cwd: process.cwd() });
    const j = JSON.parse(readFileSync(out.replace(/\\/g, "/") + "/فحص-جهات-تماس-حي.json", "utf8"));
    console.log("STATS:", JSON.stringify(j.stats));
    const d = j.docs[0];
    console.log("DOC keys:", Object.keys(d).filter((k) => /contact|mail|phone|whatsapp|social/i.test(k)).join(","));
    console.log("contacts:", JSON.stringify({ emails: d.emails, phones: d.phones, whatsapp: d.whatsapp, social: d.social, hasContact: d.hasContact }));
  } catch (e) { console.error("ERR:", e.message); process.exitCode = 1; }
  srv.close(); process.exit(process.exitCode || 0);
});