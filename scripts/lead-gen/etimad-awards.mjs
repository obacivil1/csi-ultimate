import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const TENDERS_FILE = path.resolve('data/etimad_all_tenders.json');
const AWARDS_FILE = path.resolve('data/etimad_all_awards.json');
const PROGRESS_FILE = path.resolve('data/etimad_awards_progress.json');
const DELAY_MS = 3000;
const SAVE_EVERY = 50;
const BASE = 'https://tenders.etimad.sa';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function decodeEntities(html) {
  return html.replace(/&#(\d+);/g, (m, code) => String.fromCharCode(code));
}

function parseAwardPage(html) {
  const decoded = decodeEntities(html);
  const result = { bidders: [], winners: [] };

  // Extract bidders table
  const bidderRows = decoded.match(/<tr>[\s\S]*?<\/tr>/g) || [];
  // Also use simpler approach with regex
  let inBidders = false;
  let inWinners = false;

  const lines = decoded.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.includes('قائمة الموردين المتقدمين')) { inBidders = true; inWinners = false; continue; }
    if (line.includes('قائمة الموردين المرسى عليهم')) { inWinners = true; inBidders = false; continue; }
    if (line.includes('class=\"text-primary\"') && !inBidders && !inWinners) continue;

    // Extract table rows with supplier data
    if (line.includes('<td>') && line.includes('</td>') && !line.includes('<th')) {
      const cells = line.match(/<td>(.*?)<\/td>/g);
      if (cells && cells.length >= 2) {
        const name = cells[0].replace(/<td>/g, '').replace(/<\/td>/g, '').trim();
        const value = cells.length > 1 ? cells[1].replace(/<td>/g, '').replace(/<\/td>/g, '').trim() : '';
        const value2 = cells.length > 2 ? cells[2].replace(/<td>/g, '').replace(/<\/td>/g, '').trim() : '';
        
        if (inBidders && name) {
          result.bidders.push({ name, offerValue: value, technicalResult: value2 || 'مطابق' });
        }
      }
    }
  }

  // Also try parsing from the HTML table structure
  try {
    const sections = decoded.match(/<h4[^>]*>(.*?)<\/h4>[\s\S]*?<table[\s\S]*?<\/table>/g);
    if (sections) {
      result.bidders = [];
      result.winners = [];
      
      sections.forEach((section, idx) => {
        const header = section.match(/<h4[^>]*>(.*?)<\/h4>/);
        const title = header ? header[1].trim() : '';
        
        const rows = section.match(/<tr>[\s\S]*?<\/tr>/g) || [];
        rows.forEach(row => {
          const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/g);
          if (!cells || cells.length < 2) return;
          
          const clean = cells.map(c => c.replace(/<[^>]+>/g, '').trim());
          const name = clean[0];
          if (!name || name.includes('<th') || name.includes('إسم المورد')) return;

          const entry = {
            name,
            offerValue: clean[1] || '',
            ...(clean[2] ? { awardValue: clean[2] } : {})
          };

          if (title.includes('المرسى عليهم')) {
            result.winners.push(entry);
          } else if (title.includes('المتقدمين')) {
            result.bidders.push(entry);
          }
        });
      });
    }
  } catch (e) {
    // Fallback to first method
  }

  return result;
}

async function main() {
  console.log('=== Etimad Award Scraper ===\n');

  // Load tenders
  const tenders = JSON.parse(fs.readFileSync(TENDERS_FILE, 'utf8'));
  
  // Filter to tenders that might have award data
  // Status IDs that can have award results: 5(الترسية), 6(تم الترسية), 8(منتهية), 13, 15, 78, 82
  const awardStatusIds = [5, 6, 8, 13, 15, 78, 82, 28, 29, 30, 31, 32, 33, 34, 38, 39, 80, 85, 86, 90];
  const candidates = tenders.filter(t =>
    t.tenderIdString &&
    !t.tenderIdString.includes('*@@**') &&
    awardStatusIds.includes(t.tenderStatusId)
  );

  // Load progress
  let awards = [];
  let processedIds = new Set();
  if (fs.existsSync(AWARDS_FILE)) {
    try {
      awards = JSON.parse(fs.readFileSync(AWARDS_FILE, 'utf8'));
      processedIds = new Set(awards.map(a => a.tenderId));
    } catch (e) { awards = []; }
  }

  console.log(`Total tenders: ${tenders.length}`);
  console.log(`Candidates (likely awarded): ${candidates.length}`);
  console.log(`Already processed: ${processedIds.size}`);
  console.log(`Remaining: ${candidates.length - processedIds.size}\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Establish session
  console.log('Establishing session...');
  await page.goto(`${BASE}/Tender/AllTendersForVisitor`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log('Session ready\n');

  let count = 0;
  let awardCount = 0;

  for (const tender of candidates) {
    if (processedIds.has(tender.tenderId)) continue;
    
    count++;
    const tenderIdStr = encodeURIComponent(tender.tenderIdString);
    
    try {
      // Navigate to detail page
      await page.goto(`${BASE}/Tender/DetailsForVisitor?STenderId=${tenderIdStr}`, {
        waitUntil: 'networkidle', timeout: 30000
      });
      await page.waitForTimeout(2000);

      // Extract award data
      const awardData = await page.evaluate(async () => {
        // Click the award tab
        const tab = document.querySelector('#awardingStepTab');
        if (tab) tab.click();
        await new Promise(r => setTimeout(r, 1500));

        const awardDiv = document.querySelector('#awardingDiv');
        return awardDiv ? awardDiv.innerHTML : null;
      });

      if (awardData) {
        const parsed = parseAwardPage(awardData);

        const awardRecord = {
          tenderId: tender.tenderId,
          tenderName: tender.tenderName,
          tenderNumber: tender.tenderNumber,
          referenceNumber: tender.referenceNumber,
          agencyName: tender.agencyName,
          statusId: tender.tenderStatusId,
          publishDate: tender.submitionDate,
          lastDate: tender.lastOfferPresentationDate,
          type: tender.tenderTypeName,
          activity: tender.tenderActivityName,
          ...parsed,
          scrapedAt: new Date().toISOString()
        };

        if (parsed.winners.length > 0 || parsed.bidders.length > 0) {
          awards.push(awardRecord);
          awardCount++;
          if (parsed.winners.length > 0) {
            const w = parsed.winners[0];
            console.log(`✓ AWARD #${awardCount}: ${w.name.slice(0, 30)} ← ${w.awardValue || w.offerValue} SAR | ${(tender.tenderName || '').slice(0, 35)}`);
          } else if (parsed.bidders.length > 0) {
            console.log(`○ BIDDERS: ${parsed.bidders.length} suppliers | ${(tender.tenderName || '').slice(0, 40)}`);
          }
        } else {
          console.log(`- No award: ${(tender.tenderName || '').slice(0, 40)}`);
        }
      } else {
        console.log(`- No award div: ${(tender.tenderName || '').slice(0, 40)}`);
      }

      // Progress save
      if (count % SAVE_EVERY === 0) {
        fs.writeFileSync(AWARDS_FILE, JSON.stringify(awards, null, 2), 'utf8');
        console.log(`  [Saved ${awards.length} awards, processed ${count}/${candidates.length - processedIds.size}]\n`);
      }

    } catch (e) {
      console.log(`✗ Error: ${tender.tenderId} - ${e.message.slice(0, 80)}`);
    }

    // Rate limit
    await sleep(DELAY_MS);

    // Periodic status
    if (count % 50 === 0) {
      const remaining = candidates.length - processedIds.size - count;
      const elapsed = (Date.now() - startTime) / 1000 / 60;
      const rate = count / elapsed;
      const estRemaining = remaining / rate;
      console.log(`  📊 [${count} processed | ${awardCount} awards found | ${Math.round(remaining)} remaining | ~${Math.round(estRemaining)} min left]`);
    }
  }

  // Final save
  fs.writeFileSync(AWARDS_FILE, JSON.stringify(awards, null, 2), 'utf8');
  console.log(`\n✅ Done! Processed: ${count}, Awards found: ${awardCount}, Total in file: ${awards.length}`);

  await browser.close();
}

const startTime = Date.now();
main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});