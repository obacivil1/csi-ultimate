/**
 * models/evidence.mjs — first-class Evidence abstraction (§15).
 *
 * Evidence is always traceable to an observation. Full bodies are never
 * stored: excerpts are bounded (512 chars) and truncation is explicit
 * (truncated=true) with the hash of the FULL source preserved. Silent
 * truncation is a model violation, not a default.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  optionalString,
  requireEnum,
  sha256Hex,
  freezeRecord,
} from "../common.mjs";
import { newId } from "../correlation.mjs";

export const EVIDENCE_TYPES = Object.freeze(["hash-only", "redacted-excerpt", "reference", "metadata"]);
export const REDACTION_STATUSES = Object.freeze(["hash-only", "redacted", "clear"]);
export const EXCERPT_LIMIT = 512;

export function createEvidence({
  evidence_id,
  observation_id,
  type,
  description = null,
  reference = null,
  hash = null,
  redaction_status = "hash-only",
  metadata = {},
} = {}) {
  const obsId = requireNonEmptyString(observation_id, "observation_id");
  const kind = requireEnum(type, "type", EVIDENCE_TYPES);
  let excerpt = null;
  let truncated = false;
  let finalHash = hash;
  if (description !== null && description !== undefined) {
    if (typeof description !== "string" || !description.trim()) {
      throw new SecurityEngineError("MODEL_VALIDATION", "description must be a non-empty string when provided");
    }
    finalHash = hash === null || hash === undefined ? sha256Hex(description) : requireNonEmptyString(hash, "hash");
    excerpt = description.length > EXCERPT_LIMIT ? description.slice(0, EXCERPT_LIMIT) : description;
    truncated = description.length > EXCERPT_LIMIT;
  } else if (finalHash !== null && finalHash !== undefined) {
    finalHash = requireNonEmptyString(hash, "hash");
  }
  if (kind !== "metadata" && finalHash === null) {
    throw new SecurityEngineError(
      "MODEL_VALIDATION",
      "non-metadata evidence requires a hash or a description to hash"
    );
  }
  return freezeRecord({
    evidence_id:
      evidence_id === undefined ? newId("ev") : requireNonEmptyString(evidence_id, "evidence_id"),
    observation_id: obsId,
    type: kind,
    description: excerpt,
    truncated,
    reference: optionalString(reference, "reference"),
    hash: finalHash,
    hash_source: hash === null || hash === undefined ? "computed" : "provided",
    redaction_status: requireEnum(redaction_status, "redaction_status", REDACTION_STATUSES),
    metadata: { ...requireObject(metadata, "metadata") },
  });
}
