import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { UniversalKnowledgeEngine } from '../core/universal-knowledge-engine.mjs';

function createTempEngine() {
  const dir = mkdtempSync(join(tmpdir(), 'universal-knowledge-'));
  const engine = new UniversalKnowledgeEngine({
    knowledgePath: join(dir, 'universal-knowledge.json'),
    graphPath: join(dir, 'knowledge-graph.json'),
  });
  return { dir, engine };
}

test('creates a universal concept with evidence and confidence', () => {
  const { dir, engine } = createTempEngine();
  try {
    const concept = engine.createOrUpdateConcept({
      conceptName: 'CATEGORY_PAGE',
      confidence: 0.72,
      evidenceCount: 3,
      observations: [{ kind: 'similar-links', weight: 0.8 }],
    });

    assert.equal(concept.conceptName, 'CATEGORY_PAGE');
    assert.equal(concept.confidence, 0.72);
    assert.equal(concept.evidenceCount, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('updates existing concepts instead of duplicating them', () => {
  const { dir, engine } = createTempEngine();
  try {
    engine.createOrUpdateConcept({ conceptName: 'CATEGORY_PAGE', confidence: 0.6, evidenceCount: 2 });
    const updated = engine.createOrUpdateConcept({ conceptName: 'CATEGORY_PAGE', confidence: 0.9, evidenceCount: 4 });

    assert.equal(updated.confidence, 0.9);
    assert.equal(updated.evidenceCount, 4);
    assert.equal(engine.listConcepts().filter(concept => concept.conceptName === 'CATEGORY_PAGE').length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('abstracts a page fingerprint into a CATEGORY_PAGE concept', () => {
  const { dir, engine } = createTempEngine();
  try {
    const result = engine.abstractPageToConcept({
      semanticSignals: ['category', 'browse', 'directory', 'listing'],
      structuralSignals: ['many-similar-links', 'pagination', 'grouped-navigation'],
      linkTopology: { linkDensity: 0.82, repeatedBlocks: 2 },
      domFingerprint: 'repeated-card-structure',
    });

    assert.equal(result.conceptName, 'CATEGORY_PAGE');
    assert.ok(result.confidence >= 0.6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('abstracts a page fingerprint into an ADVERTISEMENT_PAGE concept', () => {
  const { dir, engine } = createTempEngine();
  try {
    const result = engine.abstractPageToConcept({
      semanticSignals: ['contact', 'price', 'phone', 'description'],
      structuralSignals: ['single-card', 'contact-details', 'low-outgoing-links'],
      linkTopology: { linkDensity: 0.15, repeatedBlocks: 1 },
      domFingerprint: 'detail-card',
    });

    assert.equal(result.conceptName, 'ADVERTISEMENT_PAGE');
    assert.ok(result.confidence >= 0.6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns UNKNOWN_PAGE when signals are too weak', () => {
  const { dir, engine } = createTempEngine();
  try {
    const result = engine.abstractPageToConcept({
      semanticSignals: ['welcome', 'hello'],
      structuralSignals: ['plain-text'],
      linkTopology: { linkDensity: 0.2, repeatedBlocks: 0 },
      domFingerprint: 'blank',
    });

    assert.equal(result.conceptName, 'UNKNOWN_PAGE');
    assert.ok(result.confidence <= 0.4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('learns from a page observation and records structural evidence', () => {
  const { dir, engine } = createTempEngine();
  try {
    const concept = engine.learnFromObservation({
      pageType: 'CATEGORY_PAGE',
      semanticSignals: ['category', 'browse'],
      structuralSignals: ['many-similar-links', 'pagination'],
      linkTopology: { linkDensity: 0.7 },
      domFingerprint: 'cards',
    });

    assert.equal(concept.conceptName, 'CATEGORY_PAGE');
    assert.ok(concept.confidence >= 0.6);
    assert.ok(concept.observations.length >= 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persists knowledge to disk', () => {
  const { dir, engine } = createTempEngine();
  try {
    engine.createOrUpdateConcept({ conceptName: 'DIRECTORY_PAGE', confidence: 0.81, evidenceCount: 5 });
    const reloaded = new UniversalKnowledgeEngine({
      knowledgePath: join(dir, 'universal-knowledge.json'),
      graphPath: join(dir, 'knowledge-graph.json'),
    });

    const concept = reloaded.getConceptByName('DIRECTORY_PAGE');
    assert.ok(concept);
    assert.equal(concept.confidence, 0.81);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
