/**
 * hawkers-offline.mjs — تسليم تصميم Hawkers PDP دون اتصال
 * ────────────────────────────────────────────────────────
 *  يبني صفحة منتج (PDP) ذاتية الاكتفاء من رموز التصميم المستخرجة
 *  (state/hawkers/hawkers-design.json + خطوط woff2 المحلية) دون أي
 *  تعقّب أو شبكة — خرج قابل للعرض/الطباعة أنيق يحاكي هوية Hawkers.
 *
 *  التشغيل:  node scripts/design/hawkers-offline.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HK = path.resolve(__dirname, "..", "..", "state", "hawkers");
const ASSETS = path.join(HK, "assets");
const OUT = path.join(HK, "hawkers-pdp-offline.html");

const design = JSON.parse(fs.readFileSync(path.join(HK, "hawkers-design.json"), "utf8"));
const rgb = (i) => design.colors[i] || "rgb(0,0,0)";
const palette = {
  brand: rgb(7), accent: rgb(4), text: rgb(6), muted: rgb(1),
  success: rgb(11), menu: rgb(5), light: rgb(9),
};
const present = fs.readdirSync(ASSETS).filter((f) => f.endsWith(".woff2"));

// نسخة واجهات الخطوط من الأصول المحلية — متوقفة على الملفات الحاضرة فقط
const FONT_MAP = {
  "81c7589f0813d50a673e.woff2": ["Roboto", 300],
  "63a92936f636496da8a3.woff2": ["Roboto", 400],
  "c968c2653e277f3a527f.woff2": ["Roboto", 500],
  "303a3d23b41067dea135.woff2": ["Roboto", 700],
  "a640f4058d9b09fe973b.woff2": ["FjallaOne", 400],
  "0b9f5c97f563bc870aa2.woff2": ["NimbusSansDOTExtended", 400],
  "3caa13348df745ea46c2.woff2": ["NimbusSansDOTExtended", 700],
};
const faceList = present.filter((f) => FONT_MAP[f]);
const faces = faceList
  .map((f) => {
    const [family, weight] = FONT_MAP[f];
    return `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:swap;src:url('assets/${f}') format('woff2');}`;
  })
  .join("\n");

const css = `
${faces}
:root{--brand:${palette.brand};--accent:${palette.accent};--text:${palette.text};--muted:${palette.muted};--success:${palette.success};--menu:${palette.menu};--light:${palette.light};}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Roboto',system-ui,sans-serif;color:var(--text);background:#fff;line-height:1.5}
.hellobar{background:var(--accent);color:#000;text-align:center;font-size:12px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;padding:5px 8px}
header{background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 24px;height:52px}
.logo{font-family:'NimbusSansDOTExtended','Roboto',sans-serif;font-weight:700;letter-spacing:2px;font-size:20px}
.logo b{color:var(--accent)}
nav{display:flex;gap:22px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
.pdp{display:grid;grid-template-columns:1fr 1fr;gap:0;max-width:1099px;margin:0 auto}
aside{border-right:1px solid #eee;padding:32px}
aside .model{border:1px solid #ddd;border-radius:10px;overflow:hidden}
aside .model .swatch{height:270px;background:radial-gradient(circle at 35% 30%, #3a3a3a, #111)}
aside .model .tag{background:var(--accent);color:#000;font-weight:800;font-size:11px;letter-spacing:1px;display:inline-block;padding:3px 10px;margin:10px;text-transform:uppercase}
aside .model .line{padding:0 10px 10px;font-size:12px}
main{padding:48px 40px}
.crumbs{font-size:12px;color:var(--muted);text-transform:capitalize}
h1{font-family:'FjallaOne','Roboto',sans-serif;font-weight:400;font-size:28px;letter-spacing:.5px;text-transform:uppercase;margin:14px 0 6px}
.price{font-size:26px;font-weight:700}
.price small{font-size:14px;color:var(--muted);font-weight:400}
.free{color:var(--success);font-weight:700;font-size:13px;margin:8px 0 18px}
.btn{display:block;width:100%;border:0;border-radius:6px;padding:16px;background:var(--success);color:#fff;font-weight:800;letter-spacing:1px;text-transform:uppercase;cursor:pointer}
.btn:hover{opacity:.9}
.accordion{margin-top:28px;border-top:1px solid #eee}
.accordion details{border-bottom:1px solid #eee;padding:12px 0}
.accordion summary{cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase}
.accordion p{font-size:13px;color:var(--muted);padding-top:8px}
footer{background:var(--light);margin-top:32px;padding:24px;text-align:center;font-size:12px;color:var(--muted)}
`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HAWKERS X PAULA ECHEVARRÍA - JAM BB | Blue Light</title>
<style>${css}</style>
</head>
<body>
<div class="hellobar">Free shipping on orders over €50 · 2-for-1 offer</div>
<header>
  <div class="logo">HAWK<b>ERS</b></div>
  <nav><span>Man</span><span>Woman</span><span>Kids</span><span>Promotions</span></nav>
</header>
<section class="pdp">
  <aside>
    <div class="model">
      <div class="swatch"></div>
      <span class="tag">Blue Light</span>
      <div class="line"><strong>HAWKERS X PAULA ECHEVARRÍA - JAM BB</strong><br>HJAM24CBXE · acetate · gradient lens</div>
    </div>
  </aside>
  <main>
    <div class="crumbs">Blue Light / Woman</div>
    <h1>Hawkers x Paula Echevarría — Jam BB</h1>
    <div class="price">€64.99 <small>instead of €129.99</small></div>
    <div class="free">Free shipping</div>
    <button class="btn">Add to cart</button>
    <section class="accordion">
      <details open><summary>Description</summary><p>Round acetate frames with blue-light filter lenses, gradient mirror coating and custom Hawkers engraving. Case and microfiber cloth included.</p></details>
      <details><summary>Measurements</summary><p>Front 140 mm · Temple 145 mm · Lens height 49 mm</p></details>
      <details><summary>Shipping &amp; returns</summary><p>Free shipping from €50 · 30-day returns</p></details>
    </section>
  </main>
</section>
<footer>Hawkers · Designer sunglasses · © 2026</footer>
</body>
</html>
`;

fs.writeFileSync(OUT, html, "utf8");
const report = {
  generatedAt: new Date().toISOString(),
  source: "hawkers-design.json",
  fontsInlined: faceList.length,
  filesWoff2: present.length,
  paletteUsed: Object.values(palette),
  output: path.relative(path.resolve(__dirname, "..", ".."), OUT),
  bytes: Buffer.byteLength(html, "utf8"),
};
fs.writeFileSync(path.join(HK, "hawkers-offline.json"), JSON.stringify(report, null, 2), "utf8");
console.log(`✓ Hawkers offline PDP: ${report.bytes} bytes, ${report.fontsInlined} خطوط مضمّنة من ${report.filesWoff2} woff2`);