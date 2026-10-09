/** Phase 2 Tests A + G (selection half) — deterministic identity registry. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentity } from "../models/identity.mjs";
import { createIdentityRegistry } from "../identity/registry.mjs";

const mk = (identity_id, label, role, tenant_id) =>
  createIdentity({ identity_id, label, role, tenant_id });

function populated() {
  const reg = createIdentityRegistry();
  reg.register(mk("idn_a", "User-A", "admin", "tenant-a"));
  reg.register(mk("idn_b", "User-B", "member", "tenant-a"));
  reg.register(mk("idn_c", "Tenant-B-User", "member", "tenant-b"));
  return reg;
}

test("A — two identities coexist without collision", () => {
  const reg = populated();
  assert.equal(reg.size(), 3);
  assert.equal(reg.get("idn_a").label, "User-A");
  assert.equal(reg.get("idn_b").label, "User-B");
  assert.equal(reg.get("ghost"), null);
  assert.deepEqual(reg.list().map((i) => i.identity_id), ["idn_a", "idn_b", "idn_c"]);
  assert.throws(() => reg.register(mk("idn_a", "Dupe", "member", "tenant-a")), (e) => e?.code === "IDENTITY_DUPLICATE");
});

test("selection honors exact criteria; unknown criteria rejected", () => {
  const reg = populated();
  assert.equal(reg.select({ role: "member", tenant_id: "tenant-a" }).identity_id, "idn_b");
  assert.equal(reg.select({ label: "Tenant-B-User" }).identity_id, "idn_c");
  assert.throws(() => reg.select({ password: "x" }), (e) => e?.code === "SELECTION_VALIDATION");
});

test("no match is explicit and echoes nothing (no silent fallback)", () => {
  const reg = populated();
  try {
    reg.select({ label: "nobody pw=hunter2-BBB" });
    assert.fail("must throw");
  } catch (e) {
    assert.equal(e?.code, "NO_MATCHING_IDENTITY");
    assert.ok(!String(e?.message).includes("hunter2-BBB"));
  }
});

test("G — repeated equivalent selection is stable regardless of registration order", () => {
  const r1 = populated();
  const first = r1.select({ role: "member" }).identity_id;
  assert.equal(r1.select({ role: "member" }).identity_id, first);
  const r2 = createIdentityRegistry();
  r2.register(mk("idn_c", "Tenant-B-User", "member", "tenant-b"));
  r2.register(mk("idn_b", "User-B", "member", "tenant-a"));
  r2.register(mk("idn_a", "User-A", "admin", "tenant-a"));
  assert.equal(r2.select({ role: "member" }).identity_id, first);
  assert.equal(first, "idn_b");
});

test("R2 — caller mutation after registration cannot alter selection", () => {
  const reg = createIdentityRegistry();
  const mutable = { identity_id: "idn_m", label: "Mutable", role: "member", tenant_id: "t1" };
  reg.register(mutable);
  // Caller mutates their own object after registration.
  mutable.role = "admin";
  mutable.tenant_id = "other";
  mutable.label = "Changed";
  // Registry still decides on the frozen copy taken at registration time.
  assert.equal(reg.select({ role: "member", tenant_id: "t1" }).identity_id, "idn_m");
  assert.equal(reg.get("idn_m").role, "member");
  assert.ok(Object.isFrozen(reg.get("idn_m")));
});
