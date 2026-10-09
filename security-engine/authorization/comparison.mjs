/**
 * authorization/comparison.mjs — multi-identity differential analysis (§5).
 *
 * Pure analysis over already-observed executions: this module performs NO
 * network I/O and sends NO requests. Each side of a comparison is
 * { actor, context, response }: the actor states who is tested, the Phase 2
 * context proves it (or an explicitly opted-in anonymous baseline for the
 * subject side only), and the Phase 1 response is what was observed.
 *
 * Secret rule for everything composed here: engine-written strings embed
 * ONLY fixed vocabulary, integers, counts, truncated hashes, and stable
 * identifiers. Response-derived free text (indicator values, header values,
 * bodies) is never embedded — counts and hashes stand in for it.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  sha256Hex,
  freezeRecord,
} from "../common.mjs";
import { newCorrelationId } from "../correlation.mjs";
import { createObservation } from "../models/observation.mjs";
import { createEvidence } from "../models/evidence.mjs";
import { createFinding } from "../models/finding.mjs";
import {
  requireDimension,
  classifyOutcome,
  deriveExpectedBoundary,
  evaluateCrossing,
  gradeConfidence,
  UNKNOWN_IMPACT,
  UNKNOWN_SEVERITY,
} from "./semantics.mjs";

function shortHash(value) {
  if (typeof value !== "string" || !value) return "none";
  return sha256Hex(value).slice(0, 16);
}

function stateDigest(response) {
  const indicators = Array.isArray(response?.state_indicators) ? response.state_indicators.length : 0;
  return `indicators=${indicators} body=${shortHash(response?.body_hash || "")}`;
}

function normalizeActor(actor, name) {
  requireObject(actor, name);
  return {
    identity_id: requireNonEmptyString(actor.identity_id, `${name}.identity_id`),
    role: requireNonEmptyString(actor.role, `${name}.role`),
    tenant_id: actor.tenant_id === undefined || actor.tenant_id === null
      ? null
      : requireNonEmptyString(actor.tenant_id, `${name}.tenant_id`),
  };
}

function normalizeSide(side, name, { allowAnonymous }) {
  requireObject(side, name);
  const actor = normalizeActor(side.actor, `${name}.actor`);
  requireObject(side.response, `${name}.response`);
  const context = side.context === undefined || side.context === null ? null : side.context;
  if (context === null) {
    if (actor.role !== "anonymous" || allowAnonymous !== true) {
      throw new SecurityEngineError(
        "ANONYMOUS_NOT_ALLOWED",
        `${name} has no execution context: anonymous observation requires role "anonymous" plus explicit opt-in`
      );
    }
    return { actor, context: null, response: side.response, request_id: side.request_id ?? null };
  }
  requireObject(context, `${name}.context`);
  const ctxIdentity = requireNonEmptyString(context.identity_id, `${name}.context.identity_id`);
  const ctxSession = context.session_id ?? null;
  if (typeof ctxSession !== "string" || !ctxSession) {
    throw new SecurityEngineError("INVALID_CONTEXT", `${name}.context carries no session attribution`);
  }
  if (ctxIdentity !== actor.identity_id) {
    throw new SecurityEngineError(
      "CONTEXT_ACTOR_MISMATCH",
      `${name} context belongs to ${ctxIdentity}, not ${actor.identity_id}`
    );
  }
  return {
    actor,
    context,
    response: side.response,
    request_id: side.request_id === undefined || side.request_id === null
      ? null
      : requireNonEmptyString(side.request_id, `${name}.request_id`),
  };
}

/**
 * Run one closed-set comparison. Returns { verdict, reason, boundary,
 * observation, evidence[], candidate|null, correlation_id } — all frozen.
 * A candidate is created ONLY on BOUNDARY-CROSSING with a complete pack,
 * and always at lifecycle status "candidate" (never auto-validated).
 */
export function analyzeComparison({
  dimension,
  reference,
  subject,
  resource = null,
  manifest = null,
  observedDeny = false,
  endpoint_id = null,
  target_id = null,
  scope = null,
  allowAnonymousSubject = false,
  correlation_id = null,
} = {}) {
  requireDimension(dimension);
  if (resource !== null && resource !== undefined) requireObject(resource, "resource");
  if (manifest !== null && manifest !== undefined) requireObject(manifest, "manifest");
  const ref = normalizeSide(reference, "reference", { allowAnonymous: false });
  if (ref.context === null) {
    throw new SecurityEngineError("ANONYMOUS_NOT_ALLOWED", "the reference side must be authenticated");
  }
  const sub = normalizeSide(subject, "subject", { allowAnonymous: allowAnonymousSubject });

  const refOut = classifyOutcome(ref.response);
  const subOut = classifyOutcome(sub.response);
  const boundary = deriveExpectedBoundary({
    dimension,
    subject: sub.actor,
    resource,
    manifest,
    observedDeny,
    endpoint_id,
  });
  const { verdict, reason } = evaluateCrossing({
    dimension,
    referenceOutcome: refOut.outcome,
    subjectOutcome: subOut.outcome,
    boundary,
  });

  const runCorr = correlation_id === null || correlation_id === undefined
    ? newCorrelationId()
    : requireNonEmptyString(correlation_id, "correlation_id");
  const refRespId = typeof ref.response.response_id === "string" ? ref.response.response_id : null;
  const subRespId = typeof sub.response.response_id === "string" ? sub.response.response_id : null;

  const observation = createObservation({
    correlation_id: runCorr,
    target_id,
    endpoint_id,
    identity_id: sub.actor.identity_id,
    request_reference: sub.request_id,
    response_reference: subRespId,
    state_before: `reference ${stateDigest(ref.response)}`,
    state_after: `subject ${stateDigest(sub.response)}`,
    signals: Object.freeze([
      `dimension:${dimension}`,
      `reference:${refOut.outcome}`,
      `subject:${subOut.outcome}`,
      `boundary:${boundary.source}`,
      `verdict:${verdict}`,
    ]),
    metadata: {
      dimension,
      boundary_statement: boundary.statement,
      boundary_source: boundary.source,
      reference_actor: ref.actor.identity_id,
      subject_actor: sub.actor.identity_id,
      reference_response: refRespId,
      subject_response: subRespId,
      reference_context: ref.context.context_id ?? null,
      subject_context: sub.context ? sub.context.context_id ?? null : null,
    },
  });

  const statusLine = (o, r) => `${o}(${r.status})`;
  const differential = createEvidence({
    observation_id: observation.observation_id,
    type: "hash-only",
    description:
      `dimension=${dimension} ` +
      `reference=${statusLine(refOut.outcome, ref.response)} ` +
      `subject=${statusLine(subOut.outcome, sub.response)} ` +
      `boundary-source=${boundary.source} verdict=${verdict}`,
    redaction_status: "hash-only",
  });
  const provenance = createEvidence({
    observation_id: observation.observation_id,
    type: "reference",
    reference: sub.context ? `ctx:${sub.context.context_id ?? sub.actor.identity_id}` : "baseline:anonymous",
    description: `execution provenance trace for ${sub.actor.identity_id} via ${ref.actor.identity_id} baseline`,
    redaction_status: "hash-only",
  });
  const evidence = [differential, provenance];

  let candidate = null;
  if (verdict === "BOUNDARY-CROSSING") {
    const boundaryEv = createEvidence({
      observation_id: observation.observation_id,
      type: "reference",
      reference: `boundary:${boundary.source}:${dimension}`,
      description: `applying boundary from ${boundary.source} on ${dimension}`,
      redaction_status: "hash-only",
    });
    evidence.push(boundaryEv);
    candidate = createFinding({
      finding_type: "authorization",
      title: `Possible ${dimension} boundary crossing (${sub.actor.role} on ${resource?.resource_id ?? "target resource"})`,
      target_id,
      endpoint_reference: endpoint_id,
      identity_references: [sub.actor.identity_id, ref.actor.identity_id],
      resource_reference: resource?.resource_id ?? null,
      expected_boundary: boundary.statement,
      observed_behavior:
        `subject ${statusLine(subOut.outcome, sub.response)} ` +
        `vs reference ${statusLine(refOut.outcome, ref.response)} on ${dimension}`,
      security_relevance:
        `Differential points to a ${dimension} boundary crossing (boundary source: ${boundary.source}). ` +
        `Foundation-layer candidacy only — impact and exploitability are not established.`,
      state_before: `reference ${stateDigest(ref.response)}`,
      state_after: `subject ${stateDigest(sub.response)}`,
      evidence_references: evidence.map((e) => e.evidence_id),
      reproduction_reference: null,
      confidence: gradeConfidence({ source: boundary.source, dimension }),
      impact: { ...UNKNOWN_IMPACT },
      severity: { ...UNKNOWN_SEVERITY },
      scope_status: scope === null || scope === undefined ? { decision: "unknown" } : scope,
    });
  }

  return freezeRecord({
    verdict,
    reason,
    boundary: freezeRecord({ source: boundary.source, applies: boundary.applies }),
    observation,
    evidence: Object.freeze(evidence),
    candidate,
    correlation_id: runCorr,
  });
}
