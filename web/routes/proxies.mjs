import { Router } from "express";
import { hostname } from "os";
import { listProxies, getProxy, checkProxies } from "../../core/proxy-pool.mjs";

export const proxiesRouter = Router();

// GET /proxies — حالة البركة كاملة (تشخيصية)
proxiesRouter.get("/", (_req, res) => {
  const list = listProxies();
  res.json({
    proxies: list,
    total: list.length,
    healthy: list.filter((p) => p.ok).length,
    server: hostname(),
  });
});

// POST /proxies/check — فحص صحة قسري لكل بروكسي
proxiesRouter.post("/check", async (_req, res) => {
  try {
    const results = await checkProxies(undefined, { force: true });
    res.json({ checked: results.length, results });
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

// GET /proxies/select?host= — اختيار بروكسي سالم بالتناوب
proxiesRouter.get("/select", (req, res) => {
  const host = req.query.host || "";
  const proxy = getProxy(host);
  res.json({ proxy, host, note: proxy ? null : "لا يوجد بروكسي في البركة حالياً (سيستخدم الوضع العادي)" });
});