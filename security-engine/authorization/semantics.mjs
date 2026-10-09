/**
 * authorization/semantics.mjs — authorization decision theory (§6, §12).
 *
 * Pure verdict discipline. Three vocabularies, never mixed:
 *   outcomes     — ALLOW | DENY | AMBIGUOUS        (what was observed)
 *   boundary src — explicit-rules | observed-denial | conservative-inference | unknown
 *   verdicts     — WITHIN-BOUNDARY | BOUNDARY-CROSSING | INCONCLUSIVE
 *
 * Hard rules enforced here, not by convention:
 * - 404 and every non-2xx/non-401/non-403 status is AMBIGUOUS (denial by
 *   concealment is indistinguishable from absence — guessing is prohibited).
 * - Unknown boundary source always yields INCONCLUSIVE, never a candidate.
 * - Privileged functions come from an explicit manifest or not at all:
 *   no URL-keyword guessing, ever.
 * - Confidence is evidence-derived from a fixed table; impact and severity
 *   stay "unknown" with rationale (sensitivity/exploitability are not
 *   established at the foundation layer — assigning them would be guessing).
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  requireEnum,
  freezeRecord,
} from "../common.mjs";

export const DIMENSIONS = Object.freeze([
  "object-level",
  "function-level",
  "cross-tenant",
  "horizontal",
  "vertical",
  "method-drift",
]);
export const OUTCOMES = Object.freeze(["ALLOW", "DENY", "AMBIGUOUS"]);
export const VERDICTS = Object.freeze(["WITHIN-BOUNDARY", "BOUNDARY-CROSSING", "INCONCLUSIVE"]);
export const BOUNDARY_SOURCES = Object.freeze([
  "explicit-rules",
  "observed-denial",
  "conservative-inference",
  "unknown",
]);

export function requireDimension(dimension) {
  return requireEnum(dimension, "dimension", DIMENSIONS);
}

/**
 * Classify one observed response. Deliberately coarse: only 2xx is ALLOW,
 * only 401/403 is DENY — everything else (including 404) is AMBIGUOUS.
 */
export function classifyOutcome(response) {
  requireObject(response, "response");
  const status = response.status;
  if (!Number.isInteger(status)) {
    throw new SecurityEngineError("AUTHZ_VALIDATION", "response.status must be an integer");
  }
  if (status >= 200 && status <= 299) return { outcome: "ALLOW", reason: `status=${status} success class` };
  if (status === 401 || status === 403) return { outcome: "DENY", reason: `status=${status} refusal class` };
  return { outcome: "AMBIGUOUS", reason: `status=${status} carries no authorization meaning` };
}

function matchRule(rules, dimension, subject) {
  if (!Array.isArray(rules)) return null;
  for (const rule of rules) {
    if (!rule || typeof rule !== "object" || rule.dimension !== dimension) continue;
    const when = rule.when === undefined || rule.when === null ? {} : rule.when;
    if (typeof when !== "object") continue;
    const ok = Object.entries(when).every(([k, v]) => subject[k] === v);
    if (ok && typeof rule.boundary === "string" && rule.boundary.trim()) return rule.boundary.trim();
  }
  return null;
}

/**
 * Derive the expected boundary for the subject actor. Precedence:
 * explicit-rules > observed-denial > conservative-inference > unknown.
 * Returns { statement|null, source, applies } — applies=false means the
 * comparison cannot be judged and MUST resolve INCONCLUSIVE downstream.
 */
export function deriveExpectedBoundary({
  dimension,
  subject,
  resource = null,
  manifest = null,
  observedDeny = false,
  endpoint_id = null,
} = {}) {
  requireDimension(dimension);
  requireObject(subject, "subject");
  requireNonEmptyString(subject.identity_id, "subject.identity_id");
  requireNonEmptyString(subject.role, "subject.role");
  if (resource !== null && resource !== undefined) requireObject(resource, "resource");
  if (manifest !== null && manifest !== undefined) requireObject(manifest, "manifest");

  const ruleHit = manifest ? matchRule(manifest.rules, dimension, subject) : null;
  if (ruleHit) {
    return { statement: ruleHit, source: "explicit-rules", applies: true };
  }

  if (dimension === "function-level" && manifest && Array.isArray(manifest.privileged_functions)) {
    if (endpoint_id !== null && endpoint_id !== undefined && manifest.privileged_functions.includes(endpoint_id)) {
      return {
        statement: `restricted function ${endpoint_id} — manifest-listed privileged function`,
        source: "explicit-rules",
        applies: true,
      };
    }
  }

  if (observedDeny === true) {
    return {
      statement: "same actor class denied on this function (observed denial)",
      source: "observed-denial",
      applies: true,
    };
  }

  // Conservative inference: exact field mismatches only, never heuristics.
  if ((dimension === "object-level" || dimension === "horizontal") && resource) {
    const owner = resource.owner_identity;
    if (typeof owner === "string" && owner && owner !== subject.identity_id) {
      return {
        statement: `resource owned by ${owner} — owner-only access`,
        source: "conservative-inference",
        applies: true,
      };
    }
  }
  if (dimension === "cross-tenant" && resource) {
    const tenant = resource.tenant_id;
    const actorTenant = subject.tenant_id ?? null;
    if (typeof tenant === "string" && tenant && typeof actorTenant === "string" && actorTenant && tenant !== actorTenant) {
      return { statement: "cross-tenant isolation", source: "conservative-inference", applies: true };
    }
  }
  // function-level without a manifest, vertical without ranks, and
  // method-drift on its own have no honest boundary — unknown by design.
  return { statement: null, source: "unknown", applies: false };
}

/**
 * Judge one dimension. AMBIGUOUS anywhere, or an inapplicable boundary,
 * yields INCONCLUSIVE. Only subject-ALLOW against an applying boundary
 * yields BOUNDARY-CROSSING; subject-DENY is WITHIN-BOUNDARY.
 */
export function evaluateCrossing({ dimension, referenceOutcome, subjectOutcome, boundary } = {}) {
  requireDimension(dimension);
  requireEnum(referenceOutcome, "referenceOutcome", OUTCOMES);
  requireEnum(subjectOutcome, "subjectOutcome", OUTCOMES);
  requireObject(boundary, "boundary");
  requireEnum(boundary.source, "boundary.source", BOUNDARY_SOURCES);
  if (referenceOutcome === "AMBIGUOUS" || subjectOutcome === "AMBIGUOUS") {
    return { verdict: "INCONCLUSIVE", reason: "ambiguous observation cannot be judged" };
  }
  if (boundary.applies !== true || boundary.source === "unknown") {
    return { verdict: "INCONCLUSIVE", reason: "no applicable expected boundary" };
  }
  if (subjectOutcome === "ALLOW") {
    return { verdict: "BOUNDARY-CROSSING", reason: `subject ALLOW against applying boundary (${boundary.source})` };
  }
  return { verdict: "WITHIN-BOUNDARY", reason: "subject denied under an applying boundary" };
}

const CONFIDENCE_BY_SOURCE = Object.freeze({
  "explicit-rules": { score: 0.9, level: "high" },
  "observed-denial": { score: 0.75, level: "medium" },
  "conservative-inference": { score: 0.6, level: "medium" },
});

/** Evidence-derived grading: fixed table, documented reasons, no guessing. */
export function gradeConfidence({ source, dimension } = {}) {
  requireDimension(dimension);
  const row = CONFIDENCE_BY_SOURCE[requireEnum(source, "source", BOUNDARY_SOURCES)];
  if (!row) {
    throw new SecurityEngineError(
      "AUTHZ_VALIDATION",
      "confidence cannot be graded without a known boundary source"
    );
  }
  return freezeRecord({
    level: row.level,
    score: row.score,
    reasons: Object.freeze([
      `two-identity differential on ${dimension}`,
      `expected boundary source: ${source}`,
    ]),
    rationale: "evidence-derived at the foundation layer; no behavioral guessing",
  });
}

export const UNKNOWN_IMPACT = Object.freeze({
  level: "unknown",
  rationale: "data sensitivity is not established at the foundation layer; impact assessment belongs to later review",
});

export const UNKNOWN_SEVERITY = Object.freeze({
  level: "unknown",
  rationale: "exploitability and reachability are not established at the foundation layer",
});
