/**
 * models/endpoint.mjs — Endpoint contract (§9.2).
 *
 * An Endpoint is one addressable operation on a Target. The contract assumes
 * nothing: authentication_context defaults to "unknown" (never "none"), and
 * nothing marks an endpoint as state-changing — that is a future observation,
 * not a declaration.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  requireEnum,
  freezeRecord,
} from "../common.mjs";
import { newId } from "../correlation.mjs";

const METHODS = /^[A-Z][A-Z0-9_\-]*$/;
export const AUTH_CONTEXTS = Object.freeze(["none", "unknown", "required", "session", "token"]);
export const PARAM_LOCATIONS = Object.freeze(["query", "path", "body", "header", "cookie"]);

function normalizePort(scheme, port) {
  if (port === undefined || port === null || port === "") {
    return scheme === "https" ? 443 : 80;
  }
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new SecurityEngineError("MODEL_VALIDATION", "port must be an integer 1..65535");
  }
  return n;
}

function normalizeParameters(parameters) {
  if (parameters === undefined) return [];
  if (!Array.isArray(parameters)) {
    throw new SecurityEngineError("MODEL_VALIDATION", "parameters must be an array");
  }
  return parameters.map((p, i) => {
    if (!p || typeof p !== "object") {
      throw new SecurityEngineError("MODEL_VALIDATION", `parameters[${i}] must be an object`);
    }
    if ("value" in p) {
      // Fail closed: parameter VALUES are never persisted (they may carry
      // secrets or PII). Callers must declare names/locations only.
      throw new SecurityEngineError(
        "SECRET_REFUSED",
        `parameters[${i}] must not contain a value — names and locations only`
      );
    }
    return Object.freeze({
      name: requireNonEmptyString(p.name, `parameters[${i}].name`),
      location: requireEnum(p.location ?? "query", `parameters[${i}].location`, PARAM_LOCATIONS),
      required: p.required === true,
    });
  });
}

export function createEndpoint({
  endpoint_id,
  target_id = null,
  scheme = "https",
  host,
  port,
  path = "/",
  method = "GET",
  parameters,
  authentication_context = "unknown",
  resource_reference = null,
  metadata = {},
} = {}) {
  const sch = requireEnum(String(scheme).toLowerCase(), "scheme", ["http", "https"]);
  const m = requireNonEmptyString(method, "method").toUpperCase();
  if (!METHODS.test(m)) {
    throw new SecurityEngineError("MODEL_VALIDATION", "method must be a valid HTTP method token");
  }
  return freezeRecord({
    endpoint_id:
      endpoint_id === undefined ? newId("ep") : requireNonEmptyString(endpoint_id, "endpoint_id"),
    target_id: target_id === null || target_id === undefined ? null : requireNonEmptyString(target_id, "target_id"),
    scheme: sch,
    host: requireNonEmptyString(host, "host").toLowerCase(),
    port: normalizePort(sch, port),
    path: requireNonEmptyString(path, "path"),
    method: m,
    parameters: normalizeParameters(parameters),
    authentication_context: requireEnum(authentication_context, "authentication_context", AUTH_CONTEXTS),
    resource_reference:
      resource_reference === null || resource_reference === undefined
        ? null
        : requireNonEmptyString(resource_reference, "resource_reference"),
    metadata: { ...requireObject(metadata, "metadata") },
  });
}
