/** Phase 2 Tests B, C, E + lifecycle — session manager. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentity, createSession, bindSession } from "../models/identity.mjs";
import { createSessionManager, evaluateSessionRecord } from "../session/manager.mjs";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const mgr = () => createSessionManager({ nowMs: () => NOW });
const idn = (id, label) => createIdentity({ identity_id: id, label });
const boundSes = (sid, identity, over = {}) =>
  bindSession(createSession({ session_id: sid, target_id: "tgt_1", ...over }), identity);

test("B — each session resolves to its intended identity, with provenance", () => {
  const m = mgr();
  const a = idn("idn_a", "User-A");
  const b = idn("idn_b", "User-B");
  m.register(boundSes("ses_a", a), { provenance: { source: "vault", reference: "vault:sess-a" } });
  m.register(boundSes("ses_b", b));
  const ra = m.resolve("idn_a");
  assert.equal(ra.session.session_id, "ses_a");
  assert.equal(ra.provenance.source, "vault");
  assert.equal(ra.provenance.reference, "vault:sess-a");
  assert.equal(m.resolve("idn_b").session.session_id, "ses_b");
  assert.equal(m.evaluate("idn_a", {}), "valid");
});

test("registration refuses anonymous pools and duplicates", () => {
  const m = mgr();
  assert.throws(
    () => m.register(createSession({ session_id: "ses_x" })),
    (e) => e?.code === "SESSION_UNBOUND"
  );
  const a = idn("idn_a", "User-A");
  m.register(boundSes("ses_a", a));
  assert.throws(() => m.register(boundSes("ses_a", a)), (e) => e?.code === "SESSION_DUPLICATE");
});

test("E — identity without a session fails explicitly, leaking nothing", () => {
  const m = mgr();
  const a = idn("idn_a", "User-A");
  const b = idn("idn_b", "User-B");
  m.register(boundSes("ses_b", b));
  try {
    m.resolve("idn_a");
    assert.fail("must throw");
  } catch (e) {
    assert.equal(e?.code, "MISSING_SESSION");
    // The error names the requested identity only — never another session.
    assert.ok(!String(e?.message).includes("ses_b"));
  }
  try {
    m.requireUsable("idn_a", {});
    assert.fail("must throw");
  } catch (e) {
    assert.equal(e?.code, "MISSING_SESSION");
  }
});

test("C — a session can never silently serve another identity", () => {
  const m = mgr();
  const a = idn("idn_a", "User-A");
  const b = idn("idn_b", "User-B");
  m.register(boundSes("ses_a", a));
  m.register(boundSes("ses_b", b));
  try {
    m.resolve("idn_a", { sessionId: "ses_b" });
    assert.fail("must throw");
  } catch (e) {
    assert.equal(e?.code, "IDENTITY_SESSION_MISMATCH");
  }
  try {
    m.resolve("idn_a", { sessionId: "ses_nope" });
    assert.fail("must throw");
  } catch (e) {
    assert.equal(e?.code, "MISSING_SESSION");
  }
});

test("several sessions under one identity require an explicit choice", () => {
  const m = mgr();
  const a = idn("idn_a", "User-A");
  m.register(boundSes("ses_a1", a));
  m.register(boundSes("ses_a2", a));
  assert.throws(() => m.resolve("idn_a"), (e) => e?.code === "AMBIGUOUS_SESSION");
  assert.equal(m.resolve("idn_a", { sessionId: "ses_a2" }).session.session_id, "ses_a2");
});

test("usability: valid / expired / invalidated / unusable", () => {
  const m = mgr();
  const a = idn("idn_a", "User-A");
  m.register(boundSes("ses_ok", a, { expires_at: "2026-10-08T00:00:00.000Z" }));
  m.register(boundSes("ses_old", a, { expires_at: "2026-10-01T00:00:00.000Z" }));
  assert.equal(m.evaluate("idn_a", { sessionId: "ses_ok" }), "valid");
  assert.equal(m.evaluate("idn_a", { sessionId: "ses_old" }), "expired");
  assert.equal(evaluateSessionRecord({ status: "weird" }), "unusable");
  try {
    m.requireUsable("idn_a", { sessionId: "ses_old" });
    assert.fail("must throw");
  } catch (e) {
    assert.equal(e?.code, "SESSION_EXPIRED");
  }
  const inv = m.invalidate("idn_a", { sessionId: "ses_ok", reason: "rotated" });
  assert.equal(inv.session.status, "revoked");
  assert.equal(inv.provenance.source, "configured");
  assert.equal(inv.provenance.invalidation_reason, "rotated");
  assert.equal(m.evaluate("idn_a", { sessionId: "ses_ok" }), "invalidated");
  try {
    m.requireUsable("idn_a", { sessionId: "ses_ok" });
    assert.fail("must throw");
  } catch (e) {
    assert.equal(e?.code, "SESSION_INVALIDATED");
  }
  assert.throws(() => m.invalidate("idn_a", { sessionId: "ses_old", reason: "" }), /reason/);
});

test("R1 — invalid clock input is rejected fail-closed, never valid", () => {
  const m = mgr();
  const a = idn("idn_a", "User-A");
  m.register(boundSes("ses_old", a, { expires_at: "2026-10-01T00:00:00.000Z" }));
  // An expired session under a garbage clock must throw — not read "valid".
  for (const bad of ["tomorrow", NaN, Infinity, -Infinity, null, {}, []]) {
    assert.throws(
      () => evaluateSessionRecord({ status: "active", expires_at: "2026-10-01T00:00:00.000Z" }, { nowMs: bad }),
      (e) => e?.code === "CLOCK_INVALID",
      `clock ${String(bad)} must be rejected`
    );
  }
  assert.throws(
    () => m.requireUsable("idn_a", { sessionId: "ses_old", nowMs: "tomorrow" }),
    (e) => e?.code === "CLOCK_INVALID"
  );
  // Sane clocks still work.
  assert.equal(m.evaluate("idn_a", { sessionId: "ses_old" }), "expired");
});

test("R3 — unsafe provenance references are rejected at registration", () => {
  const m = mgr();
  const a = idn("idn_a", "User-A");
  for (const bad of ["Bearer abc.def", "sess=CCC; Path=/", "password=hunter2"]) {
    assert.throws(
      () => m.register(boundSes(`ses_${bad.length}`, a), { provenance: { source: "vault", reference: bad } }),
      (e) => e?.code === "SECRET_REFUSED",
      `provenance reference ${bad} must be refused`
    );
  }
  const ok = m.register(boundSes("ses_ok", a), { provenance: { source: "vault", reference: "vault:sess-ok" } });
  assert.equal(ok.provenance.reference, "vault:sess-ok");
});
