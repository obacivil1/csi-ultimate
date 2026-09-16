/**
 * db.mjs — SQLite persistence layer for core datasets.
 * ─────────────────────────────────────────────────────────
 * Replaces JSON-on-disk as the long-term store for
 * tenders, contractors, awards, and projects, while keeping
 * JSON exports for interop. WAL mode + prepared statements.
 *
 * Usage:
 *   const db = openDb("data/csi.db")
 *   await db.importMany("tenders", rows)
 *   const rows = await db.query("contractors", { limit, where, params })
 *   await db.upsertDocuments(toDocumentRow(doc, opts))
 *   const rows = await db.queryDocuments({ limit, source, doc_type, missingContacts })
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const DEFAULT_PATH = path.resolve("data/csi.db");

function open(file = DEFAULT_PATH) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  migrate(db);
  return wrap(db);
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenders (
      id           TEXT PRIMARY KEY,
      title        TEXT,
      entity       TEXT,
      value        REAL,
      currency     TEXT DEFAULT 'SAR',
      status       TEXT,
      deadline     TEXT,
      activity     TEXT,
      url          TEXT,
      source       TEXT DEFAULT 'etimad',
      scraped_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tenders_status ON tenders(status);
    CREATE INDEX IF NOT EXISTS idx_tenders_deadline ON tenders(deadline);
    CREATE INDEX IF NOT EXISTS idx_tenders_value ON tenders(value);

    CREATE TABLE IF NOT EXISTS contractors (
      id           TEXT PRIMARY KEY,
      name         TEXT,
      city         TEXT,
      region       TEXT,
      phone        TEXT,
      email        TEXT,
      url          TEXT,
      source       TEXT DEFAULT 'muqawil',
      scraped_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_contractors_city ON contractors(city);
    CREATE INDEX IF NOT EXISTS idx_contractors_email ON contractors(email);

    CREATE TABLE IF NOT EXISTS awards (
      id           TEXT PRIMARY KEY,
      title        TEXT,
      winner       TEXT,
      value        REAL,
      currency     TEXT DEFAULT 'SAR',
      entity       TEXT,
      bidders      TEXT,
      date         TEXT,
      url          TEXT,
      source       TEXT DEFAULT 'etimad',
      scraped_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id           TEXT PRIMARY KEY,
      title        TEXT,
      sector       TEXT,
      description  TEXT,
      date         TEXT,
      url          TEXT,
      source       TEXT DEFAULT 'saudigulfprojects',
      scraped_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_projects_sector ON projects(sector);

    CREATE TABLE IF NOT EXISTS documents (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      source        TEXT NOT NULL,
      doc_type      TEXT NOT NULL,
      url           TEXT NOT NULL,
      url_hash      TEXT NOT NULL UNIQUE,
      raw_json      TEXT NOT NULL,
      canonical_json TEXT NOT NULL,
      contacts_json TEXT,
      topic         TEXT,
      status        TEXT DEFAULT 'active',
      confidence    REAL DEFAULT 1.0,
      extracted_at  TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      run_id        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_documents_source_type ON documents(source, doc_type);
    CREATE INDEX IF NOT EXISTS idx_documents_run ON documents(run_id);
  `);

  // ADR-002 (ربط لا نسخ): عمود document_id قابل للإغراض على الجداول التخصصية
  // تحت 21,678 صفاً قائماً. يمكن إضافة عمود بلا إعادة بناء أو نسخ.
  for (const t of ["tenders", "contractors", "awards", "projects"]) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    if (!cols.includes("document_id")) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN document_id INTEGER NULL`);
    }
  }
}

const DOC_KEYS = ["source", "doc_type", "url", "url_hash", "raw_json", "canonical_json", "contacts_json", "topic", "status", "confidence", "extracted_at", "updated_at", "run_id"];

/** يطوّع سجل/وثيقة قادمة من أي محرك (general-crawl / canonical / contact) إلى صف documents. */
export function toDocumentRow(doc = {}, opts = {}) {
  const {
    source = doc.host || doc.source || "unknown",
    doc_type = "document",
    url = doc.url,
    url_hash = opts.urlHash || hashUrl(url),
    raw = doc,
    canonical = opts.canonical || doc,
    contacts = opts.contacts ?? (doc.contacts || null),
    topic = opts.topic ?? (doc.topic || null),
    run_id = opts.run_id ?? null,
    extractedAt = opts.extractedAt ?? doc.fetchedAt ?? new Date().toISOString(),
  } = opts;

  if (!url || !url_hash) throw new TypeError("[db] toDocumentRow: url and url_hash are required");
  const now = new Date().toISOString();
  return {
    source,
    doc_type,
    url,
    url_hash,
    raw_json: JSON.stringify(raw ?? {}),
    canonical_json: JSON.stringify(canonical ?? {}),
    contacts_json: contacts ? JSON.stringify(contacts) : null,
    topic: topic ?? null,
    status: opts.status || "active",
    confidence: typeof opts.confidence === "number" ? opts.confidence : 1.0,
    extracted_at: extractedAt,
    updated_at: now,
    run_id,
  };
}

/** تطبيع URL قبل الهاش — مفتاح الديدوب.
 *  يزيل: fragment, www., trailing slash, ومعلمات التتبع/الجلسة المتغيرة
 *  (utm_*, fbclid, gclid, sid, ...) ثم يرتّب البقية أبجدياً.
 */
const VOLATILE_QUERY = /^(utm_.*|fbclid|gclid|msclkid|igshid|amp;?|ref|ref_|spm|sc|sc_|from|source|session|sid|_ga|_gl|mc_cid|mc_eid)$/i;

export function normalizeUrlForHash(raw = "") {
  if (!raw) return "";
  try {
    const u = new URL(String(raw));
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    if (path.length > 1) u.pathname = path; // وثبّت الجذر "/" كما هو
    const kept = [];
    for (const [k, v] of u.searchParams) {
      if (VOLATILE_QUERY.test(k)) continue;
      kept.push([k, v]);
    }
    kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    u.search = kept.map(([k, v]) => `${k}=${v}`).join("&");
    return u.href.replace(/\/?$/, "");
  } catch {
    return String(raw).trim();
  }
}

export function hashUrl(url) {
  return createHash("sha256").update(normalizeUrlForHash(url)).digest("hex");
}

function buildUpsert(table, keys) {
  const cols = keys.join(", ");
  const placeholders = keys.map(() => "?").join(", ");
  const updates = keys
    .filter((k) => k !== "id")
    .map((k) => `${k} = excluded.${k}`)
    .join(", ");
  return `INSERT INTO ${table} (${cols}) VALUES (${placeholders})
          ON CONFLICT(id) DO UPDATE SET ${updates}`;
}

function pick(row, keys) {
  const out = {};
  for (const k of keys) out[k] = row[k] ?? null;
  return out;
}

const TENDER_KEYS = ["id", "title", "entity", "value", "currency", "status", "deadline", "activity", "url", "source", "scraped_at"];
const CONTRACTOR_KEYS = ["id", "name", "city", "region", "phone", "email", "url", "source", "scraped_at"];
const AWARD_KEYS = ["id", "title", "winner", "value", "currency", "entity", "bidders", "date", "url", "source", "scraped_at"];
const PROJECT_KEYS = ["id", "title", "sector", "description", "date", "url", "source", "scraped_at"];

function bindable(v) {
  if (v === undefined || v === null) return null;
  const t = typeof v;
  if (t === "number") {
    if (!Number.isFinite(v)) return null;
    return v;
  }
  if (t === "string" || t === "bigint" || Buffer.isBuffer(v)) return v;
  if (t === "boolean") return v ? 1 : 0;
  return JSON.stringify(v);
}

function wrap(db) {
  const upsertTendersStmt = db.prepare(buildUpsert("tenders", TENDER_KEYS));
  const upsertContractorsStmt = db.prepare(buildUpsert("contractors", CONTRACTOR_KEYS));
  const upsertAwardsStmt = db.prepare(buildUpsert("awards", AWARD_KEYS));
  const upsertProjectsStmt = db.prepare(buildUpsert("projects", PROJECT_KEYS));
  const getByHash = db.prepare("SELECT id FROM documents WHERE url_hash = ?");

  return {
    raw: db,

    async importMany(name, rows) {
      const keyDefs = {
        tenders: TENDER_KEYS,
        contractors: CONTRACTOR_KEYS,
        awards: AWARD_KEYS,
        projects: PROJECT_KEYS,
      };
      const keys = keyDefs[name];
      if (!keys) throw new Error(`[db] unknown table: ${name}`);
      const stmtMap = {
        tenders: upsertTendersStmt,
        contractors: upsertContractorsStmt,
        awards: upsertAwardsStmt,
        projects: upsertProjectsStmt,
      };
      const stmt = stmtMap[name];
      const tx = db.transaction((list) => {
        for (const r of list) {
          const row = pick(r, keys);
          stmt.run(keys.map((k) => bindable(row[k])));
        }
      });
      tx(rows);
      return rows.length;
    },

    query(name, { limit = 50, offset = 0, where = "", params = [] } = {}) {
      const w = where ? `WHERE ${where}` : "";
      const stmt = db.prepare(`SELECT * FROM ${name} ${w} ORDER BY scraped_at DESC LIMIT ? OFFSET ?`);
      return stmt.all(...params.map(bindable), limit, offset);
    },

    count(name) {
      return db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n;
    },

    stats() {
      return {
        tenders: this.count("tenders"),
        contractors: this.count("contractors"),
        awards: this.count("awards"),
        projects: this.count("projects"),
        documents: this.count("documents"),
      };
    },

    /**
     * upsertDocuments({ rows | docs }) — الكتابة الوحيدة المعتمدة (عقد C4).
     * يقبل صفوفاً جاهزة (toDocumentRow) أو وثائق/سجلات مباشرة،
     * ويعيد { inserted, updated }.
     */
    upsertDocuments(input = []) {
      const hasRows = Array.isArray(input) && input.length && input[0] && input[0].url_hash && !input[0].raw;
      const rows = hasRows ? input : (Array.isArray(input) ? input : []).map(toDocumentRow);
      const upsert = db.prepare(`
        INSERT INTO documents
          (source, doc_type, url, url_hash, raw_json, canonical_json, contacts_json, topic, status, confidence, extracted_at, updated_at, run_id)
        VALUES (@source, @doc_type, @url, @url_hash, @raw_json, @canonical_json, @contacts_json, @topic, @status, @confidence, @extracted_at, @updated_at, @run_id)
        ON CONFLICT(url_hash) DO UPDATE SET
          source = excluded.source,
          doc_type = excluded.doc_type,
          raw_json = excluded.raw_json,
          canonical_json = excluded.canonical_json,
          contacts_json = excluded.contacts_json,
          topic = excluded.topic,
          status = excluded.status,
          confidence = excluded.confidence,
          updated_at = excluded.updated_at,
          run_id = excluded.run_id
      `);
      let inserted = 0;
      let updated = 0;
      const tx = db.transaction((list) => {
        for (const r of list) {
          const prev = getByHash.get(r.url_hash);
          const isNew = !prev;
          upsert.run(r);
          if (isNew) inserted++; else updated++;
        }
      });
      tx(rows);
      return { inserted, updated };
    },

    queryDocuments({ source, doc_type, topic, status, run_id, limit = 50, offset = 0, search = "", missingContacts = false } = {}) {
      const w = [];
      const p = {};
      if (source) { w.push("source = @source"); p.source = source; }
      if (doc_type) { w.push("doc_type = @doc_type"); p.doc_type = doc_type; }
      if (topic) { w.push("topic = @topic"); p.topic = topic; }
      if (status) { w.push("status = @status"); p.status = status; }
      if (run_id) { w.push("run_id = @run_id"); p.run_id = run_id; }
      if (search) { w.push("(canonical_json LIKE @q OR raw_json LIKE @q)"); p.q = `%${search}%`; }
      if (missingContacts) { w.push("(contacts_json IS NULL OR contacts_json = '' OR contacts_json = '{}')"); }
      const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
      const rows = db.prepare(`
        SELECT * FROM documents ${where}
        ORDER BY updated_at DESC LIMIT @limit OFFSET @offset
      `).all({ ...p, limit, offset });
      return rows.map(parseDocJson);
    },

    countDocuments(filter = {}) {
      const { source, doc_type, topic, status, run_id, missingContacts = false } = filter;
      const w = [];
      const p = {};
      if (source) { w.push("source = @source"); p.source = source; }
      if (doc_type) { w.push("doc_type = @doc_type"); p.doc_type = doc_type; }
      if (topic) { w.push("topic = @topic"); p.topic = topic; }
      if (status) { w.push("status = @status"); p.status = status; }
      if (run_id) { w.push("run_id = @run_id"); p.run_id = run_id; }
      if (missingContacts) { w.push("(contacts_json IS NULL OR contacts_json = '' OR contacts_json = '{}')"); }
      const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
      return db.prepare(`SELECT COUNT(*) AS n FROM documents ${where}`).get(p).n;
    },

    close() {
      db.close();
    },
  };
}

/** يبني صف documents من وثيقة خام بصيغة موحدة. */
export function parseDocJson(row) {
  if (!row) return row;
  let raw = null, canonical = null, contacts = null;
  try { raw = row.raw_json ? JSON.parse(row.raw_json) : null; } catch {}
  try { canonical = row.canonical_json ? JSON.parse(row.canonical_json) : null; } catch {}
  try { contacts = row.contacts_json ? JSON.parse(row.contacts_json) : null; } catch {}
  return { ...row, raw_json: raw, canonical_json: canonical, contacts_json: contacts };
}

export default open;
export { DEFAULT_PATH, buildUpsert, TENDER_KEYS, CONTRACTOR_KEYS, AWARD_KEYS, PROJECT_KEYS };