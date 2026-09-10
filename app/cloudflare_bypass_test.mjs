import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import cloudscraper from 'cloudscraper';

chromium.use(StealthPlugin());

const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-web-security',
  ],
});

const page = await browser.newPage({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
  locale: 'en-US',
});

console.log('=== 1. Bayt.com with Stealth ===');
try {
  await page.goto('https://www.bayt.com/en/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);
  const t = await page.title();
  const b = await page.evaluate(() => document.body.innerText.slice(0, 200));
  console.log(`   Title: ${t}`);
  console.log(`   Text: ${b.replace(/\n/g, ' ').slice(0, 120)}`);
} catch (e) {
  console.log(`   Error: ${e.message?.slice(0, 80)}`);
}

console.log('\n=== 2. cloudscraper HTTP test ===');
try {
  const html = await cloudscraper.get('https://www.bayt.com/en/jobs/planning-engineer-jobs/');
  const match = html.match(/<title>([^<]+)<\/title>/);
  console.log(`   Title: ${match ? match[1] : 'N/A'}`);
  
  // Extract job titles
  const titles = html.match(/<h2[^>]*>([^<]+)<\/h2>/g) || html.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)</g) || [];
  console.log(`   HTML length: ${html.length} chars`);
  console.log(`   Title matches: ${titles.length}`);
  
  if (html.includes('planning') || html.includes('Planning')) {
    console.log('   ✅ Contains planning keyword!');
  }
  if (html.includes('job') || html.includes('Job')) {
    console.log('   ✅ Contains job keyword!');
  }
} catch (e) {
  console.log(`   Error: ${e.message?.slice(0, 120)}`);
}

console.log('\n=== 3. Indeed with cloudscraper ===');
try {
  const html2 = await cloudscraper.get('https://www.indeed.com/jobs?q=Planning+Engineer&l=UAE');
  const m = html2.match(/<title>([^<]+)<\/title>/);
  console.log(`   Title: ${m ? m[1] : 'N/A'}`);
  console.log(`   HTML length: ${html2.length} chars`);
  
  // Check if we bypassed cloudflare
  if (html2.includes('Security Check') || html2.includes('Just a moment') || html2.includes('Checking your browser')) {
    console.log('   ⚠️ Still blocked');
  } else if (html2.includes('Planning Engineer') || html2.includes('planning')) {
    console.log('   ✅ Bypassed! Contains planning job data');
  } else {
    console.log('   ⚠️ Unknown response');
  }
} catch (e) {
  console.log(`   Error: ${e.message?.slice(0, 120)}`);
}

console.log('\n=== 4. NaukriGulf with cloudscraper ===');
try {
  const html3 = await cloudscraper.get('https://www.naukrigulf.com/planning-engineer-jobs');
  const m3 = html3.match(/<title>([^<]+)<\/title>/);
  console.log(`   Title: ${m3 ? m3[1] : 'N/A'}`);
  console.log(`   HTML length: ${html3.length} chars`);
  if (html3.includes('naukrigulf') || html3.includes('Naukri')) {
    console.log('   ✅ Content reached!');
  }
} catch (e) {
  console.log(`   Error: ${e.message?.slice(0, 120)}`);
}

console.log('\n=== 5. Bayt jobs search with cloudscraper searching ===');
try {
  const html4 = await cloudscraper.get('https://www.bayt.com/en/jobs/planning-engineer-jobs-in-uae/');
  const m4 = html4.match(/<title>([^<]+)<\/title>/);
  console.log(`   Title: ${m4 ? m4[1] : 'N/A'}`);
  
  // Search for job data
  const jobTitles = [...html4.matchAll(/<a[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/a>/gi)];
  console.log(`   Job title tags: ${jobTitles.length}`);
  jobTitles.slice(0, 5).forEach((j, i) => console.log(`   ${i+1}. ${j[1].trim().slice(0, 80)}`));
} catch (e) {
  console.log(`   Error: ${e.message?.slice(0, 120)}`);
}

await browser.close();
