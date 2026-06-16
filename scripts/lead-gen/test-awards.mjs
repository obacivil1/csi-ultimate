import { chromium } from 'playwright';
import fs from 'fs';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://tenders.etimad.sa/Tender/AllTendersForVisitor', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  // Test with 3 tenders
  const d = JSON.parse(fs.readFileSync('data/etimad_all_tenders.json', 'utf8'));
  const testIds = d.filter(t => 
    t.tenderIdString && !t.tenderIdString.includes('*@@**') && 
    [6, 13, 15, 82].includes(t.tenderStatusId)
  ).slice(0, 3);
  
  for (const t of testIds) {
    console.log(`\n=== Tender ${t.tenderId} | Status ${t.tenderStatusId} | ${t.tenderName?.slice(0, 50)} ===`);
    
    try {
      await page.goto(
        `https://tenders.etimad.sa/Tender/DetailsForVisitor?STenderId=${encodeURIComponent(t.tenderIdString)}`,
        { waitUntil: 'networkidle', timeout: 30000 }
      );
      await page.waitForTimeout(2000);
      
      const result = await page.evaluate(async () => {
        const tab = document.querySelector('#awardingStepTab');
        if (!tab) return { error: 'No award tab found' };
        tab.click();
        await new Promise(r => setTimeout(r, 2000));
        
        const div = document.querySelector('#awardingDiv');
        if (!div) return { error: 'No awardingDiv found' };
        return { html: div.innerHTML };
      });
      
      if (result.html) {
        // Parse sections
        const sections = result.html.match(/<h4[^>]*>[\s\S]*?<\/h4>\s*<table[\s\S]*?<\/table>/gi);
        console.log(`Sections: ${sections?.length || 0}`);
        
        if (sections) {
          sections.forEach((s, i) => {
            const header = s.match(/<h4[^>]*>(.*?)<\/h4>/);
            const title = header ? header[1].replace(/<[^>]+>/g, '').trim() : 'unknown';
            console.log(`  ${i}: ${title}`);
            
            const rows = s.match(/<tr>[\s\S]*?<\/tr>/g) || [];
            rows.forEach((row, j) => {
              const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/g);
              if (!cells || cells.length < 2) return;
              const clean = cells.map(c => c.replace(/<[^>]+>/g, '').trim());
              if (!clean[0] || clean[0].includes('إسم المورد') || clean[0].includes('<th')) return;
              console.log(`    ${j}: ${clean.join(' | ')}`);
            });
          });
        }
      } else {
        console.log('No award data:', JSON.stringify(result));
      }
    } catch(e) {
      console.log('Error:', e.message.slice(0, 100));
    }
  }
  
  await browser.close();
}

main();