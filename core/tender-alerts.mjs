/**
 * tender-alerts.mjs — تنبيهات المواعيد (الخيار 2)
 * ─────────────────────────────────────────────
 * اختيار نقيّ صِرف: منادايات تنتهي خلال X يوم (نشطة حالياً) أو انتهت
 * حديثاً خلال Y يوم — خرج CSV/JSON أسبوعي للعملاء. لا يعتمد على net.
 */

const MS_DAY = 86400000;

export function parseDeadline(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {Array<{id,title,entity,status,deadline,url,value}>} rows
 * @param {{expiringDays?:number, expiredGraceDays?:number, now?:Date|string}} [opts]
 */
export function selectAlerts(rows, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const expiringDays = opts.expiringDays ?? 14;
  const expiredGraceDays = opts.expiredGraceDays ?? 7;

  const expiring = [];
  const recentlyExpired = [];
  for (const r of rows) {
    const dl = parseDeadline(r.deadline);
    if (!dl) continue;
    const daysLeft = (dl - now) / MS_DAY;
    if (daysLeft >= 0 && daysLeft <= expiringDays) {
      expiring.push({ ...r, daysLeft: Math.round(daysLeft) });
    } else if (daysLeft < 0 && -daysLeft <= expiredGraceDays) {
      recentlyExpired.push({ ...r, daysAgo: Math.round(-daysLeft) });
    }
  }
  expiring.sort((a, b) => a.daysLeft - b.daysLeft || String(a.id).localeCompare(String(b.id)));
  recentlyExpired.sort((a, b) => a.daysAgo - b.daysAgo || String(a.id).localeCompare(String(b.id)));

  return {
    generatedAt: now.toISOString(),
    window: { expiringDays, expiredGraceDays },
    expiringCount: expiring.length,
    recentlyExpiredCount: recentlyExpired.length,
    expiring,
    recentlyExpired,
  };
}