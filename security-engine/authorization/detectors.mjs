/**
 * authorization/detectors.mjs — Phase 3 detector definitions (§5.1, §8, T9).
 *
 * One definition per closed-set dimension. These are DEFINITIONS, not a
 * running scanner: nothing here registers itself, sends requests, or enables
 * anything. Each `execute` is a thin dimension-fixed wrapper over
 * analyzeComparison (pure analysis of supplied observations). Enabling
 * happens exclusively through the Phase 1 registry inside test/lab runs —
 * shipped state is always disabled-by-default, and zero-detector operation
 * is unaffected (this module has no side effects on import).
 */
import { requireObject, freezeRecord } from "../common.mjs";
import { DIMENSIONS } from "./semantics.mjs";
import { analyzeComparison } from "./comparison.mjs";

const DETECTOR_META = Object.freeze([
  { detector_id: "authz-object-level", name: "Object-Level Differential", dimension: "object-level" },
  { detector_id: "authz-function-level", name: "Function-Level Differential", dimension: "function-level" },
  { detector_id: "authz-cross-tenant", name: "Cross-Tenant Differential", dimension: "cross-tenant" },
  { detector_id: "authz-horizontal", name: "Horizontal Role Differential", dimension: "horizontal" },
  { detector_id: "authz-vertical", name: "Vertical Role Differential", dimension: "vertical" },
  { detector_id: "authz-method-drift", name: "Method-Drift Differential", dimension: "method-drift" },
]);

function makeDetector(meta) {
  return freezeRecord({
    detector_id: meta.detector_id,
    name: meta.name,
    version: "0.1.0",
    specialization: "authorization",
    required_capabilities: Object.freeze(["two-identities", "observed-responses", "lab-fixture"]),
    scope_requirements: Object.freeze({ lab_only: true, min_identities: 2 }),
    dimension: meta.dimension,
    execute: async (input = {}) => {
      requireObject(input, "input");
      const result = analyzeComparison({ ...input, dimension: meta.dimension });
      return {
        status: "complete",
        verdict: result.verdict,
        candidate_id: result.candidate ? result.candidate.finding_id : null,
        observation_id: result.observation.observation_id,
        evidence_count: result.evidence.length,
      };
    },
  });
}

export function createAuthorizationDetectors() {
  if (DETECTOR_META.map((m) => m.dimension).sort().join(",") !== [...DIMENSIONS].sort().join(",")) {
    throw new Error("detector set drifted from the closed dimension set");
  }
  return Object.freeze(DETECTOR_META.map(makeDetector));
}
