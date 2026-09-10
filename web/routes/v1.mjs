import { Router } from "express";
import { authRouter } from "./auth.mjs";
import { tendersRouter } from "./tenders.mjs";
import { contractorsRouter } from "./contractors.mjs";
import { paymentsRouter } from "./payments.mjs";
import { dashboardRouter } from "./dashboard.mjs";
import { awardsRouter } from "./awards.mjs";
import { projectsRouter } from "./projects.mjs";
import { exportRouter } from "./export.mjs";
import { alertsRouter } from "./alerts.mjs";
import { adminRouter } from "./admin.mjs";
import { contactRouter } from "./contact.mjs";
import { engineRouter } from "./engine.mjs";
import { siteProfileRouter } from "./site-profile.mjs";
import { generalRouter } from "./general.mjs";
import { proxiesRouter } from "./proxies.mjs";

/**
 * v1.mjs — عقد الواجهة الثابت (/api/v1/*)
 * المسارات القديمة /api/* تبقى شغّالة كأسماء بديلة؛ الجديد يحدث هنا فقط.
 * أي تغيير مستقبلي يُفتح في v2 ويكون v1 ثابتاً للمستهلكين.
 */
export const v1Router = Router();

v1Router.get("/health", (req, res) => {
  res.json({ ok: true, version: "v1", time: Date.now() });
});

v1Router.use("/auth", authRouter);
v1Router.use("/tenders", tendersRouter);
v1Router.use("/contractors", contractorsRouter);
v1Router.use("/payments", paymentsRouter);
v1Router.use("/dashboard", dashboardRouter);
v1Router.use("/awards", awardsRouter);
v1Router.use("/projects", projectsRouter);
v1Router.use("/export", exportRouter);
v1Router.use("/alerts", alertsRouter);
v1Router.use("/admin", adminRouter);
v1Router.use("/contact", contactRouter);
v1Router.use("/general", generalRouter);
v1Router.use("/proxies", proxiesRouter);
v1Router.use("/", siteProfileRouter);
v1Router.use("/", engineRouter);