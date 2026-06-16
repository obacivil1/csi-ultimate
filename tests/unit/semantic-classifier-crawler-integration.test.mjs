import test from 'node:test';
import assert from 'node:assert/strict';
import { SemanticPageClassifier } from '../core/semantic-page-classifier.mjs';

const classifier = new SemanticPageClassifier();

test('classifier returns metadata structure for page content', () => {
  const html = '<html><head><title>Job Opening</title><meta name="description" content="Apply now for this job vacancy" /></head><body><h1>Required Driver</h1><p>We are hiring a driver. Apply now.</p></body></html>';
  const result = classifier.classifyPage(html);
  assert.equal(result.pageType, 'JOB_LISTING_PAGE');
  assert.ok(typeof result.confidence === 'number');
  assert.ok(Array.isArray(result.scores));
  assert.ok(Array.isArray(result.matchedKeywords));
});
