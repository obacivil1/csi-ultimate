import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import openDb, { toDocumentRow, hashUrl, normalizeUrlForHash } from "../core/db.mjs";

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docdb-test-"));
  const db = openDb(path.join(dir, "test.db"));
  return { db, dir, close() { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("hashUrl deterministic and stable", () => {
  const h1 = hashUrl("https://ad.com/item/123");
  const h2 = hashUrl("https://ad.com/item/123");
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(h1, hashUrl("https://ad.com/item/124"));
});

test("normalizeUrlForHash merges session/utm/tracking variants into one identity", () => {
  const a = "https://ad.com/item/42?utm_source=facebook&utm_campaign=x&fbclid=abc";
  const b = "https://www.AD.com/item/42/";           // حالة + www + trailing slash
  const c = "https://ad.com/item/42#reviews";         // fragment
  const d = "https://ad.com/item/42?sid=aa10bb&utm_medium=paid"; // معلمة جلسة
  const set = new Set([a, b, c, d].map(normalizeUrlForHash));
  assert.equal(set.size, 1, `variants must collapse to one identity, got: ${[...set]}`);
  assert.equal(hashUrl(a), hashUrl(b));
  assert.equal(hashUrl(b), hashUrl(c));
  assert.equal(hashUrl(c), hashUrl(d));
});

test("normalizeUrlForHash keeps meaningful query params but ignores their order", () => {
  const p1 = normalizeUrlForHash("https://x.com/search?q=engineer&city=riyadh");
  const p2 = normalizeUrlForHash("https://x.com/search?city=riyadh&q=engineer");
  assert.equal(p1, p2, "param order must not change identity");
  assert.match(p1, /q=engineer/);
  const withoutTracked = normalizeUrlForHash("https://x.com/search?q=engineer&utm_source=n");
  assert.equal(hashUrl(withoutTracked), hashUrl("https://x.com/search?q=engineer"));
});

test("normalizeUrlForHash differentiates genuinely different URLs", () => {
  assert.notEqual(hashUrl("https://x.com/a"), hashUrl("https://x.com/b"));
  assert.notEqual(hashUrl("https://x.com/a"), hashUrl("https://y.com/a"));
});

test("toDocumentRow maps general-crawl doc shape", () => {
  const row = toDocumentRow({
    url: "https://site.com/page", host: "site.com",
    title: "T", text: "body",
    contacts: { emails: ["x@y.com"], phones: [], whatsapp: [], social: [], hasAny: true },
  }, { doc_type: "document", topic: "business" });
  assert.equal(row.source, "site.com");
  assert.equal(row.doc_type, "document");
  assert.equal(row.topic, "business");
  assert.equal(row.url_hash, hashUrl("https://site.com/page"));
  assert.equal(row.contacts_json.includes("x@y.com"), true);
  assert.equal(typeof row.raw_json, "string");
  assert.equal(row.status, "active");
  assert.equal(row.confidence, 1.0);
});

test("upsertDocuments inserts then updates (url_hash idempotency)", () => {
  const { db, close } = tempDb();
  const r1 = toDocumentRow({ url: "https://g.com/1", host: "g.com", title: "v1" }, { doc_type: "classified" });
  const first = db.upsertDocuments([r1]);
  assert.equal(first.inserted, 1);
  assert.equal(first.updated, 0);

  const r1b = toDocumentRow({ url: "https://g.com/1", host: "g.com", title: "v2" }, { doc_type: "classified" });
  const second = db.upsertDocuments([r1b]);
  assert.equal(second.inserted, 0);
  assert.equal(second.updated, 1);
  assert.equal(db.countDocuments(), 1);
  close();
});

test("queryDocuments filters by doc_type and parses JSON columns", () => {
  const { db, close } = tempDb();
  db.upsertDocuments([
    toDocumentRow({ url: "https://g.com/j1", host: "g.com", title: "Job" }, { doc_type: "job" }),
    toDocumentRow({ url: "https://g.com/c1", host: "g.com", title: "Contractor" }, { doc_type: "contractor" }),
  ]);
  const jobs = db.queryDocuments({ doc_type: "job" });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].canonical_json.title, "Job");
  assert.equal(jobs[0].raw_json.host, "g.com");
  assert.equal(db.countDocuments({ doc_type: "contractor" }), 1);
  assert.equal(db.countDocuments(), 2);
  close();
});

test("documents table coexists with legacy specialized tables", () => {
  const { db, close } = tempDb();
  db.upsertDocuments([toDocumentRow({ url: "https://g.com/x", host: "g.com" }, { doc_type: "document" })]);
  const s = db.stats();
  assert.ok("documents" in s);
  assert.ok(s.documents >= 1);
  close();
});