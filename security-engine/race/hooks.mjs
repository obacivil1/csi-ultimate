/**
 * race/hooks.mjs — TOCTOU check/use lifecycle machine.
 *
 * CHECK_PENDING → CHECK_REACHED → HOLD → RELEASE → USE_REACHED → COMPLETE.
 * The machine records fixture-attested checkpoints; it never infers them.
 * A stuck machine (missing signal), an illegal edge, or an undeclared
 * fixture yields UNSUPPORTED — the run layer maps that to INCONCLUSIVE.
 * Fresh machine per repetition (no reuse, mirroring the barrier rule).
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  isoNow,
  freezeRecord,
} from "../common.mjs";

export const HOOK_STATES = Object.freeze([
  "CHECK_PENDING",
  "CHECK_REACHED",
  "HOLD",
  "RELEASE",
  "USE_REACHED",
  "COMPLETE",
]);

const EDGES = Object.freeze({
  CHECK_PENDING: Object.freeze(["CHECK_REACHED"]),
  CHECK_REACHED: Object.freeze(["HOLD"]),
  HOLD: Object.freeze(["RELEASE"]),
  RELEASE: Object.freeze(["USE_REACHED"]),
  USE_REACHED: Object.freeze(["COMPLETE"]),
  COMPLETE: Object.freeze([]),
});

export function createHookMachine({ correlation_id = null } = {}) {
  const corr = correlation_id === null || correlation_id === undefined
    ? null
    : requireNonEmptyString(correlation_id, "correlation_id");
  let state = "CHECK_PENDING";
  let terminal = false;
  const checkpoints = [];

  function signal(next) {
    if (terminal) {
      throw new SecurityEngineError("STALE_HOOK", "hook machine is terminal — fresh machine required per repetition");
    }
    requireNonEmptyString(next, "checkpoint");
    if (!EDGES[state].includes(next)) {
      throw new SecurityEngineError(
        "HOOK_INVALID_TRANSITION",
        `illegal hook transition ${state} → ${next}`
      );
    }
    state = next;
    checkpoints.push(freezeRecord({ checkpoint: next, sequence: checkpoints.length + 1, source: "fixture", at: isoNow() }));
    if (state === "COMPLETE") terminal = true;
    return state;
  }

  return {
    signal,
    current() {
      return state;
    },
    isTerminal() {
      return terminal;
    },
    isComplete() {
      return state === "COMPLETE";
    },
    attestations() {
      return Object.freeze([...checkpoints]);
    },
  };
}

/**
 * Unsupported fixture hook: declared when the fixture cannot expose the
 * required check/use synchronization point. Carries the reason; the run
 * layer must treat it as UNSUPPORTED → INCONCLUSIVE, never a candidate.
 */
export function unsupportedHook(reason) {
  const why = requireNonEmptyString(reason, "reason");
  return freezeRecord({ supported: false, reason: why });
}

export function isHookMachine(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.signal === "function" &&
    typeof value.isComplete === "function" &&
    typeof value.attestations === "function"
  );
}
