import test from "node:test";
import assert from "node:assert/strict";
import { mineEmails, minePhones, mineWhatsapp, mineSocial, mineContacts } from "../core/contact-miner.mjs";

test("يميز الإيميلات ويزيل السطور النموذجية", () => {
  const emails = mineEmails("msg contact@corp.io and sales@corp.io + noreply@x.io + example@example.com + صورة@2x.png");
  assert.deepEqual(emails, ["contact@corp.io", "sales@corp.io"]);
});

test("يستخرج أرقاماً دولية ومحلية مع مسافات", () => {
  const phones = minePhones("Call +971501234567 or +966 55 123 4567 or 0501234567. Not a year 2026 and not 123.");
  assert.ok(phones.includes("971501234567"), `get +9715... got ${phones.join(",")}`);
  assert.ok(phones.includes("966551234567"), `get +966...  got ${phones.join(",")}`);
  assert.equal(phones.filter((p) => p.length < 9).length, 0);
});

test("لا يلتقط أرقاماً هلامية أو قصيرة", () => {
  const phones = minePhones("عام 2026، قيمة 999، معرّف 12345 ، رقم 0 — لا شيء يصلح");
  assert.equal(phones.length, 0);
});

test("يستخرج أرقام واتساب من الروابط", () => {
  const whats = mineWhatsapp(["https://wa.me/971501234567?text=hi", "https://api.whatsapp.com/send?phone=201001112233", "https://wa.me/industry.example/join"]);
  assert.deepEqual(whats, ["971501234567", "201001112233"]);
});

test("يستخرج الشبكات الاجتماعية ويستبعد أدوات المشاركة", () => {
  const social = mineSocial([
    "https://www.linkedin.com/in/john-doe",
    "https://twitter.com/corp",
    "https://www.facebook.com/sharer/sharer.php?u=x",
    "https://instagram.com/p/123",
    "https://t.me/corpchannel",
  ]);
  assert.ok(social.includes("https://www.linkedin.com/in/john-doe"));
  assert.ok(social.includes("https://twitter.com/corp"));
  assert.ok(!social.some((s) => s.includes("/sharer/")));
  assert.ok(social.includes("https://instagram.com/p/123"));
  assert.ok(social.includes("https://t.me/corpchannel"));
});

test("mineContacts يجمّع كل شيء ويرفع hasAny", () => {
  const c = mineContacts("تواصل hello@mine.ae أو 0551112233", ["https://wa.me/971501234567", "https://linkedin.com/in/x"]);
  assert.equal(c.hasAny, true);
  assert.ok(c.emails.includes("hello@mine.ae"));
  assert.ok(c.phones.includes("0551112233"));
  assert.ok(c.whatsapp.includes("971501234567"));
  assert.equal(c.social.length, 1);
  const none = mineContacts("لا شيء هنا");
  assert.equal(none.hasAny, false);
});