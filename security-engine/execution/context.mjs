/**
 * execution/context.mjs — authenticated execution context (§5.4, §5.7, §14).
 *
 * Binds one execution to exactly one identity plus one session, with
 * provenance. Downstream components read identity/session FROM the context —
 * never by inferring from cookies, headers, tokens, or response bodies.
 * Attribution is validated up front (binding + usability); an execution
 * whose attribution is unavailable or ambiguous is refused, never guessed.
 * The context carries identifiers only — no secrets, no credential material.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  isoNow,
  freezeRecord,
} from "../common.mjs";
import { newId } from "../correlation.mjs";
import { assertSessionIdentity, isSafeReference } from "../models/identity.mjs";
import { evaluateSessionRecord, usabilityError } from "../session/manager.mjs";

function normalizeSessionProvenance(value) {
  if (value === null || value === undefined) return null;
  requireObject(value, "session_provenance");
  const reference = value.reference === undefined || value.reference === null
    ? null
    : requireNonEmptyString(value.reference, "session_provenance.reference");
  // R3: same opaque-reference policy as everywhere else — provenance must
  // not become a path for free-text/secret-shaped material into contexts.
  if (!isSafeReference(reference)) {
    throw new SecurityEngineError(
      "SECRET_REFUSED",
      "session_provenance.reference must be null or an opaque namespaced reference " +
        "(ref:|vault:|jar:|store:|none:) — raw secrets are never stored"
    );
  }
  return freezeRecord({
    source: requireNonEmptyString(value.source, "session_provenance.source"),
    reference,
  });
}

export function createAuthenticatedContext({
  execution,
  identity,
  session,
  request_reference = null,
  session_provenance = null,
  nowMs = Date.now(),
} = {}) {
  requireObject(execution, "execution");
  const execution_id = requireNonEmptyString(execution.execution_id, "execution.execution_id");
  const correlation_id = requireNonEmptyString(execution.correlation_id, "execution.correlation_id");
  requireObject(identity, "identity");
  const identity_id = requireNonEmptyString(identity.identity_id, "identity.identity_id");
  requireObject(session, "session");
  const session_id = requireNonEmptyString(session.session_id, "session.session_id");

  if (session.identity_id === null || session.identity_id === undefined) {
    throw new SecurityEngineError(
      "MISSING_SESSION",
      `session ${session_id} is not bound to any identity — anonymous execution contexts are prohibited`
    );
  }
  // Reuses the Phase 1 isolation primitive: cross-identity use throws here,
  // before any execution record exists.
  assertSessionIdentity(session, identity_id);

  const usability = evaluateSessionRecord(session, { nowMs });
  if (usability !== "valid") throw usabilityError(identity_id, session_id, usability);

  const prov = normalizeSessionProvenance(session_provenance);
  return freezeRecord({
    context_id: newId("ctx"),
    execution_id,
    correlation_id,
    identity_id,
    session_id,
    request_reference:
      request_reference === null || request_reference === undefined
        ? null
        : requireNonEmptyString(request_reference, "request_reference"),
    provenance: freezeRecord({
      session_source: prov ? prov.source : "unrecorded",
      session_reference: prov ? prov.reference : null,
      context_created_at: isoNow(),
    }),
    created_at: isoNow(),
  });
}

/**
 * Reviewer-facing chain: Execution → Identity → Session → Request/Workflow.
 * Contains stable non-secret identifiers only — traceable without ever
 * inspecting secrets.
 */
export function traceProvenance(context) {
  requireObject(context, "context");
  return freezeRecord({
    execution: requireNonEmptyString(context.execution_id, "context.execution_id"),
    identity: requireNonEmptyString(context.identity_id, "context.identity_id"),
    session: requireNonEmptyString(context.session_id, "context.session_id"),
    request: context.request_reference ?? null,
    correlation: requireNonEmptyString(context.correlation_id, "context.correlation_id"),
  });
}
