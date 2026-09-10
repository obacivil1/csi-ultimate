/**
 * topic-classifier.mjs — تصنيف مواضيع عام
 * يجمع نصوص (عربية/إنجليزية) ويرجّح لكل تصنيف درجات مبنية على كلمات مفاتيح مرجّحة،
 * ويصدر: قائمة المواضيع مع نسبة القوة لكل منها + التصنيف الغالب.
 * لا يعتمد على أي خدمة خارجية — قابل للاختبار بشكل حتمي.
 */

export const TAXONOMY = {
  business: {
    label: "أعمال / تجاري",
    weights: {
      "أعمال": 2, "تجاري": 2, "سوق": 1, "استثمار": 2, "أرباح": 2, "مصنع": 1, "منتجات": 1,
      "مورد": 1, "عقود": 1, "تصدير": 1, "استيراد": 1, "شركة": 1, "شركات": 1, "تجارة": 2,
      "business": 2, "market": 1, "investment": 2, "profit": 2, "supplier": 1, "trade": 2,
      "company": 1, "export": 1, "import": 1, "manufactur": 1,
    },
  },
  news: {
    label: "أخبار",
    weights: {
      "أخبار": 2, "عاجل": 2, "وكالة": 1, "تقرير": 1, "مراسل": 1, "بث مباشر": 1, "صحيفة": 1,
      "news": 2, "breaking": 2, "report": 1, "correspondent": 1, "headline": 1, "live": 1,
    },
  },
  sports: {
    label: "رياضة",
    weights: {
      "كرة": 2, "كرة القدم": 3, "دوري": 2, "مباراة": 2, "نادي": 1, "لاعب": 1, "ملعب": 1,
      "مدرب": 1, "جمهور": 1, "أهداف": 2, "بطل": 1, "رياضة": 2, "أولمبياد": 2,
      "football": 3, "soccer": 3, "match": 2, "league": 2, "player": 1, "stadium": 1,
      "goal": 2, "team": 1, "championship": 2, "sport": 2,
    },
  },
  tech: {
    label: "تقنية",
    weights: {
      "تقنية": 2, "تكنولوجيا": 2, "برمجيات": 2, "تطبيق": 1, "ذكاء اصطناعي": 3, "بيانات": 1,
      "شبكات": 1, "أمن سيبراني": 3, "أجهزة": 1, "هواتف": 1, "الحوسبة": 2, "الإنترنت": 1,
      "tech": 2, "software": 2, "app": 1, "artificial": 3, "ai": 3, "data": 1, "cyber": 3,
      "cloud": 2, "network": 1, "digital": 1, "startup": 2, "algorithm": 2, "code": 1,
    },
  },
  health: {
    label: "صحة",
    weights: {
      "صحة": 2, "طبي": 2, "دواء": 2, "علاج": 1, "مستشفى": 2, "لقاح": 2, "فيروس": 2,
      "مرض": 1, "عيادة": 2, "جراحة": 1, "ممرض": 1, "تغذية": 1,
      "health": 2, "medical": 2, "hospital": 2, "vaccine": 3, "virus": 2, "clinic": 2,
      "doctor": 1, "surgery": 1, "nutrition": 1, "cancer": 2,
    },
  },
  finance: {
    label: "اقتصاد / مالية",
    weights: {
      "بنك": 2, "مصرف": 2, "عملة": 1, "بورصة": 2, "ذهب": 2, "نقد": 1, "إفلاس": 1,
      "قروض": 2, "فوائد": 1, "احتياطي": 1, "ميزانية": 1, "تضخم": 2,
      "bank": 2, "banking": 2, "currency": 1, "stock": 2, "exchange": 1, "gold": 2,
      "loan": 2, "mortgage": 1, "inflation": 2, "budget": 1, "recession": 2, "financ": 2,
    },
  },
  jobs: {
    label: "وظائف / توظيف",
    weights: {
      "وظيفة": 2, "وظائف": 2, "توظيف": 2, "راتب": 1, "سيرة ذاتية": 2, "مقابلة": 1,
      "مهندس": 1, "شاغر": 2, "حافز": 1, "رفع الملف": 1, "توظيف": 2, "متقدم": 1,
      "hiring": 2, "recruit": 2, "job": 2, "jobs": 2, "salary": 1, "resume": 2,
      "interview": 2, "engineer": 1, "vacancy": 2, "career": 2,
    },
  },
  real_estate: {
    label: "عقارات",
    weights: {
      "عقار": 2, "شقة": 2, "فيلا": 2, "أرض": 1, "إيجار": 1, "تمليك": 1, "سكني": 1,
      "تجاري": 0, "مكتب": 1, "عمائر": 2, "تورط": 1, "مؤجر": 1,
      "real estate": 3, "property": 2, "apartment": 2, "villa": 2, "rent": 1,
      "mortgage": 2, "land": 1, "housing": 2, "estate": 2,
    },
  },
  automotive: {
    label: "سيارات",
    weights: {
      "سيارة": 2, "سيارات": 2, "محرك": 1, "قطع غيار": 2, "وكالة": 1, "مركبات": 2,
      "التسجيل": 1, "لوحة": 1, "كرون": 1, "مطلوب": 1,
      "car": 2, "cars": 2, "vehicle": 2, "engine": 1, "auto": 1, "dealership": 2,
      "parts": 1, "truck": 1, "garage": 2,
    },
  },
  education: {
    label: "تعليم",
    weights: {
      "جامعة": 2, "تعليم": 2, "مدرسة": 2, "طالب": 1, "منحة": 2, "دراسة": 1, "كورس": 1,
      "مناهج": 2, "امتحان": 1, "درجات": 1, "محاضرات": 1, "كلية": 2,
      "education": 2, "university": 2, "school": 2, "course": 1, "scholarship": 2,
      "student": 1, "college": 2, "campus": 1, "academic": 2, "research": 1,
    },
  },
};

const HIGH_SIGNAL = 3;

export function classifyText(text) {
  if (!text || typeof text !== "string") {
    return { dominant: { topic: "general", label: "عام", pct: 100 }, topics: [], scored: false };
  }

  const haystack = ` ${text.toLowerCase()} `;
  const scores = {};
  for (const [topic, spec] of Object.entries(TAXONOMY)) {
    let score = 0;
    for (const [kw, w] of Object.entries(spec.weights)) {
      if (w === 0) continue;
      // قم بحساب وقوعات الكلمة مع حدّ أقصى لمنع التشبع في النصوص الطويلة
      let count = 0;
      let idx = haystack.indexOf(kw);
      while (idx !== -1 && count < 10) {
        count += 1;
        idx = haystack.indexOf(kw, idx + kw.length);
      }
      if (count > 0) score += w * (count === 1 ? 1 : Math.min(3, count));
    }
    if (score > 0) scores[topic] = score;
  }

  if (Object.keys(scores).length === 0) {
    return { dominant: { topic: "general", label: "عام", pct: 100 }, topics: [], scored: false };
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const topics = Object.entries(scores)
    .map(([topic, score]) => ({
      topic,
      label: TAXONOMY[topic].label,
      score,
      pct: Math.round((score / total) * 1000) / 10,
    }))
    .sort((a, b) => b.score - a.score);

  return {
    dominant: { topic: topics[0].topic, label: topics[0].label, pct: Math.round(topics[0].score / total * 100) },
    topics,
    scored: true,
    highSignal: topics.some(t => t.score >= HIGH_SIGNAL * 2),
  };
}

export function classifyDocumentTitle(title) {
  return classifyText(title || "");
}

export function mixTexts(texts) {
  return texts.filter(Boolean).join(" ").toLowerCase();
}