import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CrossSiteReasoner } from '../core/cross-site-reasoner.mjs';
import { UniversalKnowledgeEngine } from '../core/universal-knowledge-engine.mjs';
import { KnowledgeTransferEngine } from '../core/knowledge-transfer-engine.mjs';

function createReasonerHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'cross-site-reasoner-'));
  const knowledge = new UniversalKnowledgeEngine({
    knowledgePath: join(dir, 'universal-knowledge.json'),
    graphPath: join(dir, 'knowledge-graph.json'),
  });
  const transfer = new KnowledgeTransferEngine({ knowledgeEngine: knowledge });
  const reasoner = new CrossSiteReasoner({ knowledgeEngine: knowledge, transferEngine: transfer });
  return { dir, reasoner, knowledge };
}

test('routes category-style pages toward exploration actions', () => {
  const { dir, reasoner, knowledge } = createReasonerHarness();
  try {
    knowledge.createOrUpdateConcept({ conceptName: 'CATEGORY_PAGE', confidence: 0.85, evidenceCount: 5 });
    const decision = reasoner.reason({
      semanticSignals: ['category', 'browse', 'listing'],
      structuralSignals: ['many-similar-links', 'pagination'],
      linkTopology: { linkDensity: 0.75 },
      domFingerprint: 'repeated-card-structure',
    });

    assert.equal(decision.conceptName, 'CATEGORY_PAGE');
    assert.equal(decision.action, 'EXPLORE_CATEGORIES');
    assert.ok(decision.confidence >= 0.6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('routes ad-like pages toward extraction', () => {
  const { dir, reasoner, knowledge } = createReasonerHarness();
  try {
    knowledge.createOrUpdateConcept({ conceptName: 'ADVERTISEMENT_PAGE', confidence: 0.9, evidenceCount: 6 });
    const decision = reasoner.reason({
      semanticSignals: ['contact', 'price', 'phone', 'description'],
      structuralSignals: ['contact-details', 'low-outgoing-links'],
      linkTopology: { linkDensity: 0.12 },
      domFingerprint: 'detail-card',
    });

    assert.equal(decision.conceptName, 'ADVERTISEMENT_PAGE');
    assert.equal(decision.action, 'EXTRACT_CONTENT');
    assert.ok(decision.confidence >= 0.7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to LOW_PRIORITY_CRAWL for unknown concepts', () => {
  const { dir, reasoner } = createReasonerHarness();
  try {
    const decision = reasoner.reason({
      semanticSignals: ['hello'],
      structuralSignals: ['plain-text'],
      linkTopology: { linkDensity: 0.1 },
      domFingerprint: 'blank',
    });

    assert.equal(decision.conceptName, 'UNKNOWN_PAGE');
    assert.equal(decision.action, 'LOW_PRIORITY_CRAWL');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes transfer metadata from prior knowledge', () => {
  const { dir, reasoner, knowledge } = createReasonerHarness();
  try {
    knowledge.createOrUpdateConcept({ conceptName: 'CATEGORY_PAGE', confidence: 0.82, evidenceCount: 4 });
    const decision = reasoner.reason({
      semanticSignals: ['category', 'browse'],
      structuralSignals: ['grouped-navigation', 'pagination'],
      linkTopology: { linkDensity: 0.72 },
      domFingerprint: 'cards',
    });

    assert.ok('transfer' in decision);
    assert.ok(decision.transfer.similarityScore >= 0.6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses the cross-site reasoner output shape expected by the crawler', () => {
  const { dir, reasoner, knowledge } = createReasonerHarness();
  try {
    knowledge.createOrUpdateConcept({ conceptName: 'DIRECTORY_PAGE', confidence: 0.8, evidenceCount: 4 });
    const decision = reasoner.reason({
      semanticSignals: ['directory', 'navigation'],
      structuralSignals: ['category-clusters'],
      linkTopology: { linkDensity: 0.58 },
      domFingerprint: 'directory-grid',
    });

    assert.deepEqual(Object.keys(decision).sort(), ['action', 'confidence', 'conceptName', 'reasoning', 'transfer'].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
