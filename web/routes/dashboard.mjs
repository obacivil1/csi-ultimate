import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../middleware/auth.mjs';
import { getJSON } from '../cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const dashboardRouter = Router();

const TENDERS_FILE = path.join(__dirname, '..', '..', 'data', 'etimad_all_tenders.json');
const CONTRACTORS_FILE = path.join(__dirname, '..', '..', 'data', 'muqawil_contractors.json');

// GET /api/dashboard/summary - Main dashboard stats
dashboardRouter.get('/summary', authenticate, (req, res) => {
  const { subscription, trialDaysLeft } = req.user;

  res.json({
    user: {
      name: req.user.name,
      email: req.user.email,
      company: req.user.company,
      subscription,
      trialDaysLeft: trialDaysLeft || 0,
      isActive: ['basic', 'professional', 'enterprise', 'trial'].includes(subscription),
      isTrial: subscription === 'trial',
      isExpired: subscription === 'expired'
    },
    features: {
      canViewTenders: true,
      canViewContractors: ['basic', 'professional', 'enterprise', 'trial'].includes(subscription),
      canExport: ['professional', 'enterprise'].includes(subscription),
      canUseAPI: ['enterprise'].includes(subscription),
      maxExport: subscription === 'trial' ? 50 : subscription === 'basic' ? 200 : -1
    }
  });
});

// GET /api/dashboard/analytics - Charts data
dashboardRouter.get('/analytics', (req, res) => {
  try {
    const tenders = getJSON('tenders', TENDERS_FILE) || [];

    // 1. Top 10 agencies
    const agencyCount = {};
    tenders.forEach(t => {
      const a = t.agencyName || 'غير معروف';
      agencyCount[a] = (agencyCount[a] || 0) + 1;
    });
    const topAgencies = Object.entries(agencyCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    // 2. Activity distribution
    const activityCount = {};
    const ACTIVITY_MAP = {
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
      'إيجار': 'إيجار وتأجير', 'تأجير': 'إيجار وتأجير'
    };
    tenders.forEach(t => {
      const act = t.tenderActivityName || 'أخرى';
      let found = false;
      for (const [kw, cat] of Object.entries(ACTIVITY_MAP)) {
        if (act.includes(kw)) { activityCount[cat] = (activityCount[cat] || 0) + 1; found = true; break; }
      }
      if (!found) activityCount['أخرى'] = (activityCount['أخرى'] || 0) + 1;
    });
    const activityDist = Object.entries(activityCount)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    // 3. Monthly trend (from submitionDate)
    const monthCount = {};
    tenders.forEach(t => {
      const d = t.submitionDate;
      if (d && d.length >= 7) {
        const m = d.substring(0, 7); // YYYY-MM
        monthCount[m] = (monthCount[m] || 0) + 1;
      }
    });
    const monthlyTrend = Object.entries(monthCount)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-24) // last 24 months
      .map(([month, count]) => ({ month, count }));

    res.json({ topAgencies, activityDist, monthlyTrend });
  } catch(e) {
    res.json({ topAgencies: [], activityDist: [], monthlyTrend: [] });
  }
});
