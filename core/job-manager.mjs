import crypto from "node:crypto";

/**
 * job-manager.mjs — أوركسترا تنفيذ الجوبات
 * طابور في-المعالجة يُحوِّل التنفيذ حسب المضيف: جوب واحد لكل host في أي لحظة،
 * المضيفات المختلفة تعمل بالتوازي. يدعم التفويم (dedupe)، الإلغاء، وقائمة الحالة.
 * قابل للاستبدال لاحقاً بنواة BullMQ/Redis عند الحاجة لنشر متعدد العمليات.
 */

const hosts = new Map(); // hostname -> HostRunner
const jobs = new Map();  // jobId -> job record

class HostRunner {
  constructor(hostname) {
    this.hostname = hostname;
    this.running = null;
    this.pending = [];
  }
}

function getHost(hostname) {
  if (!hosts.has(hostname)) hosts.set(hostname, new HostRunner(hostname));
  return hosts.get(hostname);
}

export function enqueueJob({ key, hostname, meta = {}, task }) {
  if (typeof task !== "function") throw new TypeError("job-manager: task must be a function");
  if (!hostname) throw new TypeError("job-manager: hostname required");

  if (key) {
    const active = [...jobs.values()].find(j => j.key === key && (j.status === "queued" || j.status === "running"));
    if (active) {
      const h = getHost(active.hostname);
      const position = h.pending.findIndex(p => p.id === active.id) + 1;
      return { jobId: active.id, deduped: true, position: position > 0 ? position : 0, status: active.status };
    }
  }

  const id = crypto.randomUUID();
  const job = {
    id, key: key || null, hostname, meta,
    task, status: "queued", cancelled: false,
    enqueuedAt: new Date().toISOString(), startedAt: null, finishedAt: null, error: null,
  };
  jobs.set(id, job);
  const h = getHost(hostname);
  h.pending.push({ id, meta });
  pump(h);
  return { jobId: id, deduped: false, position: h.pending.length, status: "queued" };
}

async function pump(h) {
  if (h.running) return;
  const entry = h.pending.shift();
  if (!entry) return;
  const job = jobs.get(entry.id);
  if (!job || job.cancelled) { pump(h); return; }

  h.running = entry.id;
  job.status = "running";
  job.startedAt = new Date().toISOString();

  const ctx = {
    jobId: job.id,
    isCancelled: () => job.cancelled,
    update: (patch) => Object.assign(job, patch),
  };

  try {
    await job.task(ctx);
    if (job.cancelled) job.status = "cancelled";
    else job.status = "completed";
  } catch (e) {
    job.status = "failed";
    job.error = e && e.message ? e.message : String(e);
  } finally {
    job.finishedAt = new Date().toISOString();
    h.running = null;
    pump(h);
  }
}

export function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return { ok: false, reason: "not-found" };
  job.cancelled = true;
  if (job.status === "queued") {
    job.status = "cancelled";
    return { ok: true, cancelledQueued: true };
  }
  return { ok: true, cancelledQueued: false, note: "already running — أبِقِ الجري (أوضِف علامة إيقاف للمهمة عبر stop)" };
}

export function getJob(jobId) {
  const j = jobs.get(jobId);
  if (!j) return null;
  return {
    id: j.id, key: j.key, hostname: j.hostname, status: j.status,
    meta: j.meta, enqueuedAt: j.enqueuedAt, startedAt: j.startedAt,
    finishedAt: j.finishedAt, error: j.error,
  };
}

export function listQueue() {
  const out = [];
  for (const [hostname, h] of hosts) {
    if (h.running) out.push({ id: h.running, hostname, status: "running" });
    h.pending.forEach((p, i) => out.push({ id: p.id, hostname, status: "queued", position: i + 1 }));
  }
  return out;
}