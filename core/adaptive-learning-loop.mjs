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
      const seed = {
        successfulHypotheses: 0,
        failedHypotheses: 0,
        successfulStrategies: [],
        failedStrategies: [],
        signalEffectiveness: {},
        explorationStatistics: {},
      };
      this._persist(seed);
      return seed;
    }

    try {
      return JSON.parse(readFileSync(this.path, 'utf8'));
    } catch {
      return {
        successfulHypotheses: 0,
        failedHypotheses: 0,
        successfulStrategies: [],
        failedStrategies: [],
        signalEffectiveness: {},
        explorationStatistics: {},
      };
    }
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

    if (success) {
      this.memory.successfulHypotheses = (this.memory.successfulHypotheses || 0) + 1;
      this.memory.successfulStrategies = this.memory.successfulStrategies || [];
      this.memory.successfulStrategies.push({ hypothesisType, signal, timestamp: new Date().toISOString() });
    } else {
      this.memory.failedHypotheses = (this.memory.failedHypotheses || 0) + 1;
      this.memory.failedStrategies = this.memory.failedStrategies || [];
      this.memory.failedStrategies.push({ hypothesisType, signal, timestamp: new Date().toISOString() });
    }

    this.memory.signalEffectiveness = this.memory.signalEffectiveness || {};
    this.memory.signalEffectiveness[signal] = (this.memory.signalEffectiveness[signal] || 0) + (success ? 1 : -0.5);
    this.memory.explorationStatistics[signal] = (this.memory.explorationStatistics[signal] || 0) + 1;
    this._persist(this.memory);
    return this.memory;
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
    };
  }
}
