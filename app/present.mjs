import fs from 'fs';

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));

function categorize(title, url) {
  if (url.includes('/sport/')) return '⚽ رياضة';
  if (url.includes('/ebusiness/')) return '💼 اقتصاد';
  if (url.includes('/politics/')) return '🏛️ سياسة';
  if (url.includes('/video/')) return '🎬 فيديو';
  if (url.includes('/liveblog/') || title.includes('مباشر')) return '🔴 مباشر';
  if (title.includes('اتفاق') || title.includes('إيران') || title.includes('ترمب') || title.includes('قاليباف')) return '🌍 أخبار عاجلة';
  return '📰 أخبار';
}

const categorized = {};
for (const item of raw) {
  const cat = categorize(item.title, item.url);
  if (!categorized[cat]) categorized[cat] = [];
  categorized[cat].push(item);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║     📰  الجزيرة نت — 22 يونيو 2026            ║');
console.log('║     مستخلص بواسطة CSI Ultimate Scraper         ║');
console.log('╚══════════════════════════════════════════════════╝\n');

for (const [cat, items] of Object.entries(categorized)) {
  console.log(`  ${cat} (${items.length})`);
  console.log(`  ${'─'.repeat(50)}`);
  items.slice(0, 8).forEach((item, i) => {
    const title = item.title.length > 70 ? item.title.slice(0, 67) + '...' : item.title;
    console.log(`  ${i+1}. ${title}`);
    if (item.date && item.date !== 'live-blue') {
      const d = item.date.replace('live-blue', '').trim();
      if (d) console.log(`     📅 ${d}`);
    }
  });
  console.log('');
}

console.log(`\n  📊 إجمالي: ${raw.length} موضوع`);
console.log(`  🔗 جميع الروابط محفوظة في ${process.argv[2]}`);
