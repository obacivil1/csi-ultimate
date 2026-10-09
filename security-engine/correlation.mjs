/**
 * correlation.mjs — correlation / execution / entity identifiers (Phase 1).
 *
 * Every security execution, request observation, evidence item, and finding
 * must be traceable to a correlation context (§17). IDs combine a readable
 * prefix, millisecond time, a process counter, and cryptographic randomness:
 * deterministic enough for traceability, unique enough to prevent collisions.
 * Pure — no I/O.
 */
import { randomHex } from "./common.mjs";
import { requireNonEmptyString } from "./common.mjs";

let counter = 0;

export function newId(prefix) {
  const clean = requireNonEmptyString(prefix, "prefix").replace(/[^a-z0-9]/gi, "").toLowerCase() || "id";
  counter += 1;
  return `${clean}_${Date.now().toString(36)}_${counter.toString(36)}_${randomHex(4)}`;
}

export const newCorrelationId = () => newId("corr");
export const newExecutionId = () => newId("exec");
export const newRequestId = () => newId("req");
export const newObservationId = () => newId("obs");
export const newEvidenceId = () => newId("ev");
export const newFindingId = () => newId("find");

/** Fresh trace context for one security execution. */
export function newTrace() {
  return { correlation_id: newCorrelationId(), execution_id: newExecutionId() };
}
