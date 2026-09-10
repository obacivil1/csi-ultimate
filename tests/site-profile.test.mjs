import test from "node:test";
import assert from "node:assert/strict";
import { buildAllSiteProfiles, buildSiteProfile, listConfiguredSites } from "../core/site-profile.mjs";

test("site profile: all configured adapters resolve to profiles", () => {
  const sites = listConfiguredSites();
  assert.ok(sites.length >= 5, `configured sites: ${sites.length}`);
  const profiles = buildAllSiteProfiles();
  assert.equal(profiles.length, sites.length, "one profile per configured site");
  const hosts = profiles.map(p => p.hostname);
  for (const s of sites) assert.ok(hosts.includes(s), `${s} present in profiles`);
});

test("site profile: shape invariants hold for every profile", () => {
  for (const p of buildAllSiteProfiles()) {
    assert.ok(p.url.startsWith("https://"), `${p.hostname}: url`);
    assert.ok(p.identity.search, `${p.hostname}: identity.search`);
    assert.ok(p.extraction.region, `${p.hostname}: extraction.region`);
    assert.ok(typeof p.extraction.coveragePct === "number" && p.extraction.coveragePct >= 0 && p.extraction.coveragePct <= 100, `${p.hostname}: coveragePct bound`);
    assert.ok(p.extraction.fields.title, `${p.hostname}: title selector configured`);
    assert.ok(p.extraction.fields.phone, `${p.hostname}: phone selector configured`);
    assert.ok(["A", "B", "C", "D"].includes(p.maturity.grade), `${p.hostname}: maturity grade`);
    assert.ok(p.maturity.score >= 0 && p.maturity.score <= 100, `${p.hostname}: maturity score bound`);
    assert.ok(p.liveRun.files >= 0, `${p.hostname}: liveRun.files`);
    assert.equal(typeof p.liveRun.totalRecords, "number", `${p.hostname}: liveRun.totalRecords`);
  }
});

test("site profile: entry strategy reflected when ledger has data", () => {
  const p = buildSiteProfile("sa.opensooq.com");
  assert.equal(p.hostname, "sa.opensooq.com");
  if (p.entry) {
    assert.ok(typeof p.entry.strategy === "string" && p.entry.strategy.length, "strategy string");
    assert.ok(typeof p.entry.successRate === "number" && p.entry.successRate >= 0 && p.entry.successRate <= 100, "successRate within 0-100");
  }
});

test("site profile: known run data surfaces for gumtree records", () => {
  const p = buildSiteProfile("gumtree.com");
  if (p.liveRun.files > 0) {
    assert.ok(p.liveRun.freshness, "freshness timestamp present");
    assert.ok(p.liveRun.verification?.trustScore?.score >= 0 && p.liveRun.verification?.trustScore?.score <= 100, "trust score bound");
    if (p.liveRun.latestReport) {
      assert.ok(p.liveRun.latestReport.generatedAt, "latest report generatedAt");
    }
  }
});

test("site profile: unknown adapters never throw via listConfiguredSites", () => {
  const extra = listConfiguredSites().filter(h => !h.includes("."));
  for (const h of extra) assert.doesNotThrow(() => buildSiteProfile(h));
});