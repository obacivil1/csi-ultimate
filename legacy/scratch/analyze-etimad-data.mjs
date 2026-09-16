import fs from 'fs';

const data = JSON.parse(fs.readFileSync('data/etimad_all_tenders.json', 'utf8'));
console.log('TOTAL: ' + data.length + '\n');

// Status distribution
const statusMap = { 2: 'نشطة', 3: 'فتح العروض', 4: 'فحص العروض', 5: 'الترسية', 6: 'تم الترسية', 8: 'منتهية' };
const statuses = {};
for (const t of data) {
  const s = t.tenderStatusId || 0;
  statuses[s] = (statuses[s] || 0) + 1;
}
console.log('── Statuses ──');
Object.entries(statuses).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log('  ' + (statusMap[k] || k) + ': ' + v));

// Top agencies
const agencies = {};
for (const t of data) {
  const a = t.agencyName || 'غير محدد';
  agencies[a] = (agencies[a] || 0) + 1;
}
const sortedAgencies = Object.entries(agencies).sort((a,b) => b[1]-a[1]);
console.log('\n── Top 20 Agencies ──');
sortedAgencies.slice(0, 20).forEach(([k,v]) => console.log('  ' + v + ' | ' + k));

// Activity distribution
const activities = {};
for (const t of data) {
  const a = t.tenderActivityName || 'غير محدد';
  activities[a] = (activities[a] || 0) + 1;
}
console.log('\n── Top Activities ──');
Object.entries(activities).sort((a,b) => b[1]-a[1]).slice(0, 15).forEach(([k,v]) => console.log('  ' + v + ' | ' + k));

// Tender types
const types = {};
for (const t of data) {
  const ty = t.tenderTypeName || 'غير محدد';
  types[ty] = (types[ty] || 0) + 1;
}
console.log('\n── Types ──');
Object.entries(types).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log('  ' + k + ': ' + v));

// Date range
const dates = data.map(t => t.submitionDate).filter(Boolean).sort();
console.log('\n── Date Range ──');
console.log('  First: ' + dates[0]);
console.log('  Last: ' + dates[dates.length - 1]);

// Tenders expiring soon (lastOfferPresentationDate in next 7 days)
const now = new Date();
const soon = data.filter(t => {
  if (!t.lastOfferPresentationDate) return false;
  const d = new Date(t.lastOfferPresentationDate);
  return d > now && d < new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
});
console.log('\n── Expiring within 7 days: ' + soon.length + ' tenders ──');
soon.slice(0, 10).forEach(t => {
  console.log('  ' + t.tenderNumber + ' | ' + t.tenderName.substring(0, 50) + ' | ' + t.lastOfferPresentationDate.substring(0, 10) + ' | ' + t.agencyName);
});

// Sample full record
console.log('\n── Sample Record ──');
const sample = data[0];
Object.entries(sample).forEach(([k,v]) => {
  if (v !== null && v !== '') {
    console.log('  ' + k + ': ' + (typeof v === 'string' && v.length > 60 ? v.substring(0, 60) + '...' : v));
  }
});
