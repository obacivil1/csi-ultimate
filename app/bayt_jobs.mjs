import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
  locale: 'en-US',
});

console.log('1. Opening Bayt.com...');
await page.goto('https://www.bayt.com/en/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
console.log(`   Title: ${await page.title()}`);

// Check if blocked
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200));
console.log(`   Body preview: ${bodyText.replace(/\n/g, ' ').slice(0, 120)}`);

if (bodyText.includes('Checking your browser') || bodyText.includes('Cloudflare') || bodyText.includes('captcha')) {
  console.log('❌ Blocked by Cloudflare/captcha');
  await browser.close();
  process.exit(1);
}

// Try to search
console.log('\n2. Searching for planning jobs...');
const searchInput = await page.$('input[type="text"], input[name="q"], input[placeholder*="job"], input[placeholder*="search"], input[placeholder*="بحث"]');
if (searchInput) {
  await searchInput.click();
  await searchInput.fill('Planning Engineer');
  await page.waitForTimeout(500);

  // Press Enter
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
} else {
  // Try going directly to search URL
  await page.goto('https://www.bayt.com/en/jobs/planning-engineer-jobs/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);
}

console.log(`   Result page: ${await page.title()}`);

// Extract job listings
const jobs = await page.evaluate(() => {
  const items = [];
  
  // Try different selectors
  const cards = document.querySelectorAll('[class*="job"], [class*="card"], [class*="listing"], [class*="result"], article, li[class]');
  
  for (const card of cards) {
    const titleEl = card.querySelector('h1 a, h2 a, h3 a, [class*="title"] a, a[class*="title"]');
    const title = titleEl?.textContent?.trim();
    const link = titleEl?.href;
    
    if (!title || title.length < 5) continue;
    
    const company = card.querySelector('[class*="company"], [class*="employer"]')?.textContent?.trim() || '';
    const location = card.querySelector('[class*="location"]')?.textContent?.trim() || '';
    const date = card.querySelector('[class*="date"], time, [class*="time"]')?.textContent?.trim() || '';
    const desc = card.querySelector('p, [class*="desc"], [class*="summary"]')?.textContent?.trim()?.slice(0, 150) || '';
    
    items.push({
      title: title.replace(/\s+/g, ' ').slice(0, 100),
      company: company.replace(/\s+/g, ' ').slice(0, 60),
      location: location.replace(/\s+/g, ' ').slice(0, 60),
      date: date.replace(/\s+/g, ' ').slice(0, 40),
      description: desc.replace(/\s+/g, ' ').slice(0, 150),
      url: link || '',
    });
  }
  
  return items.filter(j => j.title && j.title.length > 5).slice(0, 20);
});

console.log(`\n3. Found ${jobs.length} jobs:\n`);

if (jobs.length === 0) {
  // Fallback: get all visible text
  const text = await page.evaluate(() => document.body.innerText);
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 10).slice(0, 30);
  console.log('   Raw page content:');
  lines.forEach((l, i) => console.log(`   ${i+1}. ${l.slice(0, 120)}`));
} else {
  jobs.forEach((j, i) => {
    console.log(`   ${i+1}. ${j.title}`);
    console.log(`      ${j.company} | ${j.location}`);
    if (j.date) console.log(`      📅 ${j.date}`);
    if (j.description) console.log(`      ${j.description}`);
    console.log();
  });
}

await browser.close();
