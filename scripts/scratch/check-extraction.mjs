import fs from 'fs';
const d = JSON.parse(fs.readFileSync('data/saudi_gulf_projects.json', 'utf8'));
console.log('Total articles:', d.length);
for (const key of ['owner', 'contractor', 'consultant', 'value', 'location']) {
  const val = d.filter(p => p[key]).length;
  console.log('  ' + key + ': ' + val + '/' + d.length + ' (' + (val / d.length * 100).toFixed(1) + '%)');
}
const saudiKws = ['Saudi Arabia', 'Riyadh', 'Jeddah', 'Dammam', 'Makkah', 'Madinam', 'Tabuk', 'NEOM', 'Roshn', 'Aramco', 'ACWA', 'PIF'];
const saudi = d.filter(p => new RegExp(saudiKws.join('|'), 'i').test((p.title || '') + (p.location || '') + (p.owner || '') + (p.contractor || '')));
console.log('\nSaudi articles:', saudi.length);
console.log('Saudi with owner:', saudi.filter(p => p.owner).length);
console.log('Saudi with contractor:', saudi.filter(p => p.contractor).length);
console.log('Saudi with consultant:', saudi.filter(p => p.consultant).length);

console.log('\n--- Saudi with owner+contractor ---');
saudi.filter(p => p.owner && p.contractor).slice(0, 8).forEach(p => {
  console.log('  ' + (p.title || '').slice(0, 50));
  console.log('    Owner: ' + (p.owner || '').slice(0, 60));
  console.log('    Contractor: ' + (p.contractor || '').slice(0, 60));
  console.log('    Consultant: ' + (p.consultant || '').slice(0, 60));
});

console.log('\n--- Saudi with consultant ---');
saudi.filter(p => p.consultant).slice(0, 5).forEach(p => {
  console.log('  ' + (p.title || '').slice(0, 50));
  console.log('    Consultant: ' + (p.consultant || '').slice(0, 60));
});
