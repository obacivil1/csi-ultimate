// Shared tender analytics — used by the authenticated dashboard (/api/dashboard/analytics)
// and the public insights endpoint (/api/meta/insights). Kept in one place so the two
// surfaces never drift apart.

export const ACTIVITY_MAP = {
  'مقاولات': 'تشييد ومقاولات', 'تشييد': 'تشييد ومقاولات', 'بناء': 'تشييد ومقاولات',
  'إنشاء': 'تشييد ومقاولات', 'هدم': 'تشييد ومقاولات', 'ترميم': 'تشييد ومقاولات',
  'صيانة': 'صيانة وتشغيل', 'تشغيل': 'صيانة وتشغيل', 'نظافة': 'صيانة وتشغيل',
  'كهرباء': 'كهرباء وسباكة', 'سباكة': 'كهرباء وسباكة',
  'طرق': 'طرق وبنية تحتية', 'حفر': 'طرق وبنية تحتية', 'ردم': 'طرق وبنية تحتية',
  'تسوية': 'طرق وبنية تحتية', 'خرسانة': 'تشييد ومقاولات',
  'دهان': 'تشييد ومقاولات', 'عزل': 'تشييد ومقاولات',
  'حديد': 'تشييد ومقاولات', 'أساسات': 'تشييد ومقاولات',
  'تقنية': 'تقنية معلومات', 'برمجة': 'تقنية معلومات', 'نظم': 'تقنية معلومات',
  'اتصالات': 'تقنية معلومات', 'برامج': 'تقنية معلومات',
  'زراعي': 'زراعة وثروة حيوانية', 'بيطري': 'زراعة وثروة حيوانية',
  'طبي': 'صحة', 'صحي': 'صحة', 'مستشفى': 'صحة',
  'تعليم': 'تعليم وتدريب', 'تدريب': 'تعليم وتدريب',
  'أمن': 'أمن وسلامة', 'سلامة': 'أمن وسلامة',
  'مياه': 'مياه وكهرباء', 'كهرباء': 'مياه وكهرباء',
  'استشارات': 'استشارات ودراسات', 'دراسة': 'استشارات ودراسات',
  'توريد': 'توريدات', 'مشتريات': 'توريدات',
  'نقل': 'نقل', 'مواصلات': 'نقل',
  'إيجار': 'إيجار وتأجير', 'تأجير': 'إيجار وتأجير',
};

export function categorizeActivity(activity) {
  const act = activity || '';
  for (const [kw, cat] of Object.entries(ACTIVITY_MAP)) {
    if (act.includes(kw)) return cat;
  }
  return 'أخرى';
}

// Single O(n) pass over the tenders array → everything the charts and insight cards need.
export function computeTenderAnalytics(tenders, { topN = 10, trendMonths = 24 } = {}) {
  const agencyCount = {};
  const activityCount = {};
  const activityNameCount = {};
  const monthCount = {};
  const typeCount = {};

  let bookletTotal = 0, bookletFree = 0, bookletPaidSum = 0, bookletPaidCount = 0, bookletMax = 0;
  let active = 0, within7 = 0, within14 = 0, within30 = 0;

  const now = new Date();
  const d7 = new Date(now.getTime() + 7 * 86400000);
  const d14 = new Date(now.getTime() + 14 * 86400000);
  const d30 = new Date(now.getTime() + 30 * 86400000);

  for (const t of tenders) {
    const a = t.agencyName || 'غير معروف';
    agencyCount[a] = (agencyCount[a] || 0) + 1;

    const cat = categorizeActivity(t.tenderActivityName);
    activityCount[cat] = (activityCount[cat] || 0) + 1;

    const an = (t.tenderActivityName || '').trim();
    if (an) activityNameCount[an] = (activityNameCount[an] || 0) + 1;

    const ty = t.tenderTypeName || 'غير محدد';
    typeCount[ty] = (typeCount[ty] || 0) + 1;

    const d = t.submitionDate;
    if (d && d.length >= 7) {
      const m = d.substring(0, 7);
      monthCount[m] = (monthCount[m] || 0) + 1;
    }

    const p = Number(t.condetionalBookletPrice);
    if (Number.isFinite(p)) {
      bookletTotal++;
      if (p === 0) bookletFree++;
      else { bookletPaidSum += p; bookletPaidCount++; if (p > bookletMax) bookletMax = p; }
    }

    if ([2, 3, 4, 5].includes(t.tenderStatusId)) active++;

    if (t.lastOfferPresentationDate) {
      const ld = new Date(t.lastOfferPresentationDate);
      if (ld > now) {
        if (ld < d7) within7++;
        if (ld < d14) within14++;
        if (ld < d30) within30++;
      }
    }
  }

  const asList = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const monthlyTrend = Object.entries(monthCount)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-trendMonths)
    .map(([month, count]) => ({ month, count }));

  return {
    topAgencies: asList(agencyCount).slice(0, topN).map(([name, count]) => ({ name, count })),
    activityDist: asList(activityCount).map(([name, count]) => ({ name, count })),
    topActivities: asList(activityNameCount).slice(0, 12).map(([name, count]) => ({ name, count })),
    types: asList(typeCount).map(([name, count]) => ({ name, count })),
    monthlyTrend,
    booklet: {
      total: bookletTotal,
      free: bookletFree,
      freePct: bookletTotal ? Math.round((bookletFree / bookletTotal) * 100) : 0,
      paidAvg: bookletPaidCount ? Math.round(bookletPaidSum / bookletPaidCount) : 0,
      paidCount: bookletPaidCount,
      max: bookletMax,
    },
    urgency: { within7, within14, within30 },
    active,
    total: tenders.length,
  };
}
