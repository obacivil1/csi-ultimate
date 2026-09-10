import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export class AdaptiveLearningLoop {
  constructor(path = './state/adaptive-memory.json') {
    this.path = resolve(path);
    this.memory = this.loadMemory();
  }

  loadMemory() {
    try {
      mkdirSync(this.path.includes('/') ? this.path.split('/').slice(0, -1).join('/') : '.', { recursive: true });
    } catch {}

    if (!existsSync(this.path)) {
      const seed = this._emptyState();
      this._persist(seed);
      return seed;
    }

    try {
      return JSON.parse(readFileSync(this.path, 'utf8'));
    } catch {
      return this._emptyState();
    }
  }

  _emptyState() {
    return {
      successfulHypotheses: 0,
      failedHypotheses: 0,
      successfulStrategies: [],
      failedStrategies: [],
      signalEffectiveness: {},
      explorationStatistics: {},
      hostnameProfiles: {},
      strategyRankings: {},
    };
  }

  _persist(data) {
    try {
      mkdirSync(this.path.includes('/') ? this.path.split('/').slice(0, -1).join('/') : '.', { recursive: true });
      writeFileSync(this.path, JSON.stringify(data, null, 2));
    } catch {}
  }

  recordOutcome(entry = {}) {
    const hypothesisType = entry.hypothesisType || 'UNKNOWN';
    const success = !!entry.success;
    const signal = entry.signal || 'unknown';
    const hostname = entry.hostname || 'default';

    if (success) {
      this.memory.successfulHypotheses = (this.memory.successfulHypotheses || 0) + 1;
      this.memory.successfulStrategies = this.memory.successfulStrategies || [];
      this.memory.successfulStrategies.push({ hypothesisType, signal, hostname, timestamp: new Date().toISOString() });
    } else {
      this.memory.failedHypotheses = (this.memory.failedHypotheses || 0) + 1;
      this.memory.failedStrategies = this.memory.failedStrategies || [];
      this.memory.failedStrategies.push({ hypothesisType, signal, hostname, timestamp: new Date().toISOString() });
    }

    this.memory.signalEffectiveness = this.memory.signalEffectiveness || {};
    this.memory.signalEffectiveness[signal] = (this.memory.signalEffectiveness[signal] || 0) + (success ? 1 : -0.5);
    this.memory.explorationStatistics[signal] = (this.memory.explorationStatistics[signal] || 0) + 1;

    this._updateHostnameProfile(hostname, hypothesisType, success);
    this._updateStrategyRankings(hostname, hypothesisType, success);

    this._persist(this.memory);
    return this.memory;
  }

  _updateHostnameProfile(hostname, strategy, success) {
    if (!this.memory.hostnameProfiles) this.memory.hostnameProfiles = {};
    if (!this.memory.hostnameProfiles[hostname]) {
      this.memory.hostnameProfiles[hostname] = {};
    }
    if (!this.memory.hostnameProfiles[hostname][strategy]) {
      this.memory.hostnameProfiles[hostname][strategy] = { attempts: 0, successes: 0, failures: 0 };
    }
    const s = this.memory.hostnameProfiles[hostname][strategy];
    s.attempts++;
    if (success) s.successes++; else s.failures++;
  }

  _updateStrategyRankings(hostname, strategy, success) {
    if (!this.memory.strategyRankings) this.memory.strategyRankings = {};
    if (!this.memory.strategyRankings[hostname]) {
      this.memory.strategyRankings[hostname] = [];
    }
    const rankings = this.memory.strategyRankings[hostname];
    const existing = rankings.find(r => r.strategy === strategy);
    if (existing) {
      existing.attempts++;
      if (success) existing.successes++;
      existing.successRate = existing.successes / existing.attempts;
      existing.updatedAt = new Date().toISOString();
    } else {
      rankings.push({
        strategy,
        attempts: 1,
        successes: success ? 1 : 0,
        successRate: success ? 1 : 0,
        firstUsed: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    rankings.sort((a, b) => b.successRate - a.successRate);
  }

  getRecommendedStrategy(hostname, availableStrategies = ['A-Standard', 'B-Proxy', 'C-HeadedHuman', 'D-SessionInject', 'E-NetworkListen']) {
    const rankings = this.memory.strategyRankings?.[hostname];
    if (!rankings || rankings.length === 0) return null;

    const best = rankings.filter(r => r.attempts >= 2).sort((a, b) => b.successRate - a.successRate);
    if (best.length === 0) {
      const byAttempts = rankings.sort((a, b) => b.attempts - a.attempts);
      return byAttempts[0]?.strategy || null;
    }
    if (best[0].successRate >= 0.6) return best[0].strategy;
    return null;
  }

  getRecommendedJitter(hostname) {
    const profile = this.memory.hostnameProfiles?.[hostname];
    if (!profile) return { minMs: 5000, maxMs: 15000 };

    const failedStrategies = Object.entries(profile)
      .filter(([, s]) => s.failures > s.successes && s.attempts >= 3)
      .map(([k]) => k);

    if (failedStrategies.length > 0) {
      return { minMs: 8000, maxMs: 25000, note: 'site has detection history — slowing down' };
    }

    const avgSuccess = Object.values(profile).reduce((a, s) => a + (s.successes / Math.max(s.attempts, 1)), 0) / Math.max(Object.keys(profile).length, 1);
    if (avgSuccess > 0.8) {
      return { minMs: 3000, maxMs: 10000, note: 'site performing well — faster pace' };
    }

    return { minMs: 5000, maxMs: 15000 };
  }

  getStats() {
    const total = (this.memory.successfulHypotheses || 0) + (this.memory.failedHypotheses || 0);
    const successRate = total > 0 ? (this.memory.successfulHypotheses || 0) / total : 0;
    return {
      successfulHypotheses: this.memory.successfulHypotheses || 0,
      failedHypotheses: this.memory.failedHypotheses || 0,
      successRate,
      signalEffectiveness: this.memory.signalEffectiveness || {},
      explorationStatistics: this.memory.explorationStatistics || {},
      strategyRankings: this.memory.strategyRankings || {},
      hostnameCount: Object.keys(this.memory.hostnameProfiles || {}).length,
    };
  }

  getHostnameProfile(hostname) {
    return this.memory.hostnameProfiles?.[hostname] || {};
  }

  getStrategyRankings(hostname) {
    return this.memory.strategyRankings?.[hostname] || [];
  }
}
