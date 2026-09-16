import fs from 'fs';

const data = JSON.parse(fs.readFileSync('data/etimad_all_tenders.json', 'utf8'));
console.log('Records:', data.length);

// Check if they're all unique
const ids = new Set(data.map(t => t.tenderId));
console.log('Unique:', ids.size);

// Group by page (use tenderId to infer)
if (data.length > 0) {
  console.log('\nFirst 3 records:');
  data.slice(0, 3).forEach((t, i) => {
    console.log(`  ${i+1}. ${t.tenderId} | ${t.tenderName.substring(0, 50)} | ${t.agencyName}`);
  });
  console.log('\nLast 3 records:');
  data.slice(-3).forEach((t, i) => {
    console.log(`  ${i+1}. ${t.tenderId} | ${t.tenderName.substring(0, 50)} | ${t.agencyName}`);
  });

  // Extract agency names for potential matching with Muqawil
  const agencies = [...new Set(data.map(t => t.agencyName))].sort();
  console.log('\nAgencies (' + agencies.length + '):');
  agencies.forEach(a => console.log('  -', a));
}
