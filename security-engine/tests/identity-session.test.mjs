/** Phase 1 §25 — identity isolation, session binding, no implicit substitution. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createIdentity,
  createSession,
  bindSession,
  assertSessionIdentity,
} from "../models/identity.mjs";

const alice = () => createIdentity({ label: "User-A", role: "member", tenant_id: "tenant-a" });
const bob = () => createIdentity({ label: "User-B", role: "member", tenant_id: "tenant-a" });

test("identity: defaults carry no privilege", () => {
  const i = createIdentity({ label: "Tenant-B-User" });
  assert.equal(i.role, "unknown");
  assert.equal(i.tenant_id, null);
  assert.ok(i.identity_id.startsWith("idn_"));
});

test("session: one-time binding, rebind refused", () => {
  const a = alice();
  const b = bob();
  const ses = createSession({ target_id: "tgt_1", authentication_method: "manual" });
  assert.equal(ses.identity_id, null);
  const bound = bindSession(ses, a);
  assert.equal(bound.identity_id, a.identity_id);
  assert.throws(() => bindSession(bound, b), (e) => e?.code === "IDENTITY_REBIND");
  // Rebinding to the SAME identity is a no-op, not an error.
  assert.equal(bindSession(bound, a).identity_id, a.identity_id);
});

test("session: cross-identity use throws (no implicit substitution)", () => {
  const a = alice();
  const b = bob();
  const ses = bindSession(createSession({}), a);
  assert.equal(assertSessionIdentity(ses, a.identity_id), true);
  assert.throws(() => assertSessionIdentity(ses, b.identity_id), (e) => e?.code === "IDENTITY_MISMATCH");
  assert.throws(() => assertSessionIdentity(ses, "nobody"), (e) => e?.code === "IDENTITY_MISMATCH");
});

test("session: raw secrets refused as references; opaque refs accepted", () => {
  assert.throws(
    () => createSession({ credential_reference: "Bearer abc.def.ghi" }),
    (e) => e?.code === "SECRET_REFUSED"
  );
  assert.throws(
    () => createSession({ cookie_jar_reference: "sess=abc; Path=/" }),
    (e) => e?.code === "SECRET_REFUSED"
  );
  const s = createSession({ credential_reference: "vault:tok-001", cookie_jar_reference: "jar:sess-a" });
  assert.equal(s.credential_reference, "vault:tok-001");
  const dumped = JSON.stringify(s);
  assert.ok(!dumped.includes("Bearer"));
});
