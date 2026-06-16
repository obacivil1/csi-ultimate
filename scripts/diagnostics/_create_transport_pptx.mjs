import PptxGenJS from "pptxgenjs"
import fs from "fs"

const pptx = new PptxGenJS()
pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 })
pptx.layout = "WIDE"

// ── Colors ──
const C = {
  bg:       "0A1628",
  dark2:    "12233D",
  dark3:    "1A2D4A",
  gold:     "D4AF37",
  accent:   "C9A84C",
  blue:     "2196F3",
  teal:     "26C6DA",
  green:    "4CAF50",
  red:      "E53935",
  purple:   "9C27B0",
  orange:   "FF9800",
  white:    "FFFFFF",
  light:    "D0D5DD",
  muted:    "78909C",
  citron:   "8BC34A",
}

const FONT = "Arial"
const TOTAL = 20
const SIG = "عبيدة عمري"

function footer(slide, n) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 7.1, w: 13.33, h: 0.4, fill: { color: C.dark2 } })
  slide.addText(`النقل العام والمدن الذكية — الرياض 2026`, { x: 0.4, y: 7.12, w: 6, h: 0.35, fontSize: 9, color: C.muted, fontFace: FONT })
  slide.addText(`${n}/${TOTAL}`, { x: 11.8, y: 7.12, w: 0.8, h: 0.35, fontSize: 9, color: C.muted, fontFace: FONT, align: "center" })
  slide.addText(SIG, { x: 12.5, y: 7.12, w: 0.8, h: 0.35, fontSize: 7, color: C.muted, fontFace: FONT, align: "right" })
}

function slideBg(slide) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: C.bg } })
}

function slideAccent(slide, color) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 7.1, fill: { color: color || C.gold } })
}

// ══════════════════════════════════════════════
// 1 — COVER
// ══════════════════════════════════════════════
const s1 = pptx.addSlide()
slideBg(s1)
s1.addShape(pptx.ShapeType.rect, { x: 0, y: 2.8, w: 13.33, h: 0.06, fill: { color: C.gold } })
s1.addShape(pptx.ShapeType.rect, { x: 0, y: 4.6, w: 13.33, h: 0.03, fill: { color: C.gold } })
s1.addText("تطوير البنية التحتية للنقل العام", { x: 1, y: 0.8, w: 11.33, h: 0.7, fontSize: 38, color: C.gold, fontFace: FONT, bold: true, align: "center" })
s1.addText("والمدن الذكية في مدينة الرياض", { x: 1, y: 1.5, w: 11.33, h: 0.7, fontSize: 36, color: C.gold, fontFace: FONT, bold: true, align: "center" })
s1.addText("التركيز على مشروع المترو", { x: 1, y: 2.2, w: 11.33, h: 0.6, fontSize: 22, color: C.white, fontFace: FONT, align: "center" })
s1.addText("عرض شامل لتحول النقل العام في العاصمة: من الاعتماد على السيارة إلى شبكة مترو عالمية", { x: 1, y: 3.1, w: 11.33, h: 0.5, fontSize: 14, color: C.muted, fontFace: FONT, align: "center" })
s1.addText("يونيو 2026", { x: 1, y: 3.7, w: 11.33, h: 0.5, fontSize: 18, color: C.accent, fontFace: FONT, align: "center" })

const badges = ["مترو الرياض", "حافلات الرياض", "المدينة الذكية", "الذكاء الاصطناعي", "رؤية 2030"]
badges.forEach((b, i) => {
  const gap = 0.25, w = 2.1, x = 0.85 + i * (w + gap)
  s1.addShape(pptx.ShapeType.roundRect, { x, y: 5, w, h: 0.5, fill: { color: C.dark2 }, line: { color: C.accent, width: 0.5 }, rectRadius: 0.05 })
  s1.addText(b, { x, y: 5, w, h: 0.5, fontSize: 12, color: C.accent, fontFace: FONT, align: "center" })
})

s1.addText("إعداد: عبيدة عمري", { x: 1, y: 5.8, w: 11.33, h: 0.4, fontSize: 12, color: C.muted, fontFace: FONT, align: "center" })
footer(s1, 1)

// ══════════════════════════════════════════════
// 2 — AGENDA
// ══════════════════════════════════════════════
const s2 = pptx.addSlide()
slideBg(s2)
slideAccent(s2, C.gold)
s2.addText("فهرس المحتويات", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: C.gold, fontFace: FONT, bold: true })

const agenda = [
  ["1", "رؤية 2030 واستراتيجية النقل", "6", "محطات المترو والتصميم المعماري"],
  ["2", "مشروع الملك عبدالعزيز للنقل العام", "7", "إنجازات أعداد الركاب"],
  ["3", "نظرة عامة على خطوط المترو الستة", "8", "التوسعات المستقبلية (المسار 7 وامتداد الأحمر)"],
  ["4", "تفاصيل المسارات (الأزرق، الأحمر، البرتقالي)", "9", "شبكة حافلات الرياض"],
  ["5", "تفاصيل المسارات (الأصفر، الأخضر، البنفسجي)", "10", "التكامل متعدد الوسائط"],
]
agenda.forEach((a, i) => {
  const y = 1.4 + i * 0.65
  s2.addText(`${a[0]}  ${a[1]}`, { x: 0.6, y, w: 5.5, h: 0.45, fontSize: 14, color: C.light, fontFace: FONT })
  s2.addText(`${parseInt(a[0]) + 10}  ${a[2]}`, { x: 6.8, y, w: 6, h: 0.45, fontSize: 14, color: C.light, fontFace: FONT })
})

const agenda2 = [
  ["11", "مبادرات المدينة الذكية", "16", "الأثر البيئي والاستدامة"],
  ["12", "الذكاء الاصطناعي وإدارة المرور", "17", "الأثر الاقتصادي"],
  ["13", "ثورة التنقل الذاتي (المركبات ذاتية القيادة)", "18", "التطوير الموجه بالنقل (TOD)"],
  ["14", "التحول الرقمي للخدمات البلدية", "19", "الرؤية المستقبلية 2030"],
  ["15", "منصة Wasl لإدارة المرور", "20", "المراجع والمصادر"],
]
agenda2.forEach((a, i) => {
  const y = 1.4 + i * 0.65
  s2.addText(`${a[0]}  ${a[1]}`, { x: 0.6, y: 4.5 + i * 0.5, w: 5.5, h: 0.4, fontSize: 12, color: C.light, fontFace: FONT })
  s2.addText(`${a[2]}`, { x: 6.8, y: 4.5 + i * 0.5, w: 6, h: 0.4, fontSize: 12, color: C.light, fontFace: FONT })
})
footer(s2, 2)

// ══════════════════════════════════════════════
// 3 — EXECUTIVE SUMMARY
// ══════════════════════════════════════════════
const s3 = pptx.addSlide()
slideBg(s3)
slideAccent(s3, C.gold)
s3.addText("ملخص تنفيذي", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: C.gold, fontFace: FONT, bold: true })

const exeKpis = [
  { val: "176", unit: "كم", label: "طول شبكة المترو" },
  { val: "6", unit: "خطوط", label: "خطوط المترو الرئيسية" },
  { val: "85", unit: "محطة", label: "محطات المترو" },
  { val: "3.6", unit: "مليون/يوم", label: "الطاقة الاستيعابية" },
  { val: "$22.5", unit: "مليار", label: "تكلفة المشروع" },
]
exeKpis.forEach((k, i) => {
  const w = 2.2, gap = 0.2, x = 0.6 + i * (w + gap)
  s3.addShape(pptx.ShapeType.roundRect, { x, y: 1.3, w, h: 1.5, fill: { color: C.dark2 }, line: { color: C.gold, width: 0.5 }, rectRadius: 0.08 })
  s3.addText(k.val, { x, y: 1.35, w, h: 0.6, fontSize: 30, color: C.gold, fontFace: FONT, bold: true, align: "center" })
  s3.addText(k.unit, { x, y: 1.9, w, h: 0.3, fontSize: 10, color: C.muted, fontFace: FONT, align: "center" })
  s3.addText(k.label, { x, y: 2.2, w, h: 0.35, fontSize: 11, color: C.white, fontFace: FONT, align: "center" })
})

const exeItems = [
  "أكبر شبكة مترو مؤتمتة بالكامل (بدون سائق) في العالم — معترف بها من موسوعة غينيس للأرقام القياسية",
  "افتتحت رسميًا في 27 نوفمبر 2024، ودخلت الخدمة الكاملة في 5 يناير 2025 بجميع خطوطها الستة",
  "200 مليون راكب حتى مارس 2026 — بمعدل 31 مليون راكب في الربع الأول من 2026 وحده",
  "شبكة متكاملة: مترو + 80 مسار حافلات + 842 حافلة + 2,860 محطة توقف",
  "الرياض تحتل المرتبة 24 عالميًا في مؤشر IMD للمدن الذكية 2026 — تقدم 3 مراكز عن 2025",
  "نظام Wasl لإدارة المرور بالذكاء الاصطناعي: 4,200 كاميرا، 900 إشارة ذكية، 1.4 مليار حدث/يوم",
  "مشروع المسار السابع (65 كم) قيد الطرح — يربط القدية، الدرعية، الملك سلمان بارك، ومسك سيتي",
]
exeItems.forEach((item, i) => {
  const y = 3.1 + i * 0.5
  s3.addShape(pptx.ShapeType.rect, { x: 0.6, y: y + 0.06, w: 0.05, h: 0.25, fill: { color: i === 0 ? C.gold : C.muted } })
  s3.addText(item, { x: 0.85, y, w: 12, h: 0.4, fontSize: 11, color: C.light, fontFace: FONT })
})
footer(s3, 3)

// ══════════════════════════════════════════════
// 4 — VISION 2030 & TRANSPORT STRATEGY
// ══════════════════════════════════════════════
const s4 = pptx.addSlide()
slideBg(s4)
slideAccent(s4, C.blue)
s4.addText("رؤية 2030 واستراتيجية النقل", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: C.blue, fontFace: FONT, bold: true })
s4.addText("النقل العام محور أساسي في تحقيق مستهدفات رؤية المملكة", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: C.muted, fontFace: FONT })

const vItems = [
  { t: "تقليل الاعتماد على المركبات الخاصة", d: "95% من الرحلات في الرياض كانت بالسيارة الخاصة قبل المترو — الهدف خفضها إلى 75% بحلول 2030" },
  { t: "خفض الانبعاثات الكربونية", d: "النقل مسؤول عن 25% من انبعاثات CO₂ في السعودية — المترو يقلل 400,000 لتر بنزين يوميًا و250,000 رحلة سيارة يوميًا" },
  { t: "دعم النمو السكاني", d: "من 7.5 مليون نسمة (2026) إلى 9.6 مليون بحلول 2030 — البنية التحتية للنقل ضرورية لاستيعاب 1.8 مليون نسمة إضافية" },
  { t: "جذب المقرات الإقليمية", d: "634 رخصة مقر إقليمي (+780 شركة متعددة الجنسيات) — النقل العام الحديث شرط أساسي للتنافسية العالمية" },
  { t: "الاستعداد لإكسبو 2030", d: "42 مليون زيارة متوقعة خلال 6 أشهر — المترو العمود الفقري لنقل الزوار دون شلل مروري" },
  { t: "رفع جودة الحياة", d: "تحسين مؤشرات جودة الهواء، تقليل وقت التنقل، توفير خيارات تنقل مريحة وآمنة للجميع" },
]
vItems.forEach((v, i) => {
  const y = 1.55 + i * 0.85
  s4.addShape(pptx.ShapeType.roundRect, { x: 0.6, y, w: 12, h: 0.73, fill: { color: C.dark2 }, rectRadius: 0.05 })
  s4.addShape(pptx.ShapeType.rect, { x: 0.6, y, w: 0.06, h: 0.73, fill: { color: C.blue } })
  s4.addText(v.t, { x: 0.9, y: y + 0.02, w: 11.3, h: 0.3, fontSize: 13, color: C.blue, fontFace: FONT, bold: true })
  s4.addText(v.d, { x: 0.9, y: y + 0.32, w: 11.3, h: 0.35, fontSize: 10, color: C.light, fontFace: FONT })
})
footer(s4, 4)

// ══════════════════════════════════════════════
// 5 — KING ABDULAZIZ PROJECT OVERVIEW
// ══════════════════════════════════════════════
const s5 = pptx.addSlide()
slideBg(s5)
slideAccent(s5, C.gold)
s5.addText("مشروع الملك عبدالعزيز للنقل العام", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: C.gold, fontFace: FONT, bold: true })
s5.addText("أحد أكبر مشاريع النقل العام في العالم — تشرف عليه الهيئة الملكية لمدينة الرياض", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 13, color: C.muted, fontFace: FONT })

const kp = [
  { head: "قطار الرياض (المترو)", items: [
    "6 خطوط — 176 كم — 85 محطة",
    "طاقة استيعابية: 3.6 مليون راكب/يوم",
    "قطارات مؤتمتة بالكامل (بدون سائق)",
    "أطول شبكة مترو مؤتمتة في العالم",
    "تكلفة المشروع: $22.5 مليار (93.75 مليار ريال)",
    "افتتاح أولي: 1 ديسمبر 2024",
    "الافتتاح الكامل: 5 يناير 2025",
  ]},
  { head: "حافلات الرياض", items: [
    "80 مسارًا — 1,900 كم إجمالي الشبكة",
    "842 حافلة (مرسيدس و MAN)",
    "2,860 محطة ونقطة توقف",
    "3 مسارات حافلات سريعة (BRT) — 160 كم",
    "58 مسارًا مغذيًا — 892 كم",
    "19 مسارًا رئيسيًا — 910 كم",
    "Wi-Fi مجاني وتكييف متطور في جميع الحافلات",
  ]},
]
kp.forEach((k, ki) => {
  const x = 0.6 + ki * 6.2
  s5.addShape(pptx.ShapeType.roundRect, { x, y: 1.5, w: 5.8, h: 5.2, fill: { color: C.dark2 }, line: { color: ki === 0 ? C.gold : C.teal, width: 0.5 }, rectRadius: 0.08 })
  s5.addText(k.head, { x: x + 0.2, y: 1.6, w: 5.4, h: 0.5, fontSize: 17, color: ki === 0 ? C.gold : C.teal, fontFace: FONT, bold: true })
  k.items.forEach((item, i) => {
    s5.addShape(pptx.ShapeType.rect, { x: x + 0.2, y: 2.3 + i * 0.6, w: 0.04, h: 0.3, fill: { color: ki === 0 ? C.gold : C.teal } })
    s5.addText(item, { x: x + 0.4, y: 2.25 + i * 0.6, w: 5.2, h: 0.4, fontSize: 12, color: C.light, fontFace: FONT })
  })
})
footer(s5, 5)

// ══════════════════════════════════════════════
// 6 — METRO LINES OVERVIEW
// ══════════════════════════════════════════════
const s6 = pptx.addSlide()
slideBg(s6)
slideAccent(s6, C.purple)
s6.addText("نظرة عامة على خطوط المترو الستة", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: C.purple, fontFace: FONT, bold: true })
s6.addText("176 كم — 85 محطة — 3 ائتلافات عالمية — 470 عربة قطار", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: C.muted, fontFace: FONT })

const lines = [
  { n: "1", name: "الأزرق", route: "العليا — البطحاء — الحاير", len: "38 كم", st: "25", color: "2196F3", opened: "1 ديسمبر 2024" },
  { n: "2", name: "الأحمر", route: "طريق الملك عبدالله — جامعة الملك سعود", len: "25.3 كم", st: "15", color: "F44336", opened: "15 ديسمبر 2024" },
  { n: "3", name: "البرتقالي", route: "طريق المدينة — طريق سعد بن عبدالرحمن", len: "40.7 كم", st: "22", color: "FF9800", opened: "5 يناير 2025" },
  { n: "4", name: "الأصفر", route: "طريق المطار — كافد", len: "29.6 كم", st: "9", color: "FFEB3B", opened: "1 ديسمبر 2024" },
  { n: "5", name: "الأخضر", route: "طريق الملك عبدالعزيز — الوزارات", len: "12.9 كم", st: "12", color: "4CAF50", opened: "15 ديسمبر 2024" },
  { n: "6", name: "البنفسجي", route: "عبدالرحمن بن عوف — الشيخ حسن بن حسين", len: "29.9 كم", st: "11", color: "9C27B0", opened: "1 ديسمبر 2024" },
]
const hdr = [{ text: "المسار", options: { fill: C.dark2, color: C.gold, bold: true, fontSize: 11 } }, { text: "الاسم", options: { fill: C.dark2, color: C.gold, bold: true, fontSize: 11 } }, { text: "المسار", options: { fill: C.dark2, color: C.gold, bold: true, fontSize: 11 } }, { text: "الطول", options: { fill: C.dark2, color: C.gold, bold: true, fontSize: 11 } }, { text: "محطات", options: { fill: C.dark2, color: C.gold, bold: true, fontSize: 11 } }, { text: "تاريخ التشغيل", options: { fill: C.dark2, color: C.gold, bold: true, fontSize: 11 } }]
const tRows = [hdr]
lines.forEach(l => {
  tRows.push([
    { text: l.n, options: { color: l.color, bold: true, fontSize: 12, align: "center" } },
    { text: l.name, options: { color: C.white, fontSize: 11 } },
    { text: l.route, options: { color: C.light, fontSize: 10 } },
    { text: l.len, options: { color: C.white, fontSize: 11 } },
    { text: l.st, options: { color: C.white, fontSize: 11, align: "center" } },
    { text: l.opened, options: { color: C.muted, fontSize: 10 } },
  ])
})
s6.addTable(tRows, { x: 0.6, y: 1.6, w: 12, h: 3.5, colW: [0.6, 1, 4, 1, 1, 2], border: { type: "solid", color: C.dark3, pt: 0.5 }, rowH: [0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4] })

// Additional info
s6.addText("• 4 محطات رئيسية كبرى: قصر الحكم، كافد، STC-العليا، المحطة الغربية — تربط بين مسارات متعددة", { x: 0.6, y: 5.5, w: 12, h: 0.3, fontSize: 11, color: C.light, fontFace: FONT })
s6.addText("• 3 ائتلافات عالمية للبناء: BACS (بكتل)، ArRiyadh New Mobility (Webuild)، FAST (FCC)", { x: 0.6, y: 5.8, w: 12, h: 0.3, fontSize: 11, color: C.light, fontFace: FONT })
s6.addText("• 183 قطارًا مؤتمتًا بالكامل — موردو القطارات: سيمنز، ألستوم، بومباردييه — تعمل بتقنية CBTC", { x: 0.6, y: 6.1, w: 12, h: 0.3, fontSize: 11, color: C.light, fontFace: FONT })
s6.addText("• 40% من المسارات تحت الأرض — الباقي على جسور علوية ومستوى الشارع", { x: 0.6, y: 6.4, w: 12, h: 0.3, fontSize: 11, color: C.light, fontFace: FONT })
footer(s6, 6)

// ══════════════════════════════════════════════
// 7 — LINES 1-2-3 DETAILS
// ══════════════════════════════════════════════
const s7 = pptx.addSlide()
slideBg(s7)
slideAccent(s7, C.blue)
s7.addText("تفاصيل المسارات — الأزرق، الأحمر، البرتقالي", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 28, color: C.blue, fontFace: FONT, bold: true })
s7.addText("أطول 3 خطوط تشكل العمود الفقري للشبكة", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: C.muted, fontFace: FONT })

const ld = [
  { color: C.blue, name: "المسار الأول — الأزرق", desc: "يمتد شمال-جنوب بطريق العليا — البطحاء — الحاير (38 كم). يخدم 25 محطة. الأكثر ازدحامًا بنسبة 45% من إجمالي الركاب. 45 قطارًا من سيمنز (4 عربات لكل قطار). ائتلاف BACS بقيادة بكتل." },
  { color: C.red, name: "المسار الثاني — الأحمر", desc: "يمتد شرق-غرب بطريق الملك عبدالله (25.3 كم). 15 محطة. ثاني أكثر الخطوط ازدحامًا (16% من الركاب). 29 قطارًا ثنائي العربة من سيمنز. مشغل: Capital Metro (RATP Dev + SAPTCO). تمديد 8.4 كم قيد الإنشاء إلى الدرعية." },
  { color: C.orange, name: "المسار الثالث — البرتقالي", desc: "أطول مسار في الشبكة (40.7 كم)، 22 محطة. يمتد من طريق المدينة إلى طريق سعد بن عبدالرحمن. 47 قطارًا من ألستوم (Innovia Metro 330). تكلفة العقد: $5.21 مليار. ائتلاف ArRiyadh New Mobility (Webuild، بومباردييه، أنسالدو)." },
]
ld.forEach((l, i) => {
  const y = 1.5 + i * 1.75
  s7.addShape(pptx.ShapeType.roundRect, { x: 0.6, y, w: 12, h: 1.5, fill: { color: C.dark2 }, rectRadius: 0.06 })
  s7.addShape(pptx.ShapeType.rect, { x: 0.6, y, w: 0.08, h: 1.5, fill: { color: l.color } })
  s7.addText(l.name, { x: 1, y: y + 0.05, w: 11, h: 0.35, fontSize: 15, color: l.color, fontFace: FONT, bold: true })
  s7.addText(l.desc, { x: 1, y: y + 0.4, w: 11.3, h: 1, fontSize: 11, color: C.light, fontFace: FONT })
})
footer(s7, 7)

// ══════════════════════════════════════════════
// 8 — LINES 4-5-6 DETAILS
// ══════════════════════════════════════════════
const s8 = pptx.addSlide()
slideBg(s8)
slideAccent(s8, C.teal)
s8.addText("تفاصيل المسارات — الأصفر، الأخضر، البنفسجي", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 28, color: C.teal, fontFace: FONT, bold: true })
s8.addText("الخطوط المكملة — ربط المطار، الحكومة، والمناطق السكنية", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: C.muted, fontFace: FONT })

const ld2 = [
  { color: C.orange, colorH: "FFEB3B", name: "المسار الرابع — الأصفر", desc: "الطريق إلى مطار الملك خالد الدولي (29.6 كم)، 9 محطات. يبدأ من كافد إلى المطار (T1-2, T3-4, T5). يتشارك مسارًا مع المسار البنفسجي لمسافة 9 كم. يخدم المسافرين جواً وموظفي المطار. 69 قطارًا ثنائي العربة من ألستوم (Metropolis)." },
  { color: C.green, name: "المسار الخامس — الأخضر", desc: "أقصر مسار (12.9 كم)، 12 محطة — يمتد بالكامل تحت الأرض. يخدم المنطقة الحكومية: وزارة التعليم، المتحف الوطني، وزارة الداخلية. يمر بشارع الملك عبدالعزيز وسط الرياض. 12 محطة تحت الأرض بالكامل." },
  { color: C.purple, name: "المسار السادس — البنفسجي", desc: "(29.9 كم)، 11 محطة. يمتد من كافد إلى حي النسيم شرقًا. يتشارك المسار مع الأصفر لـ 9 كم في الجزء الغربي. يخدم الأحياء السكنية الشرقية. معظم المسار على جسور علوية. ائتلاف FAST (FCC، سامسونج، ألستوم) — قيمة العقد $7.82 مليار." },
]
ld2.forEach((l, i) => {
  const y = 1.5 + i * 1.75
  s8.addShape(pptx.ShapeType.roundRect, { x: 0.6, y, w: 12, h: 1.5, fill: { color: C.dark2 }, rectRadius: 0.06 })
  s8.addShape(pptx.ShapeType.rect, { x: 0.6, y, w: 0.08, h: 1.5, fill: { color: l.color } })
  s8.addText(l.name, { x: 1, y: y + 0.05, w: 11, h: 0.35, fontSize: 15, color: l.colorH || l.color, fontFace: FONT, bold: true })
  s8.addText(l.desc, { x: 1, y: y + 0.4, w: 11.3, h: 1, fontSize: 11, color: C.light, fontFace: FONT })
})
footer(s8, 8)

// ══════════════════════════════════════════════
// 9 — STATIONS & ARCHITECTURE
// ══════════════════════════════════════════════
const s9 = pptx.addSlide()
slideBg(s9)
slideAccent(s9, C.accent)
s9.addText("محطات المترو — التصميم المعماري", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: C.accent, fontFace: FONT, bold: true })
s9.addText("أيقونات معمارية عالمية بتوقيع أبرز مكاتب الهندسة في العالم", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: C.muted, fontFace: FONT })

const arch = [
  { name: "محطة كافد (KAFD)", arch: "Zaha Hadid Architects", feat: "أيقونة معمارية — 45,000 م² — 6 منصات على 4 مستويات. واجهة من الخرسانة عالية الأداء بتصميم ثلاثي الأبعاد مستوحى من تموجات الرمال. يربط 3 خطوط (1، 4، 6). حاصل على شهادة LEED." },
  { name: "محطة قصر الحكم", arch: "Snøhetta (النرويج)", feat: "ساحة مفتوحة مع مظلة ضخمة من الفولاذ المقاوم للصدأ تعكس الضوء. زخارف نجدية تقليدية على الجدران الداخلية. قطارات مرئية داخل أنابيب زجاجية. 326 نقشًا مثلثيًا بأحجام مختلفة." },
  { name: "محطة STC-العليا (أولايا)", arch: "Gerber Architekten (ألمانيا)", feat: "حديقة كثبان رملية تتحول إلى سقف المحطة تحت الأرض (عمق 30 م). يربط خطين بمول تجاري. أول مساحة عامة حديقة تخدمها وسائل النقل العام في الرياض." },
  { name: "المحطة الغربية", arch: "Omrania (السعودية)", feat: "محطة رئيسية غرب الرياض — تصميم يجمع بين الاستدامة والهوية المحلية. توفير طاقة 16.6% مقارنة بمعيار ASHRAE. تخفيض استهلاك المياه الخارجية بنسبة 68%." },
]
arch.forEach((a, i) => {
  const y = 1.5 + i * 1.3
  s9.addShape(pptx.ShapeType.roundRect, { x: 0.6, y, w: 12, h: 1.1, fill: { color: C.dark2 }, rectRadius: 0.05 })
  s9.addShape(pptx.ShapeType.rect, { x: 0.6, y, w: 0.06, h: 1.1, fill: { color: C.accent } })
  s9.addText(a.name, { x: 0.9, y: y + 0.02, w: 4, h: 0.3, fontSize: 14, color: C.accent, fontFace: FONT, bold: true })
  s9.addText(a.arch, { x: 9, y: y + 0.02, w: 3.3, h: 0.3, fontSize: 10, color: C.muted, fontFace: FONT, align: "right" })
  s9.addText(a.feat, { x: 0.9, y: y + 0.35, w: 11.3, h: 0.65, fontSize: 11, color: C.light, fontFace: FONT })
})
footer(s9, 9)

// ══════════════════════════════════════════════
// 10 — RIDERSHIP ACHIEVEMENTS
// ══════════════════════════════════════════════
const s10 = pptx.addSlide()
slideBg(s10)
slideAccent(s10, C.green)
s10.addText("إنجازات أعداد الركاب", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: C.green, fontFace: FONT, bold: true })
s10.addText("200 مليون راكب في أقل من 16 شهرًا — مؤشرات نمو قياسية", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: C.muted, fontFace: FONT })

// Chart
const ridership = [
  { name: "الركاب (مليون)", labels: ["الأسبوع 1", "ديسمبر 2024", "يناير 2025", "مارس 2025", "يونيو 2025", "سبتمبر 2025", "ديسمبر 2025", "مارس 2026"],
    values: [1.9, 15, 35, 60, 85, 110, 150, 200] },
]
s10.addChart(pptx.charts.BAR, ridership, {
  x: 0.6, y: 1.6, w: 7.5, h: 4.5,
  barGrouping: "clustered", barDir: "col",
  chartColors: [C.green],
  catAxisLabelColor: C.muted, catAxisLabelFontSize: 8,
  valAxisLabelColor: C.muted, valAxisLabelFontSize: 9,
  valAxisTitle: "مليون راكب", valAxisTitleColor: C.muted,
  showLegend: false,
  dataLabelFormatCode: '#,##0', dataLabelColor: C.green, dataLabelFontSize: 9,
  plotArea: { fill: { color: C.bg } },
})

const rStats = [
  { val: "200M", label: "إجمالي الركاب (مارس 2026)" },
  { val: "31M", label: "ركاب المترو — Q1 2026" },
  { val: "19.55M", label: "ركاب الحافلات — Q1 2026" },
  { val: "45%", label: "حصة الخط الأزرق من الركاب" },
  { val: "99.81%", label: "نسبة الالتزام بالمواعيد" },
  { val: "1.13M", label: "رحلة تشغيلية" },
  { val: "32.2M", label: "كم قطعتها القطارات" },
  { val: "0.9M", label: "الركاب اليوميون (متوسط)" },
]
rStats.forEach((r, i) => {
  const x = 8.5 + (i % 2) * 2.2
  const y = 1.6 + Math.floor(i / 2) * 1.15
  s10.addShape(pptx.ShapeType.roundRect, { x, y, w: 2, h: 1, fill: { color: C.dark2 }, rectRadius: 0.06 })
  s10.addText(r.val, { x, y: y + 0.05, w: 2, h: 0.45, fontSize: 18, color: C.green, fontFace: FONT, bold: true, align: "center" })
  s10.addText(r.label, { x, y: y + 0.5, w: 2, h: 0.35, fontSize: 9, color: C.light, fontFace: FONT, align: "center" })
})

s10.addText("المصادر: هيئة النقل العام، الهيئة الملكية لمدينة الرياض، TGA", { x: 0.6, y: 6.6, w: 12, h: 0.3, fontSize: 10, color: C.muted })
footer(s10, 10)

// ══════════════════════════════════════════════
// 11 — FUTURE EXPANSION
// ══════════════════════════════════════════════
const s11 = pptx.addSlide()
slideBg(s11)
slideAccent(s11, C.orange)
s11.addText("التوسعات المستقبلية", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: C.orange, fontFace: FONT, bold: true })
s11.addText("المسار السابع وامتداد المسار الأحمر — مستقبل شبكة المترو", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: C.muted, fontFace: FONT })

// Two expansion cards
const exp = [
  { t: "المسار السابع (Line 7)", items: [
    "الطول: 65 كم — 47 كم تحت الأرض + 19 كم جسور علوية",
    "19 محطة (14 تحت الأرض + 5 فوق الأرض)",
    "يربط: القدية ← حدائق الملك عبدالله ← الملك سلمان بارك ← مسك سيتي ← الدرعية",
    "محطة تبادل مع المسار الأحمر عند الدرعية",
    "قطار القدية السريع (250 كم/س) يربط المطار بالقدية في 30 دقيقة",
    "افتتاح العروض التجارية: يناير 2026",
    "يخدم 10 ملايين نسمة ويقلص أوقات التنقل إلى النصف",
    "أسطول إضافي: 150 عربة — الإجمالي: 470 عربة",
  ]},
  { t: "امتداد المسار الأحمر (Red Line Extension)", items: [
    "الطول: 8.4 كم — 7.1 كم أنفاق عميقة + 1.3 كم جسور علوية",
    "5 محطات جديدة — محطتان في جامعة الملك سعود (مدينة طبية + بهو الجامعة)",
    "3 محطات في الدرعية — إحداها نقطة ربط بالمسار 7",
    "عقد تصميم وبناء بقيمة $2.75 مليار",
    "ائتلاف بقيادة Webuild (30.1%) + L&T + ألستوم +نسمة",
    "مدة التنفيذ: ~6 سنوات (يكتمل ~2032)",
    "يقلص 150,000 مركبة يوميًا من طرق الدرعية",
    "زمن الرحلة من مدينة الملك فهد الرياضية إلى وسط الدرعية: 40 دقيقة",
  ]},
]
exp.forEach((e, ei) => {
  const x = 0.6 + ei * 6.2
  s11.addShape(pptx.ShapeType.roundRect, { x, y: 1.5, w: 5.8, h: 5.3, fill: { color: C.dark2 }, line: { color: C.orange, width: 0.5 }, rectRadius: 0.08 })
  s11.addText(e.t, { x: x + 0.2, y: 1.6, w: 5.4, h: 0.45, fontSize: 16, color: C.orange, fontFace: FONT, bold: true })
  e.items.forEach((item, i) => {
    s11.addShape(pptx.ShapeType.rect, { x: x + 0.2, y: 2.3 + i * 0.55, w: 0.04, h: 0.3, fill: { color: C.orange } })
    s11.addText(item, { x: x + 0.4, y: 2.25 + i * 0.55, w: 5.2, h: 0.4, fontSize: 10.5, color: C.light, fontFace: FONT })
  })
})
footer(s11, 11)

// ══════════════════════════════════════════════
// 12 — RIYADH BUS NETWORK
// ══════════════════════════════════════════════
const s12 = pptx.addSlide()
slideBg(s12)
slideAccent(s12, C.teal)
s12.addText("شبكة حافلات الرياض", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: C.teal, fontFace: FONT, bold: true })
s12.addText("أكبر شبكة حافلات في المملكة — متكاملة بالكامل مع المترو", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: C.muted, fontFace: FONT })

const busKpis = [
  { val: "80", label: "مسارًا" },
  { val: "1,900", label: "كم إجمالي الشبكة" },
  { val: "842", label: "حافلة" },
  { val: "2,860", label: "محطة ونقطة توقف" },
  { val: "19.55M", label: "راكب Q1 2026" },
]
busKpis.forEach((k, i) => {
  const w = 2.2, gap = 0.2, x = 0.6 + i * (w + gap)
  s12.addShape(pptx.ShapeType.roundRect, { x, y: 1.6, w, h: 1.3, fill: { color: C.dark2 }, line: { color: C.teal, width: 0.5 }, rectRadius: 0.08 })
  s12.addText(k.val, { x, y: 1.65, w, h: 0.5, fontSize: 26, color: C.teal, fontFace: FONT, bold: true, align: "center" })
  s12.addText(k.label, { x, y: 2.2, w, h: 0.4, fontSize: 11, color: C.white, fontFace: FONT, align: "center" })
})

const busItems = [
  "3 مسارات حافلات سريعة (BRT) بطول 160 كم — مسارات مخصصة بالكامل",
  "19 مسارًا رئيسيًا (910 كم) — تربط الوجهات المهمة والمراكز التجارية",
  "58 مسارًا مغذيًا (892 كم) — تربط الأحياء السكنية بمحطات المترو",
  "حافلات Mercedes وMAN — سعة 65-110 راكب — Wi-Fi وتكييف متطور",
  "وقود فائق النقاء (ULSD) — التزام بالاستدامة البيئية",
  "خدمة Bus on Demand — حافلات عند الطلب تغطي المناطق غير المخدومة",
  "ارتفاع 34% في استخدام الحافلات منذ افتتاح المترو — زيادة الطلب على وسائل النقل العام",
  "تكامل مع مترو الرياض عبر مواقف النقل العام (Park & Ride) عند المحطات الرئيسية",
]
busItems.forEach((item, i) => {
  const y = 3.2 + i * 0.45
  s12.addShape(pptx.ShapeType.rect, { x: 0.6, y: y + 0.05, w: 0.04, h: 0.22, fill: { color: C.teal } })
  s12.addText(item, { x: 0.85, y, w: 12, h: 0.35, fontSize: 11, color: C.light, fontFace: FONT })
})
footer(s12, 12)

// ══════════════════════════════════════════════
// 13 — MULTIMODAL INTEGRATION
// ══════════════════════════════════════════════
const s13 = pptx.addSlide()
slideBg(s13)
slideAccent(s13, C.blue)
s13.addText("التكامل متعدد الوسائط", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: C.blue, fontFace: FONT, bold: true })
s13.addText("رحلة متكاملة من الباب إلى الوجهة — مترو + حافلات + مواقف + تنقل صغير", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 13, color: C.muted, fontFace: FONT })

const miItems = [
  { t: "Park & Ride (مواقف النقل العام)", d: "مواقف سيارات مجانية عند المحطات الرئيسية (قصر الحكم، كافد، الغربية، STC) لتشجيع الانتقال من السيارة الخاصة إلى المترو." },
  { t: "Bus on Demand (حافلات عند الطلب)", d: "خدمة مرنة تغطي المناطق منخفضة الكثافة — تعمل عبر تطبيق ذكي. متكاملة مع جداول المترو." },
  { t: "Car on Demand (سيارات عند الطلب)", d: "خدمة مشاركة السيارات بالتعاون مع أوبر — توصيل الركاب من وإلى محطات المترو." },
  { t: "التكامل مع المونوريل", d: "مونوريل كافد (3.6 كم، 6 محطات) — يربط مباني المنطقة المالية بمحطة المترو. تنفذه CRRC الصينية." },
  { t: "السكوترات الكهربائية", d: "خدمات التنقل الصغير (السكوتر والدراجات) متوفرة في المناطق العالية الكثافة حول المحطات." },
  { t: "نظام التذاكر الموحد (Darb)", d: "بطاقة Darb الإلكترونية — تستخدم في المترو والحافلات ومواقف السيارات. شرائح زمنية (ساعتان = 4 ريال، 30 يومًا = 140 ريال). خصم 50% للطلاب." },
]
miItems.forEach((m, i) => {
  const y = 1.5 + i * 0.88
  s13.addShape(pptx.ShapeType.roundRect, { x: 0.6, y, w: 12, h: 0.75, fill: { color: C.dark2 }, rectRadius: 0.04 })
  s13.addShape(pptx.ShapeType.rect, { x: 0.6, y, w: 0.06, h: 0.75, fill: { color: C.blue } })
  s13.addText(m.t, { x: 0.9, y: y + 0.02, w: 11.3, h: 0.28, fontSize: 13, color: C.blue, fontFace: FONT, bold: true })
  s13.addText(m.d, { x: 0.9, y: y + 0.3, w: 11.3, h: 0.38, fontSize: 10, color: C.light, fontFace: FONT })
})
footer(s13, 13)

// ══════════════════════════════════════════════
// 14 — SMART CITY INITIATIVES
// ══════════════════════════════════════════════
const s14 = pptx.addSlide()
slideBg(s14)
slideAccent(s14, C.citron)
s14.addText("مبادرات المدينة الذكية", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: C.citron, fontFace: FONT, bold: true })
s14.addText("الرياض في المرتبة 24 عالميًا في مؤشر IMD للمدن الذكية 2026", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: C.muted, fontFace: FONT })

const scKpis = [
  { val: "24", label: "عالميًا IMD 2026" },
  { val: "27", label: "عالميًا IMD 2025" },
  { val: "+3", label: "مراكز متقدمة" },
  { val: "مكة", label: "التالي (IMD)" },
  { val: "8", label: "مدن سعودية في المؤشر" },
]
scKpis.forEach((k, i) => {
  const w = 2.2, gap = 0.2, x = 0.6 + i * (w + gap)
  s14.addShape(pptx.ShapeType.roundRect, { x, y: 1.5, w, h: 1.2, fill: { color: C.dark2 }, line: { color: C.citron, width: 0.5 }, rectRadius: 0.08 })
  s14.addText(k.val, { x, y: 1.55, w, h: 0.5, fontSize: 26, color: C.citron, fontFace: FONT, bold: true, align: "center" })
  s14.addText(k.label, { x, y: 2.1, w, h: 0.35, fontSize: 10, color: C.white, fontFace: FONT, align: "center" })
})

const scItems = [
  "منصة مدينتي (Madinaty) — منصة ذكية لإدارة المدينة تعمل بالذكاء الاصطناعي — أطلقت في قمة الذكاء الاصطناعي العالمية",
  "مؤشر 15 دقيقة — تطبيق Mycity يحدد الخدمات المتاحة خلال 15 دقيقة من موقع المستخدم",
  "التحول الرقمي لأمانة الرياض — 8 مبادرات للتمكين الرقمي — منصة بلدي: 124 خدمة، 3 ملايين طلب، 1.8 مليون مستفيد",
  "التخطيط الذكي للمواقف — المرحلة الأولى من خطة مواقف الرياض الشاملة بأنظمة ذكية وتقنيات الدفع الإلكتروني",
  "الربط بشبكة الجيل الخامس 5G — تغطية 96% من طريق الملك فهد والحزام الشمالي عبر STC",
  "مبادرة المدن الذكية — مسابقة Smartathon (جائزة مليون ريال) — بالشراكة بين SDAIA والهيئة الملكية",
]
scItems.forEach((item, i) => {
  const y = 3 + i * 0.6
  s14.addShape(pptx.ShapeType.rect, { x: 0.6, y: y + 0.05, w: 0.04, h: 0.25, fill: { color: C.citron } })
  s14.addText(item, { x: 0.85, y, w: 12, h: 0.4, fontSize: 11, color: C.light, fontFace: FONT })
})
footer(s14, 14)

// ══════════════════════════════════════════════
// 15 — AI & TRAFFIC MANAGEMENT
// ══════════════════════════════════════════════
const s15 = pptx.addSlide()
slideBg(s15)
slideAccent(s15, C.blue)
s15.addText("الذكاء الاصطناعي وإدارة المرور", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: C.blue, fontFace: FONT, bold: true })
s15.addText("نظام Wasl — أكبر نظام ذكي لإدارة المرور في الشرق الأوسط", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: C.muted, fontFace: FONT })

// Wasl KPIs
const waslKpis = [
  { val: "4,200", label: "كاميرا ذكية" },
  { val: "900", label: "وحدة تحكم إشارات" },
  { val: "1.4B", label: "حدث/يوم" },
  { val: "14%", label: "تخفيض وقت التنقل" },
]
waslKpis.forEach((k, i) => {
  const w = 2.8, gap = 0.3, x = 0.6 + i * (w + gap)
  s15.addShape(pptx.ShapeType.roundRect, { x, y: 1.5, w, h: 1.4, fill: { color: C.dark2 }, line: { color: C.blue, width: 0.5 }, rectRadius: 0.08 })
  s15.addText(k.val, { x, y: 1.55, w, h: 0.55, fontSize: 28, color: C.blue, fontFace: FONT, bold: true, align: "center" })
  s15.addText(k.label, { x, y: 2.2, w, h: 0.4, fontSize: 11, color: C.white, fontFace: FONT, align: "center" })
})

const aiItems = [
  "نظام Wasl — منصة موحدة لإدارة المرور — تغطي الرياض بالكامل بتقنية تعلم التعزيز (Reinforcement Learning)",
  "كاميرات AI — تكتشف الحوادث والازدحام وتُعدّل توقيت الإشارات آليًا في غضون دقائق",
  "التكامل مع المترو — نظام التحكم التكيفي من ألستوم يتواصل مع Wasl — تعديل الإشارات حول المحطات مباشرة",
  "إدارة المياه بالذكاء الاصطناعي — الشركة الوطنية للمياه: كشف التسربات الصوتية + AI لترتيب أولويات الإصلاح",
  "نتائج إدارة المياه: خفض الفاقد من 30% (2022) إلى 21% (2026) — الهدف 15% بحلول 2030",
  "روبوتات التوصيل ذاتية القيادة (Level 4) — تجربة Jahez + ROSHN في واجهة روشن — توصيل طعام بدون سائق",
]
aiItems.forEach((item, i) => {
  const y = 3.2 + i * 0.6
  s15.addShape(pptx.ShapeType.rect, { x: 0.6, y: y + 0.05, w: 0.04, h: 0.25, fill: { color: C.blue } })
  s15.addText(item, { x: 0.85, y, w: 12, h: 0.4, fontSize: 11, color: C.light, fontFace: FONT })
})
footer(s15, 15)

// ══════════════════════════════════════════════
// 16 — AUTONOMOUS MOBILITY
// ══════════════════════════════════════════════
const s16 = pptx.addSlide()
slideBg(s16)
slideAccent(s16, C.purple)
s16.addText("ثورة التنقل الذاتي", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: C.purple, fontFace: FONT, bold: true })
s16.addText("المركبات ذاتية القيادة — مستقبل التنقل في الرياض", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: C.muted, fontFace: FONT })

const avKpis = [
  { val: "Robotaxi", label: "تجربة WeRide + أوبر + AiDriver" },
  { val: "25%", label: "مركبات شحن ذاتية بحلول 2030" },
  { val: "Level 4", label: "روبوتات توصيل طعام (Jahez)" },
  { val: "250", label: "كم/س — قطار القدية السريع" },
]
avKpis.forEach((k, i) => {
  const w = 2.8, gap = 0.3, x = 0.6 + i * (w + gap)
  s16.addShape(pptx.ShapeType.roundRect, { x, y: 1.5, w, h: 1.2, fill: { color: C.dark2 }, line: { color: C.purple, width: 0.5 }, rectRadius: 0.08 })
  s16.addText(k.val, { x, y: 1.55, w, h: 0.4, fontSize: 22, color: C.purple, fontFace: FONT, bold: true, align: "center" })
  s16.addText(k.label, { x, y: 2, w, h: 0.4, fontSize: 10, color: C.white, fontFace: FONT, align: "center" })
})

const avItems = [
  "تجربة Robotaxi — يوليو 2025: انطلاق أول تاكسي ذاتي القيادة في الرياض بين المطار ووسط المدينة",
  "الشركاء: WeRide (الصين) + أوبر + AiDriver المحلي — وزارة الداخلية، هيئة الاتصالات، SDAIA",
  "قطار القدية السريع — سرعة 250 كم/س — يربط المطار بالقدية في 30 دقيقة — يندمج مع المسار 7",
  "هيئة الطرق أصدرت كود المركبات ذاتية القيادة — أجهزة اتصال ذكية على الطرق لنقل البيانات للأنظمة الذاتية",
  "دراسة علمية (Nature 2026): المركبات الكهربائية الذاتية تقلل التكاليف الخارجية 39.4% — خفض حوادث 55%",
  "استراتيجية النقل البري: 25% من مركبات نقل البضائع ذاتية القيادة بحلول 2030 — الهدف: 100% بحلول 2035",
]
avItems.forEach((item, i) => {
  const y = 3 + i * 0.6
  s16.addShape(pptx.ShapeType.rect, { x: 0.6, y: y + 0.05, w: 0.04, h: 0.25, fill: { color: C.purple } })
  s16.addText(item, { x: 0.85, y, w: 12, h: 0.4, fontSize: 11, color: C.light, fontFace: FONT })
})
footer(s16, 16)

// ══════════════════════════════════════════════
// 17 — ENVIRONMENTAL IMPACT
// ══════════════════════════════════════════════
const s17 = pptx.addSlide()
slideBg(s17)
slideAccent(s17, C.green)
s17.addText("الأثر البيئي والاستدامة", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: C.green, fontFace: FONT, bold: true })
s17.addText("النقل العام المستدام — خفض الانبعاثات وتحسين جودة الهواء", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: C.muted, fontFace: FONT })

const envKpis = [
  { val: "250,000", label: "رحلة سيارة أقل يوميًا" },
  { val: "400,000", label: "لتر بنزين أقل/يوم" },
  { val: "30%", label: "خفض التلوث (تقديري)" },
  { val: "40%", label: "خفض التلوث 2030 (تقديري)" },
  { val: "25%", label: "انبعاثات CO₂ من النقل" },
]
envKpis.forEach((k, i) => {
  const w = 2.2, gap = 0.2, x = 0.6 + i * (w + gap)
  s17.addShape(pptx.ShapeType.roundRect, { x, y: 1.5, w, h: 1.3, fill: { color: C.dark2 }, line: { color: C.green, width: 0.5 }, rectRadius: 0.08 })
  s17.addText(k.val, { x, y: 1.55, w, h: 0.5, fontSize: 22, color: C.green, fontFace: FONT, bold: true, align: "center" })
  s17.addText(k.label, { x, y: 2.1, w, h: 0.4, fontSize: 10, color: C.white, fontFace: FONT, align: "center" })
})

const envItems = [
  "محطات المترو مصممة بمعايير LEED — ألواح كهروضوئية (5,448 م²) في مستودع الغرب (الخط 3) توفر 33% من احتياجات الطاقة",
  "محطة قصر الحكم: توفير طاقة 16.8% — تخفيض مياه خارجية 66% — توفير مياه داخلية 40%",
  "المحطة الغربية: توفير طاقة 16.6% (2.08% من الطاقة المتجددة) — تخفيض مياه خارجية 68%",
  "20% مواد بناء معاد تدويرها في المحطات — دهانات منخفضة المركبات العضوية المتطايرة (VOC)",
  "أبحاث علمية (2025): انخفاض CO وSO₂ في الأحياء المخدومة بالمترو — خاصة الخطوط الأخضر والأزرق والبنفسجي",
  "تحسين الممر الأول/الأخير بنسبة 20% يقلل CO₂ بـ 1.07 مليون طن سنويًا (دراسة KAPSARC)",
  "استهداف 50% طاقة متجددة بحلول 2030 يخفض البصمة الكربونية للنقل الكهربائي بشكل كبير",
  "التحول للنقل العام يدعم هدف المملكة للوصول للحياد الصفري 2060",
]
envItems.forEach((item, i) => {
  const y = 3.1 + i * 0.48
  s17.addShape(pptx.ShapeType.rect, { x: 0.6, y: y + 0.04, w: 0.04, h: 0.2, fill: { color: C.green } })
  s17.addText(item, { x: 0.85, y, w: 12, h: 0.35, fontSize: 10, color: C.light, fontFace: FONT })
})
footer(s17, 17)

// ══════════════════════════════════════════════
// 18 — ECONOMIC IMPACT
// ══════════════════════════════════════════════
const s18 = pptx.addSlide()
slideBg(s18)
slideAccent(s18, C.gold)
s18.addText("الأثر الاقتصادي", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: C.gold, fontFace: FONT, bold: true })
s18.addText("عائد استثمار يصل إلى 281 مليار ريال — تحفيز النمو والتنمية", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: C.muted, fontFace: FONT })

const ecoKpis = [
  { val: "281B", label: "ريال عائد اقتصادي متوقع" },
  { val: "3.5", label: "ريال عائد لكل ريال مستثمر" },
  { val: "SAR 93.75B", label: "إجمالي تكلفة المشروع ($25B)" },
  { val: "32%", label: "ارتفاع أسعار العقارات قرب المترو" },
]
ecoKpis.forEach((k, i) => {
  const w = 2.8, gap = 0.3, x = 0.6 + i * (w + gap)
  s18.addShape(pptx.ShapeType.roundRect, { x, y: 1.5, w, h: 1.4, fill: { color: C.dark2 }, line: { color: C.gold, width: 0.5 }, rectRadius: 0.08 })
  s18.addText(k.val, { x, y: 1.55, w, h: 0.5, fontSize: 24, color: C.gold, fontFace: FONT, bold: true, align: "center" })
  s18.addText(k.label, { x, y: 2.15, w, h: 0.4, fontSize: 10, color: C.white, fontFace: FONT, align: "center" })
})

const ecoItems = [
  "العائد المتوقع: SAR 3.5 لكل ريال مستثمر — إجمالي العائد SAR 281.25 مليار من توفير الوقود والنشاطات التشغيلية",
  "ارتفاع أسعار العقارات 32% في الأحياء على خطوط المترو (حى التعاون — Knight Frank)",
  "إجمالي استثمار البنية التحتية للرياض المرتبط بإكسبو 2030: $92 مليار (7% من الناتج المحلي)",
  "مشاريع رؤية 2030 التراكمية: $1.25 تريليون — برنامج الرياض الأكبر جغرافيًا في الاستثمار",
  "إكسبو 2030 يساهم بـ $64 مليار في الناتج المحلي ويخلق 171,000 وظيفة",
  "تطوير المناطق حول المحطات (TOD) — يخلق مراكز تجارية وسكنية جديدة ويعزز النشاط الاقتصادي",
  "توفير في وقت التنقل يزيد الإنتاجية — الموظفون يقضون وقتًا أقل في الزحام ووقتًا أكثر في العمل",
  "جذب الشركات العالمية — 634 مقرًا إقليميًا — المترو عامل جذب رئيسي للكفاءات والشركات",
]
ecoItems.forEach((item, i) => {
  const y = 3.2 + i * 0.48
  s18.addShape(pptx.ShapeType.rect, { x: 0.6, y: y + 0.04, w: 0.04, h: 0.2, fill: { color: C.gold } })
  s18.addText(item, { x: 0.85, y, w: 12, h: 0.35, fontSize: 10, color: C.light, fontFace: FONT })
})
footer(s18, 18)

// ══════════════════════════════════════════════
// 19 — FUTURE VISION 2030+
// ══════════════════════════════════════════════
const s19 = pptx.addSlide()
slideBg(s19)
s19.addShape(pptx.ShapeType.rect, { x: 0, y: 2.6, w: 13.33, h: 0.06, fill: { color: C.gold } })
s19.addText("الرؤية المستقبلية — الرياض 2030 وما بعدها", { x: 1, y: 0.5, w: 11.33, h: 0.8, fontSize: 32, color: C.gold, fontFace: FONT, bold: true, align: "center" })
s19.addText("مدينة عالمية مترابطة — مستدامة — ذكية", { x: 1, y: 1.3, w: 11.33, h: 0.5, fontSize: 18, color: C.white, fontFace: FONT, align: "center" })

const futItems = [
  "🌐  شبكة مترو تتوسع: المسار 7 (65 كم) + امتدادات مستقبلية — تجاوز 250 كم بحلول 2030",
  "🧠  مدينة تديرها الذكاء الاصطناعي: Wasl + منصة مدينتي + 5G — إدارة آنية لكل خدمات المدينة",
  "🚗  ثورة التنقل الذاتي: Robotaxi + توصيل ذاتي + قطار القدية 250 كم/س — 25% شحن ذاتي بحلول 2030",
  "🌱  الاستدامة: 50% طاقة متجددة — الحياد الصفري 2060 — خفض 40% من تلوث النقل بحلول 2030",
  "🏗️  إكسبو 2030: 42 مليون زيارة — $92 مليار استثمار بنية تحتية — 171,000 وظيفة — نقلة نوعية",
  "🏘️  التطوير الموجه بالنقل (TOD): مدن حول المحطات — كثافة سكانية أعلى — خدمات في 15 دقيقة",
  "👨‍👩‍👧‍👦  Population 9.6M by 2030, 15M by 2050 — network ready to scale",
  "🏆  Top 10 city economy — Riyadh aims to be among world's top 10 city economies by 2030",
]
futItems.forEach((item, i) => {
  const y = 2.2 + i * 0.6
  s19.addText(item, { x: 1.5, y, w: 10.33, h: 0.45, fontSize: 13, color: C.light, fontFace: FONT })
})

s19.addShape(pptx.ShapeType.rect, { x: 0, y: 7.1, w: 13.33, h: 0.4, fill: { color: C.dark2 } })
s19.addText("عبيدة عمري", { x: 12.4, y: 7.13, w: 0.9, h: 0.35, fontSize: 7, color: C.muted, fontFace: FONT, align: "right" })
s19.addText("19/20", { x: 11.8, y: 7.12, w: 0.8, h: 0.35, fontSize: 9, color: C.muted, fontFace: FONT, align: "center" })
s19.addText(`النقل العام والمدن الذكية — الرياض 2026`, { x: 0.4, y: 7.12, w: 6, h: 0.35, fontSize: 9, color: C.muted, fontFace: FONT })

// ══════════════════════════════════════════════
// 20 — REFERENCES
// ══════════════════════════════════════════════
const s20 = pptx.addSlide()
slideBg(s20)
slideAccent(s20, C.muted)
s20.addText("المراجع والمصادر", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: C.gold, fontFace: FONT, bold: true })

const refs = [
  "الهيئة الملكية لمدينة الرياض (RCRC) — مشروع الملك عبدالعزيز للنقل العام — rcrc.gov.sa",
  "RCRC — إعلان ترسية مشروع امتداد المسار الأحمر — يناير 2026 — rcrc.gov.sa/126118-2/",
  "RCRC — وصول مترو الرياض إلى 200 مليون راكب — مارس 2026 — rcrc.gov.sa/218513-2/",
  "RCRC — بيانات مفتوحة: محطات المترو حسب الخط والنوع 2026",
  "أمانة منطقة الرياض — استراتيجية التحول الرقمي ومبادرات المدن الذكية — alriyadh.gov.sa",
  "أمانة الرياض — تقدم الرياض للمرتبة 24 في مؤشر IMD للمدن الذكية 2026",
  "Wikipedia — Riyadh Metro — أكتوبر 2024 — أطوال المسارات وتواريخ الافتتاح",
  "Railway Gazette — Riyadh Metro: Year One Review — مارس 2026",
  "MEED — RCRC opens Riyadh Metro Line 7 bids — يونيو 2026",
  "The Saudi Times — Riyadh Metro System Exceeds Ridership Projections — فبراير 2026",
  "The Saudi Times — Saudi Cities Climb in IMD Smart City Index 2026 — أبريل 2026",
  "The Saudi Times — Public Bus Network Records 30.6M Journeys in Q1 2026 — أبريل 2026",
  "Gulf Commute — Riyadh Metro 2025: Full Opening Status, Operating Hours & New Lines",
  "Arab News — How Saudi Arabia's self-driving push is transforming transport — 2025",
  "AI in Arabia — How Riyadh AI plans for 9.5M residents by 2030 — مايو 2026",
  "KAPSARC — Urban Transport Policies and Emission Reduction Strategies in Riyadh — 2025",
  "Nature / Scientific Reports — Simulation assessment of autonomous EVs on urban sustainability in Riyadh — 2026",
  "Zaha Hadid Architects — KAFD Metro Station — zaha-hadid.com",
  "Snøhetta — Qasr AlHokm Metro Station — snohetta.com",
  "Gerber Architekten — Olaya Metro Station — gerberarchitekten.de",
  "AstroLabs — Riyadh Metro to Carry 3.6M Passengers Daily: Impact on Saudi Economy — 2025",
  "Riyadh 2030 — Infrastructure Progress Dashboard — riyadh2030.ai — 2026",
  "AGBI — Investors rush to the right side of Riyadh's metro tracks — سبتمبر 2025",
  "Global Business Outlook — Saudi Vision 2030: Riyadh Metro & Kingdom's diversification push — 2025",
  "الدراسة العلمية (MDPI 2025) — Sustainable Urban Renewal: Planning TOD in Riyadh",
]
refs.forEach((r, i) => {
  const y = 1.3 + i * 0.22
  s20.addText(`• ${r}`, { x: 0.6, y, w: 12, h: 0.2, fontSize: 7.5, color: C.light, fontFace: FONT })
})

s20.addShape(pptx.ShapeType.rect, { x: 0, y: 7.1, w: 13.33, h: 0.4, fill: { color: C.dark2 } })
s20.addText("عبيدة عمري", { x: 12.4, y: 7.13, w: 0.9, h: 0.35, fontSize: 7, color: C.muted, fontFace: FONT, align: "right" })
s20.addText("20/20", { x: 11.8, y: 7.12, w: 0.8, h: 0.35, fontSize: 9, color: C.muted, fontFace: FONT, align: "center" })
s20.addText(`النقل العام والمدن الذكية — الرياض 2026`, { x: 0.4, y: 7.12, w: 6, h: 0.35, fontSize: 9, color: C.muted, fontFace: FONT })

// ── Save ──
const outPath = "E:\\N8N\\scraper\\scraper2\\csi-ultimate\\Riyadh_Public_Transport_Smart_City_2026.pptx"
pptx.writeFile({ fileName: outPath }).then(() => {
  console.log("✅ تم إنشاء العرض التقديمي: " + outPath)
  const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1)
  console.log("   الحجم: " + sizeKB + " كيلوبايت")
  console.log("   20 شريحة — النقل العام والمدن الذكية في الرياض 2026")
}).catch(err => {
  console.error("❌ خطأ:", err.message)
  process.exit(1)
})
