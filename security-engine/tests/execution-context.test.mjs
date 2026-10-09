/** Phase 2 Tests D, F + determinism — authenticated execution context. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createExecution } from "../execution/contract.mjs";
import { createIdentity, createSession, bindSession } from "../models/identity.mjs";
import { createSessionManager } from "../session/manager.mjs";
import { createAuthenticatedContext, traceProvenance } from "../execution/context.mjs";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const allow = { decision: "allow", reason: "test", checks: [], target_id: "tgt_1", correlation_id: "corr_t" };
const execOf = () =>
  createExecution({
    correlation_id: "corr_t",
    target: { target_id: "tgt_1" },
    scopeDecision: allow,
    budget: { maxRequests: 5, timeoutMs: 60000 },
  });
const idn = (id, label) => createIdentity({ identity_id: id, label });
const sesFor = (sid, identity, over = {}) =>
  bindSession(createSession({ session_id: sid, target_id: "tgt_1", ...over }), identity);

test("D — execution traces to identity + session without inspecting secrets", () => {
  const exec = execOf();
  const a = idn("idn_a", "User-A");
  const m = createSessionManager({ nowMs: () => NOW });
  m.register(sesFor("ses_a", a), { provenance: { source: "vault", reference: "vault:sess-a" } });
  const entry = m.requireUsable("idn_a", {});
  const ctx = createAuthenticatedContext({
    execution: exec,
    identity: a,
    session: entry.session,
    request_reference: "req_1",
    session_provenance: entry.provenance,
    nowMs: NOW,
  });
  assert.ok(ctx.context_id.startsWith("ctx_"));
  assert.equal(ctx.execution_id, exec.execution_id);
  assert.equal(ctx.identity_id, "idn_a");
  assert.equal(ctx.session_id, "ses_a");
  assert.equal(ctx.provenance.session_source, "vault");
  const chain = traceProvenance(ctx);
  assert.deepEqual(chain, {
    execution: exec.execution_id,
    identity: "idn_a",
    session: "ses_a",
    request: "req_1",
    correlation: "corr_t",
  });
  // Opaque references (vault:…) are safe to carry; raw secrets can never
  // exist here because Phase 1 factories refuse them at construction.
  assert.equal(ctx.provenance.session_reference, "vault:sess-a");
});

test("mismatched, unbound, expired, and revoked sessions are refused", () => {
  const exec = execOf();
  const a = idn("idn_a", "User-A");
  const b = idn("idn_b", "User-B");
  const sesB = sesFor("ses_b", b);
  assert.throws(
    () => createAuthenticatedContext({ execution: exec, identity: a, session: sesB, nowMs: NOW }),
    (e) => e?.code === "IDENTITY_MISMATCH"
  );
  const unbound = createSession({ session_id: "ses_x" });
  assert.throws(
    () => createAuthenticatedContext({ execution: exec, identity: a, session: unbound, nowMs: NOW }),
    (e) => e?.code === "MISSING_SESSION"
  );
  const old = sesFor("ses_old", a, { expires_at: "2026-10-01T00:00:00.000Z" });
  assert.throws(
    () => createAuthenticatedContext({ execution: exec, identity: a, session: old, nowMs: NOW }),
    (e) => e?.code === "SESSION_EXPIRED"
  );
  const dead = createSession({ session_id: "ses_d", target_id: "tgt_1", status: "revoked", identity_id: "idn_a" });
  assert.throws(
    () => createAuthenticatedContext({ execution: exec, identity: a, session: dead, nowMs: NOW }),
    (e) => e?.code === "SESSION_INVALIDATED"
  );
});

test("F — credential material never reaches errors or serialized contexts", () => {
  try {
    createSession({ session_id: "ses_x", cookie_jar_reference: "sess=CCC" });
    assert.fail("must throw");
  } catch (e) {
    assert.equal(e?.code, "SECRET_REFUSED");
    assert.ok(!String(e?.message).includes("sess=CCC"));
  }
  const exec = execOf();
  const a = idn("idn_a", "User-A");
  const ctx = createAuthenticatedContext({
    execution: exec,
    identity: a,
    session: sesFor("ses_a", a),
    nowMs: NOW,
  });
  const dumped = JSON.stringify(ctx);
  for (const secret of ["sess=CCC", "Bearer", "hunter2", "password"]) {
    assert.ok(!dumped.includes(secret), `leaked: ${secret}`);
  }
});

test("G — same inputs select the same identity/session across repetitions", () => {
  const exec = execOf();
  const a = idn("idn_a", "User-A");
  const session = sesFor("ses_a", a);
  const c1 = createAuthenticatedContext({ execution: exec, identity: a, session, nowMs: NOW });
  const c2 = createAuthenticatedContext({ execution: exec, identity: a, session, nowMs: NOW });
  assert.equal(c1.identity_id, c2.identity_id);
  assert.equal(c1.session_id, c2.session_id);
  assert.deepEqual(traceProvenance(c1), traceProvenance(c2));
  assert.equal(c1.request_reference, null);
});

test("R3 — unsafe session_provenance references are rejected in contexts", () => {
  const exec = execOf();
  const a = idn("idn_a", "User-A");
  const session = sesFor("ses_a", a);
  for (const bad of ["Bearer abc.def", "sess=CCC", "token=EEE"]) {
    assert.throws(
      () =>
        createAuthenticatedContext({
          execution: exec,
          identity: a,
          session,
          session_provenance: { source: "vault", reference: bad },
          nowMs: NOW,
        }),
      (e) => e?.code === "SECRET_REFUSED",
      `context provenance reference ${bad} must be refused`
    );
  }
});
