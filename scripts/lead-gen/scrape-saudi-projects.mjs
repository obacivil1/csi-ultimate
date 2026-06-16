import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://www.saudigulfprojects.com';
const CATEGORIES = ['construction', 'mega-projects', 'transport', 'power', 'water'];

async function scrapeArticle(url) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => document.body.innerText);
    const title = await page.title();
    browser.close();
    return { title, text, url };
  } catch (e) {
    browser.close();
    return null;
  }
}

function parseProject(article) {
  const { title, text, url } = article;
  if (!text || !title) return null;

  // Extract value
  const valueMatch = text.match(/(SAR\s*[\d,.]+\s*(billion|million|bn|mn|B|M))|(\$[\d,.]+\s*(billion|million|bn|mn))\s*(SAR)?/gi);
  const value = valueMatch ? valueMatch[0] : null;

  // Extract company/contractor names
  const contractorPatterns = [
    /(awarded|signed|secured|won)\s+(a\s+)?(contract|agreement|deal)\s+(to|with|for)\s+([^,.]+)/gi,
    /(awards|awarded)\s+(a\s+)?(contract|agreement)\s+(to|for)\s+([^,.]+)/gi,
    /(appoints|appointed|selects|selected)\s+([^,.]+?)\s+(as|for|to)/gi,
  ];

  let contractor = null;
  for (const pat of contractorPatterns) {
    const m = text.match(pat);
    if (m) {
      const parts = m[0].split(/\s+(to|with|for|as)\s+/i);
      if (parts.length >= 2) contractor = parts[parts.length - 1].trim();
      break;
    }
  }

  // Extract location (city names in Saudi Arabia)
  const saudiCities = ['Riyadh','Jeddah','Mecca','Makkah','Madinah','Medina','Dammam','Khobar','Dhahran','Tabuk','Buraidah','Abha','Ha\'il','Hail','Najran','Jazan','Jizan','Al-Ahsa','Hofuf','Taif','Yanbu','Al-Kharj','Qatif','Jubail','Arar','Sakaka','Makkah','Al-Bahah','Northern Borders'];
  const cityPattern = new RegExp(`(${saudiCities.join('|')})`, 'gi');
  const cityMatch = text.match(cityPattern);
  const location = cityMatch ? [...new Set(cityMatch)][0] : null;

  // Determine sector
  let sector = 'Construction';
  if (text.match(/power|energy|electricity|solar|wind|renewable/i)) sector = 'Power';
  else if (text.match(/water|desalination|wastewater|sewage/i)) sector = 'Water';
  else if (text.match(/oil|gas|petroleum|refinery|petrochemical|hydrocarbon/i)) sector = 'Oil & Gas';
  else if (text.match(/transport|road|rail|metro|bridge|tunnel|airport|port/i)) sector = 'Transport';
  else if (text.match(/manufacturing|factory|industrial/i)) sector = 'Manufacturing';
  else if (text.match(/hotel|tourism|hospitality|resort|entertainment/i)) sector = 'Tourism';
  else if (text.match(/mining|mine|mineral/i)) sector = 'Mining';
  else if (text.match(/data.center|cloud|digital|ai\b/i)) sector = 'AI & Data';

  return {
    title: title.replace(' - SaudiGulf Projects', '').trim(),
    contractor,
    value,
    location,
    sector,
    source: url,
    scrapedAt: new Date().toISOString()
  };
}

async function main() {
  console.log('=== Scrape Saudi Projects ===\n');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const articles = [];
  const seen = new Set();

  for (const cat of CATEGORIES) {
    console.log(`\n--- Category: ${cat} ---`);
    for (let p = 1; p <= 5; p++) {
      try {
        const url = `${BASE}/category/${cat}/page/${p}/`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);
        const links = await page.evaluate(() =>
          Array.from(document.querySelectorAll('article a, .post-title a, h2 a, h3 a, .entry-title a'))
            .map(a => a.href)
            .filter(h => h && h.includes('saudigulfprojects.com') && !h.includes('/category/') && !h.includes('/page/'))
        );
        const unique = [...new Set(links)];
        console.log(`  Page ${p}: ${unique.length} articles`);
        for (const link of unique) {
          if (seen.has(link)) continue;
          seen.add(link);
          articles.push(link);
        }
        if (unique.length < 5) break;
      } catch (e) {
        console.log(`  Page ${p}: error`);
        break;
      }
    }
  }

  console.log(`\nTotal article URLs: ${articles.length}`);
  browser.close();

  // Scrape each article
  const projects = [];
  for (let i = 0; i < articles.length; i++) {
    process.stdout.write(`[${i+1}/${articles.length}] ${articles[i].slice(0, 60)}... `);
    try {
      const article = await scrapeArticle(articles[i]);
      if (article) {
        const parsed = parseProject(article);
        if (parsed && parsed.contractor) {
          projects.push(parsed);
          console.log(`✅ ${parsed.contractor.slice(0, 30)}`);
        } else {
          console.log('⏭️ no contractor');
        }
      } else {
        console.log('⏭️ failed');
      }
    } catch (e) {
      console.log(`❌ ${e.message.slice(0, 50)}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  fs.writeFileSync('data/saudi_projects.json', JSON.stringify(projects, null, 2), 'utf8');
  console.log(`\n✅ Done: ${projects.length} projects scraped`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
