/** Phase 4 bindings — H1 tripartition + R1 transport policy. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOperationDescriptor, validateOperationBindings } from "../race/bindings.mjs";

const desc = (over = {}) => ({ endpoint_id: "ep_transfer", method: "post", ...over });
const good = () => validateOperationBindings({
  descriptor: desc({ params_metadata: [{ name: "amount", location: "body" }] }),
  bindings: { amount: 60 },
  transport: { retries: 0 },
});

test("valid descriptor + bindings + retry-free transport accepted", () => {
  const out = good();
  assert.equal(out.descriptor.method, "POST");
  assert.equal(out.bindings.amount, 60);
  assert.deepEqual(out.transport, { retries: 0 });
  assert.ok(Object.isFrozen(out) && Object.isFrozen(out.bindings));
});

test("missing bindings or missing declared params → EXECUTION_UNAVAILABLE", () => {
  assert.throws(
    () => validateOperationBindings({ descriptor: desc(), bindings: null, transport: { retries: 0 } }),
    (e) => e?.code === "EXECUTION_UNAVAILABLE"
  );
  assert.throws(
    () => validateOperationBindings({
      descriptor: desc({ params_metadata: [{ name: "amount", location: "body" }] }),
      bindings: {},
      transport: { retries: 0 },
    }),
    (e) => e?.code === "EXECUTION_UNAVAILABLE"
  );
});

test("secret-shaped binding names refused; non-primitives refused", () => {
  for (const name of ["password", "token", "api-key", "cookie", "Authorization", "secret"]) {
    assert.throws(
      () => validateOperationBindings({ descriptor: desc(), bindings: { [name]: "x" }, transport: { retries: 0 } }),
      (e) => e?.code === "SECRET_REFUSED",
      `binding name ${name}`
    );
  }
  assert.throws(
    () => validateOperationBindings({ descriptor: desc(), bindings: { amount: { nested: 1 } }, transport: { retries: 0 } }),
    (e) => e?.code === "BINDING_INVALID"
  );
  assert.throws(
    () => validateOperationBindings({ descriptor: desc(), bindings: { amount: [1] }, transport: { retries: 0 } }),
    (e) => e?.code === "BINDING_INVALID"
  );
});

test("R1 — retry-enabled transports rejected at registration", () => {
  for (const transport of [{ retries: 1 }, { retries: 3 }, {}, null]) {
    assert.throws(
      () => validateOperationBindings({ descriptor: desc(), bindings: {}, transport }),
      (e) => e?.code === "BINDING_INVALID" || e?.code === "MODEL_VALIDATION",
      `transport ${JSON.stringify(transport)}`
    );
  }
});

test("descriptor hygiene: method token, values stay in bindings", () => {
  assert.throws(
    () => validateOperationDescriptor({ endpoint_id: "e", method: "GE T" }),
    (e) => e?.code === "BINDING_INVALID"
  );
  assert.throws(
    () => validateOperationDescriptor({ endpoint_id: "e", method: "GET", params_metadata: [{ name: "a", location: "query", value: 1 }] }),
    (e) => e?.code === "BINDING_INVALID"
  );
  assert.throws(() => validateOperationDescriptor({ method: "GET" }), (e) => e?.code === "MODEL_VALIDATION");
});
