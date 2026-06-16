import test from 'node:test';
import assert from 'node:assert/strict';
import { SemanticPageClassifier } from '../core/semantic-page-classifier.mjs';

const classifier = new SemanticPageClassifier();

test('classifies English job listing pages from semantic text', () => {
  const html = `
    <html>
      <head>
        <title>Required Driver - Immediate Start</title>
        <meta name="description" content="Apply now for this job vacancy with salary details." />
      </head>
      <body>
        <h1>Required Driver</h1>
        <h2>Hiring now</h2>
        <p>We are hiring a driver. Required skills include safe driving and punctuality. Salary is negotiable.</p>
        <a href="#">Apply Now</a>
        <a href="#">Employer Contact</a>
      </body>
    </html>`;

  const result = classifier.classifyPage(html);
  assert.equal(result.pageType, 'JOB_LISTING_PAGE');
  assert.ok(result.confidence >= 0.4);
  assert.ok(result.matchedKeywords.length > 0);
});

test('classifies Arabic real estate ad pages from semantic text', () => {
  const html = `
    <html>
      <head>
        <title>شقة للإيجار مفروشة</title>
        <meta name="description" content="شقة للإيجار في قلب المدينة" />
      </head>
      <body>
        <h1>شقة للإيجار</h1>
        <p>شقة مفروشة مع غرفتين. اتصل بالمالك الآن وسعر مناسب.</p>
        <a href="#">اتصل بالمالك</a>
      </body>
    </html>`;

  const result = classifier.classifyPage(html);
  assert.equal(result.pageType, 'REAL_ESTATE_AD_PAGE');
  assert.ok(result.confidence >= 0.35);
});

test('classifies vehicle listing pages from semantic text', () => {
  const html = `
    <html>
      <head>
        <title>سيارة مستعملة موديل 2020</title>
        <meta name="description" content="سيارة بخارية مع محرك قوي ومصداقية" />
      </head>
      <body>
        <h1>سيارة مستعملة</h1>
        <p>الميلage 12000 كم. ناقل يدوي ومحرك ممتاز.</p>
        <a href="#">عرض السيارة</a>
      </body>
    </html>`;

  const result = classifier.classifyPage(html);
  assert.equal(result.pageType, 'VEHICLE_LISTING_PAGE');
  assert.ok(result.confidence >= 0.35);
});

test('falls back to UNKNOWN_PAGE when no semantic signals are found', () => {
  const html = '<html><head><title>Welcome</title></head><body><p>Just a generic landing page with no listing signals.</p></body></html>';
  const result = classifier.classifyPage(html);
  assert.equal(result.pageType, 'UNKNOWN_PAGE');
  assert.equal(result.confidence, 0);
});
