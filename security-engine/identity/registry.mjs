/**
 * identity/registry.mjs — deterministic identity registry (§5.1, §5.6).
 *
 * Operates ON Phase 1 identity records (models/identity.mjs) — no competing
 * model (§8.2, §8.3). Registration is explicit. Selection is deterministic:
 * candidates are filtered by exact criteria, stable-sorted by identity_id,
 * and the first match wins — the same set plus the same criteria always
 * yields the same identity. No match is an explicit NO_MATCHING_IDENTITY
 * error: never a fallback, never a default, never random, and criteria
 * values are never echoed into errors (they are caller-controlled text).
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  freezeRecord,
} from "../common.mjs";

const CRITERIA_KEYS = Object.freeze(["role", "tenant_id", "label"]);

export function createIdentityRegistry() {
  const byId = new Map();

  return {
    register(identity) {
      requireObject(identity, "identity");
      const id = requireNonEmptyString(identity.identity_id, "identity.identity_id");
      requireNonEmptyString(identity.label, "identity.label");
      if (byId.has(id)) {
        throw new SecurityEngineError("IDENTITY_DUPLICATE", `identity ${id} is already registered`);
      }
      // R2: store a frozen defensive copy — caller-side mutation of the
      // passed-in object after registration must not change selection.
      const stored = freezeRecord({ ...identity });
      byId.set(id, stored);
      return stored;
    },

    get(identityId) {
      const id = requireNonEmptyString(identityId, "identityId");
      return byId.has(id) ? byId.get(id) : null;
    },

    has(identityId) {
      return byId.has(requireNonEmptyString(identityId, "identityId"));
    },

    size() {
      return byId.size;
    },

    list() {
      return Object.freeze(
        [...byId.values()].sort((a, b) => (a.identity_id < b.identity_id ? -1 : 1))
      );
    },

    select(criteria = {}) {
      requireObject(criteria, "criteria");
      for (const key of Object.keys(criteria)) {
        if (!CRITERIA_KEYS.includes(key)) {
          throw new SecurityEngineError(
            "SELECTION_VALIDATION",
            `unknown selection criterion "${key}" — allowed: ${CRITERIA_KEYS.join(", ")}`
          );
        }
      }
      const matches = [...byId.values()]
        .filter((rec) => Object.entries(criteria).every(([k, v]) => rec[k] === v))
        .sort((a, b) => (a.identity_id < b.identity_id ? -1 : 1));
      if (matches.length === 0) {
        // Deliberately value-free: criteria are caller-controlled text and
        // must never be echoed into errors, logs, or evidence.
        throw new SecurityEngineError(
          "NO_MATCHING_IDENTITY",
          `no registered identity matches the given criteria (${byId.size} registered)`
        );
      }
      return matches[0];
    },

    clear() {
      byId.clear();
    },
  };
}

export { CRITERIA_KEYS };

export function selectionSummary(selection) {
  requireObject(selection, "selection");
  return freezeRecord({
    identity_id: requireNonEmptyString(selection.identity_id, "selection.identity_id"),
    label: selection.label ?? null,
  });
}
