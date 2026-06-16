#!/usr/bin/env node
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";
import { StructuralKnowledgeGraph } from "./core/structural-knowledge-graph.mjs";

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
    if (e.stack) console.log(`     ${e.stack.split("\n").slice(0, 3).join("\n     ")}`);
    process.exitCode = 1;
  }
}

const tmpPath = join(tmpdir(), `csi-kg-test-${randomBytes(4).toString("hex")}.json`);

let graph;

await section("Constructor — empty graph", async () => {
  graph = new StructuralKnowledgeGraph(tmpPath);
  assert(graph.graph.nodes.length === 0, "initial empty nodes");
  assert(graph.graph.edges.length === 0, "initial empty edges");
  assert(graph.path === tmpPath, `path set: ${graph.path}`);
});

await section("addObservation — creates nodes + edge", async () => {
  const edge = graph.addObservation({
    sourceConcept: "CATEGORY_PAGE",
    targetConcept: "ADVERTISEMENT_PAGE",
    observation: "category_contains_ads",
    weight: 0.8,
  });
  assert(graph.graph.nodes.length === 2, `2 nodes: ${JSON.stringify(graph.graph.nodes.map(n => n.id))}`);
  assert(graph.graph.edges.length === 1, `1 edge`);
  assert(edge.source === "CATEGORY_PAGE", `source: ${edge.source}`);
  assert(edge.target === "ADVERTISEMENT_PAGE", `target: ${edge.target}`);
  assert(edge.weight === 0.8, `weight: ${edge.weight}`);
});

await section("addObservation — reuses existing nodes", async () => {
  graph.addObservation({
    sourceConcept: "CATEGORY_PAGE",
    targetConcept: "DIRECTORY_PAGE",
    observation: "category_is_directory",
    weight: 0.6,
  });
  assert(graph.graph.nodes.length === 3, `3 unique nodes (no duplicates)`);
  assert(graph.graph.edges.length === 2, `2 edges`);
});

await section("getGraph — returns current state", async () => {
  const state = graph.getGraph();
  assert(state === graph.graph, "same reference");
  assert(state.nodes.length === 3, "3 nodes in returned graph");
});

await section("addObservation — default weight when omitted", async () => {
  const edge = graph.addObservation({
    sourceConcept: "PAGINATION_PAGE",
    targetConcept: "CATEGORY_PAGE",
    observation: "paginated_category",
  });
  assert(edge.weight === 0.5, `default weight 0.5, got ${edge.weight}`);
});

await section("addObservation — fallback for missing concepts", async () => {
  const edge = graph.addObservation({});
  assert(edge.source === "UNKNOWN_PAGE", `source fallback: ${edge.source}`);
  assert(edge.target === "UNKNOWN_PAGE", `target fallback: ${edge.target}`);
});

await section("load — handles missing file gracefully", async () => {
  const fresh = new StructuralKnowledgeGraph("./nonexistent/path/graph.json");
  const loaded = fresh.load();
  assert(loaded.nodes.length === 0, "no nodes from non-existent file");
  assert(loaded.edges.length === 0, "no edges from non-existent file");
});

// cleanup
try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch {}

console.log("\n" + "═".repeat(40));
if (process.exitCode) {
  console.log("⚠️  بعض الاختبارات فشلت");
} else {
  console.log("🎉  كل الاختبارات نجحت");
}
