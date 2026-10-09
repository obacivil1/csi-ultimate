import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const eq = t.indexOf("=");
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    out[key] = val;
  }
  return out;
}

const REQUIRED = ["JWT_SECRET"];
const SECRETS = ["JWT_SECRET", "PAYPAL_CLIENT_SECRET", "SMTP_PASS", "CSI_CAPTCHA_API_KEY", "CSI_AUTH_TOKEN", "CSI_AUTH_PASS"];
// Weak-secret patterns that must never be accepted, in ANY environment (CWE-798).
const WEAK_SECRET_RE = /^(change[-_]?me|secret|password|default|example|test|dev|admin|123456|qwerty|letmein)/i;

function secretStrengthOk(v) {
  if (!v) return false;
  if (WEAK_SECRET_RE.test(v.trim())) return false;
  if (v.trim().length < 32) return false;
  return new Set(v).size >= 12; // must not be one repeated char / trivial pattern
}

const fileEnv = loadDotEnv();
for (const [k, v] of Object.entries(fileEnv)) {
  if (!(k in process.env)) process.env[k] = v;
}

function isProd() {
  return process.env.NODE_ENV === "production";
}

function validate() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`[env] Missing required env vars: ${missing.join(", ")}. Check .env`);
  }
  // Strength gate applies in ALL environments (a weak JWT secret breaks every account in dev too)
  if (!secretStrengthOk(process.env.JWT_SECRET)) {
    throw new Error(
      "[env] Weak JWT_SECRET — must be >= 32 chars, not a known default word, and non-trivial. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
    );
  }
  const unsafe = SECRETS.filter((k) => k !== "JWT_SECRET" && (process.env[k] ?? "") === "" && isProd());
  if (unsafe.length) {
    throw new Error(`[env] Insecure/default secrets in production: ${unsafe.join(", ")}. Set real values.`);
  }
}

function get(key, fallback = "") {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}

function num(key, fallback) {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && process.env[key] !== undefined ? v : fallback;
}

function flag(key) {
  return process.env[key] === "1" || process.env[key] === "true";
}

export const env = {
  ROOT,
  NODE_ENV: get("NODE_ENV", "development"),
  PORT: num("PORT", 3000),
  // Number of reverse-proxy hops to trust (Render = 1, +Cloudflare = 2). Never use
  // a permissive value: it would let clients spoof X-Forwarded-For / req.ip.
  TRUST_PROXY: num("TRUST_PROXY", 1),
  CSI_PORT: num("CSI_PORT", 3030),
  SCRAPER_UI_PORT: num("SCRAPER_UI_PORT", 3456),
  JWT_SECRET: get("JWT_SECRET"),
  TZ: get("TZ", "Asia/Riyadh"),
  SMTP: {
    HOST: get("SMTP_HOST", "smtp.gmail.com"),
    PORT: num("SMTP_PORT", 587),
    USER: get("SMTP_USER"),
    PASS: get("SMTP_PASS"),
    FROM_EMAIL: get("FROM_EMAIL", "noreply@csi-ultimate.com"),
    FROM_NAME: get("FROM_NAME", "CSI Ultimate"),
  },
  PAYPAL: {
    CLIENT_ID: get("PAYPAL_CLIENT_ID"),
    CLIENT_SECRET: get("PAYPAL_CLIENT_SECRET"),
    SANDBOX: get("PAYPAL_SANDBOX", "true") === "true",
  },
  // Cloudflare Turnstile — optional bot protection. When SECRET_KEY is unset the
  // auth routes skip verification (so local/dev flows keep working).
  TURNSTILE: {
    SITE_KEY: get("TURNSTILE_SITE_KEY"),
    SECRET_KEY: get("TURNSTILE_SECRET_KEY"),
  },
  CACHE_TTL: num("CACHE_TTL", 3600000),
  // In-process node-cron is disabled by default: on Render's ephemeral/sleeping
  // instances it is unreliable. Data updates run in GitHub Actions instead.
  // Set ENABLE_SCHEDULER=1 only for long-lived hosts with persistent storage.
  SCHEDULER: flag("ENABLE_SCHEDULER"),
  ALLOWED_ORIGINS: get("ALLOWED_ORIGINS"),
  LOG_LEVEL: get("CSI_LOG_LEVEL", "INFO").toUpperCase(),
  UAT: flag("CSI_UAT"),
  HARD_MODE: flag("CSI_HARD_MODE"),
  EXTREME_MODE: flag("CSI_EXTREME_MODE"),
  PROXY: get("CSI_PROXY"),
  INDEED_PUBLISHER_ID: get("CSI_INDEED_PUBLISHER_ID"),
  CAPTCHA_API_KEY: get("CSI_CAPTCHA_API_KEY"),
  ALERT_URL: get("CSI_ALERT_URL"),
  CF_WAIT_MS: num("CSI_CF_WAIT_MS", 35000),
  FLARE: {
    URL: get("CSI_FLARE_URL", "http://localhost:8191"),
    TIMEOUT_MS: num("CSI_FLARE_TIMEOUT_MS", 60000),
    CACHE_SIZE: num("CSI_FLARE_CACHE_SIZE", 200),
    DISABLED: flag("CSI_FLARE_DISABLED"),
  },
  AUTH: {
    USER: get("CSI_AUTH_USER") || get("CSI_USER"),
    PASS: get("CSI_AUTH_PASS") || get("CSI_PASS"),
    TOKEN: get("CSI_AUTH_TOKEN") || get("CSI_TOKEN"),
  },
  AI: {
    ENDPOINT: get("CSI_AI_ENDPOINT"),
    MODEL: get("CSI_AI_MODEL", "bigpickle-v2"),
    KEY: get("CSI_AI_KEY"),
    TIMEOUT: num("CSI_AI_TIMEOUT", 60000),
  },
  DEBUG: flag("DEBUG"),
  VA_DEBUG: flag("VA_DEBUG"),
  validate,
};

if (!process.env.TZ) process.env.TZ = env.TZ;