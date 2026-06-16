import test from 'node:test';
import assert from 'node:assert/strict';
import { PatternRegistry } from '../core/pattern-registry.mjs';
import { SimilarityEngine } from '../core/pattern-similarity.mjs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';

function makeTempRegistry() {
  const dir = mkdtempSync(resolve(tmpdir(), 'pattern-registry-'));
  return {
    dir,
    registry: new PatternRegistry(resolve(dir, 'patterns.json')),
  };
}

test('creates and updates patterns with confidence', () => {
  const { registry, dir } = makeTempRegistry();
  try {
    const pattern = registry.learnPattern({
      patternType: 'listing',
      fingerprint: {
        urlPattern: '/cars/',
        domShape: ['article', 'h2', 'a'],
        headingHierarchy: ['h1', 'h2'],
        repeatedSelectors: ['article', 'a'],
        semanticSignals: ['car', 'price'],
        internalLinkStructure: ['cars', 'details'],
      },
      pageType: 'VEHICLE_LISTING_PAGE',
      url: 'https://example.com/cars/',
      confidence: 0.7,
    });

    assert.ok(pattern.patternId);
    assert.equal(pattern.patternType, 'listing');
    assert.equal(pattern.usageCount, 1);

    registry.updateConfidence(pattern.patternId, 0.15);
    const stored = registry.getPattern(pattern.patternId);
    assert.ok(stored.confidence >= 0.8);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matches similar fingerprints across domains', () => {
  const { registry, dir } = makeTempRegistry();
  try {
    registry.learnPattern({
      patternType: 'listing',
      fingerprint: {
        urlPattern: '/cars/',
        domShape: ['article', 'h2', 'a'],
        headingHierarchy: ['h1', 'h2'],
        repeatedSelectors: ['article', 'a'],
        semanticSignals: ['car', 'price'],
        internalLinkStructure: ['cars', 'details'],
      },
      pageType: 'VEHICLE_LISTING_PAGE',
      url: 'https://vendor-a.com/cars/',
      confidence: 0.8,
    });

    const similar = registry.findSimilarPatterns({
      urlPattern: '/vehicles/',
      domShape: ['article', 'h2', 'a'],
      headingHierarchy: ['h1', 'h2'],
      repeatedSelectors: ['article', 'a'],
      semanticSignals: ['vehicle', 'price'],
      internalLinkStructure: ['vehicles', 'details'],
    }, { threshold: 0.45 });

    assert.ok(similar.length > 0);
    assert.ok(similar[0].score >= 0.45);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('retires weak patterns', () => {
  const { registry, dir } = makeTempRegistry();
  try {
    const weak = registry.learnPattern({
      patternType: 'category',
      fingerprint: {
        urlPattern: '/blog/',
        domShape: ['section'],
        headingHierarchy: ['h2'],
        repeatedSelectors: ['section'],
        semanticSignals: ['blog'],
        internalLinkStructure: ['blog'],
      },
      pageType: 'BLOG_ARTICLE_PAGE',
      url: 'https://example.org/blog',
      confidence: 0.12,
    });

    const retired = registry.retireWeakPatterns({ minConfidence: 0.2 });
    assert.ok(retired.some(item => item.patternId === weak.patternId));
    assert.equal(registry.getPattern(weak.patternId), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('similarity engine computes weighted similarity', () => {
  const engine = new SimilarityEngine();
  const score = engine.compareFingerprints({
    urlPattern: '/cars/',
    domShape: ['article', 'h2', 'a'],
    headingHierarchy: ['h1', 'h2'],
    repeatedSelectors: ['article', 'a'],
    semanticSignals: ['car', 'price'],
    internalLinkStructure: ['cars', 'details'],
  }, {
    urlPattern: '/vehicles/',
    domShape: ['article', 'h2', 'a'],
    headingHierarchy: ['h1', 'h2'],
    repeatedSelectors: ['article', 'a'],
    semanticSignals: ['vehicle', 'price'],
    internalLinkStructure: ['vehicles', 'details'],
  });

  assert.ok(score >= 0.45);
});
