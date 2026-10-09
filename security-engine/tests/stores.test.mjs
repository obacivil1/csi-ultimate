/** Phase 1 §25 — storage interfaces: in-memory backend for every store kind. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore, STORE_KINDS } from "../storage/stores.mjs";

test("every store kind accepts, retrieves, lists, removes", () => {
  for (const [kind, idField] of Object.entries(STORE_KINDS)) {
    const store = createMemoryStore(kind);
    assert.equal(store.kind, kind);
    assert.equal(store.idField, idField);
    assert.equal(store.size(), 0);
    assert.equal(store.get("missing"), null);
    const rec = Object.freeze({ [idField]: `${kind}-1`, note: "x" });
    store.put(rec);
    assert.equal(store.size(), 1);
    assert.equal(store.get(`${kind}-1`), rec);
    assert.ok(store.has(`${kind}-1`));
    assert.equal(store.list().length, 1);
    assert.throws(() => store.put(rec), (e) => e?.code === "STORE_DUPLICATE");
    assert.equal(store.remove(`${kind}-1`), true);
    assert.equal(store.remove(`${kind}-1`), false);
    assert.equal(store.size(), 0);
  }
});

test("stores reject records without their id field; unknown kinds rejected", () => {
  const store = createMemoryStore("finding");
  assert.throws(() => store.put({ title: "no-id" }), (e) => e?.code === "STORE_VALIDATION");
  assert.throws(() => store.put({ finding_id: "" }), (e) => e?.code === "STORE_VALIDATION");
  assert.throws(() => createMemoryStore("nope"), /kind/);
  const up = createMemoryStore("evidence");
  up.put({ evidence_id: "e1" });
  up.upsert({ evidence_id: "e1", note: "replaced" });
  assert.equal(up.get("e1").note, "replaced");
  up.clear();
  assert.equal(up.size(), 0);
});
