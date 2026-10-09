/**
 * race/bindings.mjs — fixture-owned operation bindings (H1/R1).
 *
 * Tripartition, enforced at registration time:
 *   operation metadata — routable description (endpoint + method + names);
 *   executable bindings — fixture-owned concrete values (validated here);
 *   credential material — opaque Phase 2 references only (never values).
 *
 * Bindings must be fixture-owned, deterministic, lab-safe, explicitly
 * declared, and pre-validated. Parameter names that look like secrets are
 * refused (Phase 1 SENSITIVE_KEYS policy); values must be primitives
 * (strings/numbers/booleans) so nothing executable or secret-shaped hides
 * inside. Missing or invalid bindings → EXECUTION_UNAVAILABLE.
 *
 * Transport policy (R1): `transport.retries` MUST be exactly 0. Retry-enabled
 * transports are rejected at registration — race runs are structurally
 * incapable of inheriting automatic retries.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  isSensitiveKey,
  freezeRecord,
} from "../common.mjs";

const METHOD_RE = /^[A-Z][A-Z0-9_\-]*$/;

export function validateOperationDescriptor(operation) {
  requireObject(operation, "operation");
  const endpoint_id = requireNonEmptyString(operation.endpoint_id, "operation.endpoint_id");
  const method = requireNonEmptyString(operation.method, "operation.method").toUpperCase();
  if (!METHOD_RE.test(method)) {
    throw new SecurityEngineError("BINDING_INVALID", "operation.method must be a valid HTTP method token");
  }
  let params = [];
  if (operation.params_metadata !== undefined) {
    if (!Array.isArray(operation.params_metadata)) {
      throw new SecurityEngineError("BINDING_INVALID", "operation.params_metadata must be an array");
    }
    params = operation.params_metadata.map((p, i) => {
      if (!p || typeof p !== "object" || "value" in p) {
        throw new SecurityEngineError(
          "BINDING_INVALID",
          `operation.params_metadata[${i}] declares name/location only — values live in bindings`
        );
      }
      return Object.freeze({
        name: requireNonEmptyString(p.name, `operation.params_metadata[${i}].name`),
        location: requireNonEmptyString(p.location ?? "query", `operation.params_metadata[${i}].location`),
      });
    });
  }
  return freezeRecord({ endpoint_id, method, params_metadata: Object.freeze(params) });
}

export function validateOperationBindings({ descriptor, bindings, transport } = {}) {
  const normalized = validateOperationDescriptor(descriptor);
  if (bindings === null || bindings === undefined) {
    throw new SecurityEngineError(
      "EXECUTION_UNAVAILABLE",
      "missing fixture-owned bindings — the engine invents no parameter values"
    );
  }
  requireObject(bindings, "bindings");
  const clean = {};
  for (const [name, value] of Object.entries(bindings)) {
    if (!name || typeof name !== "string") {
      throw new SecurityEngineError("BINDING_INVALID", "binding names must be non-empty strings");
    }
    if (isSensitiveKey(name)) {
      throw new SecurityEngineError(
        "SECRET_REFUSED",
        `binding "${name}" looks like credential material — opaque references only, never values`
      );
    }
    if (value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value) === false) {
      throw new SecurityEngineError(
        "BINDING_INVALID",
        `binding "${name}" must be a string, number, or boolean`
      );
    }
    clean[name] = value;
  }
  for (const p of normalized.params_metadata) {
    if (!(p.name in clean)) {
      throw new SecurityEngineError(
        "EXECUTION_UNAVAILABLE",
        `binding for declared parameter "${p.name}" is absent`
      );
    }
  }
  requireObject(transport, "transport");
  if (transport.retries !== 0) {
    throw new SecurityEngineError(
      "BINDING_INVALID",
      "transport.retries must be exactly 0 — retry-enabled transports are rejected for race runs"
    );
  }
  return freezeRecord({
    descriptor: normalized,
    bindings: Object.freeze({ ...clean }),
    transport: Object.freeze({ retries: 0 }),
  });
}
