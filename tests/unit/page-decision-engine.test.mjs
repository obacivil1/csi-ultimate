import test from 'node:test';
import assert from 'node:assert/strict';
import { PageDecisionEngine } from '../core/page-decision-engine.mjs';

const engine = new PageDecisionEngine();

test('routes directory pages to category exploration', () => {
  const decision = engine.decide({
    url: 'https://example.com/category',
    pageType: 'DIRECTORY_PAGE',
    confidence: 0.9,
    semanticScores: [],
    discoveredLinks: [
      { url: 'https://example.com/jobs', text: 'Jobs' },
      { url: 'https://example.com/about', text: 'About' },
    ],
  });

  assert.equal(decision.action, 'EXPLORE_CATEGORIES');
  assert.ok(decision.priority >= 25);
  assert.ok(decision.linkScores.some(link => link.score > 0));
});

test('routes job listing pages to ad discovery', () => {
  const decision = engine.decide({
    url: 'https://example.com/jobs/driver',
    pageType: 'JOB_LISTING_PAGE',
    confidence: 0.88,
    semanticScores: [],
    discoveredLinks: [
      { url: 'https://example.com/cls/123', text: 'View ad' },
      { url: 'https://example.com/jobs', text: 'More jobs' },
    ],
  });

  assert.equal(decision.action, 'DISCOVER_ADS');
  assert.ok(decision.priority >= 70);
  assert.ok(decision.linkScores[0].score >= decision.linkScores[1].score);
});

test('routes job ad pages to extraction', () => {
  const decision = engine.decide({
    url: 'https://example.com/cls/123',
    pageType: 'JOB_AD_PAGE',
    confidence: 0.96,
    semanticScores: [],
    discoveredLinks: [],
  });

  assert.equal(decision.action, 'EXTRACT_CONTENT');
  assert.equal(decision.priority, 100);
});

test('routes blog pages to low priority crawl', () => {
  const decision = engine.decide({
    url: 'https://example.com/blog/post',
    pageType: 'BLOG_ARTICLE_PAGE',
    confidence: 0.6,
    semanticScores: [],
    discoveredLinks: [],
  });

  assert.equal(decision.action, 'LOW_PRIORITY_CRAWL');
  assert.ok(decision.priority <= 20);
});

test('routes unknown pages to low priority crawl', () => {
  const decision = engine.decide({
    url: 'https://example.com/unknown',
    pageType: 'UNKNOWN_PAGE',
    confidence: 0.1,
    semanticScores: [],
    discoveredLinks: [],
  });

  assert.equal(decision.action, 'LOW_PRIORITY_CRAWL');
  assert.equal(decision.priority, 5);
});
