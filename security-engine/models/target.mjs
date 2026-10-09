/**
 * models/target.mjs — Target contract (§9.1).
 *
 * A Target names *where* testing may happen. It deliberately carries an
 * explicit authorization_status: the model must never silently imply that
 * testing a target is authorized. The scope gate (§18) is the only component
 * allowed to turn authorization context into an allow decision.
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

export const ENVIRONMENTS = Object.freeze(["lab", "staging", "production", "unknown"]);
export const AUTHORIZATION_STATUSES = Object.freeze([
  "unknown",
  "pending",
  "authorized",
  "expired",
  "denied",
]);

export function createTarget({
  target_id,
  base_url,
  scope_reference = null,
  environment = "unknown",
  authorization_status = "unknown",
  metadata = {},
} = {}) {
  const raw = requireNonEmptyString(base_url, "base_url");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SecurityEngineError("MODEL_VALIDATION", "base_url must be a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SecurityEngineError("MODEL_VALIDATION", "base_url must use http or https");
  }
  return freezeRecord({
    target_id: target_id === undefined ? newId("tgt") : requireNonEmptyString(target_id, "target_id"),
    base_url: parsed.href,
    host: parsed.hostname.toLowerCase(),
    scope_reference:
      scope_reference === null || scope_reference === undefined
        ? null
        : requireNonEmptyString(scope_reference, "scope_reference"),
    environment: requireEnum(environment, "environment", ENVIRONMENTS),
    // Explicit by design: "unknown" authorizes nothing.
    authorization_status: requireEnum(authorization_status, "authorization_status", AUTHORIZATION_STATUSES),
    metadata: { ...requireObject(metadata, "metadata") },
    created_at: isoNow(),
  });
}
