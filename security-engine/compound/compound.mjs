/**
 * compound/compound.mjs — pure deterministic correlator: one authorization
 * finding × one race finding → compound candidate or explicit no-link.
 *
 * Security rules enforced here (not by convention):
 * - Scope decisions are NORMALIZED FIRST ({allow,deny,unknown}); raw source
 *   scope values never cross the output boundary in any form. Only
 *   normalized tokens appear in scope_pair and reasons.
 * - Reproduction references pass the Phase 1 safe opaque-reference contract
 *   (isSafeReference); unsafe values become absent (null), never propagated,
 *   never synthesized. Paired only when both sides safe.
 * - Linkage is exact identifier matching only (strict ===, non-empty
 *   strings, byte-exact normalized identity keys). Tenant consistency is
 *   required where both sides declare tenants.
 * - Output status is unconditionally "candidate"; validated solely via the
 *   existing Phase 1 lifecycle rules. No new type, no new state.
 * - No execution, no network, no credentials, no filesystem, no subprocess.
 *   The detector definition below is a specification-level concept: it is
 *   never registered by this module (no registry import exists here).
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  sha256Hex,
  freezeRecord,
} from "../common.mjs";
import { isSafeReference } from "../models/identity.mjs";
import { createObservation } from "../models/observation.mjs";
import { createEvidence } from "../models/evidence.mjs";
import { createFinding } from "../models/finding.mjs";
import { UNKNOWN_IMPACT, UNKNOWN_SEVERITY } from "../authorization/semantics.mjs";
import { newCorrelationId } from "../correlation.mjs";

const PERMITTED_STATUSES = Object.freeze(["candidate", "validated"]);
const SCOPE_VOCABULARY = Object.freeze(["allow", "deny", "unknown"]);

/**
 * Scope normalization: map ANY raw source value onto the fixed vocabulary
 * BEFORE any use. Only these three tokens may enter output or reasons.
 */
export function normalizeScopeDecision(raw) {
  if (raw === "allow" || raw === "deny" || raw === "unknown") return raw;
  return "unknown";
}

function validScopeToken(tok) {
  return tok === "allow" || tok === "deny" || tok === "unknown";
}

/**
 * Identity normalization: exact function over the refs array.
 * - non-array → no keys (fail-closed, never throws for shape issues here)
 * - non-string element → contributes no keys
 * - no "|" → whole non-empty string is one key; "" contributes nothing
 * - "|" present → split on every literal "|"; ANY empty token voids the
 *   whole representation (no keys from it)
 * - matching downstream is byte-exact (UTF-16 units), case-sensitive,
 *   whitespace-sensitive — no trimming, folding, or substring logic
 */
export function normalizeIdentitySet(refs) {
  if (!Array.isArray(refs)) return Object.freeze([]);
  const out = [];
  for (const s of refs) {
    if (typeof s !== "string" || s.length === 0) continue;
    if (!s.includes("|")) {
      if (!out.includes(s)) out.push(s);
      continue;
    }
    const toks = s.split("|");
    if (toks.some((t) => t.length === 0)) continue;
    for (const t of toks) if (!out.includes(t)) out.push(t);
  }
  return Object.freeze(out.sort());
}

/**
 * Tenant readout: valid non-empty string, absent (null/undefined/""),
 * or malformed (any other type). Malformed is a no-link condition, not
 * an absence — callers must not conflate the two.
 */
export function readTenant(finding) {
  requireObject(finding, "finding");
  const t = finding.metadata ? finding.metadata.tenant_id : undefined;
  if (t === null || t === undefined || t === "") return { present: false, value: null, malformed: false };
  if (typeof t === "string" && t.length > 0) return { present: true, value: t, malformed: false };
  return { present: false, value: null, malformed: true };
}

function evidenceComplete(finding) {
  if (!Array.isArray(finding.evidence_references) || finding.evidence_references.length === 0) return false;
  if (finding.evidence_references.some((r) => typeof r !== "string" || r.length === 0)) return false;
  for (const f of ["expected_boundary", "observed_behavior", "security_relevance"]) {
    if (typeof finding[f] !== "string" || finding[f].length === 0) return false;
  }
  return true;
}

function safeRepro(ref) {
  if (ref === null || ref === undefined) return { value: null, unsafe: false };
  if (typeof ref === "string" && ref.length > 0 && isSafeReference(ref)) return { value: ref, unsafe: false };
  return { value: null, unsafe: true };
}

/**
 * Deterministic compound ID over the source-finding pair only (never over
 * evidence state, timestamps, or metadata order): non-empty string IDs,
 * lexicographic UTF-16 sort, fixed "|" pair separator, SHA-256 hex,
 * 16 chars, "compound:" prefix.
 */
export function compoundFindingId(authzId, raceId) {
  if (typeof authzId !== "string" || authzId.length === 0) return null;
  if (typeof raceId !== "string" || raceId.length === 0) return null;
  const pair = [authzId, raceId].sort().join("|");
  return `compound:${sha256Hex(pair).slice(0, 16)}`;
}

function noLink(reasons) {
  return freezeRecord({
    linked: false,
    reasons: Object.freeze([...reasons]),
    compound: null,
    observation: null,
    evidence: Object.freeze([]),
  });
}

/**
 * Correlate exactly one authorization finding with exactly one race
 * finding. Pure record transformation; never mutates inputs; returns a
 * deeply frozen result per project convention.
 */
export function correlatePair(authzFinding, raceFinding) {
  if (!authzFinding || typeof authzFinding !== "object" || !raceFinding || typeof raceFinding !== "object") {
    throw new SecurityEngineError("MODEL_VALIDATION", "correlatePair requires two finding records");
  }
  const A = authzFinding;
  const R = raceFinding;

  if (!PERMITTED_STATUSES.includes(A.status) || !PERMITTED_STATUSES.includes(R.status)) {
    return noLink(["status-not-permitted"]);
  }
  if (!evidenceComplete(A) || !evidenceComplete(R)) {
    return noLink(["evidence-incomplete"]);
  }
  if (typeof A.target_id !== "string" || A.target_id.length === 0) {
    return noLink(["target-mismatch"]);
  }
  if (typeof R.target_id !== "string" || R.target_id.length === 0) {
    return noLink(["target-mismatch"]);
  }
  if (A.target_id !== R.target_id) {
    return noLink(["target-mismatch"]);
  }
  for (const v of [A.resource_reference, R.resource_reference]) {
    if (typeof v !== "string" || v.length === 0) {
      return noLink(["resource-mismatch"]);
    }
  }
  if (A.resource_reference !== R.resource_reference) {
    return noLink(["resource-mismatch"]);
  }
  const aKeys = normalizeIdentitySet(A.identity_references);
  const rKeys = normalizeIdentitySet(R.identity_references);
  const shared = aKeys.filter((k) => rKeys.includes(k));
  if (shared.length === 0) {
    return noLink(["no-identity-intersection"]);
  }
  const aT = readTenant(A);
  const rT = readTenant(R);
  if (aT.malformed || rT.malformed) {
    return noLink(["tenant-malformed"]);
  }
  if (aT.present && rT.present && aT.value !== rT.value) {
    return noLink(["tenant-contradiction"]);
  }

  const aScope = normalizeScopeDecision(A.scope_status ? A.scope_status.decision : undefined);
  const rScope = normalizeScopeDecision(R.scope_status ? R.scope_status.decision : undefined);
  if (!validScopeToken(aScope) || !validScopeToken(rScope)) {
    return noLink(["scope-malformed"]);
  }
  if (aScope === "deny" || rScope === "deny") {
    return noLink(["scope-deny"]);
  }
  const compoundScope = aScope === "allow" && rScope === "allow" ? "allow" : "unknown";

  const aRepro = safeRepro(A.reproduction_reference);
  const rRepro = safeRepro(R.reproduction_reference);
  const pairedRepro = aRepro.value !== null && rRepro.value !== null
    ? `paired:${sha256Hex(aRepro.value).slice(0, 16)}:${sha256Hex(rRepro.value).slice(0, 16)}`
    : null;

  const cid = compoundFindingId(A.finding_id, R.finding_id);
  if (cid === null) {
    return noLink(["id-undeterminable"]);
  }

  const runCorr = newCorrelationId();
  const observation = createObservation({
    correlation_id: runCorr,
    target_id: A.target_id,
    endpoint_id: null,
    identity_id: null,
    signals: Object.freeze([
      "compound:authz-race",
      "link:established",
      `scope:${compoundScope}`,
    ]),
    state_before: null,
    state_after: null,
    metadata: {
      rule: "compound-authz-race",
      source_finding_ids: [A.finding_id, R.finding_id],
      tenant_pair: { authorization: aT.present ? aT.value : null, race: rT.present ? rT.value : null },
      scope_pair: { authorization: aScope, race: rScope },
      link_reason: "shared-target-resource-identity",
    },
  });
  const linkEvidence = createEvidence({
    observation_id: observation.observation_id,
    type: "reference",
    reference: `link:${cid}`,
    description: `compound linkage authz:${A.finding_id} race:${R.finding_id} rule:shared-target-resource-identity`,
    redaction_status: "hash-only",
  });
  const evidenceRefs = [...new Set([...A.evidence_references, ...R.evidence_references, linkEvidence.evidence_id])];
  const compound = createFinding({
    finding_id: cid,
    finding_type: "general",
    title: `Compound candidacy (authorization × race) on ${A.resource_reference}`,
    target_id: A.target_id,
    endpoint_reference: null,
    identity_references: [...new Set([...A.identity_references, ...R.identity_references])],
    resource_reference: A.resource_reference,
    expected_boundary: "Compound of independently-gated authorization and race candidacies on shared identifiers; co-occurrence only, no causal relationship established.",
    observed_behavior: `Authorization finding ${A.finding_id} and race finding ${R.finding_id} coincide on target ${A.target_id} resource ${A.resource_reference}.`,
    security_relevance: "Foundation-layer compound candidacy only — linkage asserts co-occurrence on shared identifiers, never causation, exploitability, or impact.",
    state_before: null,
    state_after: null,
    evidence_references: evidenceRefs,
    reproduction_reference: pairedRepro,
    confidence: {
      level: "low",
      score: 0.5,
      reasons: ["conjunction of two independently-gated candidates", "exact identifier linkage"],
      rationale: "Linkage strength derives from source packs; the compound adds co-occurrence only.",
    },
    impact: { level: "unknown", rationale: "Data sensitivity is not established at the foundation layer." },
    severity: { level: "unknown", rationale: "Exploitability and reachability are not established at the foundation layer." },
    scope_status: { decision: compoundScope },
    metadata: {
      rule: "compound-authz-race",
      source_finding_ids: [A.finding_id, R.finding_id],
      tenant_pair: { authorization: aT.present ? aT.value : null, race: rT.present ? rT.value : null },
      scope_pair: { authorization: aScope, race: rScope },
      reproduction: { authorization: aRepro.value, race: rRepro.value },
      link_reason: "shared-target-resource-identity",
    },
  });
  return freezeRecord({
    linked: true,
    reasons: Object.freeze(["link-established:shared-target-resource-identity"]),
    compound,
    observation,
    evidence: Object.freeze([linkEvidence]),
  });
}

/**
 * Specification-level detector concept ONLY. No registry import exists in
 * this module and none is authorized: this object is never registered by
 * Phase 5 code, performs no execution, and changes no registry behavior.
 * Registration, if ever desired, requires a separate explicit authorization.
 */
export const COMPOUND_DETECTOR_SPEC = Object.freeze({
  detector_id: "compound-authz-race",
  name: "Compound Authorization–Race Correlator",
  version: "0.1.0",
  specialization: "general",
  required_capabilities: Object.freeze(["two-candidates", "closed-findings"]),
  scope_requirements: Object.freeze({ lab_only: true }),
  status: "disabled",
  note: "Specification concept only. No registry interaction occurs in Phase 5.",
});
