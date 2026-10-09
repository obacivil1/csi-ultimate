/**
 * session/manager.mjs — session registry + lifecycle (§5.2, §5.3, §5.5).
 *
 * Reuses Phase 1 session records and isolation primitives (opaque
 * references, bindSession, assertSessionIdentity) — no parallel mechanism.
 * Adds what Phase 1 deliberately left out: a registry with provenance,
 * explicit resolution (one identity's session is never silently another's),
 * usability evaluation (valid | expired | invalidated | unusable), and
 * explicit invalidation. Anonymous session pools are prohibited: only
 * sessions already bound to exactly one identity may be registered.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  isoNow,
  freezeRecord,
} from "../common.mjs";
import { createSession, isSafeReference } from "../models/identity.mjs";

export const SESSION_USABILITY = Object.freeze(["valid", "expired", "invalidated", "unusable"]);

/**
 * Record-level usability — pure, shared by the manager and the execution
 * context so both judge usability by exactly one rule.
 */
export function evaluateSessionRecord(record, { nowMs = Date.now() } = {}) {
  requireObject(record, "session");
  // R1: the evaluation clock must be a finite number. Anything else
  // (NaN, strings, objects, null, Infinity) previously made `nowMs > exp`
  // false and let expired sessions evaluate as "valid" — fail-open.
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    throw new SecurityEngineError(
      "CLOCK_INVALID",
      "session-usability clock must be a finite number"
    );
  }
  if (record.status === "revoked") return "invalidated";
  if (record.status === "expired") return "expired";
  if (record.status !== "active") return "unusable";
  if (record.expires_at !== null && record.expires_at !== undefined) {
    const exp = Date.parse(record.expires_at);
    if (Number.isNaN(exp)) return "unusable";
    if (nowMs > exp) return "expired";
  }
  return "valid";
}

export function usabilityError(identityId, sessionId, usability) {
  const where = `identity ${identityId} session ${sessionId}`;
  if (usability === "expired") {
    return new SecurityEngineError("SESSION_EXPIRED", `${where} is expired and cannot execute`);
  }
  if (usability === "invalidated") {
    return new SecurityEngineError("SESSION_INVALIDATED", `${where} was invalidated and cannot execute`);
  }
  return new SecurityEngineError("SESSION_UNUSABLE", `${where} is in state ${usability} and cannot execute`);
}

function normalizeProvenance(provenance) {
  if (provenance === null || provenance === undefined) {
    return freezeRecord({ source: "configured", reference: null, registered_at: isoNow() });
  }
  requireObject(provenance, "provenance");
  const reference = provenance.reference === undefined || provenance.reference === null
    ? null
    : requireNonEmptyString(provenance.reference, "provenance.reference");
  // R3: provenance references obey the same opaque-reference policy as
  // credential references — no free-text/secret-shaped material persists.
  if (!isSafeReference(reference)) {
    throw new SecurityEngineError(
      "SECRET_REFUSED",
      "provenance.reference must be null or an opaque namespaced reference " +
        "(ref:|vault:|jar:|store:|none:) — raw secrets are never stored"
    );
  }
  return freezeRecord({
    source: requireNonEmptyString(provenance.source, "provenance.source"),
    reference,
    registered_at: isoNow(),
  });
}

export function createSessionManager({ nowMs = null } = {}) {
  const clock = typeof nowMs === "function" ? nowMs : () => Date.now();
  // identity_id -> Array<{ session, provenance }> (insertion order kept;
  // resolution across several sessions requires an explicit sessionId).
  const byIdentity = new Map();
  // session_id -> identity_id (global uniqueness: one session, one owner).
  const bySession = new Map();

  function entryFor(identityId, sessionId) {
    const entries = byIdentity.get(identityId) || [];
    return entries.find((e) => e.session.session_id === sessionId) || null;
  }

  return {
    register(session, { provenance = null } = {}) {
      requireObject(session, "session");
      const sid = requireNonEmptyString(session.session_id, "session.session_id");
      const iid = session.identity_id;
      if (typeof iid !== "string" || !iid.trim()) {
        throw new SecurityEngineError(
          "SESSION_UNBOUND",
          `session ${sid} is not bound to any identity — anonymous session pools are prohibited`
        );
      }
      if (bySession.has(sid)) {
        throw new SecurityEngineError("SESSION_DUPLICATE", `session ${sid} is already registered`);
      }
      const entry = freezeRecord({ session, provenance: normalizeProvenance(provenance) });
      if (!byIdentity.has(iid)) byIdentity.set(iid, []);
      byIdentity.get(iid).push(entry);
      bySession.set(sid, iid);
      return entry;
    },

    /**
     * Explicit resolution. With several sessions under one identity the
     * caller must name one — the manager never silently picks among them.
     */
    resolve(identityId, { sessionId = null } = {}) {
      const iid = requireNonEmptyString(identityId, "identityId");
      const entries = byIdentity.get(iid) || [];
      if (entries.length === 0) {
        throw new SecurityEngineError(
          "MISSING_SESSION",
          `identity ${iid} has no registered session — refusing to substitute any other session`
        );
      }
      if (sessionId === null || sessionId === undefined) {
        if (entries.length > 1) {
          throw new SecurityEngineError(
            "AMBIGUOUS_SESSION",
            `identity ${iid} holds ${entries.length} sessions — an explicit sessionId is required`
          );
        }
        return entries[0];
      }
      const sid = requireNonEmptyString(sessionId, "sessionId");
      const entry = entryFor(iid, sid);
      if (entry) return entry;
      if (bySession.has(sid)) {
        throw new SecurityEngineError(
          "IDENTITY_SESSION_MISMATCH",
          `session ${sid} belongs to ${bySession.get(sid)}, not ${iid}`
        );
      }
      throw new SecurityEngineError(
        "MISSING_SESSION",
        `identity ${iid} has no session ${sid}`
      );
    },

    evaluate(identityId, { sessionId = null, nowMs: at = null } = {}) {
      const entry = this.resolve(identityId, { sessionId });
      return evaluateSessionRecord(entry.session, { nowMs: at === null ? clock() : at });
    },

    /** Resolution + usability in one explicit step; anything unusable throws. */
    requireUsable(identityId, { sessionId = null, nowMs: at = null } = {}) {
      const iid = requireNonEmptyString(identityId, "identityId");
      const entry = this.resolve(iid, { sessionId });
      const usability = evaluateSessionRecord(entry.session, { nowMs: at === null ? clock() : at });
      if (usability !== "valid") throw usabilityError(iid, entry.session.session_id, usability);
      return entry;
    },

    provenanceOf(identityId, { sessionId = null } = {}) {
      return this.resolve(identityId, { sessionId }).provenance;
    },

    invalidate(identityId, { sessionId = null, reason } = {}) {
      const why = requireNonEmptyString(reason, "reason");
      const entry = this.resolve(identityId, { sessionId });
      const revoked = createSession({ ...entry.session, status: "revoked" });
      const next = freezeRecord({
        session: revoked,
        provenance: freezeRecord({
          ...entry.provenance,
          invalidated_at: isoNow(),
          invalidation_reason: why,
        }),
      });
      const entries = byIdentity.get(entry.session.identity_id ?? identityId);
      entries[entries.indexOf(entry)] = next;
      return next;
    },

    size() {
      return bySession.size;
    },

    clear() {
      byIdentity.clear();
      bySession.clear();
    },
  };
}
