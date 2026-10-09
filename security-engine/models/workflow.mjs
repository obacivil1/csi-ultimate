/**
 * models/workflow.mjs — Workflow / State / Transition contracts (§13).
 *
 * Contracts for future workflow intelligence. No automatic state discovery,
 * no crawling, no inference — just the shapes that later phases will fill.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  requireStringArray,
  optionalString,
  freezeRecord,
} from "../common.mjs";
import { newId } from "../correlation.mjs";

export function createWorkflow({ workflow_id, target_id = null, name, steps = [], metadata = {} } = {}) {
  if (!Array.isArray(steps)) {
    throw new SecurityEngineError("MODEL_VALIDATION", "steps must be an array");
  }
  const normSteps = steps.map((s, i) => {
    if (!s || typeof s !== "object") {
      throw new SecurityEngineError("MODEL_VALIDATION", `steps[${i}] must be an object`);
    }
    return Object.freeze({
      order: Number.isInteger(s.order) ? s.order : i,
      name: requireNonEmptyString(s.name, `steps[${i}].name`),
      endpoint_reference: s.endpoint_reference === undefined || s.endpoint_reference === null
        ? null
        : requireNonEmptyString(s.endpoint_reference, `steps[${i}].endpoint_reference`),
    });
  });
  return freezeRecord({
    workflow_id:
      workflow_id === undefined ? newId("wfl") : requireNonEmptyString(workflow_id, "workflow_id"),
    target_id: target_id === null || target_id === undefined
      ? null
      : requireNonEmptyString(target_id, "target_id"),
    name: requireNonEmptyString(name, "name"),
    steps: Object.freeze(normSteps),
    metadata: { ...requireObject(metadata, "metadata") },
  });
}

export function createState({ state_id, workflow_id = null, name, indicators = [], metadata = {} } = {}) {
  return freezeRecord({
    state_id: state_id === undefined ? newId("stt") : requireNonEmptyString(state_id, "state_id"),
    workflow_id: workflow_id === null || workflow_id === undefined
      ? null
      : requireNonEmptyString(workflow_id, "workflow_id"),
    name: requireNonEmptyString(name, "name"),
    indicators: Object.freeze(requireStringArray(indicators, "indicators")),
    metadata: { ...requireObject(metadata, "metadata") },
  });
}

export function createTransition({
  transition_id,
  from_state,
  to_state,
  trigger_request = null,
  preconditions = [],
  postconditions = [],
  metadata = {},
} = {}) {
  return freezeRecord({
    transition_id:
      transition_id === undefined ? newId("trn") : requireNonEmptyString(transition_id, "transition_id"),
    from_state: requireNonEmptyString(from_state, "from_state"),
    to_state: requireNonEmptyString(to_state, "to_state"),
    trigger_request: optionalString(trigger_request, "trigger_request"),
    preconditions: Object.freeze(requireStringArray(preconditions, "preconditions")),
    postconditions: Object.freeze(requireStringArray(postconditions, "postconditions")),
    metadata: { ...requireObject(metadata, "metadata") },
  });
}
