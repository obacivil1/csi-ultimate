/**
 * race/detectors.mjs — Phase 4 detector definitions.
 *
 * One definition per closed comparison class. DEFINITIONS, not a running
 * scanner: nothing registers itself, sends anything, or enables anything.
 * Each `execute` wires class-specific requirements around the shared
 * pipeline (runs → adjudicate → evidence pack). Enabling happens
 * exclusively through the Phase 1 registry inside test/lab runs.
 *
 * Reuse, not duplication: boundary sources are validated against the Phase 3
 * BOUNDARY_SOURCES enum (callers derive authorization boundaries with Phase 3
 * deriveExpectedBoundary); verdicts never reinterpret Phase 3 semantics;
 * lifecycle, budgets, and registry discipline are Phase 1 contracts.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  freezeRecord,
} from "../common.mjs";
import { newCorrelationId } from "../correlation.mjs";
import { BOUNDARY_SOURCES } from "../authorization/semantics.mjs";
import { participantKey } from "./barrier.mjs";
import {
  executeRaceRun,
  confirmOrdering,
  adjudicateRace,
  executeSequentialBaseline,
} from "./runs.mjs";
import { buildRacePack } from "./evidence.mjs";

export const RACE_CLASSES = Object.freeze([
  "ordering-ab",
  "check-use",
  "authz-ordering",
  "competing-ops",
  "sequential-sync",
]);

const DETECTOR_META = Object.freeze([
  { detector_id: "race-ordering-ab", name: "Ordering A/B Differential", race_class: "ordering-ab" },
  { detector_id: "race-check-use", name: "Check/Use TOCTOU Differential", race_class: "check-use" },
  { detector_id: "race-authz-ordering", name: "Authorized Ordering Differential", race_class: "authz-ordering" },
  { detector_id: "race-competing-ops", name: "Competing Operations Differential", race_class: "competing-ops" },
  { detector_id: "race-sequential-sync", name: "Sequential Baseline Differential", race_class: "sequential-sync" },
]);

function validateBoundary(boundary) {
  requireObject(boundary, "boundary");
  const source = requireNonEmptyString(boundary.source, "boundary.source");
  if (!BOUNDARY_SOURCES.includes(source)) {
    throw new SecurityEngineError(
      "MODEL_VALIDATION",
      `boundary.source must be one of ${BOUNDARY_SOURCES.join(", ")}`
    );
  }
  if (typeof boundary.applies !== "boolean") {
    throw new SecurityEngineError("MODEL_VALIDATION", "boundary.applies must be a boolean");
  }
  return boundary;
}

function collectParticipantIds(orderings) {
  const ids = [];
  for (const spec of Object.values(orderings)) {
    requireObject(spec, "ordering spec");
    if (!Array.isArray(spec.participants) || spec.participants.length === 0) {
      throw new SecurityEngineError("MODEL_VALIDATION", "each ordering needs a non-empty participants array");
    }
    for (const p of spec.participants) ids.push(participantKey(p.context));
  }
  return [...new Set(ids)];
}

async function runClassComparison({ race_class, claim, input, hooksFor = null, needBaseline = false, needResourceId = false }) {
  requireObject(input, "input");
  requireObject(input.orderings, "input.orderings");
  const names = Object.keys(input.orderings);
  if (names.length === 0) {
    throw new SecurityEngineError("MODEL_VALIDATION", "input.orderings must declare at least one ordering");
  }
  const boundary = validateBoundary(input.boundary);
  requireObject(input.budget, "input.budget");
  requireObject(input.scope, "input.scope");
  if (!Number.isInteger(input.repetitions)) {
    throw new SecurityEngineError("MODEL_VALIDATION", "input.repetitions must be an integer");
  }
  if (needResourceId) {
    const rid = input.resource && input.resource.resource_id;
    if (typeof rid !== "string" || !rid) {
      throw new SecurityEngineError("MODEL_VALIDATION", "competing-ops requires resource.resource_id (same-resource scoping)");
    }
  }
  const corr = newCorrelationId();
  const confirmations = [];
  // Ceiling note: each ordering consumes its own declared budget (shared
  // tracker across its repetitions); the comparison total is therefore
  // bounded by the sum of ordering budgets — declared upfront, deterministic.
  for (const name of names) {
    const spec = input.orderings[name];
    requireObject(spec, `orderings.${name}`);
    requireObject(spec.fixture, `orderings.${name}.fixture`);
    const confirmation = await confirmOrdering({
      name,
      repetitions: input.repetitions,
      budget: input.budget,
      runOnce: async ({ tracker, index }) => executeRaceRun({
        participants: spec.participants,
        fixture: spec.fixture,
        hooks: hooksFor ? hooksFor(name, index) : null,
        budget: tracker,
        scope: input.scope,
        correlation_id: corr,
        release_order: spec.release_order ?? null,
      }),
    });
    confirmations.push({ name, confirmation });
  }

  let baseline = null;
  if (needBaseline) {
    requireObject(input.baseline, "input.baseline");
    requireObject(input.baseline.exec, "input.baseline.exec");
    baseline = await executeSequentialBaseline({
      exec: input.baseline.exec,
      participants: input.baseline.participants,
      snapshot: input.baseline.snapshot ?? null,
      fixture: input.baseline.fixture ?? null,
    });
  }

  const adjudicated = confirmations.map(({ name, confirmation }) => ({ ordering: name, ...confirmation }));
  const { verdict, reasons } = adjudicateRace({
    baseline,
    orderings: adjudicated,
    boundary,
    resource: input.resource ?? null,
    claim,
  });

  const pack = buildRacePack({
    race_class,
    verdict,
    verdict_reasons: reasons,
    boundary,
    orderings: confirmations.map(({ name, confirmation: c }) => ({
      name,
      signature: c.signature,
      valid_runs: c.runs.length,
      pre_digest: c.pre_digest,
      post_digest: c.post_digest,
    })),
    unanimous_runs: Math.min(...confirmations.map(({ confirmation: c }) => c.runs.length)),
    excluded_runs: confirmations.flatMap(({ confirmation: c }) => c.excluded),
    participant_ids: collectParticipantIds(input.orderings),
    resource: input.resource ?? null,
    endpoint_id: input.endpoint_id ?? null,
    target_id: input.target_id ?? null,
    scope: input.scope,
    correlation_id: corr,
    baseline,
  });
  return { verdict, reasons, pack };
}

function makeDetector(meta, runner) {
  return freezeRecord({
    detector_id: meta.detector_id,
    name: meta.name,
    version: "0.1.0",
    specialization: "race",
    required_capabilities: Object.freeze(["multi-identity", "barrier-execution", "lab-fixture"]),
    scope_requirements: Object.freeze({ lab_only: true, min_identities: 2 }),
    race_class: meta.race_class,
    execute: async (input = {}) => {
      requireObject(input, "input");
      const { verdict, pack } = await runner({ ...input, race_class: meta.race_class });
      return {
        status: "complete",
        verdict,
        candidate_id: pack.candidate ? pack.candidate.finding_id : null,
        observation_id: pack.observation.observation_id,
        evidence_count: pack.evidence.length,
        excluded_count: pack.observation.metadata.excluded_runs,
      };
    },
  });
}

async function runOrderingAb(input) {
  return runClassComparison({ race_class: "ordering-ab", claim: "race", input });
}

async function runCheckUse(input) {
  if (typeof input.hooksFor !== "function") {
    throw new SecurityEngineError("MODEL_VALIDATION", "check-use requires hooksFor(name, index) factory (fresh machine per repetition)");
  }
  return runClassComparison({ race_class: "check-use", claim: "toctou", input, hooksFor: input.hooksFor });
}

async function runAuthzOrdering(input) {
  // Boundaries are derived by callers with Phase 3 deriveExpectedBoundary;
  // this detector consumes (never redefines) authorization semantics.
  return runClassComparison({ race_class: "authz-ordering", claim: "race", input });
}

async function runCompetingOps(input) {
  return runClassComparison({ race_class: "competing-ops", claim: "race", input, needResourceId: true });
}

async function runSequentialSync(input) {
  return runClassComparison({ race_class: "sequential-sync", claim: "race", input, needBaseline: true });
}

const RUNNERS = Object.freeze({
  "ordering-ab": runOrderingAb,
  "check-use": runCheckUse,
  "authz-ordering": runAuthzOrdering,
  "competing-ops": runCompetingOps,
  "sequential-sync": runSequentialSync,
});

export function createRaceDetectors() {
  if (DETECTOR_META.map((m) => m.race_class).sort().join(",") !== [...RACE_CLASSES].sort().join(",")) {
    throw new Error("detector set drifted from the closed race-class set");
  }
  return Object.freeze(DETECTOR_META.map((meta) => makeDetector(meta, RUNNERS[meta.race_class])));
}
