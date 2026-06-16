import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { StructuralKnowledgeGraph } from './structural-knowledge-graph.mjs';
import { ConceptAbstractionEngine } from './concept-abstraction-engine.mjs';

function createId(prefix = 'concept') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class UniversalKnowledgeEngine {
  constructor({ knowledgePath = './state/universal-knowledge.json', graphPath = './state/knowledge-graph.json' } = {}) {
    this.knowledgePath = resolve(knowledgePath);
    this.graphPath = resolve(graphPath);
    this.abstractionEngine = new ConceptAbstractionEngine();
    this.graph = new StructuralKnowledgeGraph(this.graphPath);
    this.concepts = [];
    this._load();
  }

  _ensureDirectory(filePath) {
    const dir = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : '.';
    mkdirSync(dir, { recursive: true });
  }

  _load() {
    try {
      this._ensureDirectory(this.knowledgePath);
      if (existsSync(this.knowledgePath)) {
        const raw = JSON.parse(readFileSync(this.knowledgePath, 'utf8'));
        this.concepts = Array.isArray(raw) ? raw : (raw.concepts || []);
      }
    } catch {
      this.concepts = [];
    }

    this.graph.load();
  }

  _save() {
    try {
      this._ensureDirectory(this.knowledgePath);
      writeFileSync(this.knowledgePath, JSON.stringify(this.concepts, null, 2));
      this.graph.persist();
    } catch {}
  }

  listConcepts() {
    return [...this.concepts];
  }

  getConceptByName(conceptName) {
    return this.concepts.find((concept) => concept.conceptName === conceptName) || null;
  }

  createOrUpdateConcept({ conceptName, confidence = 0.5, evidenceCount = 1, observations = [] } = {}) {
    const normalizedName = String(conceptName || 'UNKNOWN_PAGE').toUpperCase();
    const now = new Date().toISOString();
    const existing = this.getConceptByName(normalizedName);

    if (existing) {
      existing.confidence = Number(confidence || existing.confidence || 0.5);
      existing.evidenceCount = Number(evidenceCount || existing.evidenceCount || 1);
      existing.lastSeen = now;
      existing.observations = [...new Map([...existing.observations, ...observations].map((entry) => [JSON.stringify(entry), entry])).values()];
      this._save();
      return existing;
    }

    const concept = {
      conceptId: createId('concept'),
      conceptName: normalizedName,
      confidence: Number(confidence || 0.5),
      evidenceCount: Number(evidenceCount || 1),
      firstSeen: now,
      lastSeen: now,
      observations: Array.isArray(observations) ? observations : [],
    };

    this.concepts.push(concept);
    this._save();
    return concept;
  }

  abstractPageToConcept(input = {}) {
    return this.abstractionEngine.abstractPageToConcept(input);
  }

  learnFromObservation(input = {}) {
    const abstraction = this.abstractionEngine.abstractPageToConcept(input);
    const concept = this.createOrUpdateConcept({
      conceptName: abstraction.conceptName,
      confidence: Math.max(abstraction.confidence, 0.6),
      evidenceCount: 1,
      observations: [{
        kind: 'observation',
        semanticSignals: input.semanticSignals || [],
        structuralSignals: input.structuralSignals || [],
        linkTopology: input.linkTopology || {},
        domFingerprint: input.domFingerprint || '',
        observedAt: new Date().toISOString(),
      }],
    });

    if (abstraction.conceptName !== 'UNKNOWN_PAGE') {
      this.graph.addObservation({
        sourceConcept: abstraction.conceptName,
        targetConcept: abstraction.conceptName,
        observation: abstraction.conceptName,
        weight: abstraction.confidence,
      });
    }

    return concept;
  }
}

export const universalKnowledgeEngine = new UniversalKnowledgeEngine();
