function normalizeSignals(value = []) {
  return Array.isArray(value) ? value.filter(Boolean).map(item => String(item).toLowerCase()) : [];
}

export class DiscoveryHypothesisEngine {
  generateHypotheses(input = {}) {
    const semanticSignals = normalizeSignals(input.semanticSignals || []);
    const linkCount = Number(input.linkCount || 0);
    const contentDensity = Number(input.contentDensity || 0);
    const repeatedBlocks = Number(input.repeatedBlocks || 0);
    const commercialIndicators = normalizeSignals(input.commercialIndicators || []);
    const confidence = Number(input.confidence || 0);

    const hypotheses = [];

    const addHypothesis = (hypothesisType, confidenceScore, evidence, reasoningFactors) => {
      hypotheses.push({ hypothesisType, confidence: Number(confidenceScore.toFixed(3)), evidence, reasoningFactors });
    };

    const listingSignals = semanticSignals.some(signal => /list|ad|job|car|property|vehicle|rent|sale|price|contact/.test(signal));
    if (listingSignals || linkCount > 10 || repeatedBlocks > 0) {
      addHypothesis(
        'POSSIBLE_LISTING_PAGE',
        Math.min(0.95, 0.35 + (linkCount > 10 ? 0.12 : 0) + (contentDensity > 0.5 ? 0.1 : 0) + (commercialIndicators.length > 0 ? 0.08 : 0) + (confidence * 0.2)),
        ['multiple internal links', 'commercial language', 'repeated blocks'],
        ['semantic density', 'link volume', 'commercial indicators']
      );
    }

    const adSignals = semanticSignals.some(signal => /ad|detail|contact|price|apply|call|message/.test(signal));
    if (adSignals || commercialIndicators.length > 0) {
      addHypothesis(
        'POSSIBLE_AD_PAGE',
        Math.min(0.95, 0.3 + (adSignals ? 0.2 : 0) + (commercialIndicators.length > 0 ? 0.15 : 0) + (confidence * 0.2)),
        ['commercial intent', 'detail-oriented wording'],
        ['contact and price signals', 'action-oriented vocabulary']
      );
    }

    const categorySignals = semanticSignals.some(signal => /category|browse|directory|services|jobs|property|cars/.test(signal));
    if (categorySignals || linkCount > 15) {
      addHypothesis(
        'POSSIBLE_CATEGORY_PAGE',
        Math.min(0.9, 0.28 + (categorySignals ? 0.16 : 0) + (linkCount > 15 ? 0.1 : 0) + (confidence * 0.1)),
        ['grouped content', 'navigational clusters'],
        ['category-style labels', 'clustered links']
      );
    }

    const directorySignals = semanticSignals.some(signal => /directory|browse|sections|categories|index/.test(signal)) || linkCount > 20;
    if (directorySignals) {
      addHypothesis(
        'POSSIBLE_DIRECTORY_PAGE',
        Math.min(0.9, 0.26 + (directorySignals ? 0.14 : 0) + (linkCount > 20 ? 0.1 : 0)),
        ['site-wide navigation structure', 'many topic links'],
        ['link topology', 'directory semantics']
      );
    }

    const searchSignals = semanticSignals.some(signal => /search|results|find|query/.test(signal));
    if (searchSignals || linkCount > 8) {
      addHypothesis(
        'POSSIBLE_SEARCH_RESULT_PAGE',
        Math.min(0.85, 0.25 + (searchSignals ? 0.2 : 0) + (linkCount > 8 ? 0.1 : 0)),
        ['search-oriented terms', 'query-like results'],
        ['search vocabulary', 'result-oriented structure']
      );
    }

    const paginationSignals = semanticSignals.some(signal => /page|next|previous|pagination/.test(signal)) || linkCount > 12;
    if (paginationSignals) {
      addHypothesis(
        'POSSIBLE_PAGINATION_PAGE',
        Math.min(0.85, 0.2 + (paginationSignals ? 0.18 : 0) + (linkCount > 12 ? 0.08 : 0)),
        ['repeated page links', 'pagination cues'],
        ['pagination hints', 'page sequence patterns']
      );
    }

    if (hypotheses.length === 0) {
      addHypothesis('POSSIBLE_UNKNOWN_PAGE', 0.1, ['no strong signals'], ['fallback']);
    }

    return hypotheses.sort((a, b) => b.confidence - a.confidence);
  }
}
