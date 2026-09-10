import pptxgen from 'pptxgenjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.resolve(__dirname, '..', 'output');

// Find latest article data
const files = fs.readdirSync(OUTPUT).filter(f => (f.startsWith('article_full_') || f.startsWith('planning_article_')) && f.endsWith('.json'));
files.sort((a, b) => fs.statSync(path.join(OUTPUT, b)).mtimeMs - fs.statSync(path.join(OUTPUT, a)).mtimeMs);

if (!files.length) { console.log('No article data found'); process.exit(1); }

const data = JSON.parse(fs.readFileSync(path.join(OUTPUT, files[0]), 'utf-8'));
const paras = data.paragraphs || [];
const title = data.title || 'Planning Engineering Article';
const source = data.source || '';

console.log(`Title: ${title}`);
console.log(`Paragraphs: ${paras.length}`);

const pptx = new pptxgen();

// === SLIDE 1: Title ===
const s1 = pptx.addSlide();
s1.background = { color: '1a1a2e' };
s1.addText('CSI Ultimate', { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 14, color: '3B82F6', bold: true });
s1.addText(title, { x: 0.5, y: 1.5, w: 9, h: 1.5, fontSize: 28, color: 'FFFFFF', bold: true, align: 'center' });
s1.addText('مستخلص بواسطة CSI Ultimate Engine', { x: 0.5, y: 3.2, w: 9, h: 0.6, fontSize: 16, color: '94A3B8', align: 'center' });
s1.addText('Playwright + Node.js | التوليد التلقائي', { x: 0.5, y: 3.9, w: 9, h: 0.5, fontSize: 12, color: '64748B', align: 'center' });
s1.addText(new Date().toLocaleDateString('ar-SA'), { x: 0.5, y: 5.5, w: 9, h: 0.4, fontSize: 11, color: '475569', align: 'center' });
if (source) s1.addText(source, { x: 0.5, y: 6.0, w: 9, h: 0.4, fontSize: 10, color: '334155', align: 'center' });

// === Content slides ===
let slideNum = 2;
const totalSlides = Math.ceil(paras.length / 3) + 2;

for (let i = 0; i < paras.length; i += 3) {
  const group = paras.slice(i, i + 3);
  const slide = pptx.addSlide();
  slide.background = { color: '0F0F1F' };
  
  // Header
  slide.addText('CSI Ultimate', { x: 0.4, y: 0.2, w: 5, h: 0.4, fontSize: 10, color: '3B82F6' });
  slide.addText(`${slideNum} / ${totalSlides}`, { x: 8, y: 0.2, w: 1.5, h: 0.4, fontSize: 10, color: '475569', align: 'right' });
  
  // Divider line
  slide.addShape(pptx.ShapeType.rect, { x: 0.4, y: 0.7, w: 9.2, h: 0.03, fill: { color: '1E293B' } });

  // Content
  group.forEach((p, pi) => {
    const short = p.length > 260 ? p.slice(0, 257) + '...' : p;
    slide.addText(`▸ ${short}`, {
      x: 0.5, y: 1.0 + pi * 1.7, w: 9, h: 1.5,
      fontSize: 13, color: 'D0D0E0', valign: 'top',
      lineSpacingMultiple: 1.3,
    });
  });
  slideNum++;
}

// === Last slide ===
const last = pptx.addSlide();
last.background = { color: '0A1A0A' };
last.addText('✓ تم الانتهاء', { x: 0.5, y: 2, w: 9, h: 1, fontSize: 32, color: '10B981', bold: true, align: 'center' });
last.addText('جميع المعلومات مأخوذة من المصادر الأصلية', { x: 0.5, y: 3.2, w: 9, h: 0.5, fontSize: 14, color: '94A3B8', align: 'center' });
last.addText(`CSI Ultimate — ${paras.length} فقرة مستخلصة`, { x: 0.5, y: 4.5, w: 9, h: 0.4, fontSize: 11, color: '475569', align: 'center' });

// Save
const outName = `presentation_planning_${Date.now()}.pptx`;
const outPath = path.join(OUTPUT, outName);
await pptx.writeFile({ fileName: outPath });
console.log(`✅ ${outPath}`);
console.log(`   ${totalSlides} slides, ${paras.length} paragraphs`);
