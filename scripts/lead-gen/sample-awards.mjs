import { chromium } from 'playwright';
import fs from 'fs';

// سكريب عينة — أول 20 مناقصة فيها بيانات ترسية
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://tenders.etimad.sa/Tender/AllTendersForVisitor', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  const d = JSON.parse(fs.readFileSync('data/etimad_all_tenders.json', 'utf8'));
  
  // خذ المناقصات اللي فيها status يدل على أنها منتهية/مرسى عليها
  const candidates = d.filter(t => 
    t.tenderIdString && !t.tenderIdString.includes('*@@**') &&
    [5, 6, 8, 13, 15, 82].includes(t.tenderStatusId)
  ).slice(0, 100); // جرب 100 عشان نلقى 20 فيها بيانات
  
  const awards = [];
  
  for (let i = 0; i < candidates.length && awards.length < 20; i++) {
    const t = candidates[i];
    process.stdout.write(`[${i + 1}/${candidates.length}] ${(t.tenderName || '').slice(0, 40)}... `);
    
    try {
      await page.goto(
        `https://tenders.etimad.sa/Tender/DetailsForVisitor?STenderId=${encodeURIComponent(t.tenderIdString)}`,
        { waitUntil: 'networkidle', timeout: 30000 }
      );
      await page.waitForTimeout(2000);
      
      const result = await page.evaluate(async () => {
        const tab = document.querySelector('#awardingStepTab');
        if (!tab) return null;
        tab.click();
        await new Promise(r => setTimeout(r, 2000));
        const div = document.querySelector('#awardingDiv');
        return div ? div.innerHTML : null;
      });
      
      if (!result) { console.log('⏭️ no tab'); continue; }
      
      // Parse
      const sections = result.match(/<h4[^>]*>[\s\S]*?<\/h4>\s*<table[\s\S]*?<\/table>/gi);
      if (!sections || sections.length < 2) { console.log('⏭️ no data'); continue; }
      
      const bidders = [];
      const winners = [];
      
      sections.forEach(s => {
        const header = s.match(/<h4[^>]*>(.*?)<\/h4>/);
        const title = header ? header[1].replace(/<[^>]+>/g, '').trim() : '';
        const rows = s.match(/<tr>[\s\S]*?<\/tr>/g) || [];
        
        rows.forEach(row => {
          const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/g);
          if (!cells || cells.length < 2) return;
          const clean = cells.map(c => c.replace(/<[^>]+>/g, '').trim());
          if (!clean[0] || clean[0].includes('إسم المورد') || clean[0].includes('<th')) return;
          
          const entry = { name: clean[0], offerValue: clean[1] };
          if (clean[2]) entry.awardValue = clean[2];
          
          if (title.includes('المرسى عليهم')) winners.push(entry);
          else if (title.includes('المتقدمين')) bidders.push(entry);
        });
      });
      
      if (winners.length > 0) {
        awards.push({
          tenderId: t.tenderId, tenderName: t.tenderName, agencyName: t.agencyName,
          activity: t.tenderActivityName, type: t.tenderTypeName,
          publishDate: (t.submitionDate || '').substring(0, 10),
          lastDate: (t.lastOfferPresentationDate || '').substring(0, 10),
          bidders, winners
        });
        console.log(`✅ ${winners[0].name.slice(0, 25)} ← ${winners[0].awardValue || winners[0].offerValue} SAR`);
      } else {
        console.log('⏭️ no winners');
      }
    } catch(e) {
      console.log(`❌ ${e.message.slice(0, 50)}`);
    }
    
    await new Promise(r => setTimeout(r, 2500));
  }
  
  fs.writeFileSync('data/etimad_sample_awards.json', JSON.stringify(awards, null, 2), 'utf8');
  console.log(`\n✅ تم: ${awards.length} مناقصة راسية`);
  browser.close();
}

main();