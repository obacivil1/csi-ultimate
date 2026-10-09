/**
 * race/evidence.mjs — race evidence pack + candidate correlation.
 *
 * Observation + evidence are built for EVERY adjudicated comparison
 * (evidence inputs, never findings by themselves). A candidate is created
 * only on *-CANDIDATE verdicts with a complete pack, always at lifecycle
 * status "candidate" (never auto-validated). Engine-written strings embed
 * only fixed vocabulary, integers, counts, truncated hashes, and stable
 * identifiers — the Phase 3 secret rule applies unchanged.
 *
 * correlateCandidates (LOW-1): candidates sharing correlation ID, resource
 * reference, and state transition represent one underlying observation for
 * counting/metrics. Analytical grouping only — no lifecycle change, no
 * merging of records, no second finding engine.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  freezeRecord,
} from "../common.mjs";
import { createObservation } from "../models/observation.mjs";
import { createEvidence } from "../models/evidence.mjs";
import { createFinding } from "../models/finding.mjs";
import { UNKNOWN_IMPACT, UNKNOWN_SEVERITY } from "../authorization/semantics.mjs";

const RACE_CONFIDENCE = Object.freeze({
  "explicit-rules": { score: 0.9, level: "high" },
  "observed-denial": { score: 0.75, level: "medium" },
  "conservative-inference": { score: 0.6, level: "medium" },
});

function gradeRaceConfidence({ source, race_class, valid_runs }) {
  const row = RACE_CONFIDENCE[source];
  if (!row) {
    throw new SecurityEngineError(
      "AUTHZ_VALIDATION",
      "race confidence requires a known boundary source"
    );
  }
  return freezeRecord({
    level: row.level,
    score: row.score,
    reasons: Object.freeze([
      `ordering differential over ${race_class}`,
      `expected boundary source: ${source}`,
      `unanimous ${valid_runs}/${valid_runs} with reset attestation`,
    ]),
    rationale: "evidence-derived at the foundation layer; no behavioral guessing",
  });
}

/**
 * Build the pack for one adjudicated comparison. Always returns
 * { observation, evidence[] }; candidate is non-null only for *-CANDIDATE.
 */
export function buildRacePack({
  race_class,
  verdict,
  verdict_reasons = [],
  boundary,
  orderings,
  unanimous_runs,
  excluded_runs = [],
  participant_ids = [],
  resource = null,
  endpoint_id = null,
  target_id = null,
  scope = null,
  correlation_id,
  baseline = null,
} = {}) {
  const cls = requireNonEmptyString(race_class, "race_class");
  requireNonEmptyString(verdict, "verdict");
  requireObject(boundary, "boundary");
  if (!Array.isArray(orderings) || orderings.length === 0) {
    throw new SecurityEngineError("MODEL_VALIDATION", "orderings must be a non-empty array");
  }
  if (!Number.isInteger(unanimous_runs) || unanimous_runs < 0) {
    throw new SecurityEngineError("MODEL_VALIDATION", "unanimous_runs must be an integer >= 0");
  }
  const corr = requireNonEmptyString(correlation_id, "correlation_id");
  const res = resource === null || resource === undefined ? null : requireObject(resource, "resource");
  const resId = res && typeof res.resource_id === "string" && res.resource_id ? res.resource_id : null;

  const normOrderings = orderings.map((o, i) => {
    requireObject(o, `orderings[${i}]`);
    return {
      name: requireNonEmptyString(o.name, `orderings[${i}].name`),
      signature: typeof o.signature === "string" && o.signature ? o.signature : "unavailable",
      valid_runs: Number.isInteger(o.valid_runs) && o.valid_runs >= 0 ? o.valid_runs : 0,
      pre_digest: typeof o.pre_digest === "string" && o.pre_digest ? o.pre_digest : "unavailable",
      post_digest: typeof o.post_digest === "string" && o.post_digest ? o.post_digest : "unavailable",
    };
  });
  const first = normOrderings[0];
  const state_before = `first-ordering pre=${first.pre_digest}`;
  const state_after = `first-ordering post=${first.post_digest}`;
  if (!Array.isArray(participant_ids) || participant_ids.some((id) => typeof id !== "string" || !id)) {
    throw new SecurityEngineError("MODEL_VALIDATION", "participant_ids must be an array of non-empty strings");
  }
  const participants = [...new Set(participant_ids)];
  const reasons = Array.isArray(verdict_reasons) ? verdict_reasons.filter((r) => typeof r === "string") : [];
  // HIGH-1 visibility: the executed baseline's actual status/signature/reset
  // validity ride along in metadata — including when unusable, so a reviewer
  // can always determine what the baseline was. Values are passed through,
  // never reconstructed.
  let baselineRecord = null;
  if (baseline !== null && baseline !== undefined) {
    requireObject(baseline, "baseline");
    baselineRecord = freezeRecord({
      status: baseline.status ?? null,
      signature: typeof baseline.signature === "string" && baseline.signature ? baseline.signature : null,
      reset_valid: baseline.resetAttestation !== null && baseline.resetAttestation !== undefined
        ? baseline.resetAttestation.valid === true
        : false,
    });
  }

  const observation = createObservation({
    correlation_id: corr,
    target_id,
    endpoint_id,
    identity_id: null,
    signals: Object.freeze([
      `race:${cls}`,
      `orderings:${normOrderings.map((o) => o.name).join("+")}`,
      `boundary:${boundary.source}`,
      `verdict:${verdict}`,
      `unanimous:${unanimous_runs}/${unanimous_runs}`,
    ]),
    state_before,
    state_after,
    metadata: {
      race_class: cls,
      orderings: normOrderings.map((o) => ({ name: o.name, signature: o.signature, valid_runs: o.valid_runs })),
      boundary_statement: boundary.statement,
      boundary_source: boundary.source,
      participant_ids: participants,
      excluded_runs: excluded_runs.length,
      verdict_reasons: reasons,
      baseline: baselineRecord,
    },
  });

  const differential = createEvidence({
    observation_id: observation.observation_id,
    type: "hash-only",
    description:
      `race=${cls} ` +
      `orderings=${normOrderings.map((o) => `${o.name}:${o.signature}`).join(",")} ` +
      `boundary-source=${boundary.source} verdict=${verdict}`,
    redaction_status: "hash-only",
  });
  const provenance = createEvidence({
    observation_id: observation.observation_id,
    type: "reference",
    reference: `race-run:${corr}`,
    description: `unanimous ${unanimous_runs}/${unanimous_runs} across ${orderings.length} orderings, ${excluded_runs.length} excluded (recorded)`,
    redaction_status: "hash-only",
  });
  const evidence = [differential, provenance];

  let candidate = null;
  if (verdict === "RACE-CANDIDATE" || verdict === "TOCTOU-CANDIDATE") {
    const boundaryEv = createEvidence({
      observation_id: observation.observation_id,
      type: "reference",
      reference: `boundary:${boundary.source}:${cls}`,
      description: `applying boundary from ${boundary.source} for ${cls}`,
      redaction_status: "hash-only",
    });
    evidence.push(boundaryEv);
    candidate = createFinding({
      finding_type: "race",
      title: `Possible ${cls} ordering dependence (${resId ?? "target resource"})`,
      target_id,
      endpoint_reference: endpoint_id,
      identity_references: participants.map((id) => requireNonEmptyString(id, "participant identity")),
      resource_reference: resId,
      expected_boundary: requireNonEmptyString(boundary.statement, "boundary.statement"),
      observed_behavior:
        `orderings ${normOrderings.map((o) => `${o.name}=${o.signature}`).join(" vs ")} on ${cls} ` +
        `(unanimous ${unanimous_runs}/${unanimous_runs})`,
      security_relevance:
        `Ordering differential points to a ${cls} boundary effect (boundary source: ${boundary.source}). ` +
        `Foundation-layer candidacy only — impact and exploitability are not established.`,
      state_before,
      state_after,
      evidence_references: evidence.map((e) => e.evidence_id),
      reproduction_reference: `repro:${cls}:${normOrderings.map((o) => o.name).join("+")}:${participants.length}participants`,
      confidence: gradeRaceConfidence({ source: boundary.source, race_class: cls, valid_runs: unanimous_runs }),
      impact: { ...UNKNOWN_IMPACT },
      severity: { ...UNKNOWN_SEVERITY },
      scope_status: scope === null || scope === undefined ? { decision: "unknown" } : scope,
      metadata: { race_class: cls, race_correlation_id: corr },
    });
  }

  return freezeRecord({ observation, evidence: Object.freeze(evidence), candidate });
}

/**
 * LOW-1 correlation: group candidates sharing correlation ID, resource
 * reference, and state transition. Returns groups with a primary member
 * plus a duplicate count for metrics. Reads only; changes nothing.
 */
export function correlateCandidates(candidates) {
  if (!Array.isArray(candidates)) {
    throw new SecurityEngineError("MODEL_VALIDATION", "candidates must be an array");
  }
  const groups = new Map();
  for (const c of candidates) {
    requireObject(c, "candidate");
    const key = [
      c?.metadata?.race_correlation_id ?? "",
      c.resource_reference ?? "",
      c.state_before ?? "",
      c.state_after ?? "",
    ].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c.finding_id);
  }
  const out = [];
  let duplicates = 0;
  for (const [key, members] of groups) {
    if (members.length > 1) duplicates += members.length - 1;
    out.push(freezeRecord({ key, primary: members[0], members: Object.freeze([...members]) }));
  }
  return freezeRecord({ groups: Object.freeze(out), duplicate_count: duplicates });
}
