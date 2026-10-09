/**
 * models/observation.mjs — normalized Observation (§14).
 *
 * An Observation records *what happened* (request + response + surrounding
 * state). It carries a mandatory correlation_id for traceability and — by
 * construction — no verdict: it must never imply that a vulnerability exists.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  optionalString,
  isoNow,
  freezeRecord,
} from "../common.mjs";
import { newId } from "../correlation.mjs";

function optionalSignalArray(v, name) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new SecurityEngineError("MODEL_VALIDATION", `${name} must be an array of strings`);
  }
  return [...v];
}

export function createObservation({
  observation_id,
  correlation_id,
  target_id = null,
  endpoint_id = null,
  identity_id = null,
  request_reference = null,
  response_reference = null,
  timestamp,
  state_before = null,
  state_after = null,
  signals,
  metadata = {},
} = {}) {
  return freezeRecord({
    observation_id:
      observation_id === undefined ? newId("obs") : requireNonEmptyString(observation_id, "observation_id"),
    // Mandatory: an observation that cannot be traced to an execution is useless.
    correlation_id: requireNonEmptyString(correlation_id, "correlation_id"),
    target_id: optionalString(target_id, "target_id"),
    endpoint_id: optionalString(endpoint_id, "endpoint_id"),
    identity_id: optionalString(identity_id, "identity_id"),
    request_reference: optionalString(request_reference, "request_reference"),
    response_reference: optionalString(response_reference, "response_reference"),
    timestamp: timestamp === undefined ? isoNow() : requireNonEmptyString(timestamp, "timestamp"),
    state_before: optionalString(state_before, "state_before"),
    state_after: optionalString(state_after, "state_after"),
    signals: Object.freeze(optionalSignalArray(signals, "signals")),
    metadata: { ...requireObject(metadata, "metadata") },
  });
}
