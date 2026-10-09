/**
 * comparison/differential.mjs — minimal differential-analysis contract (§21).
 *
 * Compares two or more observations and answers ONE question:
 *   "What changed?"  (same | different | inconclusive)
 * It never answers "Is this a vulnerability?" — that decision belongs to
 * future detectors consuming these comparisons plus authorization context.
 */
import {
  SecurityEngineError,
  requireObject,
  freezeRecord,
} from "../common.mjs";

export const CATEGORIES = Object.freeze([
  "status",
  "headers",
  "bodyHash",
  "timing",
  "stateIndicators",
  "contentType",
]);

function cat(category, verdict, detail = null) {
  return Object.freeze({ category, verdict, detail });
}

function headerNames(r) {
  if (!r || !Array.isArray(r.headers_metadata)) return null;
  return r.headers_metadata.map((h) => h.name).sort();
}

function compareStatus(a, b) {
  return a.status === b.status
    ? cat("status", "same", `status=${a.status}`)
    : cat("status", "different", `${a.status} → ${b.status}`);
}

function compareHeaders(a, b) {
  const ha = headerNames(a);
  const hb = headerNames(b);
  if (!ha || !hb) return cat("headers", "inconclusive", "header metadata missing on at least one side");
  const added = hb.filter((h) => !ha.includes(h));
  const removed = ha.filter((h) => !hb.includes(h));
  if (added.length === 0 && removed.length === 0) return cat("headers", "same", `${ha.length} header names identical`);
  return cat("headers", "different", `added=[${added.join(",")}] removed=[${removed.join(",")}]`);
}

function compareBodyHash(a, b) {
  if (!a.body_hash || !b.body_hash) {
    return cat("bodyHash", "inconclusive", "body hash missing on at least one side");
  }
  return a.body_hash === b.body_hash
    ? cat("bodyHash", "same", a.body_hash.slice(0, 16))
    : cat("bodyHash", "different", `${a.body_hash.slice(0, 16)} → ${b.body_hash.slice(0, 16)}`);
}

function compareTiming(a, b, toleranceMs) {
  const ta = a.timing_ms;
  const tb = b.timing_ms;
  if (typeof ta !== "number" || typeof tb !== "number") {
    return cat("timing", "inconclusive", "timing missing on at least one side");
  }
  const delta = Math.abs(ta - tb);
  return delta <= toleranceMs
    ? cat("timing", "same", `Δ${delta}ms within ±${toleranceMs}ms`)
    : cat("timing", "different", `Δ${delta}ms exceeds ±${toleranceMs}ms`);
}

function compareStateIndicators(a, b) {
  const sa = [...(a.state_indicators || [])].sort();
  const sb = [...(b.state_indicators || [])].sort();
  const same = sa.length === sb.length && sa.every((v, i) => v === sb[i]);
  return same
    ? cat("stateIndicators", "same", `${sa.length} indicators identical`)
    : cat("stateIndicators", "different", `[${sa.join("|")}] → [${sb.join("|")}]`);
}

function compareContentType(a, b) {
  const ca = a.content_type ?? null;
  const cb = b.content_type ?? null;
  if (ca === null || cb === null) {
    return ca === cb
      ? cat("contentType", "same", "both absent")
      : cat("contentType", "inconclusive", "content type missing on one side");
  }
  return ca === cb ? cat("contentType", "same", ca) : cat("contentType", "different", `${ca} → ${cb}`);
}

const COMPARATORS = { status: compareStatus, headers: compareHeaders, bodyHash: compareBodyHash, stateIndicators: compareStateIndicators, contentType: compareContentType };

export function compareResponses(a, b, { fields = null, toleranceMs = 250 } = {}) {
  requireObject(a, "responseA");
  requireObject(b, "responseB");
  const wanted = fields === null ? [...CATEGORIES] : fields;
  if (!Array.isArray(wanted) || wanted.some((f) => !CATEGORIES.includes(f))) {
    throw new SecurityEngineError("DIFFERENTIAL_VALIDATION", `fields must be a subset of ${CATEGORIES.join(", ")}`);
  }
  if (typeof toleranceMs !== "number" || !(toleranceMs >= 0)) {
    throw new SecurityEngineError("DIFFERENTIAL_VALIDATION", "toleranceMs must be a non-negative number");
  }
  const categories = wanted.map((f) =>
    f === "timing" ? compareTiming(a, b, toleranceMs) : COMPARATORS[f](a, b)
  );
  let verdict = "same";
  for (const c of categories) {
    if (c.verdict === "different") {
      verdict = "different";
      break;
    }
    if (c.verdict === "inconclusive") verdict = "inconclusive";
  }
  return freezeRecord({ verdict, categories: Object.freeze(categories) });
}

/**
 * Observation-level comparison: identity/endpoint/target sameness as context,
 * plus an optional delegated response comparison. Without responses the
 * verdict is honestly "inconclusive" — sameness of actors is not sameness
 * of behavior.
 */
export function compareObservations(a, b, { responseA = null, responseB = null } = {}) {
  requireObject(a, "observationA");
  requireObject(b, "observationB");
  const notes = Object.freeze({
    sameTarget: (a.target_id ?? null) === (b.target_id ?? null),
    sameEndpoint: (a.endpoint_id ?? null) === (b.endpoint_id ?? null),
    sameIdentity: (a.identity_id ?? null) === (b.identity_id ?? null),
  });
  if (responseA === null || responseB === null) {
    return freezeRecord({ verdict: "inconclusive", reason: "responses-required", notes, response: null });
  }
  const response = compareResponses(responseA, responseB);
  return freezeRecord({ verdict: response.verdict, reason: null, notes, response });
}
