function normalizeToken(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(value = '') {
  return normalizeToken(value).split(/\s+/).filter(Boolean);
}

function overlapScore(a = [], b = []) {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter(token => setB.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function stringSimilarity(a = '', b = '') {
  const left = normalizeToken(a);
  const right = normalizeToken(b);
  if (!left || !right) return 0;
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  return overlapScore(leftTokens, rightTokens);
}

export class SimilarityEngine {
  compareFingerprints(left = {}, right = {}) {
    const urlScore = stringSimilarity(left.urlPattern || '', right.urlPattern || '');
    const domScore = overlapScore(tokenize(left.domShape?.join(' ') || ''), tokenize(right.domShape?.join(' ') || ''));
    const headingScore = overlapScore(tokenize(left.headingHierarchy?.join(' ') || ''), tokenize(right.headingHierarchy?.join(' ') || ''));
    const selectorScore = overlapScore(tokenize(left.repeatedSelectors?.join(' ') || ''), tokenize(right.repeatedSelectors?.join(' ') || ''));
    const semanticScore = overlapScore(tokenize(left.semanticSignals?.join(' ') || ''), tokenize(right.semanticSignals?.join(' ') || ''));
    const linkScore = overlapScore(tokenize(left.internalLinkStructure?.join(' ') || ''), tokenize(right.internalLinkStructure?.join(' ') || ''));

    const weighted = (
      urlScore * 0.3 +
      domScore * 0.2 +
      headingScore * 0.15 +
      selectorScore * 0.1 +
      semanticScore * 0.15 +
      linkScore * 0.1
    );

    return Number(weighted.toFixed(3));
  }
}
