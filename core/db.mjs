/**
 * db.mjs — SQLite persistence layer for core datasets.
 * ─────────────────────────────────────────────────────────
 * Replaces JSON-on-disk as the long-term store for
 * tenders, contractors, awards, and projects, while keeping
 * JSON exports for interop. WAL mode + prepared statements.
 *
 * Usage:
 *   const db = await connectDB("data/csi.db")
 *   await db.upsertTenders(rows)
 *   const rows = await db.queryTenders({ limit, city, status })
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

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
  `);
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
      };
    },

    close() {
      db.close();
    },
  };
}

export default open;
export { DEFAULT_PATH, buildUpsert, TENDER_KEYS, CONTRACTOR_KEYS, AWARD_KEYS, PROJECT_KEYS };