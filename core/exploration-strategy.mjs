export class ExplorationStrategy {
  rankActions(input = {}) {
    const linkCount = Number(input.linkCount || 0);
    const confidence = Number(input.confidence || 0);
    const commercialIndicators = Array.isArray(input.commercialIndicators) ? input.commercialIndicators : [];
    const repeatedBlocks = Number(input.repeatedBlocks || 0);

    const actions = [
      {
        action: 'EXPLORE_LINKS',
        score: 0.95 + Math.min(0.04, linkCount / 200) + (commercialIndicators.length > 0 ? 0.03 : 0),
        reason: 'unknown page with many links should be explored',
      },
      {
        action: 'OPEN_TOP_LINKS',
        score: 0.8 + (linkCount > 15 ? 0.05 : 0) + (confidence < 0.2 ? 0.03 : 0),
        reason: 'sample the most promising internal anchors',
      },
      {
        action: 'FOLLOW_PAGINATION',
        score: 0.7 + (linkCount > 20 ? 0.06 : 0),
        reason: 'follow paginated paths when clusters are repeated',
      },
      {
        action: 'FOLLOW_INTERNAL_PATH',
        score: 0.7 + (repeatedBlocks > 1 ? 0.05 : 0),
        reason: 'walk deeper if structure repeats',
      },
      {
        action: 'TEST_AD_LINK',
        score: 0.65 + (commercialIndicators.length > 0 ? 0.06 : 0),
        reason: 'test for ad-like targets when commercial signals exist',
      },
      {
        action: 'TEST_CATEGORY_LINK',
        score: 0.6 + (linkCount > 18 ? 0.05 : 0),
        reason: 'probe category links when structure looks navigational',
      },
    ];

    return actions.sort((a, b) => b.score - a.score);
  }
}
