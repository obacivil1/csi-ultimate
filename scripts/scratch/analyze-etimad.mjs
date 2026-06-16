import fs from 'fs';

const html = fs.readFileSync('data/etimad_test.html', 'utf8');

const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"\/?>/g)].map(m => m[1]);
console.log('Scripts:');
scripts.forEach(s => console.log(' ', s));

const inlineScripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1].trim()).filter(s => s.length > 50);
console.log('\nInline scripts count:', inlineScripts.length);

let apis = [];
inlineScripts.forEach(s => {
  const matches = [...s.matchAll(/["'](\/[A-Za-z]+\/[A-Za-z]+)["']/g)];
  matches.forEach(m => { if (!m[1].includes('..')) apis.push(m[1]); });
});
console.log('\nAPI endpoints found:');
const uniqueApis = [...new Set(apis)];
uniqueApis.forEach(a => console.log(' ', a));

const jsonBlocks = [...html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)];
console.log('\nJSON blocks:', jsonBlocks.length);
jsonBlocks.forEach((b, i) => {
  try {
    const d = JSON.parse(b[1]);
    console.log('  Block', i, ':', typeof d, Array.isArray(d) ? 'array len=' + d.length : 'keys=' + Object.keys(d).slice(0,5).join(','));
  } catch(e) {
    console.log('  Block', i, ': invalid JSON, length', b[1].length);
  }
});

const tenderName = html.match(/tenderName/g);
const refNum = html.match(/referenceNumber/g);
const agencyName = html.match(/agencyName/g);
console.log('\nTender fields in HTML:');
console.log('  tenderName:', tenderName ? tenderName.length : 0);
console.log('  referenceNumber:', refNum ? refNum.length : 0);
console.log('  agencyName:', agencyName ? agencyName.length : 0);
