import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// Intercept all XHR/fetch requests
const requests = [];
page.on('request', req => {
  const url = req.url();
  if (url.includes('/Tender/') || url.includes('/api/') || url.endsWith('.json') || url.includes('Async')) {
    requests.push({ url: url, method: req.method(), headers: req.headers() });
  }
});

const responses = [];
page.on('response', async resp => {
  const url = resp.url();
  if (url.includes('/Tender/') || url.includes('/api/') || url.includes('Async')) {
    let body = '';
    try {
      body = await resp.text();
    } catch(e) {
      body = '<error reading body>';
    }
    responses.push({ 
      url: url, 
      status: resp.status(), 
      contentType: resp.headers()['content-type'] || '',
      bodyLength: body.length,
      bodyPreview: body.substring(0, 500)
    });
  }
});

await page.goto('https://tenders.etimad.sa/Tender/AllTendersForVisitor', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

console.log('=== REQUESTS ===');
requests.forEach(r => {
  console.log(r.method, r.url);
});

console.log('\n=== RESPONSES ===');
responses.forEach(r => {
  console.log(`\n[${r.status}] ${r.url}`);
  console.log('  Content-Type:', r.contentType);
  console.log('  Body length:', r.bodyLength);
  if (r.bodyLength < 2000) {
    console.log('  Body:', r.bodyPreview);
  } else {
    console.log('  Body preview:', r.bodyPreview.substring(0, 300) + '...');
  }
});

await browser.close();
