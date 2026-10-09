/**
 * models/identity.mjs — Identity + Session contracts (§10, §11).
 *
 * Identities are conceptual test actors (User-A, Tenant-B-User, …). Phase 1
 * implements NO login automation: sessions carry opaque *references*
 * (vault:… / jar:… / ref:…) and never raw secrets. Binding is one-time — a
 * session bound to Identity A can never be silently reused as Identity B.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  requireEnum,
  isoNow,
  freezeRecord,
} from "../common.mjs";
import { newId } from "../correlation.mjs";

export const AUTH_METHODS = Object.freeze(["none", "unknown", "cookie", "header", "token-vault", "manual"]);
export const SESSION_STATUSES = Object.freeze(["active", "expired", "revoked"]);

/**
 * Opaque secret references only: null (none) or a namespaced pointer such as
 * "vault:tok-001" / "jar:session-a". Anything resembling an inline secret
 * (whitespace, semicolons, auth schemes) is rejected at the boundary.
 */
const REFERENCE_RE = /^(ref|vault|jar|store|none):[\w:./-]{1,96}$/;

export function isSafeReference(ref) {
  if (ref === null || ref === undefined) return true;
  return typeof ref === "string" && REFERENCE_RE.test(ref);
}

function requireReference(ref, name) {
  if (ref === null || ref === undefined) return null;
  if (typeof ref !== "string" || !REFERENCE_RE.test(ref)) {
    throw new SecurityEngineError(
      "SECRET_REFUSED",
      `${name} must be null or an opaque namespaced reference ` +
        `(ref:|vault:|jar:|store:|none:) — raw secrets are never stored`
    );
  }
  return ref;
}

export function createIdentity({
  identity_id,
  label,
  role = "unknown",
  tenant_id = null,
  authorization_context = {},
  metadata = {},
} = {}) {
  return freezeRecord({
    identity_id:
      identity_id === undefined ? newId("idn") : requireNonEmptyString(identity_id, "identity_id"),
    label: requireNonEmptyString(label, "label"),
    role: requireNonEmptyString(role, "role"),
    tenant_id: tenant_id === null || tenant_id === undefined
      ? null
      : requireNonEmptyString(tenant_id, "tenant_id"),
    authorization_context: { ...requireObject(authorization_context, "authorization_context") },
    metadata: { ...requireObject(metadata, "metadata") },
    created_at: isoNow(),
  });
}

export function createSession({
  session_id,
  identity_id = null,
  target_id = null,
  authentication_method = "none",
  created_at,
  expires_at = null,
  status = "active",
  credential_reference = null,
  cookie_jar_reference = null,
  header_reference = null,
  metadata = {},
} = {}) {
  return freezeRecord({
    session_id:
      session_id === undefined ? newId("ses") : requireNonEmptyString(session_id, "session_id"),
    identity_id: identity_id === null || identity_id === undefined
      ? null
      : requireNonEmptyString(identity_id, "identity_id"),
    target_id: target_id === null || target_id === undefined
      ? null
      : requireNonEmptyString(target_id, "target_id"),
    authentication_method: requireEnum(authentication_method, "authentication_method", AUTH_METHODS),
    created_at: created_at === undefined ? isoNow() : requireNonEmptyString(created_at, "created_at"),
    expires_at: expires_at === null || expires_at === undefined
      ? null
      : requireNonEmptyString(expires_at, "expires_at"),
    status: requireEnum(status, "status", SESSION_STATUSES),
    credential_reference: requireReference(credential_reference, "credential_reference"),
    cookie_jar_reference: requireReference(cookie_jar_reference, "cookie_jar_reference"),
    header_reference: requireReference(header_reference, "header_reference"),
    metadata: { ...requireObject(metadata, "metadata") },
  });
}

/**
 * One-time binding: an unbound session may be bound exactly once. Rebinding
 * to a different identity throws — sessions are never implicitly substituted.
 */
export function bindSession(session, identity) {
  requireObject(session, "session");
  requireObject(identity, "identity");
  const identityId = requireNonEmptyString(identity.identity_id, "identity.identity_id");
  if (session.identity_id === null || session.identity_id === undefined) {
    return freezeRecord({ ...session, identity_id: identityId });
  }
  if (session.identity_id !== identityId) {
    throw new SecurityEngineError(
      "IDENTITY_REBIND",
      `session ${session.session_id} is bound to ${session.identity_id} and cannot be reused as ${identityId}`
    );
  }
  return session;
}

/** Explicit identity check for any operation executed under a session. */
export function assertSessionIdentity(session, identityId) {
  requireObject(session, "session");
  const want = requireNonEmptyString(identityId, "identityId");
  if (session.identity_id !== want) {
    throw new SecurityEngineError(
      "IDENTITY_MISMATCH",
      `session ${session.session_id} belongs to ${session.identity_id ?? "nobody"}, not ${want}`
    );
  }
  return true;
}
