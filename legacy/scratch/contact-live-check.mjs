import http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const HTML = `<!DOCTYPE html><html lang="ar"><head><title>مكتب نور للمحاماة</title><meta charset="utf-8"><meta name="description" content="محاماة واستشارات قانونية في الرياض"></head><body>
<h1>مكتب نور للمحاماة</h1>
<p>الرياض حي الياسمين شارع الملك فهد. للتواصل: 0501234567 (سعودي) أو +971501234567 (دولي) أو info@noor-law.sa</p>
<a href="https://wa.me/971501234567">واتساب</a>
<a href="https://www.linkedin.com/company/noor-law">لينكدإن</a>
<a href="https://twitter.com/noorlaw">تويتر</a>
<a href="/services">التخصصات القانونية</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=x">مشاركة فيسبوك</a>
</body></html>`;

let done = false;
const finish = (code) => {
  if (done) return;
  done = true;
  try { srv.close(); } catch {}
  setTimeout(() => process.exit(code), 500);
};

const srv = http.createServer((q, r) => {
  r.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  r.end(HTML);
});

srv.on("error", (e) => { console.error("SRV ERR:", e.message); finish(1); });

srv.listen(18113, "127.0.0.1", () => {
  const out = path.resolve("temp/contact-verify/live2");
  if (!existsSync(out)) mkdirSync(out, { recursive: true });
  try {
    execFileSync(process.execPath, [
      "scripts/general-mission.mjs",
      "--urls", "http://127.0.0.1:18113/",
      "--title", "فحص جهات تماس حي",
      "--out", out,
    ], { cwd: process.cwd(), stdio: "inherit" });
    const file = path.join(out, "فحص-جهات-تماس-حي.json");
    if (!existsSync(file)) throw new Error("لم يُكتب JSON");
    const j = JSON.parse(readFileSync(file, "utf8"));
    console.log("STATS:", JSON.stringify(j.stats));
    const d = (j.docs || [])[0];
    console.log("DOC:", JSON.stringify({ hasContact: d.hasContact, emails: d.emails, phones: d.phones, whatsapp: d.whatsapp, social: d.social }));
    finish(0);
  } catch (e) {
    console.error("ERR:", e.message);
    finish(1);
  }
});

setTimeout(() => { console.error("TIMEOUT"); finish(1); }, 150000).unref();
