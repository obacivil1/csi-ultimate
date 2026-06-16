import { chromium } from 'playwright';
import fs from 'fs';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto('https://tenders.etimad.sa/Tender/AllTendersForVisitor', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  const title = await page.title();
  const html = await page.content();
  console.log('Title:', title);
  console.log('HTML length:', html.length);
  
  if (html.includes('cf-browser-verification') || html.includes('cloudflare')) {
    console.log('BLOCKED by Cloudflare');
  } else if (html.includes('Just a moment')) {
    console.log('BLOCKED - Just a moment');
  } else {
    console.log('PASSED - no Cloudflare block');
    fs.writeFileSync('data/etimad_test.html', html, 'utf8');
    console.log('Saved HTML to data/etimad_test.html');
  }
} catch(e) {
  console.log('Error:', e.message);
}

await browser.close();
