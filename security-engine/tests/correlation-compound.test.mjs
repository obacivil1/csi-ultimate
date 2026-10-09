/** Phase 5 compound correlation — mandated matrix, non-vacuous assertions. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFinding, transitionFinding } from "../models/finding.mjs";
import { createRegistry } from "../registry/registry.mjs";
import { sha256Hex } from "../common.mjs";
import {
  correlatePair,
  normalizeScopeDecision,
  normalizeIdentitySet,
  compoundFindingId,
  COMPOUND_DETECTOR_SPEC,
} from "../compound/compound.mjs";

const mkFinding = (over = {}) => createFinding({
  finding_type: "authorization",
  title: "t",
  expected_boundary: "b",
  observed_behavior: "o",
  security_relevance: "s",
  confidence: { level: "medium", score: 0.6, reasons: ["r"], rationale: "rr" },
  impact: { level: "low", rationale: "i" },
  severity: { level: "low", rationale: "r" },
  scope_status: { decision: "allow" },
  identity_references: ["idn_a"],
  resource_reference: "res_1",
  target_id: "tgt_1",
  evidence_references: ["ev_1"],
  metadata: {},
  ...over,
});
const mkRace = (over = {}) => mkFinding({ finding_type: "race", identity_references: ["idn_a|ses_1"], ...over });
const pair = (aOver = {}, rOver = {}) => [mkFinding(aOver), mkRace(rOver)];
// Spread-built records bypass factory validation, letting malformed values
// reach correlatePair itself (factory-built records are always well-formed).
const rawFinding = (over = {}) => ({ ...mkFinding({}), ...over });
const rawRace = (over = {}) => ({ ...mkRace({}), ...over });

test("scope normalization unit: fixed vocabulary only", () => {
  assert.equal(normalizeScopeDecision("allow"), "allow");
  assert.equal(normalizeScopeDecision("deny"), "deny");
  assert.equal(normalizeScopeDecision("unknown"), "unknown");
  for (const bad of [undefined, null, {}, [], "arbitrary", 42, true]) {
    assert.equal(normalizeScopeDecision(bad), "unknown", JSON.stringify(bad));
  }
});

test("scope truth table: allow+allow→allow, else unknown; deny anywhere refuses", () => {
  const cases = [
    [{}, {}, "allow"],
    [{ scope_status: { decision: "unknown" } }, {}, "unknown"],
    [{}, { scope_status: { decision: "unknown" } }, "unknown"],
    [{ scope_status: { decision: "unknown" } }, { scope_status: { decision: "unknown" } }, "unknown"],
  ];
  for (const [aOver, rOver, expected] of cases) {
    const out = correlatePair(...pair(aOver, rOver));
    assert.equal(out.linked, true);
    assert.equal(out.compound.scope_status.decision, expected);
  }
  for (const [aOver, rOver] of [
    [{ scope_status: { decision: "deny" } }, {}],
    [{}, { scope_status: { decision: "deny" } }],
    [{ scope_status: { decision: "deny" } }, { scope_status: { decision: "unknown" } }],
    [{ scope_status: { decision: "unknown" } }, { scope_status: { decision: "deny" } }],
  ]) {
    const out = correlatePair(...pair(aOver, rOver));
    assert.equal(out.linked, false);
    assert.deepEqual(out.reasons, ["scope-deny"]);
  }
});

test("malformed scope normalizes and never propagates raw values", () => {
  const rawObj = { zzzmalformed: "QZX-OBJ-1" };
  const rawArr = ["QZX-ARR-1"];
  const cases = [
    [{ scope_status: { decision: "WEIRD-SCOPE-1" } }, {}, "WEIRD-SCOPE-1", { authorization: "unknown", race: "allow" }],
    [{ scope_status: { decision: rawObj } }, {}, "QZX-OBJ-1", { authorization: "unknown", race: "allow" }],
    [{}, { scope_status: { decision: rawArr } }, "QZX-ARR-1", { authorization: "allow", race: "unknown" }],
    [{}, {}, null, { authorization: "allow", race: "allow" }],
  ];
  for (const [aOver, rOver, secret, expectedPair] of cases) {
    const out = correlatePair(rawFinding(aOver), rawRace(rOver));
    assert.equal(out.linked, true);
    assert.equal(out.compound.scope_status.decision, expectedPair.authorization === "allow" && expectedPair.race === "allow" ? "allow" : "unknown");
    assert.deepEqual(out.compound.metadata.scope_pair, expectedPair);
    if (secret) {
      const dumped = JSON.stringify({ c: out.compound, o: out.observation, e: out.evidence });
      assert.ok(!dumped.includes(secret), `leaked scope value: ${secret}`);
    }
  }
  // scope_pair vocabulary lock: only fixed tokens may appear.
  const locked = correlatePair(rawFinding({}), rawRace({}));
  for (const tok of [locked.compound.metadata.scope_pair.authorization, locked.compound.metadata.scope_pair.race]) {
    assert.ok(["allow", "deny", "unknown"].includes(tok));
  }
});

test("reproduction: paired only when both safe; unsafe never propagates", () => {
  const expected = `paired:${sha256Hex("vault:tok-001").slice(0, 16)}:${sha256Hex("ref:run-02").slice(0, 16)}`;
  const both = correlatePair(...pair(
    { reproduction_reference: "vault:tok-001" },
    { reproduction_reference: "ref:run-02" },
  ));
  assert.equal(both.linked, true);
  assert.equal(both.compound.reproduction_reference, expected);
  assert.deepEqual(both.compound.metadata.reproduction, { authorization: "vault:tok-001", race: "ref:run-02" });
  const cases = [
    [{ reproduction_reference: "vault:tok-001" }, {}, { authorization: "vault:tok-001", race: null }],
    [{}, { reproduction_reference: "ref:run-02" }, { authorization: null, race: "ref:run-02" }],
    [{ reproduction_reference: "Bearer s3cr3t-ZZZ" }, {}, { authorization: null, race: null }],
    [{}, { reproduction_reference: "sess=CCC" }, { authorization: null, race: null }],
  ];
  for (const [aOver, rOver, meta] of cases) {
    const out = correlatePair(...pair(aOver, rOver));
    assert.equal(out.linked, true);
    assert.equal(out.compound.reproduction_reference, null);
    assert.deepEqual(out.compound.metadata.reproduction, meta);
    const dumped = JSON.stringify(out);
    assert.ok(!dumped.includes("s3cr3t-ZZZ") && !dumped.includes("sess=CCC"));
  }
  // Non-string reproduction values bypass factory validation via spread records.
  const malformed = correlatePair(rawFinding({ reproduction_reference: "Bearer s3cr3t-ZZZ" }), rawRace({ reproduction_reference: 42 }));
  assert.equal(malformed.linked, true);
  assert.equal(malformed.compound.reproduction_reference, null);
  assert.deepEqual(malformed.compound.metadata.reproduction, { authorization: null, race: null });
  assert.ok(!JSON.stringify(malformed).includes("s3cr3t-ZZZ"));
  assert.equal(both.compound.status, "candidate");
});

test("lifecycle: no shortcut to validated; existing gate intact both ways", () => {
  const both = correlatePair(...pair(
    { reproduction_reference: "vault:tok-001" },
    { reproduction_reference: "ref:run-02" },
  ));
  assert.throws(() => transitionFinding(both.compound, "validated", { reason: "" }), /reason/);
  const v = transitionFinding(both.compound, "validated", { reason: "human review" });
  assert.equal(v.status, "validated");
  assert.equal(both.compound.status, "candidate");
});

test("tenant table: equal/absent link; contradiction/malformed refuse", () => {
  const T = (t) => (t === undefined ? {} : { metadata: { tenant_id: t } });
  for (const [a, r] of [
    ["tenant-a", "tenant-a"], ["tenant-a", undefined], [undefined, "tenant-a"], [undefined, undefined],
    ["tenant-a", null], [null, "tenant-a"], ["tenant-a", ""],
  ]) {
    const out = correlatePair(...pair(T(a), T(r)));
    assert.equal(out.linked, true, `tenant ${JSON.stringify(a)} vs ${JSON.stringify(r)}`);
  }
  for (const [a, r, reason] of [
    ["tenant-a", "tenant-b", "tenant-contradiction"],
    [42, "tenant-a", "tenant-malformed"],
    ["tenant-a", {}, "tenant-malformed"],
  ]) {
    const out = correlatePair(...pair(T(a), T(r)));
    assert.equal(out.linked, false);
    assert.deepEqual(out.reasons, [reason]);
  }
});

test("identity normalization: exact keys, malformed shapes never intersect", () => {
  const link = (aIds, rIds) => correlatePair(...pair({ identity_references: aIds }, { identity_references: rIds, metadata: {} })).linked;
  assert.equal(link(["idn_a"], ["idn_a|ses_1"]), true);
  assert.equal(link(["idn_a", "idn_b"], ["idn_b|ses_9"]), true);
  for (const bad of ["A|B|", "|A|B", "A||B", ""]) {
    assert.equal(link([bad], ["A"]), false, `malformed ${JSON.stringify(bad)}`);
  }
  assert.equal(link(["A"], ["a"]), false);
  assert.equal(link(["A"], [" A"]), false);
  assert.equal(link(["idn_a"], ["idn_b"]), false);
  assert.equal(normalizeIdentitySet("nope").length, 0);
  assert.deepEqual(normalizeIdentitySet(["b|1", "a"]), ["1", "a", "b"]);
});

test("target/resource equality: strict, non-empty, no normalization", () => {
  const t = (tgt, res) => correlatePair(rawFinding({ target_id: tgt }), rawRace({ target_id: tgt, resource_reference: res })).linked;
  assert.equal(t("tgt_1", "res_1"), true);
  const diff = correlatePair(...pair({ target_id: "tgt_1" }, { target_id: "tgt_2" }));
  assert.equal(diff.linked, false);
  assert.deepEqual(diff.reasons, ["target-mismatch"]);
  const rdiff = correlatePair(...pair({}, { resource_reference: "res_2" }));
  assert.equal(rdiff.linked, false);
  assert.deepEqual(rdiff.reasons, ["resource-mismatch"]);
  for (const bad of [null, "", undefined, 42, {}]) {
    const o1 = correlatePair(rawFinding({ target_id: bad }), rawRace({}));
    assert.equal(o1.linked, false, `target ${JSON.stringify(bad)}`);
    const o2 = correlatePair(rawFinding({ resource_reference: bad }), rawRace({}));
    assert.equal(o2.linked, false, `resource ${JSON.stringify(bad)}`);
  }
  assert.equal(correlatePair(...pair({ target_id: "TGT_1" }, {})).linked, false);
  assert.equal(correlatePair(...pair({ target_id: "tgt_1 " }, {})).linked, false);
  assert.equal(correlatePair(...pair({ resource_reference: "RES_1" }, {})).linked, false);
});

test("lifecycle matrix: permitted pairs yield candidate; rejected/missing refuse", () => {
  for (const [a, r] of [["candidate", "candidate"], ["candidate", "validated"], ["validated", "candidate"], ["validated", "validated"]]) {
    const out = correlatePair(...pair({ status: a }, { status: r }));
    assert.equal(out.linked, true, `${a}+${r}`);
    assert.equal(out.compound.status, "candidate");
  }
  for (const [a, r] of [["candidate", "rejected"], ["rejected", "candidate"], ["rejected", "rejected"]]) {
    const out = correlatePair(...pair({ status: a }, { status: r }));
    assert.equal(out.linked, false, `${a}+${r}`);
    assert.deepEqual(out.reasons, ["status-not-permitted"]);
  }
  const missingStatus = { ...mkFinding({}), status: undefined };
  const miss = correlatePair(missingStatus, mkRace({}));
  assert.equal(miss.linked, false);
  assert.deepEqual(miss.reasons, ["status-not-permitted"]);
  // Sources byte-identical before and after; output deeply frozen.
  const s1 = mkFinding({});
  const s2 = mkRace({});
  const before = JSON.stringify([s1, s2]);
  const res = correlatePair(s1, s2);
  assert.equal(JSON.stringify([s1, s2]), before);
  assert.ok(Object.isFrozen(res) && Object.isFrozen(res.compound) && Object.isFrozen(res.observation) && Object.isFrozen(res.evidence));
});

test("evidence completeness: empty/malformed refused; complete accepted", () => {
  assert.equal(correlatePair(rawFinding({ evidence_references: [] }), rawRace({})).linked, false);
  assert.deepEqual(correlatePair(rawFinding({ evidence_references: [] }), rawRace({})).reasons, ["evidence-incomplete"]);
  assert.equal(correlatePair(rawFinding({ evidence_references: ["", 42] }), rawRace({})).linked, false);
  assert.equal(correlatePair(rawFinding({ expected_boundary: "" }), rawRace({})).linked, false);
});

test("determinism: rerun identity, order-swapped identity, exact recompute", () => {
  const s3 = mkFinding({});
  const s4 = mkRace({});
  const x1 = correlatePair(s3, s4);
  const x2 = correlatePair(mkFinding({ finding_id: s3.finding_id }), mkRace({ finding_id: s4.finding_id }));
  assert.equal(x1.compound.finding_id, x2.compound.finding_id);
  const [lo, hi] = [s3.finding_id, s4.finding_id].sort();
  const expected = `compound:${sha256Hex(`${lo}|${hi}`).slice(0, 16)}`;
  assert.equal(x1.compound.finding_id, expected);
  assert.equal(compoundFindingId("", "x"), null);
  assert.equal(compoundFindingId("x", 42), null);
});

test("vacuity: fabricated-linkage attempts yield no compound", () => {
  assert.equal(correlatePair(...pair({ metadata: { tenant_id: "tenant-a" } }, { metadata: { tenant_id: "tenant-b" } })).linked, false);
  assert.equal(correlatePair(...pair({ target_id: null }, {})).linked, false);
  assert.equal(correlatePair(...pair({ evidence_references: [] }, {})).linked, false);
});

test("protected surface: module import registers nothing; spec is inert", async () => {
  const reg = createRegistry();
  assert.deepEqual(reg.list(), []);
  assert.deepEqual((await reg.executeAll({})).status, "not_ready");
  assert.equal(COMPOUND_DETECTOR_SPEC.status, "disabled");
  assert.equal(typeof COMPOUND_DETECTOR_SPEC.execute, "undefined");
  assert.deepEqual(COMPOUND_DETECTOR_SPEC.specialization, "general");
});

test("LOW-1(a) — absent scope_status object normalizes to unknown (eligible)", () => {
  const noScope = { ...mkFinding({}), scope_status: undefined };
  const out = correlatePair(noScope, mkRace({}));
  assert.equal(out.linked, true);
  assert.equal(out.compound.scope_status.decision, "unknown");
  assert.deepEqual(out.compound.metadata.scope_pair, { authorization: "unknown", race: "allow" });
  assert.ok(out.compound.finding_id.startsWith("compound:"));
});

test("LOW-1(b) — non-string status refuses with exact reason", () => {
  for (const bad of [42, true, {}, []]) {
    const rec = { ...mkFinding({}), status: bad };
    const out = correlatePair(rec, mkRace({}));
    assert.equal(out.linked, false, `status ${JSON.stringify(bad)}`);
    assert.deepEqual(out.reasons, ["status-not-permitted"]);
    assert.equal(out.compound, null);
  }
});

test("LOW-1(c) — non-array identity_references cannot intersect", () => {
  for (const bad of ["idn_a", 42, {}, null]) {
    const rec = { ...mkFinding({}), identity_references: bad };
    const out = correlatePair(rec, mkRace({}));
    assert.equal(out.linked, false, `identity_references ${JSON.stringify(bad)}`);
    assert.deepEqual(out.reasons, ["no-identity-intersection"]);
    assert.equal(out.compound, null);
  }
});

test("LOW-1(d) — absent metadata object means absent tenant (eligible)", () => {
  const noMeta = { ...mkFinding({}), metadata: undefined };
  const out = correlatePair(noMeta, mkRace({}));
  assert.equal(out.linked, true);
  assert.deepEqual(out.compound.metadata.tenant_pair, { authorization: null, race: null });
  const before = JSON.stringify(noMeta);
  correlatePair(noMeta, mkRace({}));
  assert.equal(JSON.stringify(noMeta), before);
});
