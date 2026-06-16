import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export class StructuralKnowledgeGraph {
  constructor(path = './state/knowledge-graph.json') {
    this.path = resolve(path);
    this.graph = { nodes: [], edges: [] };
  }

  _ensureDirectory() {
    const dir = this.path.includes('/') ? this.path.split('/').slice(0, -1).join('/') : '.';
    mkdirSync(dir, { recursive: true });
  }

  load() {
    try {
      this._ensureDirectory();
      if (!existsSync(this.path)) {
        this.graph = { nodes: [], edges: [] };
        return this.graph;
      }
      const raw = JSON.parse(readFileSync(this.path, 'utf8'));
      this.graph = raw && typeof raw === 'object' ? raw : { nodes: [], edges: [] };
      return this.graph;
    } catch {
      this.graph = { nodes: [], edges: [] };
      return this.graph;
    }
  }

  persist() {
    try {
      this._ensureDirectory();
      writeFileSync(this.path, JSON.stringify(this.graph, null, 2));
    } catch {}
  }

  addObservation({ sourceConcept, targetConcept, observation, weight = 0.5 }) {
    const source = sourceConcept || 'UNKNOWN_PAGE';
    const target = targetConcept || 'UNKNOWN_PAGE';
    const nodeSet = new Set((this.graph.nodes || []).map(node => node.id));
    if (!nodeSet.has(source)) this.graph.nodes.push({ id: source, kind: 'concept' });
    if (!nodeSet.has(target)) this.graph.nodes.push({ id: target, kind: 'concept' });

    const edge = { source, target, observation, weight: Number(weight || 0) };
    this.graph.edges.push(edge);
    this.persist();
    return edge;
  }

  getGraph() {
    return this.graph;
  }
}
