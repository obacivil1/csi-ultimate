/**
 * validate-document.mjs — السكة B: ضمان جودة البيانات
 * ─────────────────────────────────────────────────────
 * عقد مخطط لكل نموذج (مناداة/مقاول/جائزة/مشروع/وثيقة) يطابق أعمدة csi.db،
 * مع تحقق نمطيّ (تعريفات/هاتف/بريد/URL/أرقام) وحساب درجة الاكتمال.
 * يُستعمل مرتين: في خط الإنتاج (رفض/ربط التحذير) وفي تقرير الحقول الناقصة.
 */

const PTN = {
  govId: /^\d{6,12}$/,
  url: /^https?:\/\//,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  phone: /^(?:\+?\d[\d\s\-()]{6,20})$/,
  numeric: /^-?\d+([.,]\d+)?$/,
  date: /^\d{4}-\d{2}-\d{2}(T.*)?$/,
};

function freshIndex() {
  return { required: 0, filledRequired: 0, warnings: 0, errors: [] };
}

export const SCHEMAS = {
  tender: {
    required: ["id", "title", "source"],
    fields: {
      id: { type: "id", pattern: PTN.govId },
      title: { type: "string", min: 3 },
      entity: { type: "string" },
      value: { type: "number" },
      currency: { type: "string" },
      status: { type: "string" },
      deadline: { type: "date" },
      activity: { type: "string" },
      url: { type: "url", pattern: PTN.url },
      source: { type: "string" },
      scraped_at: { type: "date" },
    },
  },
  contractor: {
    required: ["id", "name", "source"],
    fields: {
      id: { type: "id", pattern: PTN.govId },
      name: { type: "string", min: 2 },
      city: { type: "string" },
      region: { type: "string" },
      phone: { type: "phone", pattern: PTN.phone },
      email: { type: "email", pattern: PTN.email },
      url: { type: "url", pattern: PTN.url },
      source: { type: "string" },
    },
  },
  award: {
    required: ["id", "title", "source"],
    fields: {
      id: { type: "id", pattern: PTN.govId },
      title: { type: "string", min: 3 },
      winner: { type: "string" },
      value: { type: "number" },
      currency: { type: "string" },
      entity: { type: "string" },
      bidders: { type: "string" },
      date: { type: "date" },
      url: { type: "url", pattern: PTN.url },
      source: { type: "string" },
    },
  },
  project: {
    required: ["id", "title", "source"],
    fields: {
      id: { type: "id" },
      title: { type: "string", min: 3 },
      sector: { type: "string" },
      description: { type: "string" },
      date: { type: "date" },
      url: { type: "url", pattern: PTN.url },
      source: { type: "string" },
    },
  },
  document: {
    required: ["id", "source", "doc_type", "url_hash"],
    fields: {
      id: { type: "id", pattern: /^\d+$/ },
      source: { type: "string" },
      doc_type: { type: "string" },
      url: { type: "url", pattern: PTN.url },
      url_hash: { type: "string", min: 32 },
      raw_json: { type: "string" },
      canonical_json: { type: "string" },
      contacts_json: { type: "string" },
      status: { type: "string" },
      confidence: { type: "number" },
    },
  },
};

const TYPE_CHECKS = {
  string: (v, f) => (typeof v === "string" && (f.min == null || v.trim().length >= f.min) ? null : `خيط فارغ/قاصر (min=${f.min ?? 0})`),
  number: (v) => ((typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && PTN.numeric.test(v.trim())) ? null : "ليس رقماً"),
  date: (v) => (v == null || v === "" ? null : PTN.date.test(String(v)) ? null : "تنسيق تاريخ غير ISO"),
  url: (v) => (v == null || v === "" ? null : PTN.url.test(String(v)) ? null : "رابط غير http(s)"),
  email: (v) => (v == null || v === "" ? null : PTN.email.test(String(v.trim())) ? null : "بريد غير صالح"),
  phone: (v) => (v == null || v === "" ? null : PTN.phone.test(String(v.trim())) ? null : "هاتف غير صالح"),
  id: (v) => (v == null || v === "" ? null : typeof v === "string" || typeof v === "number" ? null : "نوع معرّف غير صالح"),
};

export function validateDocument(doc, model) {
  const schema = SCHEMAS[model];
  if (!schema) throw new Error(`نموذج غير معروف: ${model}`);
  const idx = freshIndex();
  const isFilled = (v) => v !== null && v !== undefined && v !== "";

  for (const f of schema.required) {
    if (isFilled(doc[f])) idx.filledRequired++;
    else idx.errors.push(`حقل مطلوب ناقص: ${f}`);
    idx.required++;
  }

  for (const [field, rule] of Object.entries(schema.fields)) {
    if (field in doc && isFilled(doc[field])) {
      const check = TYPE_CHECKS[rule.type];
      const msg = check ? check(doc[field], rule) : null;
      if (msg && rule.pattern && rule.pattern.test ? !rule.pattern.test(String(doc[field]).trim()) : msg) {
        if (msg) idx.warnings++; // حقل غير أساسي بقيمة مشبوهة = تحذير لا فشل
      }
    }
  }

  const score = idx.required === 0 ? 100 : Math.round((idx.filledRequired / idx.required) * 100);
  return { valid: idx.errors.length === 0, model, score, errors: idx.errors, warnings: idx.warnings };
}

/**
 * تقرير اكتمال حقول لمجموعة سجلات — خلية جاهزة لقاعدة البيانات أو مسح.
 * @returns {{model, count, overallScore, fields: Array<{field, filled, fillRate}>, worst: Array<{id, score}>}}
 */
export function completenessReport(rows, model) {
  const schema = SCHEMAS[model];
  if (!schema) throw new Error(`نموذج غير معروف: ${model}`);
  const fields = Object.keys(schema.fields).concat(schema.required.filter((f) => !(f in schema.fields)));
  const counts = Object.fromEntries(fields.map(() => []).map((_, i) => [fields[i], 0]));
  let totalScore = 0;
  const worst = [];
  for (const row of rows) {
    for (const f of fields) if (row[f] !== null && row[f] !== undefined && row[f] !== "") counts[f]++;
    const r = validateDocument(row, model);
    totalScore += r.score;
    worst.push({ id: row.id, score: r.score });
  }
  worst.sort((a, b) => a.score - b.score);
  const n = rows.length;
  return {
    model,
    count: n,
    overallScore: n ? Math.round(totalScore / n) : 100,
    fields: fields.map((f) => ({ field: f, filled: counts[f], fillRate: n ? Math.round((counts[f] / n) * 100) : 100 })),
    worst: worst.slice(0, 5),
  };
}