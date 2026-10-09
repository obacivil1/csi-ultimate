/**
 * models/resource.mjs — Resource / Object abstraction (§12).
 *
 * A Resource is anything with an identity boundary worth testing later:
 * ownership, tenant isolation, role boundaries, object identifiers, state.
 * This file declares the shape only — no BOLA/ownership analysis lives here.
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

export function createResource({
  resource_id,
  resource_type,
  external_identifier = null,
  owner_identity = null,
  tenant_id = null,
  endpoint_references = [],
  state_reference = null,
  metadata = {},
} = {}) {
  if (!Array.isArray(endpoint_references)) {
    throw new SecurityEngineError("MODEL_VALIDATION", "endpoint_references must be an array");
  }
  return freezeRecord({
    resource_id:
      resource_id === undefined ? newId("res") : requireNonEmptyString(resource_id, "resource_id"),
    resource_type: requireNonEmptyString(resource_type, "resource_type"),
    external_identifier: optionalString(external_identifier, "external_identifier"),
    owner_identity: owner_identity === null || owner_identity === undefined
      ? null
      : requireNonEmptyString(owner_identity, "owner_identity"),
    tenant_id: tenant_id === null || tenant_id === undefined
      ? null
      : requireNonEmptyString(tenant_id, "tenant_id"),
    endpoint_references: Object.freeze(requireStringArray(endpoint_references, "endpoint_references")),
    state_reference: optionalString(state_reference, "state_reference"),
    metadata: { ...requireObject(metadata, "metadata") },
  });
}
