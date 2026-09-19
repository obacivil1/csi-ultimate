import test from "node:test";
import assert from "node:assert/strict";
import { AIBridge, createAIBridge, isAIConfigured } from "../core/ai-bridge.mjs";

test("ai-bridge: غير مُهيأ → يعيد خطأ بهدوء ولا يرمي", async () => {
  const bridge = new AIBridge({ endpoint: "" });
  assert.equal(bridge.configured, false);
  const r = await bridge.chat([{ role: "user", content: "hi" }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /not configured/);
});

test("ai-bridge: متوافق مع OpenAI — طلب محادثة + استخراج JSON من الرد", async () => {
  const bridge = new AIBridge({ endpoint: "http://test.local", model: "test-model" });
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    assert.ok(String(url).endsWith("/v1/chat/completions"));
    const payload = JSON.parse(opts.body);
    assert.equal(payload.model, "test-model");
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"selectors":{"title":"h1"},"insights":[]}' } }] }),
    };
  };
  try {
    const r = await bridge.chat([{ role: "user", content: "test" }]);
    assert.equal(r.ok, true);
    assert.ok(r.content.includes("selectors"));
    const parsed = bridge.parseJson(r.content);
    assert.deepEqual(parsed, { selectors: { title: "h1" }, insights: [] });
  } finally {
    globalThis.fetch = original;
  }
});

test("ai-bridge: جدولة تُشغّل timeout بقيمة env", async () => {
  const bridge = new AIBridge({ endpoint: "http://test.local" });
  assert.equal(typeof bridge.timeout, "number");
  assert.ok(bridge.timeout > 0);
});

test("ai-bridge: parseJson يلتقط JSON وسط نص حر", () => {
  const bridge = new AIBridge({ endpoint: "" });
  const parsed = bridge.parseJson("هذا تحليل:\n```json\n{\"a\":1}\n```\nنهاية");
  assert.deepEqual(parsed, { a: 1 });
  assert.equal(bridge.parseJson("لا json هنا"), null);
});

test("ai-bridge: فشل الشبكة يعود بخطأ لطيف لا استثناء", async () => {
  const bridge = new AIBridge({ endpoint: "http://127.0.0.1:1" }); // منفذ غير قابل للربط
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
  try {
    const r = await bridge.chat([{ role: "user", content: "x" }]);
    assert.equal(r.ok, false);
    assert.match(r.error, /ECONNREFUSED/);
  } finally {
    globalThis.fetch = original;
  }
});

test("ai-bridge: أخطاء غير-200 تنعكس بخطأ لطيف", async () => {
  const bridge = new AIBridge({ endpoint: "http://test.local", model: "m" });
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => "boom" });
  try {
    const r = await bridge.chat([{ role: "user", content: "x" }]);
    assert.equal(r.ok, false);
    assert.match(r.error, /500/);
  } finally {
    globalThis.fetch = original;
  }
});

test("ai-bridge: suggestSelectors يرجع selectors بمخطط موثّق", async () => {
  const bridge = new AIBridge({ endpoint: "http://test.local", model: "m" });
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: '{"selectors":{"container":".listing"},"insights":["ها"]}' } }],
    }),
  });
  try {
    const html = "<div class='listing'><h2>عرض</h2></div>";
    const r = await bridge.suggestSelectors(html, "استخراج العروض");
    assert.equal(r.ok, true);
    assert.equal(r.selectors.container, ".listing");
  } finally {
    globalThis.fetch = original;
  }
});

test("ai-bridge: createAIBridge + isAIConfigured ثابتان", () => {
  const bridge = createAIBridge({ endpoint: "http://localhost:9999" });
  assert.equal(bridge.configured, true);
  assert.equal(typeof isAIConfigured(), "boolean");
});