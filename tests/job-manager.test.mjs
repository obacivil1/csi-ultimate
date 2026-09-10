import test from "node:test";
import assert from "node:assert/strict";
import { enqueueJob, cancelJob, getJob, listQueue } from "../core/job-manager.mjs";

async function waitFor(jobId, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const j = getJob(jobId);
    if (j && ["completed", "failed", "cancelled"].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timeout waiting job " + jobId);
}

test("يطبع الوظائف على نفس المضيف تسلسلياً (no overlap)", async () => {
  const events = [];
  const host = "jmt.serial.test";
  const mk = (name) => new Promise((resolve) => {
    enqueueJob({
      key: `serial-${name}`,
      hostname: host,
      task: async () => {
        events.push(`${name}:start`);
        await new Promise((r) => setTimeout(r, 30));
        events.push(`${name}:end`);
        resolve();
      },
    });
  });

  await Promise.all([mk("a"), mk("b"), mk("c")]);
  assert.deepEqual(events, ["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
});

test("يشغّل المضيفات المختلفة بالتوازي", async () => {
  const t1 = new Promise((res) => enqueueJob({
    key: "par-1", hostname: "jmt.p1.test",
    task: async () => { await new Promise((r) => setTimeout(r, 50)); res("done"); },
  }));
  const t2 = new Promise((res) => enqueueJob({
    key: "par-2", hostname: "jmt.p2.test",
    task: async () => { await new Promise((r) => setTimeout(r, 50)); res("done"); },
  }));

  const start = Date.now();
  await Promise.all([t1, t2]);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 90, `parallel hosts should overlap (took ${elapsed}ms)`);
});

test("يفوّم الوظائف المتطابقة (dedupe)", async () => {
  let runs = 0;
  const key = "dedupe-key-" + Date.now();
  const r1 = enqueueJob({
    key, hostname: "jmt.dedupe.test",
    task: async () => { runs += 1; await new Promise((r) => setTimeout(r, 30)); },
  });
  const r2 = enqueueJob({
    key, hostname: "jmt.dedupe.test",
    task: async () => { runs += 1; await new Promise((r) => setTimeout(r, 30)); },
  });

  assert.equal(r1.deduped, false);
  assert.equal(r2.deduped, true);
  assert.equal(r1.jobId, r2.jobId);
  await waitFor(r1.jobId);
  assert.equal(runs, 1);
});

test("إلغاء وظيفة قائمة (queued) يمنع تشغيلها", async () => {
  const host = "jmt.cancel.test";
  let victimRan = false;
  const blocker = new Promise((resolve) => {
    enqueueJob({
      key: "cancel-blocker-" + Date.now(), hostname: host,
      task: async () => { await new Promise((r) => setTimeout(r, 50)); resolve(); },
    });
  });
  const q = enqueueJob({
    key: "cancel-victim-" + Date.now(), hostname: host,
    task: async () => { victimRan = true; },
  });
  assert.equal(q.status, "queued");
  const c = cancelJob(q.jobId);
  assert.equal(c.cancelledQueued, true);

  await blocker;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(victimRan, false);
  const j = getJob(q.jobId);
  assert.equal(j.status, "cancelled");
});

test("قائمة الطابور تعكس الوظائف الجارية والمنتظرة", async () => {
  const host = "jmt.list.test";
  let blockerResolve;
  const blocker = new Promise((r) => { blockerResolve = r; });
  const running = enqueueJob({
    key: "list-first-" + Date.now(), hostname: host,
    task: async () => { await blocker; },
  });
  const queued = enqueueJob({
    key: "list-second-" + Date.now(), hostname: host,
    task: async () => {},
  });

  const q = listQueue().filter((x) => x.hostname === host);
  assert.ok(q.some((x) => x.id === running.jobId && x.status === "running"));
  assert.ok(q.some((x) => x.id === queued.jobId && x.status === "queued"));

  blockerResolve();
  await waitFor(running.jobId);
  await waitFor(queued.jobId);
});