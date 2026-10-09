/**
 * storage/stores.mjs — storage-independent interfaces (§22).
 *
 * Phase 1 creates NO database and migrates nothing. These interfaces
 * (EndpointStore … FindingStore) define the shape a persistent backend must
 * implement later; the in-memory implementation exists so contracts and
 * detectors can be tested today without any storage dependency.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  requireEnum,
} from "../common.mjs";

export const STORE_KINDS = Object.freeze({
  endpoint: "endpoint_id",
  identity: "identity_id",
  session: "session_id",
  observation: "observation_id",
  evidence: "evidence_id",
  finding: "finding_id",
});

export function createMemoryStore(kind) {
  const idField = STORE_KINDS[requireEnum(kind, "kind", Object.keys(STORE_KINDS))];
  const rows = new Map();
  return {
    kind,
    idField,
    put(record) {
      requireObject(record, "record");
      const id = record[idField];
      if (typeof id !== "string" || !id.trim()) {
        throw new SecurityEngineError("STORE_VALIDATION", `record must carry a non-empty ${idField}`);
      }
      if (rows.has(id)) {
        throw new SecurityEngineError("STORE_DUPLICATE", `${kind} ${id} already stored — use upsert to replace`);
      }
      rows.set(id, record);
      return record;
    },
    upsert(record) {
      requireObject(record, "record");
      const id = record[idField];
      if (typeof id !== "string" || !id.trim()) {
        throw new SecurityEngineError("STORE_VALIDATION", `record must carry a non-empty ${idField}`);
      }
      rows.set(id, record);
      return record;
    },
    get(id) {
      const key = requireNonEmptyString(id, "id");
      return rows.has(key) ? rows.get(key) : null;
    },
    has(id) {
      return rows.has(requireNonEmptyString(id, "id"));
    },
    list() {
      return Object.freeze([...rows.values()]);
    },
    remove(id) {
      return rows.delete(requireNonEmptyString(id, "id"));
    },
    clear() {
      rows.clear();
    },
    size() {
      return rows.size;
    },
  };
}
