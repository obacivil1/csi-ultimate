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

const fileEnv = loadDotEnv();
for (const [k, v] of Object.entries(fileEnv)) {
  if (!(k in process.env)) process.env[k] = v;
}

function isProd() {
  return process.env.NODE_ENV === "production";
}

function validate() {
  const missing = REQUIRED.filter((k) => !process.env[k] && isProd());
  if (missing.length) {
    throw new Error(`[env] Missing required env vars in production: ${missing.join(", ")}. Check .env`);
  }
  const unsafe = SECRETS.filter((k) => ["change-me-please", ""].includes(process.env[k] ?? "") && isProd());
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
  CACHE_TTL: num("CACHE_TTL", 3600000),
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
  DEBUG: flag("DEBUG"),
  VA_DEBUG: flag("VA_DEBUG"),
  validate,
};

if (!process.env.TZ) process.env.TZ = env.TZ;