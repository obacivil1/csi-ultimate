import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { enqueueJob, getJob, listQueue, cancelJob } from "../../core/job-manager.mjs";
import { classifyText } from "../../core/topic-classifier.mjs";
import { crawlUrls, summarizeDocuments } from "../../core/general-crawl.mjs";
import { logger } from "../../core/logger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.resolve(__dirname, "../../state/general.json");

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")) } catch { return null }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8")
}

function loadJobs() {
  return readJSON(STATE_FILE) || [];
}
function persistJob(record) {
  const jobs = loadJobs();
  const idx = jobs.findIndex((j) => j.id === record.id);
  if (idx >= 0) jobs[idx] = { ...jobs[idx], ...record };
  else jobs.push(record);
  writeJSON(STATE_FILE, jobs);
}

export const generalRouter = Router();

generalRouter.post("/crawl", (req, res) => {
  const { urls = [], opts = {} } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "urls مطلوب (مصفوفة روابط واحدة على الأقل)" });
  }
  const depth = Math.max(0, Math.min(3, parseInt(opts.depth) || 0));
  const maxPages = Math.max(1, Math.min(100, parseInt(opts.maxPages) || 20));
  const fetchMode = opts.fetchMode === "browser" ? "browser" : "fetch";

  const hostname = (() => { try { return new URL(urls[0]).hostname; } catch { return "general"; } })();
  const enq = enqueueJob({
    key: `general:${hostname}:${depth}:${maxPages}:${urls.join("|")}`,
    hostname,
    meta: { kind: "general", count: urls.length, depth, maxPages },
    task: async (ctx) => {
      ctx.update({ progress: 5 });
      const docs = await crawlUrls(urls, { depth, maxPages, fetchMode, extract: opts.extract });
      if (ctx.isCancelled()) return;
      const summary = summarizeDocuments(docs, classifyText);
      persistJob({ id: enq.jobId, status: "completed", output: { docs, summary }, endedAt: new Date().toISOString() });
    },
  });

  if (!enq.deduped) {
    persistJob({
      id: enq.jobId, status: "queued", hostname, depth, maxPages, count: urls.length,
      enqueuedAt: new Date().toISOString(), output: null,
    });
  }

  res.status(202).json({
    jobId: enq.jobId, status: enq.status, deduped: enq.deduped, position: enq.position, hostname,
  });
});

generalRouter.get("/jobs", (_req, res) => {
  const jobs = loadJobs().map((j) => ({ id: j.id, status: j.status, hostname: j.hostname, count: j.count, enqueuedAt: j.enqueuedAt, endedAt: j.endedAt }));
  res.json({ jobs, queue: listQueue().filter((q) => q.hostname || true) });
});

generalRouter.get("/jobs/:id", (req, res) => {
  const job = loadJobs().find((j) => j.id === req.params.id) || getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Not found" });
  res.json(job);
});

generalRouter.post("/jobs/:id/cancel", (req, res) => {
  cancelJob(req.params.id);
  const jobs = loadJobs();
  const idx = jobs.findIndex((j) => j.id === req.params.id);
  if (idx >= 0) {
    jobs[idx] = { ...jobs[idx], status: "cancelled" };
    writeJSON(STATE_FILE, jobs);
  }
  res.json({ ok: true });
});

generalRouter.post("/classify", (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== "string") return res.status(400).json({ error: "text مطلوب" });
  res.json(classifyText(text));
});