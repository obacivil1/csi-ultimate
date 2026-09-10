/**
 * CSI Job Hunter Pro — Keyword Generator
 * Generates smart search keywords from job families + Arabic aliases
 */

const JOB_FAMILIES = {
  engineering: {
    en: ['engineer', 'engineering', 'technical', 'technician'],
    ar: ['مهندس', 'هندسي', 'تقني'],
    variants: ['planning engineer', 'project engineer', 'site engineer', 'process engineer', 'quality engineer', 'safety engineer', 'maintenance engineer', 'design engineer'],
  },
  construction: {
    en: ['construction', 'building', 'contractor', 'infrastructure'],
    ar: ['بناء', 'مقاولات', 'تشييد', 'بنية تحتية'],
    variants: ['civil works', 'road construction', 'building construction', 'MEP', 'structural'],
  },
  driving: {
    en: ['driver', 'driving', 'delivery', 'transport', 'logistics'],
    ar: ['سائق', 'قيادة', 'توصيل', 'نقل', 'لوجستيات'],
    variants: ['delivery driver', 'truck driver', 'bus driver', 'taxi driver', 'warehouse driver', 'heavy vehicle driver'],
  },
  accounting: {
    en: ['accountant', 'accounting', 'finance', 'financial', 'bookkeeper'],
    ar: ['محاسب', 'محاسبة', 'مالية', 'مالي'],
    variants: ['senior accountant', 'cost accountant', 'tax accountant', 'audit', 'accounts payable', 'accounts receivable', 'financial analyst'],
  },
  sales: {
    en: ['sales', 'selling', 'business development', 'marketing'],
    ar: ['مبيعات', 'بيع', 'تسويق', 'تطوير أعمال'],
    variants: ['sales executive', 'sales manager', 'sales representative', 'retail', 'wholesale', 'account manager'],
  },
  admin: {
    en: ['admin', 'administrative', 'office', 'secretary', 'receptionist'],
    ar: ['إداري', 'إدارة مكتبية', 'سكرتير', 'استقبال'],
    variants: ['office admin', 'admin assistant', 'office manager', 'front desk', 'data entry', 'clerk'],
  },
  hospitality: {
    en: ['hotel', 'hospitality', 'restaurant', 'food', 'catering'],
    ar: ['فندق', 'ضيافة', 'مطعم', 'طعام', 'تموين'],
    variants: ['waiter', 'chef', 'cook', 'housekeeping', 'front office', 'receptionist', 'food service', 'barista'],
  },
  retail: {
    en: ['retail', 'shop', 'store', 'sales assistant', 'cashier'],
    ar: ['تجزئة', 'متجر', 'محاسب نقدي', 'بائع'],
    variants: ['store manager', 'sales associate', 'visual merchandiser', 'inventory', 'stock room'],
  },
  it: {
    en: ['IT', 'software', 'developer', 'programmer', 'network', 'system admin'],
    ar: ['تقنية معلومات', 'برمجيات', 'مبرمج', 'شبكات', 'مسؤول نظام'],
    variants: ['web developer', 'full stack', 'frontend', 'backend', 'devops', 'database', 'cyber security'],
  },
  medical: {
    en: ['medical', 'doctor', 'nurse', 'pharmacist', 'lab technician'],
    ar: ['طبي', 'طبيب', 'ممرض', 'صيدلي', 'فني مختبر'],
    variants: ['physician', 'registered nurse', 'pharmacy', 'radiology', 'physiotherapy', 'dental'],
  },
  education: {
    en: ['teacher', 'tutor', 'instructor', 'professor', 'education'],
    ar: ['معلم', 'مدرّب', 'محاضر', 'أستاذ', 'تعليم'],
    variants: ['english teacher', 'arabic teacher', 'math teacher', 'kindergarten', 'curriculum'],
  },
  security: {
    en: ['security', 'guard', 'safety', 'protection'],
    ar: ['أمن', 'حارس', 'حماية', 'سلامة'],
    variants: ['security guard', 'safety officer', 'fire safety', 'loss prevention'],
  },
  hr: {
    en: ['HR', 'human resources', 'recruitment', 'personnel'],
    ar: ['موارد بشرية', 'توظيف', 'شؤون موظفين'],
    variants: ['HR manager', 'recruiter', 'payroll', 'training', 'talent acquisition'],
  },
  warehouse: {
    en: ['warehouse', 'storekeeper', 'inventory', 'forklift'],
    ar: ['مستودع', 'أمين مخزن', 'جرد', 'فوركليفت'],
    variants: ['warehouse supervisor', 'material handler', 'packing', 'shipping', 'receiving'],
  },
  real_estate: {
    en: ['real estate', 'property', 'broker', 'agent'],
    ar: ['عقارات', 'ممتلكات', 'وسطاء عقارات'],
    variants: ['real estate agent', 'property manager', 'leasing', 'sales agent'],
  },
  cleaning: {
    en: ['cleaning', 'janitor', 'maintenance', 'facilities'],
    ar: ['تنظيف', 'صيانة', 'مرافق'],
    variants: ['cleaning staff', 'housekeeping', 'facility manager', 'building maintenance'],
  },
  procurement: {
    en: ['procurement', 'purchasing', 'buyer', 'supply chain'],
    ar: ['مشتريات', 'توريد', 'سلسلة توريد'],
    variants: ['procurement manager', 'purchasing officer', 'supply chain', 'vendor management'],
  },
  design: {
    en: ['designer', 'design', 'graphic', 'architect'],
    ar: ['مصمم', 'تصميم', 'رسام', 'مهندس معماري'],
    variants: ['graphic designer', 'interior designer', 'UI/UX', 'architect', 'CAD'],
  },
};

const ARABIC_ALIASES = {
  'سائق': ['driver', 'delivery', 'transport'],
  'مهندس': ['engineer', 'engineering'],
  'محاسب': ['accountant', 'accounting', 'finance'],
  'مبيعات': ['sales', 'salesman', 'selling'],
  'إداري': ['admin', 'administrative', 'office'],
  'فندق': ['hotel', 'hospitality'],
  'مطعم': ['restaurant', 'food', 'chef', 'cook'],
  'معلم': ['teacher', 'tutor', 'education'],
  'أمن': ['security', 'guard', 'safety'],
  'مصمم': ['designer', 'design'],
  'warehousing': ['warehouse', 'storekeeper'],
  'تنظيف': ['cleaning', 'janitor'],
  'مشتريات': ['procurement', 'purchasing', 'buyer'],
  'موارد بشرية': ['HR', 'human resources', 'recruitment'],
};

const LOCATION_ALIASES = {
  'saudi': 'Saudi Arabia',
  'السعودية': 'Saudi Arabia',
  'ksa': 'Saudi Arabia',
  'riyadh': 'Riyadh',
  'الرياض': 'Riyadh',
  'jeddah': 'Jeddah',
  'جدة': 'Jeddah',
  'dammam': 'Dammam',
  'الدمام': 'Dammam',
  'uae': 'UAE',
  'الإمارات': 'UAE',
  'dubai': 'Dubai',
  'دبي': 'Dubai',
  'abudhabi': 'Abu Dhabi',
  'أبو ظبي': 'Abu Dhabi',
  'qatar': 'Qatar',
  'قطر': 'Qatar',
  'kuwait': 'Kuwait',
  'الكويت': 'Kuwait',
  'bahrain': 'Bahrain',
  'البحرين': 'Bahrain',
  'oman': 'Oman',
  'عُمان': 'Oman',
  'egypt': 'Egypt',
  'مصر': 'Egypt',
};

/**
 * Generate keywords from a free-text job title/role
 * @param {string} input - e.g. "planning engineer" or "مهندس تخطيط"
 * @returns {string[]} - expanded keyword list
 */
function generateKeywords(input) {
  if (!input || typeof input !== 'string') return [];

  const normalized = input.trim().toLowerCase();
  const keywords = new Set();

  // Direct input always included
  keywords.add(input.trim());

  // Check Arabic aliases
  for (const [ar, enList] of Object.entries(ARABIC_ALIASES)) {
    if (normalized.includes(ar) || normalized.includes(ar.toLowerCase())) {
      for (const kw of enList) keywords.add(kw);
    }
  }

  // Check job families
  for (const [, family] of Object.entries(JOB_FAMILIES)) {
    const allTerms = [...family.en, ...family.ar];
    const matches = allTerms.some(t => normalized.includes(t.toLowerCase()));
    if (matches) {
      for (const v of family.variants) keywords.add(v);
      for (const e of family.en) keywords.add(e);
    }
  }

  // If no family matched, still return the input
  return [...keywords].filter(k => k.length > 1).slice(0, 20);
}

/**
 * Get a human-readable label for a job family key
 */
function getFamilyLabel(key) {
  const labels = {
    engineering: 'Engineering',
    construction: 'Construction',
    driving: 'Driving',
    accounting: 'Accounting',
    sales: 'Sales',
    admin: 'Admin',
    hospitality: 'Hospitality',
    retail: 'Retail',
    it: 'IT',
    medical: 'Medical',
    education: 'Education',
    security: 'Security',
    hr: 'Human Resources',
    warehouse: 'Warehouse',
    real_estate: 'Real Estate',
    cleaning: 'Cleaning',
    procurement: 'Procurement',
    design: 'Design',
  };
  return labels[key] || key;
}

/**
 * Detect which family a query belongs to
 */
function detectFamily(input) {
  if (!input) return null;
  const normalized = input.trim().toLowerCase();

  for (const [key, family] of Object.entries(JOB_FAMILIES)) {
    const allTerms = [...family.en, ...family.ar];
    if (allTerms.some(t => normalized.includes(t.toLowerCase()))) {
      return key;
    }
  }
  return null;
}

export { JOB_FAMILIES, ARABIC_ALIASES, LOCATION_ALIASES, generateKeywords, getFamilyLabel, detectFamily };
