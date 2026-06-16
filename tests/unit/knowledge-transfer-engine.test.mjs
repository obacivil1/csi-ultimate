import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { KnowledgeTransferEngine } from '../core/knowledge-transfer-engine.mjs';
import { UniversalKnowledgeEngine } from '../core/universal-knowledge-engine.mjs';

function createTempTransferEngine() {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-transfer-'));
  const knowledge = new UniversalKnowledgeEngine({
    knowledgePath: join(dir, 'universal-knowledge.json'),
    graphPath: join(dir, 'knowledge-graph.json'),
  });
  const engine = new KnowledgeTransferEngine({ knowledgeEngine: knowledge });
  return { dir, engine, knowledge };
}

test('matches a new category page against known category concepts', () => {
  const { dir, engine, knowledge } = createTempTransferEngine();
  try {
    knowledge.createOrUpdateConcept({ conceptName: 'CATEGORY_PAGE', confidence: 0.84, evidenceCount: 5, observations: [{ kind: 'many-similar-links', weight: 0.8 }] });

    const result = engine.transferKnowledge({
      semanticSignals: ['category', 'browse', 'listing'],
      structuralSignals: ['many-similar-links', 'pagination'],
      linkTopology: { linkDensity: 0.75 },
      domFingerprint: 'repeated-card-structure',
    });

    assert.equal(result.matchedConcept, 'CATEGORY_PAGE');
    assert.ok(result.similarityScore >= 0.65);
    assert.ok(result.transferConfidence >= 0.6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matches advertisement pages across domains', () => {
  const { dir, engine, knowledge } = createTempTransferEngine();
  try {
    knowledge.createOrUpdateConcept({ conceptName: 'ADVERTISEMENT_PAGE', confidence: 0.9, evidenceCount: 6, observations: [{ kind: 'contact-details', weight: 0.9 }] });

    const result = engine.transferKnowledge({
      semanticSignals: ['contact', 'price', 'phone', 'description'],
      structuralSignals: ['contact-details', 'low-outgoing-links'],
      linkTopology: { linkDensity: 0.12 },
      domFingerprint: 'detail-card',
    });

    assert.equal(result.matchedConcept, 'ADVERTISEMENT_PAGE');
    assert.ok(result.similarityScore >= 0.7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns UNKNOWN_PAGE for weak transfer candidates', () => {
  const { dir, engine } = createTempTransferEngine();
  try {
    const result = engine.transferKnowledge({
      semanticSignals: ['hello', 'welcome'],
      structuralSignals: ['plain-text'],
      linkTopology: { linkDensity: 0.1 },
      domFingerprint: 'blank',
    });

    assert.equal(result.matchedConcept, 'UNKNOWN_PAGE');
    assert.ok(result.similarityScore <= 0.3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses a concept confidence boost when evidence is strong', () => {
  const { dir, engine, knowledge } = createTempTransferEngine();
  try {
    knowledge.createOrUpdateConcept({ conceptName: 'CATEGORY_PAGE', confidence: 0.85, evidenceCount: 10 });
    const result = engine.transferKnowledge({
      semanticSignals: ['category', 'browse', 'pagination', 'grouped-navigation'],
      structuralSignals: ['many-similar-links', 'pagination', 'grouped-navigation'],
      linkTopology: { linkDensity: 0.8, repeatedBlocks: 2 },
      domFingerprint: 'repeated-card-structure',
    });

    assert.equal(result.matchedConcept, 'CATEGORY_PAGE');
    assert.ok(result.transferConfidence > result.similarityScore);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports transfer metadata with a stable shape', () => {
  const { dir, engine, knowledge } = createTempTransferEngine();
  try {
    knowledge.createOrUpdateConcept({ conceptName: 'DIRECTORY_PAGE', confidence: 0.75, evidenceCount: 3 });
    const result = engine.transferKnowledge({
      semanticSignals: ['directory', 'navigation'],
      structuralSignals: ['navigation-heavy', 'category-clusters'],
      linkTopology: { linkDensity: 0.6 },
      domFingerprint: 'directory-grid',
    });

    assert.deepEqual(Object.keys(result).sort(), ['matchedConcept', 'similarityScore', 'transferConfidence'].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
