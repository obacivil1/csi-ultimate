#!/usr/bin/env node
import { ConceptAbstractionEngine } from "./core/concept-abstraction-engine.mjs";

function assert(cond, label, detail) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ❌ ${label}`);
    if (detail) console.log(`     ${detail}`);
    process.exitCode = 1;
  }
}

async function section(name, fn) {
  console.log(`\n📌 ${name}`);
  try {
    await fn();
  } catch (e) {
    console.log(`  💥 ${e.message}`);
    process.exitCode = 1;
  }
}

const engine = new ConceptAbstractionEngine();

await section("CATEGORY_PAGE — semantic + structural signals", async () => {
  const r = engine.abstractPageToConcept({
    semanticSignals: ["category", "browse", "listing"],
    structuralSignals: ["pagination", "many-similar-links", "grouped-navigation"],
    linkTopology: { linkDensity: 0.8 },
  });
  assert(r.conceptName === "CATEGORY_PAGE", `concept → ${r.conceptName}`, `Expected CATEGORY_PAGE`);
  assert(r.confidence > 0.8, `confidence ${r.confidence.toFixed(3)} > 0.8`);
  assert(r.matchedSignals.length >= 3, `matched ${r.matchedSignals.length} signals`);
});

await section("ADVERTISEMENT_PAGE — contact/price signals", async () => {
  const r = engine.abstractPageToConcept({
    semanticSignals: ["contact", "price", "phone", "description"],
    structuralSignals: ["contact-details", "low-outgoing-links", "single-card"],
  });
  assert(r.conceptName === "ADVERTISEMENT_PAGE", `concept → ${r.conceptName}`);
  assert(r.confidence > 0.85, `confidence ${r.confidence.toFixed(3)} > 0.85`);
});

await section("DIRECTORY_PAGE — single navigation-heavy signal (beats CATEGORY_PAGE overlap)", async () => {
  const r = engine.abstractPageToConcept({
    structuralSignals: ["navigation-heavy"],
  });
  assert(r.conceptName === "DIRECTORY_PAGE", `concept → ${r.conceptName}`);
  assert(r.confidence > 0.8, `confidence ${r.confidence.toFixed(3)} > 0.8`);
});

await section("PAGINATION_PAGE — pagination signal", async () => {
  const r = engine.abstractPageToConcept({
    semanticSignals: ["pagination"],
    structuralSignals: [],
    domFingerprint: "page-nav",
  });
  assert(r.conceptName === "PAGINATION_PAGE", `concept → ${r.conceptName}`);
});

await section("UNKNOWN — no matching signals", async () => {
  const r = engine.abstractPageToConcept({
    semanticSignals: ["random-noise-xyz"],
    structuralSignals: [],
  });
  assert(r.conceptName === "UNKNOWN_PAGE", `concept → ${r.conceptName}`);
  assert(r.confidence === 0.2, `confidence exactly 0.2`);
});

await section("Empty input — graceful fallback", async () => {
  const r = engine.abstractPageToConcept({});
  assert(r.conceptName === "UNKNOWN_PAGE", `empty → ${r.conceptName}`);
  assert(r.confidence === 0.2, `default confidence 0.2`);
});

await section("Null input — graceful fallback", async () => {
  const r = engine.abstractPageToConcept(null);
  assert(r.conceptName === "UNKNOWN_PAGE", `null → ${r.conceptName}`);
});

await section("SEARCH_RESULTS_PAGE — search signals", async () => {
  const r = engine.abstractPageToConcept({
    semanticSignals: ["search", "results", "query"],
  });
  assert(r.conceptName === "SEARCH_RESULTS_PAGE", `concept → ${r.conceptName}`);
});

console.log("\n" + "═".repeat(40));
if (process.exitCode) {
  console.log("⚠️  بعض الاختبارات فشلت");
} else {
  console.log("🎉  كل الاختبارات نجحت");
}
