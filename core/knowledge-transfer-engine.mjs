import { UniversalKnowledgeEngine } from './universal-knowledge-engine.mjs';
import { ConceptAbstractionEngine } from './concept-abstraction-engine.mjs';

export class KnowledgeTransferEngine {
  constructor({ knowledgeEngine = new UniversalKnowledgeEngine(), abstractionEngine = new ConceptAbstractionEngine() } = {}) {
    this.knowledgeEngine = knowledgeEngine;
    this.abstractionEngine = abstractionEngine;
  }

  _scoreConceptSimilarity(concept, input = {}) {
    const abstraction = this.abstractionEngine.abstractPageToConcept(input);
    const conceptName = concept.conceptName || 'UNKNOWN_PAGE';
    const evidenceFactor = Number(concept.confidence || 0) * 0.35;
    const observationFactor = Math.min(0.2, (concept.evidenceCount || 0) / 20);
    let score = 0.15 + evidenceFactor + observationFactor;

    if (conceptName === abstraction.conceptName) {
      score += 0.35;
    }

    if (conceptName === 'CATEGORY_PAGE' && (input.structuralSignals || []).some((signal) => /many-similar-links|pagination|grouped-navigation/.test(signal))) {
      score += 0.18;
    }

    if (conceptName === 'ADVERTISEMENT_PAGE' && (input.structuralSignals || []).some((signal) => /contact-details|low-outgoing-links|single-card/.test(signal))) {
      score += 0.18;
    }

    if (conceptName === 'DIRECTORY_PAGE' && (input.structuralSignals || []).some((signal) => /category-clusters|navigation-heavy/.test(signal))) {
      score += 0.18;
    }

    const linkDensity = Number(input.linkTopology?.linkDensity || 0);
    if (conceptName === 'CATEGORY_PAGE' && linkDensity > 0.55) score += 0.05;
    if (conceptName === 'ADVERTISEMENT_PAGE' && linkDensity < 0.25) score += 0.05;

    return Math.min(0.99, Number(score.toFixed(3)));
  }

  transferKnowledge(input = {}) {
    const abstraction = this.abstractionEngine.abstractPageToConcept(input);
    const concepts = this.knowledgeEngine.listConcepts();

    if (!concepts.length) {
      return {
        matchedConcept: abstraction.conceptName,
        similarityScore: Number(abstraction.confidence.toFixed(3)),
        transferConfidence: Number((abstraction.confidence * 0.7).toFixed(3)),
      };
    }

    const scored = concepts
      .map((concept) => ({
        concept,
        similarityScore: this._scoreConceptSimilarity(concept, input),
      }))
      .sort((a, b) => b.similarityScore - a.similarityScore);

    const best = scored[0];
    const similarityScore = Number(best?.similarityScore || abstraction.confidence || 0);
    const transferConfidence = Number(Math.min(0.99, similarityScore + (Number(best?.concept?.confidence || 0) * 0.08) + Math.min(0.05, (best?.concept?.evidenceCount || 0) / 100)).toFixed(3));

    return {
      matchedConcept: best?.concept?.conceptName || abstraction.conceptName || 'UNKNOWN_PAGE',
      similarityScore,
      transferConfidence,
    };
  }
}
