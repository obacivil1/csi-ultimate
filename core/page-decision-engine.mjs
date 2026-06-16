const ACTIONS = {
  EXPLORE_CATEGORIES: 'EXPLORE_CATEGORIES',
  DISCOVER_LISTINGS: 'DISCOVER_LISTINGS',
  DISCOVER_ADS: 'DISCOVER_ADS',
  EXTRACT_CONTENT: 'EXTRACT_CONTENT',
  LOW_PRIORITY_CRAWL: 'LOW_PRIORITY_CRAWL',
  IGNORE_PAGE: 'IGNORE_PAGE',
};

function normalizeText(value = '') {
  return String(value).toLowerCase();
}

function scoreLink(link, pageType) {
  const href = normalizeText(link?.url || link?.href || '');
  const text = normalizeText(link?.text || link?.label || '');
  const combined = `${href} ${text}`;

  let score = 0;
  let reason = 'default';

  if (pageType === 'DIRECTORY_PAGE') {
    if (/category|categories|browse|directory|listings?|classifieds?|jobs?|cars?|property|properties|rent|buy|sell|for-sale|forsale|forrent|real-estate|real estate|services?/i.test(combined)) {
      score += 8;
      reason = 'category-like-link';
    }
    if (/about|contact|privacy|terms|login|register|help|faq|sitemap|home/i.test(combined)) {
      score -= 6;
      reason = 'navigation-link';
    }
    if (score > 0) {
      score += 2;
    }
  }

  if (pageType === 'CATEGORY_PAGE') {
    if (/listing|listings|ad|ads|cls|details?|view|job|property|car|vehicle|rent|sale|for-sale|forsale|forrent/i.test(combined)) {
      score += 7;
      reason = 'listing-like-link';
    }
  }

  if (pageType === 'JOB_LISTING_PAGE' || pageType === 'REAL_ESTATE_LISTING_PAGE' || pageType === 'VEHICLE_LISTING_PAGE') {
    if (/\/cls\//i.test(href) || /\/ad\//i.test(href) || /detail|details?|view|property|car|vehicle|job/i.test(combined)) {
      score += 10;
      reason = 'detail-link';
    }
    if (/job|jobs|property|car|vehicle|rent|sale|listing|listings/i.test(combined)) {
      score += 3;
      reason = 'related-link';
    }
  }

  if (pageType === 'JOB_AD_PAGE' || pageType === 'REAL_ESTATE_AD_PAGE' || pageType === 'VEHICLE_AD_PAGE') {
    score = 0;
    reason = 'extract-target';
  }

  if (!score && !reason) {
    reason = 'neutral';
  }

  return { url: link?.url || link?.href || '', score, reason };
}

export class PageDecisionEngine {
  constructor(opts = {}) {
    this.options = opts;
  }

  decide(input = {}) {
    const pageType = input.pageType || 'UNKNOWN_PAGE';
    const confidence = Number(input.confidence || 0);
    const discoveredLinks = Array.isArray(input.discoveredLinks) ? input.discoveredLinks : [];
    const linkScores = discoveredLinks.map(link => scoreLink(link, pageType));

    let action = ACTIONS.LOW_PRIORITY_CRAWL;
    let priority = 5;
    let reason = 'default fallback';

    switch (pageType) {
      case 'DIRECTORY_PAGE':
        action = ACTIONS.EXPLORE_CATEGORIES;
        priority = 30;
        reason = 'directory-style landing page should surface category navigation';
        break;
      case 'CATEGORY_PAGE':
        action = ACTIONS.DISCOVER_LISTINGS;
        priority = 50;
        reason = 'category page should continue deeper discovery';
        break;
      case 'JOB_LISTING_PAGE':
        action = ACTIONS.DISCOVER_ADS;
        priority = 75;
        reason = 'job listing page should surface ad candidates';
        break;
      case 'REAL_ESTATE_LISTING_PAGE':
        action = ACTIONS.DISCOVER_ADS;
        priority = 70;
        reason = 'real-estate listings should prioritize detail pages';
        break;
      case 'VEHICLE_LISTING_PAGE':
        action = ACTIONS.DISCOVER_ADS;
        priority = 70;
        reason = 'vehicle listings should prioritize detail pages';
        break;
      case 'JOB_AD_PAGE':
      case 'REAL_ESTATE_AD_PAGE':
      case 'VEHICLE_AD_PAGE':
        action = ACTIONS.EXTRACT_CONTENT;
        priority = 100;
        reason = 'detail/ad page should be extracted immediately';
        break;
      case 'BLOG_ARTICLE_PAGE':
        action = ACTIONS.LOW_PRIORITY_CRAWL;
        priority = 15;
        reason = 'blog article is lower priority than listings and ads';
        break;
      case 'UNKNOWN_PAGE':
      default:
        action = ACTIONS.LOW_PRIORITY_CRAWL;
        priority = 5;
        reason = 'unknown semantic signature should receive minimal recursion';
        break;
    }

    if (confidence < 0.25) {
      priority = Math.min(priority, 10);
      reason = `low-confidence classification (${confidence}) -> cautious routing`;
    }

    const sortedLinks = [...linkScores].sort((a, b) => b.score - a.score);
    return {
      action,
      priority,
      reasoning: reason,
      confidence,
      pageType,
      linkScores: sortedLinks,
      url: input.url,
    };
  }
}

export const pageDecisionEngine = new PageDecisionEngine();
export { ACTIONS };
