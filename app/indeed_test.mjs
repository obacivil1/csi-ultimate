import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
  ],
});

const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
  locale: 'en-US',
  timezoneId: 'Asia/Dubai',
  geolocation: { latitude: 25.2048, longitude: 55.2708 },
  permissions: [],
  extraHTTPHeaders: {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  },
});

const page = await ctx.newPage();

// Remove webdriver traces
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
});

console.log('1. Opening Indeed...');
try {
  await page.goto('https://www.indeed.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);
  console.log(`   Title: ${await page.title()}`);

  const bodyPreview = await page.evaluate(() => document.body.innerText.slice(0, 200));
  if (bodyPreview.includes('Checking') || bodyPreview.includes('security') || bodyPreview.includes('Cloudflare')) {
    console.log('   ⚠️ Cloudflare detected');
  } else {
    console.log('   ✅ Page loaded!');
  }
} catch (e) {
  console.log(`   ⚠️ Timeout - ${e.message?.slice(0, 60)}`);
}

// Check what we got
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
console.log(`\n   Page text: ${bodyText.replace(/\n/g, ' ').slice(0, 200)}`);

// Try searching for Planning Engineer
console.log('\n2. Searching Planning Engineer UAE...');
await page.goto('https://www.indeed.com/jobs?q=Planning+Engineer&l=UAE', {
  waitUntil: 'domcontentloaded', timeout: 15000,
});
await page.waitForTimeout(3000);
console.log(`   Title: ${await page.title()}`);

const jobs = await page.evaluate(() => {
  const items = [];

  // Indeed job cards
  for (const card of document.querySelectorAll('[id^="job_"] > table, .job_seen_beacon, .cardOutline, [class*="jobCard"], [class*="jobsearch"]')) {
    const text = card.innerText?.trim();
    if (text && text.length > 20) items.push(text.slice(0, 300));
  }

  return items.slice(0, 10);
});

if (jobs.length === 0) {
  // Try general text extraction
  const lines = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('h2, h3, a[class*="title"], div[class*="title"], span[class*="title"], .company'))
      .map(el => el.textContent?.trim())
      .filter(t => t && t.length > 5)
      .slice(0, 20);
  });
  console.log('\n3. Job titles found:');
  lines.forEach((l, i) => console.log(`   ${i+1}. ${l.slice(0, 100)}`));
} else {
  console.log(`\n3. Jobs: ${jobs.length}`);
  jobs.forEach((j, i) => console.log(`   ${i+1}. ${j.slice(0, 200)}`));
}

await browser.close();
