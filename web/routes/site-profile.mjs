import { Router } from "express";
import { buildAllSiteProfiles, buildSiteProfile, listConfiguredSites } from "../../core/site-profile.mjs";

export const siteProfileRouter = Router();

siteProfileRouter.get("/profile", (_req, res) => {
  const profiles = buildAllSiteProfiles();
  const withRuns = profiles.filter(p => p.liveRun.files > 0).length;
  res.json({
    generatedAt: new Date().toISOString(),
    summary: {
      configured: profiles.length,
      withLiveRuns: withRuns,
      overallQuality: profiles.length ? Math.round(profiles.reduce((s, p) => s + p.maturity.score, 0) / profiles.length) : 0,
    },
    sites: profiles,
  });
});

siteProfileRouter.get("/profile/:hostname", (req, res) => {
  const hostname = String(req.params.hostname).replace(/^www\./, "").toLowerCase();
  if (!listConfiguredSites().includes(hostname)) {
    return res.status(404).json({ error: `لم يتم تكوين هذا الموقع: ${hostname}` });
  }
  res.json(buildSiteProfile(hostname));
});