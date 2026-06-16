import { KnowledgeTransferEngine } from './knowledge-transfer-engine.mjs';
import { UniversalKnowledgeEngine } from './universal-knowledge-engine.mjs';

export class CrossSiteReasoner {
  constructor({ knowledgeEngine = new UniversalKnowledgeEngine(), transferEngine = new KnowledgeTransferEngine({ knowledgeEngine }) } = {}) {
    this.knowledgeEngine = knowledgeEngine;
    this.transferEngine = transferEngine;
  }

  reason(input = {}) {
    const transfer = this.transferEngine.transferKnowledge(input);
    const conceptName = transfer.matchedConcept || 'UNKNOWN_PAGE';

    let action = 'LOW_PRIORITY_CRAWL';
    let confidence = transfer.transferConfidence;
    let reasoning = `Transferred knowledge from prior ${conceptName} experience with similarity ${transfer.similarityScore}`;

    switch (conceptName) {
      case 'CATEGORY_PAGE':
        action = 'EXPLORE_CATEGORIES';
        confidence = Math.max(confidence, 0.75);
        reasoning = 'Category-like structure suggests deeper exploration of similar paths.';
        break;
      case 'ADVERTISEMENT_PAGE':
        action = 'EXTRACT_CONTENT';
        confidence = Math.max(confidence, 0.8);
        reasoning = 'Ad-like structure should be extracted rather than recursively explored.';
        break;
      case 'DIRECTORY_PAGE':
        action = 'EXPLORE_CATEGORIES';
        confidence = Math.max(confidence, 0.72);
        reasoning = 'Directory-like topology suggests category navigation is the best next step.';
        break;
      case 'LISTING_PAGE':
        action = 'DISCOVER_ADS';
        confidence = Math.max(confidence, 0.69);
        reasoning = 'Listing-like structure should surface ad candidates.';
        break;
      default:
        action = 'LOW_PRIORITY_CRAWL';
        confidence = Math.max(confidence, 0.3);
        reasoning = 'No strong generalized concept matched; keep the page low priority.';
        break;
    }

    return {
      action,
      confidence: Number(confidence.toFixed(3)),
      conceptName,
      reasoning,
      transfer,
    };
  }
}
