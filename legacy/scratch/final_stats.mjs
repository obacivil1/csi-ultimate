import fs from 'fs';

const tenders = JSON.parse(fs.readFileSync('data/etimad_all_tenders.json', 'utf8'));
const contractors = JSON.parse(fs.readFileSync('data/muqawil_all_regions.json', 'utf8'));

const KW = ['مقاولات','تشييد','بناء','إنشاء','هدم','ترميم','صيانة','تشغيل','نظافة','كهرباء','سباكة','طرق','خرسانة','اسفلت','دهان','عزل','حفر','ردم','تسوية','أساسات','حديد','المنشآت'];

const construction = tenders.filter(t => {
  const text = (t.tenderName || '') + ' ' + (t.tenderActivityName || '');
  return KW.some(k => text.includes(k));
});

const types = {};
for (const t of tenders) {
  const ty = t.tenderTypeName || '?';
  types[ty] = (types[ty] || 0) + 1;
}

const prices = tenders.filter(t => t.condetionalBookletPrice && t.condetionalBookletPrice > 0).map(t => t.condetionalBookletPrice);
const avgPrice = prices.length ? (prices.reduce((a,b) => a+b, 0) / prices.length) : 0;

const agencies = {};
for (const t of tenders) agencies[t.agencyName] = (agencies[t.agencyName] || 0) + 1;

const regions = {};
for (const c of contractors) regions[c.region_name] = (regions[c.region_name] || 0) + 1;

const withEmail = contractors.filter(c => c.email).length;
const withPhone = contractors.filter(c => c.phone).length;

const fileSize = fs.statSync('data/منتجع_المنافسات_والمقاولين.xlsx').size;

console.log('═══════════════════════════════════════');
console.log('  PRODUCT SUMMARY');
console.log('═══════════════════════════════════════');
console.log(`  Excel: منتجع_المنافسات_والمقاولين.xlsx (${(fileSize/1024/1024).toFixed(1)} MB)`);
console.log('');
console.log(`  Tenders: ${tenders.length.toLocaleString()}`);
console.log(`  Construction-related: ${construction.length.toLocaleString()}`);
console.log(`  Expiring in 7 days: ${tenders.filter(t => {
    const d = t.lastOfferPresentationDate;
    if (!d) return false;
    const dt = new Date(d);
    return dt > new Date() && dt < new Date(Date.now() + 7*24*60*60*1000);
  }).length}`);
console.log('');
console.log('  Tender Types:');
Object.entries(types).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`    ${k}: ${v.toLocaleString()}`));
console.log('');
console.log(`  Avg Booklet Price: ${avgPrice.toFixed(0)} SAR`);
console.log('');
console.log('  Top Agencies:');
Object.entries(agencies).sort((a,b) => b[1]-a[1]).slice(0,5).forEach(([k,v]) => console.log(`    ${k}: ${v.toLocaleString()}`));
console.log('');
console.log(`  Contractors: ${contractors.length.toLocaleString()}`);
console.log(`  With Email: ${withEmail}`);
console.log(`  With Phone: ${withPhone}`);
console.log('');
console.log('  Regions:');
Object.entries(regions).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`    ${k}: ${v.toLocaleString()}`));
console.log('═══════════════════════════════════════');
