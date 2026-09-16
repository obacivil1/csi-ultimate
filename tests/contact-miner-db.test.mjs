import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import openDb, { toDocumentRow } from "../core/db.mjs";
import { runContactMine } from "../core/contact-miner.mjs";

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contact-db-"));
  const dbPath = path.join(dir, "c.db");
  const db = openDb(dbPath);
  return {
    db, dbPath, close() { db.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

test("queryDocuments.countDocuments: missingContacts يلتقط الصفوف بلا جهات", () => {
  const { db, close } = tempDb();
  db.upsertDocuments([
    toDocumentRow({ url: "https://x.com/a", host: "x.com", text: "some real text here" }, { doc_type: "document" }),
    toDocumentRow({ url: "https://x.com/b", host: "x.com", text: "more text with enough length" }, {
      doc_type: "document", contacts: { emails: [], phones: [], whatsapp: [], social: [], hasAny: false },
    }),
  ]);
  // b لديها contacts_json صريح (حتى لو فارغ) — لا تُلتقط؛ a بلا contacts تلتقط
  assert.equal(db.countDocuments({ missingContacts: true }), 1);
  close();
});

test("runContactMine يثري الصفوف الناقصة دون إعادة زحف", async () => {
  const { db, dbPath, close } = tempDb();
  db.upsertDocuments([toDocumentRow({
    url: "https://x.com/1", host: "x.com",
    text: "Call 0501234567 or contact a@b.com with enough words to satisfy the length check here.",
    links: [],
  }, { run_id: "t1" })]);
  const res = await runContactMine({ dbPath, persist: true });
  assert.equal(res.scanned, 1);
  assert.equal(res.updated, 1);
  assert.equal(res.skipped_no_text, 0);
  const [row] = db.queryDocuments({});
  const contacts = row.contacts_json;
  assert.ok(contacts, "contacts_json يجب أن تُملأ");
  assert.ok(contacts.hasAny);
  assert.ok(contacts.phones.includes("0501234567"), `phones: ${contacts.phones.join(",")}`);
  assert.ok(contacts.emails.includes("a@b.com"));
  close();
});

test("runContactMine يتجاهل raw_json غير الكافي بأمان (لا يكتب فوق بيانات)", async () => {
  const { db, dbPath, close } = tempDb();
  db.upsertDocuments([toDocumentRow({ url: "https://x.com/2", host: "x.com", text: "" }, { run_id: "t1" })]);
  const res = await runContactMine({ dbPath, persist: true });
  assert.equal(res.skipped_no_text, 1);
  assert.equal(res.updated, 0);
  const [row] = db.queryDocuments({});
  assert.equal(row.contacts_json, null, "لا نجبر contacts فارغة على صف بلا نص");
  close();
});

test("runContactMine بمحو all بلا اتصال: force يمسح حتى الممتلئين", async () => {
  const { db, dbPath, close } = tempDb();
  db.upsertDocuments([toDocumentRow({
    url: "https://x.com/3", host: "x.com",
    text: "This page has enough text but maybe some contacts live here.",
    links: [],
  }, { doc_type: "document" })]);
  const res = await runContactMine({ dbPath, persist: true, force: true });
  assert.equal(res.scanned, 1);
  assert.equal(res.updated, 1);
  close();
});

test("persist:false يمسح ويحصي فقط ولا يكتب (dry-run)", async () => {
  const { db, dbPath, close } = tempDb();
  db.upsertDocuments([toDocumentRow({
    url: "https://x.com/4", host: "x.com",
    text: "Email hello@mine.ae here with plenty of context text so the miner can score it.",
    links: [],
  }, { run_id: "t2" })]);
  const res = await runContactMine({ dbPath, persist: false });
  assert.equal(res.updated, 1, "يحصي أنه سيُحدَّث");
  const [row] = db.queryDocuments({});
  assert.equal(row.contacts_json, null, "لا يُكتب شيء عند persist:false");
  close();
});