/**
 * models/finding.mjs — generic security Finding contract (§16).
 *
 * One shape for both future engines. Confidence, impact, and severity are
 * separate validated objects — never collapsed into one score. Lifecycle is
 * explicit (candidate → validated | rejected) and immutable: transitions
 * return a new record with an appended status_history entry. Validation
 * requires evidence + reproduction: a signature match can never become a
 * "validated" finding.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  requireEnum,
  optionalString,
  isoNow,
  freezeRecord,
} from "../common.mjs";
import { newId } from "../correlation.mjs";

export const FINDING_TYPES = Object.freeze(["authorization", "race", "general"]);
export const FINDING_STATUSES = Object.freeze(["candidate", "validated", "rejected"]);
export const LEVELS = Object.freeze(["low", "medium", "high", "critical", "unknown"]);

function requireGraded(obj, name, { scoreRange } = {}) {
  requireObject(obj, name);
  const level = requireEnum(obj.level, `${name}.level`, LEVELS);
  const rationale = requireNonEmptyString(obj.rationale, `${name}.rationale`);
  if (scoreRange) {
    if (typeof obj.score !== "number" || obj.score < 0 || obj.score > 1) {
      throw new SecurityEngineError("MODEL_VALIDATION", `${name}.score must be a number 0..1`);
    }
    if (!Array.isArray(obj.reasons) || obj.reasons.some((r) => typeof r !== "string")) {
      throw new SecurityEngineError("MODEL_VALIDATION", `${name}.reasons must be an array of strings`);
    }
    return Object.freeze({ level, score: obj.score, reasons: Object.freeze([...obj.reasons]), rationale });
  }
  return Object.freeze({ level, rationale });
}

function requireScopeStatus(v) {
  requireObject(v, "scope_status");
  return Object.freeze({
    decision: requireEnum(v.decision, "scope_status.decision", ["allow", "deny", "unknown"]),
    reference: v.reference === undefined || v.reference === null
      ? null
      : requireNonEmptyString(v.reference, "scope_status.reference"),
  });
}

export function createFinding({
  finding_id,
  finding_type,
  title,
  target_id = null,
  endpoint_reference = null,
  identity_references = [],
  resource_reference = null,
  expected_boundary,
  observed_behavior,
  security_relevance,
  state_before = null,
  state_after = null,
  evidence_references = [],
  reproduction_reference = null,
  confidence,
  impact,
  severity,
  scope_status,
  status = "candidate",
  metadata = {},
} = {}) {
  if (!Array.isArray(identity_references) || identity_references.some((r) => typeof r !== "string")) {
    throw new SecurityEngineError("MODEL_VALIDATION", "identity_references must be an array of strings");
  }
  if (!Array.isArray(evidence_references) || evidence_references.some((r) => typeof r !== "string")) {
    throw new SecurityEngineError("MODEL_VALIDATION", "evidence_references must be an array of strings");
  }
  return freezeRecord({
    finding_id: finding_id === undefined ? newId("find") : requireNonEmptyString(finding_id, "finding_id"),
    finding_type: requireEnum(finding_type, "finding_type", FINDING_TYPES),
    title: requireNonEmptyString(title, "title"),
    target_id: optionalString(target_id, "target_id"),
    endpoint_reference: optionalString(endpoint_reference, "endpoint_reference"),
    identity_references: Object.freeze([...identity_references]),
    resource_reference: optionalString(resource_reference, "resource_reference"),
    expected_boundary: requireNonEmptyString(expected_boundary, "expected_boundary"),
    observed_behavior: requireNonEmptyString(observed_behavior, "observed_behavior"),
    security_relevance: requireNonEmptyString(security_relevance, "security_relevance"),
    state_before: optionalString(state_before, "state_before"),
    state_after: optionalString(state_after, "state_after"),
    evidence_references: Object.freeze([...evidence_references]),
    reproduction_reference: optionalString(reproduction_reference, "reproduction_reference"),
    confidence: requireGraded(confidence, "confidence", { scoreRange: true }),
    impact: requireGraded(impact, "impact"),
    severity: requireGraded(severity, "severity"),
    scope_status: requireScopeStatus(scope_status),
    status: requireEnum(status, "status", FINDING_STATUSES),
    status_history: Object.freeze([]),
    metadata: { ...requireObject(metadata, "metadata") },
    created_at: isoNow(),
  });
}

const ALLOWED_TRANSITIONS = Object.freeze({
  candidate: Object.freeze(["validated", "rejected"]),
  validated: Object.freeze([]),
  rejected: Object.freeze([]),
});

export function transitionFinding(finding, next, { reason } = {}) {
  requireObject(finding, "finding");
  const from = requireEnum(finding.status, "finding.status", FINDING_STATUSES);
  const to = requireEnum(next, "next", FINDING_STATUSES);
  const why = requireNonEmptyString(reason, "reason");
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new SecurityEngineError(
      "LIFECYCLE",
      `illegal finding transition ${from} → ${to}`
    );
  }
  if (to === "validated") {
    if (!Array.isArray(finding.evidence_references) || finding.evidence_references.length < 1) {
      throw new SecurityEngineError("LIFECYCLE", "validation requires at least one evidence reference");
    }
    if (!finding.reproduction_reference) {
      throw new SecurityEngineError("LIFECYCLE", "validation requires a reproduction reference");
    }
  }
  return freezeRecord({
    ...finding,
    status: to,
    status_history: Object.freeze([
      ...finding.status_history,
      Object.freeze({ from, to, reason: why, at: isoNow() }),
    ]),
  });
}
