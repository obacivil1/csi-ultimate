/**
 * adapters/http.mjs — HTTP adapter (§23).
 *
 * Pure mappers between security-engine Request/Response models and a
 * transport shape. They perform NO network I/O and attach NO credentials:
 * toTransportDescriptor() emits a descriptor only (existing clients will do
 * the sending in later phases); fromTransportResult() folds a completed
 * result back into a secret-safe SecurityResponse.
 */
import { requireObject, requireNonEmptyString } from "../common.mjs";
import { createSecurityResponse } from "../models/http.mjs";

export function toTransportDescriptor(securityRequest) {
  requireObject(securityRequest, "securityRequest");
  const method = requireNonEmptyString(securityRequest.method, "securityRequest.method");
  const url = requireNonEmptyString(securityRequest.url, "securityRequest.url");
  const headerNames = Array.isArray(securityRequest.headers_metadata)
    ? securityRequest.headers_metadata.map((h) => h.name)
    : [];
  const parameterNames = Array.isArray(securityRequest.parameters_metadata)
    ? securityRequest.parameters_metadata.map((p) => `${p.location}:${p.name}`)
    : [];
  return Object.freeze({
    method,
    url,
    header_names: Object.freeze(headerNames),
    parameter_names: Object.freeze(parameterNames),
    identity_reference: securityRequest.identity_reference ?? null,
    transport_policy: Object.freeze({
      attachCredentials: false,
      reason:
        "Phase 1 descriptors never carry secrets; credential binding belongs to future session-aware senders",
    }),
  });
}

export function fromTransportResult(result, { request_id = null, correlation_id = null } = {}) {
  requireObject(result, "result");
  if (!Number.isInteger(result.status)) {
    throw new Error("result.status must be an integer");
  }
  const body = result.body === undefined ? null : result.body;
  const timing = result.timing_ms !== undefined ? result.timing_ms : result.timingMs;
  const indicators = result.state_indicators !== undefined ? result.state_indicators : result.stateIndicators;
  return createSecurityResponse({
    request_id,
    correlation_id,
    status: result.status,
    headers: result.headers ?? [],
    body,
    content_type: result.content_type !== undefined ? result.content_type : result.contentType,
    timing_ms: timing === undefined ? null : timing,
    state_indicators: indicators === undefined ? [] : indicators,
  });
}
