/**
 * registry/registry.mjs — detector registry contract (§19).
 *
 * Register / unregister / enable / disable / list / resolve / execute.
 * The registry operates correctly with ZERO detectors, and no detector is
 * ever enabled by default: registration sets status "disabled" unless the
 * definition explicitly requests otherwise — and even then, enable() is a
 * separate deliberate act. No Race/BOLA/BFLA detectors exist in Phase 1.
 * Fail-closed: unknown detectors throw; disabled or incapable detectors
 * yield explicit not_ready outcomes — never silent success.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  requireEnum,
  freezeRecord,
} from "../common.mjs";

export const SPECIALIZATIONS = Object.freeze(["authorization", "race", "general"]);
export const DETECTOR_STATUSES = Object.freeze(["enabled", "disabled"]);

function validateDefinition(def) {
  requireObject(def, "detector definition");
  const detector_id = requireNonEmptyString(def.detector_id, "detector_id");
  const name = requireNonEmptyString(def.name, "name");
  const version = requireNonEmptyString(def.version, "version");
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new SecurityEngineError("REGISTRY_VALIDATION", "version must start with MAJOR.MINOR.PATCH");
  }
  const specialization = requireEnum(def.specialization, "specialization", SPECIALIZATIONS);
  const required_capabilities = def.required_capabilities === undefined ? [] : def.required_capabilities;
  if (!Array.isArray(required_capabilities) || required_capabilities.some((c) => typeof c !== "string")) {
    throw new SecurityEngineError("REGISTRY_VALIDATION", "required_capabilities must be an array of strings");
  }
  const scope_requirements = def.scope_requirements === undefined ? {} : def.scope_requirements;
  requireObject(scope_requirements, "scope_requirements");
  if (def.execute !== undefined && typeof def.execute !== "function") {
    throw new SecurityEngineError("REGISTRY_VALIDATION", "execute must be a function when provided");
  }
  return freezeRecord({
    detector_id,
    name,
    version,
    specialization,
    required_capabilities: Object.freeze([...required_capabilities]),
    scope_requirements: Object.freeze({ ...scope_requirements }),
    status: def.status === undefined ? "disabled" : requireEnum(def.status, "status", DETECTOR_STATUSES),
    execute: def.execute,
  });
}

export function createRegistry() {
  const defs = new Map();
  const order = [];

  const snapshot = (def) =>
    freezeRecord({
      detector_id: def.detector_id,
      name: def.name,
      version: def.version,
      specialization: def.specialization,
      required_capabilities: def.required_capabilities,
      scope_requirements: def.scope_requirements,
      status: def.status,
    });

  return {
    register(def) {
      const clean = validateDefinition(def);
      if (defs.has(clean.detector_id)) {
        throw new SecurityEngineError(
          "REGISTRY_DUPLICATE",
          `detector ${clean.detector_id} is already registered`
        );
      }
      defs.set(clean.detector_id, clean);
      order.push(clean.detector_id);
      return snapshot(clean);
    },

    unregister(detectorId) {
      const id = requireNonEmptyString(detectorId, "detectorId");
      if (!defs.has(id)) {
        throw new SecurityEngineError("REGISTRY_UNKNOWN", `unknown detector ${id}`);
      }
      defs.delete(id);
      order.splice(order.indexOf(id), 1);
      return true;
    },

    enable(detectorId) {
      const id = requireNonEmptyString(detectorId, "detectorId");
      const def = defs.get(id);
      if (!def) throw new SecurityEngineError("REGISTRY_UNKNOWN", `unknown detector ${id}`);
      const next = freezeRecord({ ...def, status: "enabled" });
      defs.set(id, next);
      return snapshot(next);
    },

    disable(detectorId) {
      const id = requireNonEmptyString(detectorId, "detectorId");
      const def = defs.get(id);
      if (!def) throw new SecurityEngineError("REGISTRY_UNKNOWN", `unknown detector ${id}`);
      const next = freezeRecord({ ...def, status: "disabled" });
      defs.set(id, next);
      return snapshot(next);
    },

    list({ status } = {}) {
      const wanted = status === undefined ? null : requireEnum(status, "status", DETECTOR_STATUSES);
      return Object.freeze(
        order.map((id) => defs.get(id)).filter((d) => !wanted || d.status === wanted).map(snapshot)
      );
    },

    resolve(detectorId) {
      const id = requireNonEmptyString(detectorId, "detectorId");
      const def = defs.get(id);
      return def ? snapshot(def) : null;
    },

    async execute(detectorId, ctx = {}) {
      const id = requireNonEmptyString(detectorId, "detectorId");
      const def = defs.get(id);
      if (!def) throw new SecurityEngineError("REGISTRY_UNKNOWN", `unknown detector ${id}`);
      if (def.status !== "enabled") {
        return Object.freeze({ detector_id: id, status: "not_ready", reason: "detector-disabled" });
      }
      if (typeof def.execute !== "function") {
        return Object.freeze({ detector_id: id, status: "not_ready", reason: "no-execute-capability" });
      }
      try {
        const outcome = await def.execute(ctx);
        if (!outcome || typeof outcome !== "object" || typeof outcome.status !== "string") {
          return Object.freeze({ detector_id: id, status: "not_ready", reason: "malformed-detector-outcome" });
        }
        return Object.freeze({ detector_id: id, ...outcome });
      } catch (e) {
        return Object.freeze({
          detector_id: id,
          status: "not_ready",
          reason: "detector-errored",
          detail: e?.message || String(e),
        });
      }
    },

    async executeAll(ctx = {}) {
      const enabled = order.map((id) => defs.get(id)).filter((d) => d.status === "enabled");
      if (enabled.length === 0) {
        return Object.freeze({ status: "not_ready", reason: "no-enabled-detectors", results: Object.freeze([]) });
      }
      const results = [];
      for (const def of enabled) {
        results.push(await this.execute(def.detector_id, ctx));
      }
      return Object.freeze({ status: "complete", results: Object.freeze(results) });
    },
  };
}
