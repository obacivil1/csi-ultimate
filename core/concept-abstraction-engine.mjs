const UNIVERSAL_CONCEPTS = {
  CATEGORY_PAGE: {
    keywords: ['category', 'browse', 'directory', 'listing', 'categories', 'grouped-navigation', 'pagination', 'many-similar-links'],
    score: 0.8,
  },
  ADVERTISEMENT_PAGE: {
    keywords: ['contact', 'price', 'phone', 'description', 'contact-details', 'low-outgoing-links', 'single-card'],
    score: 0.82,
  },
  DIRECTORY_PAGE: {
    keywords: ['directory', 'navigation', 'category-clusters', 'navigation-heavy'],
    score: 0.78,
  },
  LISTING_PAGE: {
    keywords: ['listing', 'ad', 'details', 'view', 'card'],
    score: 0.72,
  },
  PAGINATION_PAGE: {
    keywords: ['pagination', 'page', 'next'],
    score: 0.7,
  },
  SEARCH_RESULTS_PAGE: {
    keywords: ['search', 'results', 'query'],
    score: 0.7,
  },
  PROFILE_PAGE: {
    keywords: ['profile', 'user', 'account'],
    score: 0.68,
  },
  CONTACT_PAGE: {
    keywords: ['contact', 'about', 'support'],
    score: 0.66,
  },
  LANDING_PAGE: {
    keywords: ['home', 'welcome', 'landing'],
    score: 0.6,
  },
};

function normalizeToken(value = '') {
  return String(value).toLowerCase().trim();
}

export class ConceptAbstractionEngine {
  abstractPageToConcept(input = {}) {
    if (!input) input = {};
    const semanticSignals = Array.isArray(input.semanticSignals) ? input.semanticSignals : [];
    const structuralSignals = Array.isArray(input.structuralSignals) ? input.structuralSignals : [];
    const linkTopology = input.linkTopology || {};
    const domFingerprint = String(input.domFingerprint || '');

    const allSignals = [
      ...semanticSignals.map(normalizeToken),
      ...structuralSignals.map(normalizeToken),
      normalizeToken(domFingerprint),
    ].filter(Boolean);

    const scored = Object.entries(UNIVERSAL_CONCEPTS)
      .map(([conceptName, template]) => {
        const matched = template.keywords.filter((keyword) => allSignals.some((signal) => signal.includes(keyword) || keyword.includes(signal)));
        if (!matched.length) return null;

        const signalWeight = matched.length * 0.16;
        const densityBonus = Number(linkTopology.linkDensity || 0) > 0.5 && conceptName === 'CATEGORY_PAGE' ? 0.12 : 0;
        const structuralBonus = structuralSignals.some((signal) => signal.includes('pagination') || signal.includes('many-similar-links') || signal.includes('grouped-navigation')) && conceptName === 'CATEGORY_PAGE' ? 0.12 : 0;
        const adBonus = (semanticSignals.some((signal) => /contact|price|phone|description/.test(signal)) || structuralSignals.some((signal) => /contact-details|low-outgoing-links|single-card/.test(signal))) && conceptName === 'ADVERTISEMENT_PAGE' ? 0.15 : 0;
        const directoryBonus = (semanticSignals.some((signal) => /directory|navigation/.test(signal)) || structuralSignals.some((signal) => /category-clusters|navigation-heavy/.test(signal))) && conceptName === 'DIRECTORY_PAGE' ? 0.12 : 0;
        const score = Math.min(0.99, template.score + signalWeight + densityBonus + structuralBonus + adBonus + directoryBonus);
        return { conceptName, score, matched };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      return { conceptName: 'UNKNOWN_PAGE', confidence: 0.2, matchedSignals: [] };
    }

    const best = scored[0];
    const confidence = Math.min(0.99, best.score);

    return {
      conceptName: best.conceptName,
      confidence,
      matchedSignals: best.matched,
    };
  }
}
