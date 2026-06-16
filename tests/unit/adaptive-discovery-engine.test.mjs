import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscoveryHypothesisEngine } from '../core/adaptive-discovery-engine.mjs';
import { ExplorationStrategy } from '../core/exploration-strategy.mjs';
import { HypothesisValidator } from '../core/hypothesis-validator.mjs';
import { AdaptiveLearningLoop } from '../core/adaptive-learning-loop.mjs';
import { OpportunityScorer } from '../core/opportunity-scorer.mjs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';

function makeTempDir() {
  return mkdtempSync(resolve(tmpdir(), 'adaptive-discovery-'));
}

test('generates hypotheses for unknown pages', () => {
  const engine = new DiscoveryHypothesisEngine();
  const hypotheses = engine.generateHypotheses({
    pageType: 'UNKNOWN_PAGE',
    confidence: 0.15,
    semanticSignals: ['car', 'price', 'listing'],
    linkCount: 24,
    contentDensity: 0.8,
    repeatedBlocks: 3,
    commercialIndicators: ['price', 'contact'],
  });

  assert.ok(hypotheses.length >= 2);
  assert.ok(hypotheses.some(h => h.hypothesisType === 'POSSIBLE_LISTING_PAGE'));
});

test('ranks exploratory actions', () => {
  const strategy = new ExplorationStrategy();
  const actions = strategy.rankActions({
    pageType: 'UNKNOWN_PAGE',
    confidence: 0.1,
    linkCount: 30,
    commercialIndicators: ['price', 'contact'],
    repeatedBlocks: 3,
  });

  assert.ok(actions.length >= 3);
  assert.equal(actions[0].action, 'EXPLORE_LINKS');
});

test('validates confirmed hypotheses', () => {
  const validator = new HypothesisValidator();
  const result = validator.validate({
    hypothesisType: 'POSSIBLE_AD_PAGE',
    predictedOutcome: 'multiple detail links',
    observedOutcome: 'multiple detail links and contact info',
  });

  assert.equal(result.status, 'CONFIRMED');
});

test('rejects failed hypotheses', () => {
  const validator = new HypothesisValidator();
  const result = validator.validate({
    hypothesisType: 'POSSIBLE_CATEGORY_PAGE',
    predictedOutcome: 'category links',
    observedOutcome: 'no category links',
  });

  assert.equal(result.status, 'REJECTED');
});

test('learns from feedback', () => {
  const dir = makeTempDir();
  try {
    const loop = new AdaptiveLearningLoop(resolve(dir, 'adaptive-memory.json'));
    loop.recordOutcome({ hypothesisType: 'POSSIBLE_LISTING_PAGE', success: true, signal: 'listing' });
    loop.recordOutcome({ hypothesisType: 'POSSIBLE_LISTING_PAGE', success: false, signal: 'listing' });
    const stats = loop.getStats();
    assert.ok(stats.successfulHypotheses >= 1);
    assert.ok(stats.failedHypotheses >= 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scores promising unknown pages as high opportunity', () => {
  const scorer = new OpportunityScorer();
  const result = scorer.score({
    semanticSignals: ['car', 'price', 'listing'],
    linkCount: 25,
    repeatedBlocks: 4,
    patternSimilarity: 0.6,
    explorationSuccessRate: 0.8,
    historicalSuccess: 0.7,
  });

  assert.equal(result.opportunityLevel, 'HIGH');
  assert.ok(result.score >= 0.7);
});

test('routes adaptive decisions for unknown promising pages', () => {
  const engine = new DiscoveryHypothesisEngine();
  const hypotheses = engine.generateHypotheses({
    pageType: 'UNKNOWN_BUT_PROMISING',
    confidence: 0.2,
    semanticSignals: ['price', 'contact', 'listing'],
    linkCount: 18,
    contentDensity: 0.75,
    repeatedBlocks: 2,
    commercialIndicators: ['price', 'contact'],
  });

  assert.ok(hypotheses.some(h => h.hypothesisType === 'POSSIBLE_LISTING_PAGE'));
  assert.ok(hypotheses.some(h => h.hypothesisType === 'POSSIBLE_AD_PAGE'));
});

test('does not discard unknown promising pages immediately', () => {
  const scorer = new OpportunityScorer();
  const result = scorer.score({
    semanticSignals: ['price', 'contact', 'listing'],
    linkCount: 22,
    repeatedBlocks: 2,
    patternSimilarity: 0.3,
    explorationSuccessRate: 0.65,
    historicalSuccess: 0.6,
  });

  assert.ok(result.score >= 0.5);
  assert.notEqual(result.opportunityLevel, 'LOW');
});

test('uses max score for strong commercial indicators', () => {
  const scorer = new OpportunityScorer();
  const result = scorer.score({
    semanticSignals: ['price', 'contact', 'buy', 'sell'],
    linkCount: 40,
    repeatedBlocks: 5,
    patternSimilarity: 0.8,
    explorationSuccessRate: 0.9,
    historicalSuccess: 0.95,
  });

  assert.equal(result.opportunityLevel, 'CRITICAL');
  assert.ok(result.score > 0.9);
});

test('creates a hypothesis with explainable reasoning', () => {
  const engine = new DiscoveryHypothesisEngine();
  const hypotheses = engine.generateHypotheses({
    pageType: 'UNKNOWN_PAGE',
    confidence: 0.2,
    semanticSignals: ['jobs', 'salary'],
    linkCount: 16,
    contentDensity: 0.6,
    repeatedBlocks: 2,
    commercialIndicators: ['salary', 'contact'],
  });

  const listingHypothesis = hypotheses.find(h => h.hypothesisType === 'POSSIBLE_LISTING_PAGE');
  assert.ok(listingHypothesis);
  assert.ok(listingHypothesis.reasoningFactors.length > 0);
  assert.ok(listingHypothesis.evidence.length > 0);
});

test('supports ranking with pagination and internal-path actions', () => {
  const strategy = new ExplorationStrategy();
  const actions = strategy.rankActions({
    pageType: 'UNKNOWN_PAGE',
    confidence: 0.08,
    linkCount: 60,
    commercialIndicators: ['price', 'contact'],
    repeatedBlocks: 4,
  });

  assert.ok(actions.some(action => action.action === 'FOLLOW_PAGINATION'));
  assert.ok(actions.some(action => action.action === 'FOLLOW_INTERNAL_PATH'));
});

test('records adaptive memory persistence state', () => {
  const dir = makeTempDir();
  try {
    const loop = new AdaptiveLearningLoop(resolve(dir, 'adaptive-memory.json'));
    loop.recordOutcome({ hypothesisType: 'POSSIBLE_AD_PAGE', success: true, signal: 'detail-link' });
    const persisted = loop.loadMemory();
    assert.ok(persisted);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('builds a valid opportunity score for medium signals', () => {
  const scorer = new OpportunityScorer();
  const result = scorer.score({
    semanticSignals: ['article'],
    linkCount: 8,
    repeatedBlocks: 1,
    patternSimilarity: 0.1,
    explorationSuccessRate: 0.3,
    historicalSuccess: 0.2,
  });

  assert.equal(result.opportunityLevel, 'LOW');
});

test('supports heuristic fallback for empty signals', () => {
  const scorer = new OpportunityScorer();
  const result = scorer.score({});
  assert.ok(result.score >= 0);
  assert.equal(result.opportunityLevel, 'LOW');
});

test('validation can handle uncertain results', () => {
  const validator = new HypothesisValidator();
  const result = validator.validate({
    hypothesisType: 'POSSIBLE_LISTING_PAGE',
    predictedOutcome: 'listing pages',
    observedOutcome: 'unclear outcome',
  });

  assert.equal(result.status, 'UNCERTAIN');
});

test('learning loop can expose success rates', () => {
  const dir = makeTempDir();
  try {
    const loop = new AdaptiveLearningLoop(resolve(dir, 'adaptive-memory.json'));
    loop.recordOutcome({ hypothesisType: 'POSSIBLE_CATEGORY_PAGE', success: true, signal: 'category' });
    loop.recordOutcome({ hypothesisType: 'POSSIBLE_CATEGORY_PAGE', success: true, signal: 'category' });
    const stats = loop.getStats();
    assert.ok(stats.successRate >= 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('discovery engine can generate search-result hypotheses', () => {
  const engine = new DiscoveryHypothesisEngine();
  const hypotheses = engine.generateHypotheses({
    pageType: 'UNKNOWN_PAGE',
    confidence: 0.25,
    semanticSignals: ['search', 'results'],
    linkCount: 12,
    contentDensity: 0.45,
    repeatedBlocks: 1,
    commercialIndicators: ['search'],
  });
  assert.ok(hypotheses.some(h => h.hypothesisType === 'POSSIBLE_SEARCH_RESULT_PAGE'));
});

test('discovery engine can generate pagination hypotheses', () => {
  const engine = new DiscoveryHypothesisEngine();
  const hypotheses = engine.generateHypotheses({
    pageType: 'UNKNOWN_PAGE',
    confidence: 0.22,
    semanticSignals: ['pagination', 'page'],
    linkCount: 20,
    contentDensity: 0.4,
    repeatedBlocks: 2,
    commercialIndicators: []
  });
  assert.ok(hypotheses.some(h => h.hypothesisType === 'POSSIBLE_PAGINATION_PAGE'));
});

test('adaptive memory can be updated with strategy feedback', () => {
  const dir = makeTempDir();
  try {
    const loop = new AdaptiveLearningLoop(resolve(dir, 'adaptive-memory.json'));
    loop.recordOutcome({ hypothesisType: 'POSSIBLE_AD_PAGE', success: true, signal: 'detail-link' });
    loop.recordOutcome({ hypothesisType: 'POSSIBLE_AD_PAGE', success: false, signal: 'detail-link' });
    const memory = loop.loadMemory();
    assert.ok(memory.successfulHypotheses || memory.failedHypotheses);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
