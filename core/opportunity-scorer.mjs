export class OpportunityScorer {
  score(input = {}) {
    const semanticSignals = Array.isArray(input.semanticSignals) ? input.semanticSignals : [];
    const linkCount = Number(input.linkCount || 0);
    const repeatedBlocks = Number(input.repeatedBlocks || 0);
    const patternSimilarity = Number(input.patternSimilarity || 0);
    const explorationSuccessRate = Number(input.explorationSuccessRate || 0);
    const historicalSuccess = Number(input.historicalSuccess || 0);

    let score = 0.05;
    score += semanticSignals.length * 0.03;
    score += Math.min(0.12, linkCount / 250);
    score += Math.min(0.12, repeatedBlocks * 0.03);
    score += Math.min(0.16, patternSimilarity * 0.24);
    score += Math.min(0.16, explorationSuccessRate * 0.24);
    score += Math.min(0.16, historicalSuccess * 0.24);

    const commercial = semanticSignals.some(signal => /price|contact|buy|sell|ad|job|property|car|listing/.test(String(signal).toLowerCase()));
    if (commercial) score += 0.08;

    score = Math.min(1, Number(score.toFixed(3)));

    let opportunityLevel = 'LOW';
    if (score >= 0.95) opportunityLevel = 'CRITICAL';
    else if (score >= 0.68) opportunityLevel = 'HIGH';
    else if (score >= 0.45) opportunityLevel = 'MEDIUM';

    return { score, confidence: score, opportunityLevel };
  }
}
