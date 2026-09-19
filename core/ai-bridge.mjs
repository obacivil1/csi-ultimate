/**
 * ai-bridge.mjs — جسر AI اختياري متوافق مع OpenAI (اقتراح selectors وتحليل)
 * ─────────────────────────────────────────────────────────────────────────
 * مستوحى من N0VA AIBridge/BigpickleBridge: نقطة دخول واحدة لأي خادم
 * OpenAI-compatible (Bigpickle المحلي، أي وكيل آخر...).
 *
 * اختياري تماماً: بدون إعداد يبقى معطلاً بصمت ولا يكسر أي مسار.
 * حالياً يُستخدم لاقتراح CSS selectors وخطط استخراج للمواقع الجديدة.
 */

import { env } from "../config/env.mjs";

/**
 * AIBridge — عميل خفيف لمحادثة/تحليل عبر واجهة /v1/chat/completions.
 */
export class AIBridge {
  /**
   * @param {object} [opts]
   * @param {string} [opts.endpoint] - مثلاً http://localhost:8080
   * @param {string} [opts.model]    - مثلاً bigpickle-v2
   * @param {string} [opts.apiKey]   - اختياري Bearer
   * @param {number}  [opts.timeout]
   */
  constructor(opts = {}) {
    this.endpoint = (opts.endpoint || env.AI.ENDPOINT || "").replace(/\/+$/, "");
    this.model = opts.model || env.AI.MODEL || "bigpickle-v2";
    this.apiKey = opts.apiKey || env.AI.KEY || "";
    this.timeout = opts.timeout || env.AI.TIMEOUT || 60000;
  }

  /** configured — هل الجسر مُهيأ فعلاً؟ */
  get configured() {
    return Boolean(this.endpoint);
  }

  /**
   * chat — طلب محادثة أجوبة JSON.
   * @param {Array<{role:string,content:string}>} messages
   * @param {number} [temperature]
   * @returns {Promise<{ok:boolean, content?:string, error?:string}>}
   */
  async chat(messages, temperature = 0.3) {
    if (!this.configured) {
      return { ok: false, error: "AI bridge not configured (set CSI_AI_ENDPOINT)" };
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      const headers = { "Content-Type": "application/json" };
      if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

      const res = await fetch(`${this.endpoint}/v1/chat/completions`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({ model: this.model, messages, temperature, max_tokens: 2048 }),
      });
      clearTimeout(timer);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      return { ok: true, content };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  /**
   * parseJson — استخراج JSON من رد عميل قد يضيف نصاً حوله.
   * يعيد null عند الفشل.
   */
  parseJson(content) {
    if (!content) return null;
    const trimmed = content.trim();
    try {
      return JSON.parse(trimmed);
    } catch {}
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    return null;
  }

  /**
   * suggestSelectors — تحليل مُقتطع من HTML لاقتراح selectors لمواقع جديدة.
   * @param {string} htmlSnippet - عينة HTML (قِطع العناوين، القوائم...)
   * @param {string} [objective] - أشياء نريد استخراجها
   * @returns {Promise<{ok:boolean, selectors?:object, insights?:string[], error?:string}>}
   */
  async suggestSelectors(htmlSnippet, objective = "استخراج عناصر إعلانات/عقود") {
    const system = "أنت خبير استخراج بيانات من HTML. أجب بصيغة JSON فقط. لا تشرح.";
    const user = `الهدف: ${objective}

عينة HTML (قد تكون مبتورة):
${String(htmlSnippet).slice(0, 8000)}

حلل البنية وأجب بصيغة JSON:
{
  "selectors": {"container": "css", "title": "css", "description": "css", "price": "css", "phone": "css", "location": "css", "link": "css"},
  "insights": ["ملاحظتان قصيرتان عن بنية الصفحة"]
}`;
    const r = await this.chat([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    if (!r.ok) return r;
    const parsed = this.parseJson(r.content) ?? {};
    return { ok: true, selectors: parsed.selectors ?? {}, insights: parsed.insights ?? [] };
  }

  /**
   * analyze — تحليل حر لأي بيانات (ملاحظات، توصيات).
   * @returns {Promise<{ok:boolean, insights?:string[], recommendations?:string[], error?:string}>}
   */
  async analyze(data, objective = "تحليل") {
    const r = await this.chat([
      { role: "system", content: "أنت محلل بيانات. أجب بصيغة JSON فقط." },
      {
        role: "user",
        content: `الهدف: ${objective}\nالبيانات: ${JSON.stringify(data).slice(0, 3000)}\n\nأجب:\n{"insights": [], "recommendations": []}`,
      },
    ]);
    if (!r.ok) return r;
    const parsed = this.parseJson(r.content) ?? {};
    return { ok: true, insights: parsed.insights ?? [], recommendations: parsed.recommendations ?? [] };
  }
}

/**
 * createAIBridge — مُصنِّع سريع من env بدون معاملات.
 */
export function createAIBridge(opts = {}) {
  return new AIBridge(opts);
}

export function isAIConfigured() {
  return Boolean(env.AI.ENDPOINT);
}