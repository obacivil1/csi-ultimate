// Lightweight, privacy-friendly conversion metrics.
//
// Only AGGREGATE COUNTERS are kept (no IPs, no user ids, no cookies, no PII).
// The goal is to answer one question after launch: how many visitors turned
// into signups / sample downloads / paid purchases.
//
// Durable storage: Upstash Redis (same REST credentials as web/store.mjs) when
// configured, otherwise a local JSON file (fine for dev; ephemeral on Render).

import fs from 'fs';
import path from 'path';

const KEY = 'metrics';
const FILE = path.join(process.cwd(), 'state', 'metrics.json');

export const EVENTS = [
  'visit_home',
  'view_insights',
  'download_sample',
  'signup',
  'login',
  'checkout_start',
  'purchase',
  'webhook_activation',
];

let data = null;
let timer = null;

function env() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/$/, '');
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  return { url, token };
}

async function upstash(command) {
  const { url, token } = env();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

function emptyData() {
  return {
    totals: Object.fromEntries(EVENTS.map(e => [e, 0])),
    daily: {},
    since: new Date().toISOString(),
  };
}

function merge(parsed) {
  const base = emptyData();
  if (!parsed || typeof parsed !== 'object') return base;
  for (const e of EVENTS) base.totals[e] = Number(parsed.totals?.[e]) || 0;
  if (parsed.daily && typeof parsed.daily === 'object') base.daily = parsed.daily;
  if (parsed.since) base.since = parsed.since;
  return base;
}

/** Load counters once at startup (before the HTTP server accepts traffic). */
export async function initMetrics() {
  if (data) return;
  const { url, token } = env();
  if (url && token) {
    try {
      const raw = await upstash(['GET', KEY]);
      data = merge(raw ? JSON.parse(raw) : null);
      return;
    } catch (e) {
      console.error(`[metrics] upstream load failed: ${e.message}`);
    }
  }
  try {
    data = merge(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch {
    data = emptyData();
  }
}

function persist() {
  const json = JSON.stringify(data);
  const { url, token } = env();
  if (url && token) {
    return upstash(['SET', KEY, json]).catch(e => console.error(`[metrics] save failed: ${e.message}`));
  }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, json, 'utf8');
  } catch (e) {
    console.error(`[metrics] file write failed: ${e.message}`);
  }
  return Promise.resolve();
}

/** Increment one counter. Synchronous and cheap; persistence is debounced. */
export function track(event) {
  if (!EVENTS.includes(event)) return;
  if (!data) data = emptyData();
  data.totals[event] = (data.totals[event] || 0) + 1;
  const day = new Date().toISOString().slice(0, 10);
  const d = (data.daily[day] = data.daily[day] || {});
  d[event] = (d[event] || 0) + 1;

  // Coalesce bursts into one write every couple of seconds.
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; persist(); }, 2000);
  if (typeof timer.unref === 'function') timer.unref();
}

/** Flush pending counts (call on shutdown). */
export async function flushMetrics() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (data) await persist();
}

/** Snapshot for the admin dashboard: totals + the last N calendar days (UTC). */
export function getMetrics({ days = 14 } = {}) {
  const base = data || emptyData();
  const cutoff = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const daily = Object.entries(base.daily)
    .filter(([date]) => date >= cutoff)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, counts]) => ({ date, ...counts }));
  return { totals: { ...base.totals }, daily, since: base.since, events: EVENTS };
}
