import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { SimilarityEngine } from './pattern-similarity.mjs';

function createId() {
  return `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class PatternRegistry {
  constructor(path = './state/pattern-registry.json') {
    this.path = resolve(path);
    this.similarityEngine = new SimilarityEngine();
    this.patterns = [];
    this._load();
  }

  _load() {
    try {
      mkdirSync(this.path.includes('/') ? this.path.split('/').slice(0, -1).join('/') : '.', { recursive: true });
    } catch {}

    if (!existsSync(this.path)) {
      this.patterns = [];
      return;
    }

    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8'));
      this.patterns = Array.isArray(raw) ? raw : (raw.patterns || []);
    } catch {
      this.patterns = [];
    }
  }

  _save() {
    try {
      mkdirSync(this.path.includes('/') ? this.path.split('/').slice(0, -1).join('/') : '.', { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.patterns, null, 2));
    } catch {}
  }

  learnPattern({ patternType, fingerprint, pageType, url, confidence = 0.5 }) {
    const existing = this.patterns.find(pattern => pattern.patternType === patternType && pattern.pageType === pageType && this.similarityEngine.compareFingerprints(pattern.fingerprint, fingerprint) >= 0.8);
    if (existing) {
      existing.usageCount = (existing.usageCount || 0) + 1;
      existing.lastSeen = new Date().toISOString();
      existing.confidence = Math.min(0.99, Number(existing.confidence || 0) + Number(confidence || 0) * 0.1);
      this._save();
      return existing;
    }

    const pattern = {
      patternId: createId(),
      patternType,
      pageType,
      confidence: Math.min(0.99, Number(confidence || 0.5)),
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      usageCount: 1,
      fingerprint,
      sourceUrl: url || '',
    };

    this.patterns.push(pattern);
    this._save();
    return pattern;
  }

  getPattern(patternId) {
    return this.patterns.find(pattern => pattern.patternId === patternId) || null;
  }

  updateConfidence(patternId, delta = 0.1) {
    const pattern = this.getPattern(patternId);
    if (!pattern) return null;
    pattern.confidence = Math.min(0.99, Number(pattern.confidence || 0) + Number(delta || 0));
    pattern.lastSeen = new Date().toISOString();
    pattern.usageCount = (pattern.usageCount || 0) + 1;
    this._save();
    return pattern;
  }

  findSimilarPatterns(fingerprint, opts = {}) {
    const threshold = Number(opts.threshold || 0.5);
    const scored = this.patterns
      .map(pattern => ({
        ...pattern,
        score: this.similarityEngine.compareFingerprints(pattern.fingerprint, fingerprint),
      }))
      .filter(result => result.score >= threshold)
      .sort((a, b) => b.score - a.score);

    return scored;
  }

  retireWeakPatterns(opts = {}) {
    const minConfidence = Number(opts.minConfidence || 0.2);
    const retired = this.patterns.filter(pattern => Number(pattern.confidence || 0) < minConfidence);
    this.patterns = this.patterns.filter(pattern => Number(pattern.confidence || 0) >= minConfidence);
    this._save();
    return retired;
  }
}

export const patternRegistry = new PatternRegistry();
