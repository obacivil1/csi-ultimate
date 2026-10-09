/**
 * models/http.mjs — Security Request / Response contracts (§9.3, §9.4).
 *
 * Secret-safety is structural, not advisory:
 * - headers are stored as NAMES only (values never persisted);
 * - request/response bodies are stored as HASH + LENGTH only;
 * - identity linkage uses opaque references, never credentials.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  optionalString,
  requireStringArray,
  headersToMetadata,
  sha256Hex,
  isoNow,
  freezeRecord,
} from "../common.mjs";
import { newId } from "../correlation.mjs";

function normalizeUrl(raw, name) {
  const s = requireNonEmptyString(raw, name);
  let parsed;
  try {
    parsed = new URL(s);
  } catch {
    throw new SecurityEngineError("MODEL_VALIDATION", `${name} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SecurityEngineError("MODEL_VALIDATION", `${name} must use http or https`);
  }
  return parsed.href;
}

export function createSecurityRequest({
  request_id,
  correlation_id = null,
  endpoint_id = null,
  method,
  url,
  headers,
  parameters,
  body = null,
  identity_reference = null,
  timestamp,
} = {}) {
  const m = requireNonEmptyString(method, "method").toUpperCase();
  let bodyHash = null;
  let bodyLength = null;
  if (body !== null && body !== undefined) {
    if (typeof body !== "string") {
      throw new SecurityEngineError("MODEL_VALIDATION", "body must be a string when provided");
    }
    bodyHash = sha256Hex(body);
    bodyLength = Buffer.byteLength(body, "utf8");
  }
  let parametersMetadata = [];
  if (parameters !== undefined) {
    if (!Array.isArray(parameters)) {
      throw new SecurityEngineError("MODEL_VALIDATION", "parameters must be an array");
    }
    parametersMetadata = parameters.map((p, i) => {
      if (!p || typeof p !== "object" || "value" in p) {
        throw new SecurityEngineError(
          "SECRET_REFUSED",
          `parameters[${i}] must declare name/location only — values are never stored`
        );
      }
      return Object.freeze({
        name: requireNonEmptyString(p.name, `parameters[${i}].name`),
        location: requireNonEmptyString(p.location ?? "query", `parameters[${i}].location`),
      });
    });
  }
  return freezeRecord({
    request_id: request_id === undefined ? newId("req") : requireNonEmptyString(request_id, "request_id"),
    correlation_id: correlation_id === null || correlation_id === undefined
      ? null
      : requireNonEmptyString(correlation_id, "correlation_id"),
    endpoint_id: endpoint_id === null || endpoint_id === undefined
      ? null
      : requireNonEmptyString(endpoint_id, "endpoint_id"),
    method: m,
    url: normalizeUrl(url, "url"),
    headers_metadata: Object.freeze(headersToMetadata(headers)),
    parameters_metadata: Object.freeze(parametersMetadata),
    body_hash: bodyHash,
    body_length: bodyLength,
    identity_reference:
      identity_reference === null || identity_reference === undefined
        ? null
        : requireNonEmptyString(identity_reference, "identity_reference"),
    timestamp: timestamp === undefined ? isoNow() : requireNonEmptyString(timestamp, "timestamp"),
  });
}

export function createSecurityResponse({
  response_id,
  request_id = null,
  correlation_id = null,
  status,
  headers,
  body = null,
  content_type = null,
  timing_ms = null,
  state_indicators = [],
  timestamp,
} = {}) {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new SecurityEngineError("MODEL_VALIDATION", "status must be an integer 100..599");
  }
  if (timing_ms !== null && timing_ms !== undefined && !(typeof timing_ms === "number" && timing_ms >= 0)) {
    throw new SecurityEngineError("MODEL_VALIDATION", "timing_ms must be a non-negative number");
  }
  let bodyHash = null;
  let bodyLength = null;
  if (body !== null && body !== undefined) {
    if (typeof body !== "string") {
      throw new SecurityEngineError("MODEL_VALIDATION", "body must be a string when provided");
    }
    bodyHash = sha256Hex(body);
    bodyLength = Buffer.byteLength(body, "utf8");
  }
  return freezeRecord({
    response_id:
      response_id === undefined ? newId("rsp") : requireNonEmptyString(response_id, "response_id"),
    request_id: request_id === null || request_id === undefined
      ? null
      : requireNonEmptyString(request_id, "request_id"),
    correlation_id: correlation_id === null || correlation_id === undefined
      ? null
      : requireNonEmptyString(correlation_id, "correlation_id"),
    status,
    headers_metadata: Object.freeze(headersToMetadata(headers)),
    body_hash: bodyHash,
    body_length: bodyLength,
    content_type: optionalString(content_type, "content_type"),
    timing_ms: timing_ms ?? null,
    state_indicators: Object.freeze(requireStringArray(state_indicators, "state_indicators")),
    timestamp: timestamp === undefined ? isoNow() : requireNonEmptyString(timestamp, "timestamp"),
  });
}
