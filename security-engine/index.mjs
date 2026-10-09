/**
 * security-engine/index.mjs — barrel exports (Phase 1 foundation).
 *
 * Dependency direction (one-way, additive):
 *   security-engine → adapters → existing infrastructure
 *   (core/ssrf-guard.mjs only, consumed — never modified)
 * Existing infrastructure does NOT depend on security-engine.
 */
export * from "./common.mjs";
export * from "./correlation.mjs";
export * from "./models/target.mjs";
export * from "./models/endpoint.mjs";
export * from "./models/http.mjs";
export * from "./models/identity.mjs";
export * from "./models/resource.mjs";
export * from "./models/workflow.mjs";
export * from "./models/observation.mjs";
export * from "./models/evidence.mjs";
export * from "./models/finding.mjs";
export * from "./scope/gate.mjs";
export * from "./adapters/ssrf.mjs";
export * from "./adapters/http.mjs";
export * from "./registry/registry.mjs";
export * from "./execution/contract.mjs";
export * from "./comparison/differential.mjs";
export * from "./storage/stores.mjs";
