# PHASE 3 — CONTROLLED AUTHORIZATION DIRECTIVE

**Document:** `PHASE_3_CONTROLLED_AUTHORIZATION_DIRECTIVE.md`
**Status:** AUTHORITATIVE
**Phase:** 3
**Mode:** CONTROLLED IMPLEMENTATION
**Preconditions:** Phase 1 PASS · Phase 2 CLOSED (including Repair R1/R2/R3)
**Next Phase:** Phase 4 (Race Engine) — NOT AUTHORIZED
**Primary Boundary:** Differential authorization analysis foundation only

---

## 1. AUTHORITY

This document is the **sole authoritative implementation directive for Phase 3**.

The implementer MUST NOT derive Phase 3 scope from:

* the master roadmap;
* previous conversations;
* previous prompts;
* descriptive architecture documents;
* study plans;
* existing experimental implementations;
* assumptions about Phase 4 or any later phase.

Where this directive conflicts with a descriptive document, this directive takes precedence for Phase 3.

No work outside the explicit Phase 3 boundary is authorized.

Construction basis (consistency, not scope): Phase 1 directive §§4, 5, 17–23, 30–31 (additive engine, contracts, registry, execution, differential, evidence, secret handling, hard stops) and Phase 2 directive §§5–8, 10–17 (identity/session foundation, isolation, determinism, provenance, non-goals, lifecycle discipline).

---

## 2. PHASE 3 MANDATE

Phase 3 shall establish the controlled **differential authorization analysis foundation**: the capability to execute equivalent requests under distinct, explicitly bound target identities and to compare the outcomes using the Phase 1 differential contract — producing observations and, only where the evidence standard of §7 is fully met, candidate findings.

Phase 3 answers, deterministically and with provenance:

1. What does Identity A observe when acting on Resource R?
2. What does Identity B observe for the equivalent action on R?
3. What changed between the two observations (same / different / inconclusive)?
4. What authorization boundary was expected, and on what cited basis?
5. Was that boundary crossed — or is the outcome inconclusive?
6. Can every step be replayed to the same conclusion?
7. Can a reviewer trace each conclusion to identity, session, request, and evidence without inspecting secrets?

Phase 3 SHALL NOT attempt to become an autonomous vulnerability scanner, an exploit framework, or a general authorization oracle.

---

## 3. CORE PRINCIPLES (binding, carried from Phases 1–2)

* HTTP status + URL + body is **never** sufficient evidence of an authorization decision (Phase 2 §3, extended here).
* A response difference between two identities is a **signal**, not a finding.
* `UNKNOWN` policy outcomes are **inconclusive**, never findings.
* Explicit state > implicit state; deterministic behavior > heuristics; provenance > inference; failure > unsafe fallback; reuse > parallel architecture; controlled scope > opportunistic capability.

---

## 4. REQUIRED OUTCOME

At the end of Phase 3 the engine must possess, tested and documented:

* a closed, explicitly enumerated comparison set (§5.1) — nothing outside it;
* two-or-more-identity differential execution over Phase 2 contexts;
* authorization observations with full provenance;
* candidate findings meeting §7 — and nothing else elevated beyond observation;
* measured false-positive behavior on safe fixtures (§13/T7);
* a mandatory pre-closure Red-Team audit disposition (§17).

---

## 5. SCOPE

### 5.1 Closed comparison set

Phase 3 is authorized to implement differential comparison **only** across these dimensions (candidate generation, never verdicts by themselves):

1. **Object-level (same tenant):** Identity A acts on a resource owned by Identity B.
2. **Function-level:** a non-privileged identity reaches a privileged function. Privileged functions MUST come from an explicit per-fixture manifest or from observed denial differentials — never from URL-keyword guessing.
3. **Cross-tenant:** an identity of Tenant A acts on a resource of Tenant B.
4. **Horizontal role:** same-role peer resource access.
5. **Vertical role:** lower-role identity reaches higher-role function.
6. **Method drift:** same endpoint across methods with differing authorization outcomes (observation; candidate only with full boundary analysis).

Any further dimension requires a separate authoritative directive.

### 5.2 Identity-matrix execution

* Every comparison executes under Phase 2 identities/sessions via `createAuthenticatedContext` (or its compatible successor): minimum two identities, plus an unauthenticated baseline where the fixture supports it.
* Sessions enter exclusively as pre-bound opaque references (Phase 2 manager). Target login automation, credential harvesting, guessing, synthesis, or derivation remain prohibited (Phase 1 §3; Phase 2 §6.2).
* Deterministic selection (Phase 2 registry semantics) governs which identities execute; implicit fallback to another identity, a prior session, or anonymous access is prohibited.

### 5.3 Resource references

* Reuse the Phase 1 Resource contract. External identifiers are observed from responses; response bodies remain hash-only per Phase 1 secret policy — full bodies are never persisted to derive identifiers.

### 5.4 Observation production

* Every comparison emits Phase 1 Observations carrying the Phase 2 execution context. Observations carry no verdict field and imply no vulnerability (§13 of the Phase 2 directive is preserved).

### 5.5 From observation to candidate (and no further by default)

* An observation becomes a **candidate** finding only when §6 yields `BOUNDARY-CROSSING` with a cited expected boundary **and** §7's evidence pack is complete.
* Single-identity success, uncompared, is an observation at most — never a candidate.
* Candidates enter the Phase 1 finding lifecycle at `candidate`; `validated` requires reproduction + reason per the existing lifecycle rules. Nothing in Phase 3 auto-validates.

---

## 6. AUTHORIZATION SEMANTICS (explicit decision theory)

### 6.1 Observed outcomes (vocabulary)

* `ALLOW` — success-class status with a resource representation or state effect.
* `DENY` — authentication/authorization refusal (401/403-class) or policy-grounded refusal.
* `AMBIGUOUS` — redirects, rate limits, errors, captchas, timeouts, empty responses, and any response whose authorization meaning cannot be established. `AMBIGUOUS` is always `INCONCLUSIVE`.

Status codes are signals. No status code, alone or combined with a URL, decides a boundary.

### 6.2 Expected-boundary sources (strict precedence)

1. Explicit rules (program scope document, fixture manifest).
2. Directly observed denial for the same actor class on the same function.
3. Conservative inference from role hierarchy and tenant ownership.
4. **Unknown** — yields `INCONCLUSIVE`, never a finding.

The cited source MUST be recorded on every candidate (`boundary_source`).

### 6.3 Boundary-crossing rules

* **Object-level:** A acts on R owned by B (same tenant), observed `ALLOW`, no legitimizing authorization evidenced → candidate.
* **Function-level:** non-privileged identity obtains `ALLOW` on a manifest-listed (or denial-differential-proven) privileged function → candidate.
* **Cross-tenant:** A-tenant identity obtains representation or state effect on a B-tenant resource → candidate (highest bar: representation/state evidence required, never status alone).
* **Horizontal:** same-role peer `ALLOW` on a non-shared resource → candidate.
* **Vertical:** lower-role `ALLOW` on higher-role function → candidate.
* **Method drift:** differing outcomes across methods → observation; candidate only when a rule above is independently satisfied.

### 6.4 Prohibited inferences (non-exhaustive, binding)

The engine must NOT conclude a boundary crossing merely because: two identities receive the same status; two responses look similar; a resource is accessible; a request succeeds; a response contains an object; HTTP 200/201/204 is returned; a URL contains "admin", "manage", "api", or a numeric ID; one tenant's resource name resembles another's.

---

## 7. EVIDENCE REQUIREMENTS

Every candidate MUST carry a complete evidence pack — all thirteen, non-vacuous:

1. actor identity (+ role, tenant); 2. target resource (+ owner, tenant);
3. endpoint + HTTP method; 4. exact request difference between the compared executions;
5. expected boundary; 6. cited boundary source (§6.2 level); 7. observed behavior per identity;
8. state before / state after; 9. Phase 2 provenance chain (execution→identity→session→request);
10. minimal reproduction sequence; 11. confidence / impact / severity as **separate** objects with rationales;
12. scope status (gate decision + reference); 13. lifecycle state (`candidate` unless lifecycle rules promote it).

Incomplete packs are observations, downgraded automatically and explicitly.

---

## 8. SECURITY REQUIREMENTS

* **Secret hygiene (Phase 1 rules extended):** no passwords, tokens, cookies, API keys, authorization headers, or credentials in logs, errors, evidence, or reports; response bodies hash-only; identifiers/references only. Provenance references obey the opaque-reference policy (R3 precedent).
* **Isolation:** execution contexts are never shared across identities; sessions resolve per Phase 2 manager semantics; registry selection stays deterministic with no fallback.
* **Explicit failure:** unknown identity, missing/invalid/expired session, mismatch, ambiguous comparison, missing boundary source, or incomplete evidence MUST yield explicit `INCONCLUSIVE`/refusal states — never downgrade to anonymous, another identity, a default credential, or assumed-allowed.
* **Lab-only execution:** all Phase 3 execution occurs against loopback/authorized fixtures inside the existing scope framework. External-target scanning is prohibited. Detectors remain **disabled by default**; enabling is permitted only inside test/lab runs, never as shipped default.

---

## 9. ARCHITECTURE BOUNDARIES

* Additive only, inside `security-engine/` (+ its tests). Consume Phase 1 (differential, evidence, finding, registry, execution, scope gate, stores) and Phase 2 (registry, manager, context) contracts — duplicate none of them.
* No new HTTP clients; no scope-validator changes; no SSRF-guard changes; no report-builder replacement; no database migration; no new dependencies.
* `local-lab` existing scenarios MUST NOT be altered in behavior. Additive fixture scenarios (e.g., two-tenant or role fixtures) are permitted **only** with written justification in the final report and zero impact on existing scenarios.
* No second identity/session/differential/evidence subsystem (§8.2–8.3 of Phase 2 apply by reference).

---

## 10. PROTECTED AREAS

Phase 1 contracts and behavior; Phase 2 foundation (extend only compatibly, with documented impact); existing application authentication (`web/routes/auth.mjs`, middleware); `core/db.mjs` + migrations; existing detector call sites and behavior; `pentest_tool.py`; recon orchestration/crawler wiring; production routes; enterprise audit documents; unrelated UI/reporting/BIM; Nuclei or any external scanning integration; deployment infrastructure.

---

## 11. NON-GOALS (explicitly prohibited)

Race/TOCTOU detection; synchronized attack dispatch; Nuclei integration or templates; CVE scanning; generic vulnerability scanning; commodity detectors (XSS/SQLi/redirect/headers/fingerprinting); exploit chaining or autonomous attack-path generation; probabilistic authorization inference; AI-generated vulnerability conclusions; external-target execution; production enablement of detectors; target login automation; credential harvesting/guessing/synthesis; new dependencies; database changes; scope or auth-route changes; opportunistic refactoring, renaming, or restructuring.

---

## 12. DETERMINISM AND FAIL-CLOSED RULES

* Same configured identities, sessions, fixtures, and inputs MUST yield the same comparisons, verdicts, and evidence hashes across repetitions (clock and randomness confined to record IDs, never decisions).
* Any unavailable prerequisite (identity, session, boundary source, evidence field, fixture) produces an explicit `INCONCLUSIVE`/`not_ready`/`blocked` outcome — recorded, never silent, never success.
* Comparison outcomes use only `same | different | inconclusive`; authorization outcomes only `WITHIN-BOUNDARY | BOUNDARY-CROSSING (candidate) | INCONCLUSIVE`.

---

## 13. REQUIRED TESTING

* **T1 — Matrix:** on fixtures, own-resource `ALLOW` observed; other-identity/tenant `DENY` observed; unauthenticated `DENY` observed.
* **T2 — Unknown policy:** unknown boundary source → `INCONCLUSIVE`; zero candidates emitted.
* **T3 — Differential reuse:** Phase 1 comparison contract exercised (same/different/inconclusive incl. tolerance and missing-signal paths).
* **T4 — Evidence completeness:** every candidate carries all 13 pack fields, non-vacuous; incomplete packs auto-downgrade.
* **T5 — Secret hygiene:** planted credential/response-body material appears in no evidence, error, or serialized output.
* **T6 — Determinism:** repeated runs over fixed fixtures yield identical verdicts and evidence hashes.
* **T7 — Negative controls + FP measurement:** full pipeline over safe fixtures yields **zero validated findings**; report counts (candidates / inconclusive / validated) as the quality gate.
* **T8 — Regression:** Phase 1 (44) + Phase 2 (14) + Repair (4) suites green; `npm test` 270; recon pytest 210; root scope 19; no new failures (pre-existing environmental local-lab failures recorded, not repaired).
* **T9 — Registry discipline:** detectors ship disabled; zero-detector operation intact; enabling occurs only inside test/lab runs.

---

## 14. IMPLEMENTATION RULES

Additive development; reuse before duplication; no parallel architecture; no opportunistic refactoring, cleanup, renaming, dependency upgrades, UI changes, performance rewrites, or repository restructuring. Before modifying any file, verify the change is directly required by this directive.

---

## 15. HARD STOPS

STOP immediately (report blocker, affected component, why this directive is insufficient, minimum clarification needed — do not improvise) if:

1. A required decision is not defined here or in Phase 1/2 contracts.
2. A protected component must be substantially changed.
3. Phase 3 requires race-condition logic or synchronized dispatch.
4. Phase 3 requires Nuclei or another external scanning framework.
5. Phase 1/2 behavior must be intentionally broken.
6. A security decision would require guessing (esp. boundary sources).
7. Identity/session isolation cannot be guaranteed.
8. External-target execution or login automation becomes necessary.
9. Tests reveal unexplained regression.
10. Scope must materially expand beyond §5.

---

## 16. DEFINITION OF DONE

Phase 3 is complete only when ALL are true:

* [ ] Phase 1 + Phase 2 baselines reverified before work.
* [ ] Closed comparison set (§5.1) implemented — nothing outside it.
* [ ] Multi-identity differential execution over Phase 2 contexts works.
* [ ] Observations carry full provenance; no verdict fields on observations.
* [ ] Candidates require cited boundary source + complete 13-field pack.
* [ ] §6.4 prohibited inferences absent (tested, incl. 200-alone and URL-keyword cases).
* [ ] Unknown policy yields `INCONCLUSIVE`, zero candidates (tested).
* [ ] Secret hygiene holds across evidence, errors, serialization (tested).
* [ ] Determinism holds across repetitions (tested).
* [ ] Negative controls yield zero validated findings; FP counts reported.
* [ ] Detectors ship disabled; lab-only enabling (tested).
* [ ] All T1–T9 pass; full regression green with no new failures.
* [ ] No protected component modified in behavior.
* [ ] No race/Nuclei/generic-scanner/login-automation code exists.
* [ ] No new dependencies; no migrations; no scope/auth changes.
* [ ] Mandatory pre-closure Red-Team audit completed with disposition (§17).
* [ ] Change inventory, test evidence, and scope-compliance statement produced.
* [ ] Architecture remains additive and reversible.

---

## 17. RED-TEAM AUDIT (mandatory, pre-closure)

Before Phase 3 closure, an independent read-only Red-Team audit MUST execute against implementation + tests + contracts, covering: verdict discipline (§6), evidence completeness (§7), isolation/secret hygiene (§8), determinism (§12), bypass paths, scope leakage (race/Nuclei/generic scanning), and regression integrity.

Disposition rules: `PASS` or `PASS WITH FINDINGS` (non-blocking only) permits closure review; any blocking/Critical finding forces a repair-directive cycle — closure is forbidden until repaired and re-audited.

---

## 18. CLOSURE CONDITIONS

Phase 3 may proceed to closure review if and only if: every §16 item is true; the §17 audit disposition is `PASS` or `PASS WITH FINDINGS` with zero blocking findings; the final report (§19) is complete; and no hard-stop condition is open.

---

## 19. REQUIRED FINAL REPORT

* **A.** Executive Result (`PASS` / `FAIL` / `BLOCKED`).
* **B.** Files Changed (exact paths; created/modified/deleted/renamed counts).
* **C.** Protected Files Verification (Phase 1, Phase 2, app auth, db, scopes, detectors, recon wiring).
* **D.** Authorization Foundation (what was built; dimension-by-dimension).
* **E.** Semantics Compliance (how §6 verdict discipline is enforced; prohibited inferences tested).
* **F.** Evidence Compliance (13-field packs; lifecycle; separation of confidence/impact/severity).
* **G.** Security Review (isolation, secrets, lab-only, disabled-by-default).
* **H.** Tests (T1–T9 results; regression table with exact commands; FP counts).
* **I.** Scope Compliance (explicit confirmations mirroring §11 + §15 clean record).
* **J.** Deviations (`NONE` or itemized).
* **K.** Red-Team Audit (scope, verdict, findings with severities, disposition).
* **L.** Remaining Limitations (deferred items only).
* **M.** Recommendation (`PHASE 3 PASS — READY FOR REVIEW` / `FAIL — REPAIR REQUIRED` / `BLOCKED — DECISION REQUIRED`).

---

## 20. PHASE BOUNDARY

When §16 + §18 are satisfied, STOP. Do not begin Phase 4 (Race Engine); do not implement race detection, synchronized dispatch, or any authorization-detector expansion; do not optimize unrelated systems. Further work requires a separate authoritative directive.

---

## 21. FINAL AUTHORIZATION STATEMENT

This directive authorizes only the **differential authorization analysis foundation** defined above — comparisons, observations, and evidence-gated candidates built strictly on the protected Phase 1 and closed Phase 2 foundations.

It does NOT authorize the engine to exploit vulnerabilities, to act on findings, to scan external targets, to automate authentication, or to decide anything by guessing.

Favor, in order: **explicit state > implicit state · deterministic behavior > heuristics · provenance > inference · failure > unsafe fallback · reuse > parallel architecture · controlled scope > opportunistic capability**.

**END OF PHASE 3 DIRECTIVE**
