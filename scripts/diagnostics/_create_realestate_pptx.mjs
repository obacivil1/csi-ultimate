import PptxGenJS from "pptxgenjs"
import fs from "fs"

const pptx = new PptxGenJS()
pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 })
pptx.layout = "WIDE"

const BG = "0D1B2A"
const DARK2 = "1B2838"
const ACCENT = "C9A84C"
const GOLD = "D4AF37"
const BLUE = "1E90FF"
const TEAL = "20B2AA"
const RED = "E94560"
const GREEN = "2ECC71"
const ORANGE = "FF8C00"
const WHITE = "FFFFFF"
const LIGHT = "E0E0E0"
const MUTED = "8899AA"

function addFooter(slide, n, t) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 7.1, w: 13.33, h: 0.4, fill: { color: DARK2 } })
  slide.addText(`التقرير العقاري — الرياض 2026`, { x: 0.5, y: 7.15, w: 5, h: 0.3, fontSize: 10, color: MUTED, fontFace: "Arial", align: "left" })
  slide.addText(`${n}/${t}`, { x: 12.3, y: 7.15, w: 0.8, h: 0.3, fontSize: 10, color: MUTED, fontFace: "Arial", align: "center" })
}

const TOTAL = 12

// ═══ Slide 1: Cover ═══
const s1 = pptx.addSlide()
s1.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } })
s1.addShape(pptx.ShapeType.rect, { x: 0, y: 3.2, w: 13.33, h: 0.06, fill: { color: GOLD } })
s1.addText("التقرير العقاري", { x: 1, y: 1, w: 11.33, h: 1, fontSize: 48, color: GOLD, fontFace: "Arial", bold: true, align: "center" })
s1.addText("سوق العقارات في مدينة الرياض", { x: 1, y: 2, w: 11.33, h: 0.7, fontSize: 30, color: WHITE, fontFace: "Arial", align: "center" })
s1.addText("تحليل شامل لاتجاهات الأسعار، الإيجارات، والنمو العقاري", { x: 1, y: 2.7, w: 11.33, h: 0.5, fontSize: 16, color: MUTED, fontFace: "Arial", align: "center" })
s1.addText("يونيو 2026", { x: 1, y: 3.6, w: 11.33, h: 0.5, fontSize: 18, color: GOLD, fontFace: "Arial", align: "center" })
const tags = ["عقار", "Bayut", "CBRE", "JLL", "Knight Frank", "هيئة العقار"]
tags.forEach((t, i) => {
  const cols = 6, gap = 0.3
  const w = (11.33 - gap * (cols - 1)) / cols
  s1.addShape(pptx.ShapeType.roundRect, { x: 1 + i * (w + gap), y: 4.6, w, h: 0.5, fill: { color: DARK2 }, line: { color: ACCENT, width: 0.5 }, rectRadius: 0.05 })
  s1.addText(t, { x: 1 + i * (w + gap), y: 4.6, w, h: 0.5, fontSize: 11, color: ACCENT, fontFace: "Arial", align: "center" })
})
addFooter(s1, 1, TOTAL)

// ═══ Slide 2: Market Overview ═══
const s2 = pptx.addSlide()
s2.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } })
s2.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: GOLD } })
s2.addText("نظرة عامة على السوق", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: GOLD, fontFace: "Arial", bold: true })
s2.addText("المؤشرات الرئيسية لسوق العقارات في الرياض — يونيو 2026", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: MUTED, fontFace: "Arial" })

const kpis = [
  { val: "580", unit: "مليار ريال", label: "قيمة السوق السكني" },
  { val: "41.5%", unit: "", label: "حصة الرياض من السوق السعودي" },
  { val: "7.5", unit: "مليون", label: "عدد السكان" },
  { val: "9.6", unit: "مليون", label: "السكان المتوقعون 2030" },
  { val: "63%", unit: "", label: "نسبة التملّك السكني" },
]
kpis.forEach((k, i) => {
  const w = 2.2, gap = 0.3, x = 0.6 + i * (w + gap)
  s2.addShape(pptx.ShapeType.roundRect, { x, y: 1.7, w, h: 1.6, fill: { color: DARK2 }, line: { color: ACCENT, width: 0.5 }, rectRadius: 0.08 })
  s2.addText(k.val, { x, y: 1.8, w, h: 0.7, fontSize: 32, color: GOLD, fontFace: "Arial", bold: true, align: "center" })
  s2.addText(k.unit, { x, y: 2.4, w, h: 0.3, fontSize: 11, color: MUTED, fontFace: "Arial", align: "center" })
  s2.addText(k.label, { x, y: 2.7, w, h: 0.4, fontSize: 11, color: WHITE, fontFace: "Arial", align: "center" })
})

// Key bullets
const bullets = [
  "الرياض تمتلك 41.5% من إجمالي قيمة السوق العقاري السعودي — الأعلى في المملكة",
  "عدد سكان الرياض ينمو بمعدل 3-4% سنويًا، متجهًا نحو 9.6 مليون نسمة بحلول 2030",
  "أكثر من 780 شركة متعددة الجنسيات تلتزم بفتح مقرات إقليمية في الرياض",
  "634 رخصة مقر إقليمي صادرة حتى الربع الثاني 2025",
  "نسبة التملّك السكني ارتفعت من 47% (2020) إلى 63% (2026)",
]
bullets.forEach((b, i) => {
  const y = 3.7 + i * 0.6
  s2.addShape(pptx.ShapeType.rect, { x: 0.6, y: y + 0.08, w: 0.06, h: 0.35, fill: { color: GOLD } })
  s2.addText(b, { x: 0.9, y, w: 11.5, h: 0.45, fontSize: 13, color: LIGHT, fontFace: "Arial" })
})

// Source
s2.addText("المصادر: هيئة العقار (REGA)، CBRE، JLL، Knight Frank", { x: 0.6, y: 6.7, w: 12, h: 0.3, fontSize: 10, color: MUTED, fontFace: "Arial" })
addFooter(s2, 2, TOTAL)

// ═══ Slide 3: Price Trends Chart ═══
const s3 = pptx.addSlide()
s3.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } })
s3.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: BLUE } })
s3.addText("اتجاهات أسعار الوحدات السكنية", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: BLUE, fontFace: "Arial", bold: true })
s3.addText("متوسط أسعار الشقق والفلل في الرياض (2020-2026)", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: MUTED, fontFace: "Arial" })

// Price chart
const chartData3 = [
  { name: "شقق", labels: ["2020", "2021", "2022", "2023", "2024", "2025", "2026"], values: [4600, 4900, 5400, 5800, 6000, 6245, 6200] },
  { name: "فلل", labels: ["2020", "2021", "2022", "2023", "2024", "2025", "2026"], values: [3800, 4100, 4600, 5000, 5250, 5640, 5600] },
]
s3.addChart(pptx.charts.BAR, chartData3, {
  x: 0.6, y: 1.6, w: 7.5, h: 4.5,
  barGrouping: "clustered",
  barDir: "col",
  chartColors: [BLUE, GOLD],
  catAxisLabelColor: MUTED, catAxisLabelFontSize: 10,
  valAxisLabelColor: MUTED, valAxisLabelFontSize: 10,
  valAxisTitle: "ريال/م²", valAxisTitleColor: MUTED,
  showLegend: true, legendColor: WHITE, legendFontSize: 11,
  dataLabelFormatCode: '#,##0', dataLabelColor: WHITE, dataLabelFontSize: 9,
  plotArea: { fill: { color: BG } },
})

// Price summary table
const table3 = [
  [{ text: "المؤشر", options: { fill: { color: DARK2 }, color: GOLD, bold: true, fontSize: 11 } },
   { text: "القيمة", options: { fill: { color: DARK2 }, color: GOLD, bold: true, fontSize: 11 } },
   { text: "التغير", options: { fill: { color: DARK2 }, color: GOLD, bold: true, fontSize: 11 } }],
  [{ text: "متوسط سعر الشقة", options: { color: LIGHT, fontSize: 11 } }, { text: "957,000 ريال", options: { color: WHITE, fontSize: 11 } }, { text: "-10.8% (Q1 2026)", options: { color: RED, fontSize: 11 } }],
  [{ text: "سعر الشقة/م²", options: { color: LIGHT, fontSize: 11 } }, { text: "3,800 ريال/م²", options: { color: WHITE, fontSize: 11 } }, { text: "+6.3% سنويًا", options: { color: GREEN, fontSize: 11 } }],
  [{ text: "سعر الفيلا/م²", options: { color: LIGHT, fontSize: 11 } }, { text: "5,600 ريال/م²", options: { color: WHITE, fontSize: 11 } }, { text: "+4.9% سنويًا", options: { color: GREEN, fontSize: 11 } }],
  [{ text: "متوسط سعر العقار", options: { color: LIGHT, fontSize: 11 } }, { text: "2.3 مليون ريال", options: { color: WHITE, fontSize: 11 } }, { text: "+10% سنويًا", options: { color: GREEN, fontSize: 11 } }],
  [{ text: "الارتفاع التراكمي 5 سنوات", options: { color: LIGHT, fontSize: 11 } }, { text: "38%", options: { color: WHITE, fontSize: 11 } }, { text: "", options: { fontSize: 11 } }],
]
s3.addTable(table3, { x: 8.5, y: 1.6, w: 4.3, h: 3.2, colW: [1.5, 1.4, 1.4], border: { type: "solid", color: DARK2, pt: 0.5 }, rowH: [0.35, 0.35, 0.35, 0.35, 0.35, 0.35] })

s3.addText("أبرز الأحياء من حيث السعر (ريال/م²): الصحافة 13,438 | حطين 11,915 | الملقا 10,746 | القيروان 9,244", { x: 0.6, y: 6.3, w: 12, h: 0.35, fontSize: 11, color: MUTED, fontFace: "Arial" })
s3.addText("المصدر: Bayut، CBRE، Knight Frank، هيئة الإحصاء — 2026", { x: 0.6, y: 6.6, w: 12, h: 0.3, fontSize: 10, color: MUTED })
addFooter(s3, 3, TOTAL)

// ═══ Slide 4: District Price Ladder ═══
const s4 = pptx.addSlide()
s4.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } })
s4.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: ORANGE } })
s4.addText("توزيع الأسعار حسب الأحياء", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: ORANGE, fontFace: "Arial", bold: true })

const districts = [
  { name: "شمال الرياض (الملقا، حطين، النرجس)", price: "6,200 – 8,500", tier: "فاخر", color: GOLD },
  { name: "وسط الرياض (العليا، السليمانية)", price: "5,000 – 7,500", tier: "راقٍ", color: BLUE },
  { name: "شرق الرياض (الرمال، المنصية)", price: "3,200 – 5,500", tier: "متوسط", color: GREEN },
  { name: "جنوب الرياض (الشفة، العزيزية)", price: "2,500 – 3,800", tier: "اقتصادي", color: TEAL },
]
districts.forEach((d, i) => {
  const y = 1.4 + i * 1.3
  s4.addShape(pptx.ShapeType.roundRect, { x: 0.6, y, w: 12, h: 1.1, fill: { color: DARK2 }, rectRadius: 0.06 })
  s4.addShape(pptx.ShapeType.rect, { x: 0.6, y, w: 0.08, h: 1.1, fill: { color: d.color } })
  s4.addText(d.name, { x: 1, y: y + 0.05, w: 6, h: 0.4, fontSize: 15, color: d.color, fontFace: "Arial", bold: true })
  s4.addText(`ريال/م² ${d.price}`, { x: 1, y: y + 0.4, w: 4, h: 0.35, fontSize: 13, color: WHITE, fontFace: "Arial" })
  s4.addShape(pptx.ShapeType.roundRect, { x: 8, y: y + 0.2, w: 1.5, h: 0.5, fill: { color: d.color }, rectRadius: 0.05 })
  s4.addText(d.tier, { x: 8, y: y + 0.2, w: 1.5, h: 0.5, fontSize: 12, color: BG, fontFace: "Arial", bold: true, align: "center" })
})

s4.addText("العائد الإيجاري: أحياء العائد المرتفع (8%+) — الملقا، الياسمين | العائد المتوسط (6.5-8%) — حطين، النرجس، العارض | العائد المنخفض (4.5-6%) — السليمانية", { x: 0.6, y: 6.6, w: 12, h: 0.4, fontSize: 11, color: MUTED, fontFace: "Arial" })
addFooter(s4, 4, TOTAL)

// ═══ Slide 5: Rental Market ═══
const s5 = pptx.addSlide()
s5.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } })
s5.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: TEAL } })
s5.addText("سوق الإيجارات", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: TEAL, fontFace: "Arial", bold: true })
s5.addText("تحليل الإيجارات السكنية في الرياض — مايو 2026", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: MUTED, fontFace: "Arial" })

// Rent chart
const rentData = [
  { name: "إيجار سنوي", labels: ["السويدي", "الجرادية", "اليمامة", "الشفة", "اليرموك", "العارض", "الرمال", "قرطبة", "النرجس", "الملقا", "الياسمين"],
    values: [12000, 18000, 20000, 23000, 35000, 65000, 50000, 62400, 70000, 70000, 70000] },
]
s5.addChart(pptx.charts.BAR, rentData, {
  x: 0.6, y: 1.6, w: 8, h: 4.5,
  barGrouping: "clustered",
  barDir: "bar",
  chartColors: [TEAL],
  catAxisLabelColor: MUTED, catAxisLabelFontSize: 8,
  valAxisLabelColor: MUTED, valAxisLabelFontSize: 10,
  valAxisTitle: "ريال/سنويًا", valAxisTitleColor: MUTED,
  showLegend: false,
  dataLabelFormatCode: '#,##0', dataLabelColor: TEAL, dataLabelFontSize: 8,
  plotArea: { fill: { color: BG } },
})

// Rent key stats
const rentStats = [
  { label: "متوسط الإيجار (شقة)", val: "44,400 ريال/سنة", sub: "3,700 ريال/شهر" },
  { label: "تراجع الإيجارات", val: "-15%", sub: "خلال العام الماضي" },
  { label: "متوسط الإيجار (فيلا)", val: "100,000 ريال/سنة", sub: "8,333 ريال/شهر" },
  { label: "تراجع سنوي", val: "-2.1%", sub: "الربع الأول 2026" },
]
rentStats.forEach((r, i) => {
  const y = 1.6 + i * 1.2
  s5.addShape(pptx.ShapeType.roundRect, { x: 9, y, w: 3.8, h: 1, fill: { color: DARK2 }, rectRadius: 0.06 })
  s5.addText(r.label, { x: 9.2, y: y + 0.02, w: 3.4, h: 0.25, fontSize: 10, color: MUTED, fontFace: "Arial" })
  s5.addText(r.val, { x: 9.2, y: y + 0.25, w: 3.4, h: 0.35, fontSize: 17, color: i === 1 ? RED : TEAL, fontFace: "Arial", bold: true })
  s5.addText(r.sub, { x: 9.2, y: y + 0.6, w: 3.4, h: 0.25, fontSize: 10, color: MUTED, fontFace: "Arial" })
})

s5.addText("قرار التجميد: تجميد الإيجارات السكنية في الرياض لمدة 5 سنوات من سبتمبر 2025 — يمنع رفع الإيجار عند تجديد العقود", { x: 0.6, y: 6.4, w: 12, h: 0.35, fontSize: 11, color: MUTED, fontFace: "Arial" })
s5.addText("المصادر: Darak، هيئة العقار، JLL، منصة إيجار — 58,283 إعلان نشط", { x: 0.6, y: 6.7, w: 12, h: 0.3, fontSize: 10, color: MUTED })
addFooter(s5, 5, TOTAL)

// ═══ Slide 6: Rental Yield ═══
const s6 = pptx.addSlide()
s6.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } })
s6.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: GREEN } })
s6.addText("العائد على الاستثمار الإيجاري", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: GREEN, fontFace: "Arial", bold: true })
s6.addText("مقارنة العائد الإيجاري في الرياض بالأسواق العالمية", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: MUTED, fontFace: "Arial" })

// Yield comparison chart
const yieldData = [
  { name: "العائد الإيجاري", labels: ["الرياض", "السعودية", "لندن", "نيويورك", "سنغافورة", "دبي"],
    values: [7.1, 6.84, 3.0, 4.0, 2.8, 6.5] },
]
s6.addChart(pptx.charts.BAR, yieldData, {
  x: 0.6, y: 1.6, w: 7.5, h: 4.5,
  barGrouping: "clustered",
  barDir: "col",
  chartColors: [GREEN],
  catAxisLabelColor: MUTED, catAxisLabelFontSize: 10,
  valAxisLabelColor: MUTED, valAxisLabelFontSize: 10,
  valAxisTitle: "نسبة العائد %", valAxisTitleColor: MUTED,
  showLegend: false,
  dataLabelFormatCode: '0.0"%"', dataLabelColor: GREEN, dataLabelFontSize: 11,
  plotArea: { fill: { color: BG } },
})

// Yield by district
const yieldTbl = [
  [{ text: "الحي", options: { fill: { color: DARK2 }, color: GOLD, bold: true, fontSize: 11 } },
   { text: "العائد %", options: { fill: { color: DARK2 }, color: GOLD, bold: true, fontSize: 11 } },
   { text: "المستوى", options: { fill: { color: DARK2 }, color: GOLD, bold: true, fontSize: 11 } }],
  [{ text: "الملقا", options: { color: LIGHT, fontSize: 11 } }, { text: "8.2 – 9.4%", options: { color: GREEN, fontSize: 11 } }, { text: "مرتفع جدًا", options: { color: GREEN, fontSize: 11 } }],
  [{ text: "حطين", options: { color: LIGHT, fontSize: 11 } }, { text: "7.5 – 8.6%", options: { color: GREEN, fontSize: 11 } }, { text: "مرتفع", options: { color: GREEN, fontSize: 11 } }],
  [{ text: "النرجس", options: { color: LIGHT, fontSize: 11 } }, { text: "6.5 – 8%", options: { color: BLUE, fontSize: 11 } }, { text: "متوسط", options: { color: BLUE, fontSize: 11 } }],
  [{ text: "العارض", options: { color: LIGHT, fontSize: 11 } }, { text: "6.5 – 8%", options: { color: BLUE, fontSize: 11 } }, { text: "متوسط", options: { color: BLUE, fontSize: 11 } }],
  [{ text: "السليمانية", options: { color: LIGHT, fontSize: 11 } }, { text: "4.8 – 5.4%", options: { color: RED, fontSize: 11 } }, { text: "منخفض", options: { color: RED, fontSize: 11 } }],
]
s6.addTable(yieldTbl, { x: 8.5, y: 1.6, w: 4.3, h: 2.5, colW: [1.5, 1.4, 1.4], border: { type: "solid", color: DARK2, pt: 0.5 }, rowH: [0.35, 0.35, 0.35, 0.35, 0.35, 0.35] })

s6.addText("• متوسط العائد الإيجاري للشقق في الرياض: 7.1% | للفلل: 5.8%", { x: 0.6, y: 6.3, w: 12, h: 0.3, fontSize: 12, color: LIGHT, fontFace: "Arial" })
s6.addText("• المملكة تتفوق على لندن (3%)، نيويورك (4%)، سنغافورة (2.8%) في العائد الإيجاري", { x: 0.6, y: 6.6, w: 12, h: 0.3, fontSize: 12, color: LIGHT, fontFace: "Arial" })
s6.addText("المصادر: REGA، Global Property Guide، هيئة العقار", { x: 0.6, y: 6.9, w: 12, h: 0.2, fontSize: 10, color: MUTED })
addFooter(s6, 6, TOTAL)

// ═══ Slide 7: Transaction Activity ═══
const s7 = pptx.addSlide()
s7.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } })
s7.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: RED } })
s7.addText("نشاط المعاملات العقارية", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: RED, fontFace: "Arial", bold: true })
s7.addText("تراجع حاد في عدد الصفقات مع استمرار ارتفاع القيم", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: MUTED, fontFace: "Arial" })

// Transaction chart
const txData = [
  { name: "عدد الصفقات (بالآلاف)", labels: ["2020", "2021", "2022", "2023", "2024", "2025", "Q1 2026"],
    values: [45, 52, 68, 72, 75, 56.6, 8.6] },
]
s7.addChart(pptx.charts.BAR, txData, {
  x: 0.6, y: 1.6, w: 7, h: 4.5,
  barGrouping: "clustered",
  barDir: "col",
  chartColors: [RED],
  catAxisLabelColor: MUTED, catAxisLabelFontSize: 9,
  valAxisLabelColor: MUTED, valAxisLabelFontSize: 10,
  valAxisTitle: "ألف صفقة", valAxisTitleColor: MUTED,
  showLegend: false,
  dataLabelFormatCode: '#,##0', dataLabelColor: RED, dataLabelFontSize: 10,
  plotArea: { fill: { color: BG } },
})

const txBullets = [
  "Q1 2026: 8,600+ صفقة سكنية في الرياض — انخفاض 54.4% عن العام الماضي",
  "قيمة الصفقات: 112 مليار ريال في Q1 2026 على مستوى المملكة",
  "2025: 56,600 صفقة في الرياض — انخفاض 31.4% عن 2024",
  "متوسط سعر الصفقة: 1.7 مليون ريال — الأعلى في السنوات الأخيرة",
  "التمويل العقاري: 52 مليار ريال سنويًا (ارتفاع من 18 مليار في 2020)",
  "التراجع يعود إلى: التوترات الجيوسياسية، غلاء الأسعار، التعديلات التنظيمية",
]
txBullets.forEach((b, i) => {
  const y = 1.6 + i * 0.7
  s7.addShape(pptx.ShapeType.rect, { x: 8, y: y + 0.08, w: 0.06, h: 0.35, fill: { color: i < 2 ? RED : MUTED } })
  s7.addText(b, { x: 8.3, y, w: 4.5, h: 0.5, fontSize: 11, color: LIGHT, fontFace: "Arial" })
})
addFooter(s7, 7, TOTAL)

// ═══ Slide 8: Supply & Demand ═══
const s8 = pptx.addSlide()
s8.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } })
s8.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: BLUE } })
s8.addText("العرض والطلب", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: BLUE, fontFace: "Arial", bold: true })
s8.addText("المعروض العقاري ووتيرة التسليم", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: MUTED, fontFace: "Arial" })

// Supply chart
const supplyData = [
  { name: "الوحدات المسلمة (ألف)", labels: ["2020", "2021", "2022", "2023", "2024", "2025", "2026 (م)", "2030 (م)"],
    values: [30, 35, 40, 45, 48, 65, 63, 100] },
]
s8.addChart(pptx.charts.BAR, supplyData, {
  x: 0.6, y: 1.6, w: 7.5, h: 4.5,
  barGrouping: "clustered",
  barDir: "col",
  chartColors: [BLUE],
  catAxisLabelColor: MUTED, catAxisLabelFontSize: 9,
  valAxisLabelColor: MUTED, valAxisLabelFontSize: 10,
  valAxisTitle: "ألف وحدة", valAxisTitleColor: MUTED,
  showLegend: false,
  dataLabelFormatCode: '#,##0', dataLabelColor: BLUE, dataLabelFontSize: 10,
  plotArea: { fill: { color: BG } },
})

const supplyStats = [
  { val: "2.19", unit: "مليون وحدة", label: "المخزون السكني Q1 2026" },
  { val: "65,000", unit: "وحدة", label: "تم تسليمها في 2025 (+30%)" },
  { val: "63,000", unit: "وحدة", label: "قيد التسليم في 2026" },
  { val: "310,000+", unit: "وحدة", label: "إجمالي خط التطوير" },
]
supplyStats.forEach((s, i) => {
  const y = 1.6 + i * 1.2
  s8.addShape(pptx.ShapeType.roundRect, { x: 8.5, y, w: 4.3, h: 1, fill: { color: DARK2 }, rectRadius: 0.06 })
  s8.addText(s.val, { x: 8.7, y: y + 0.05, w: 3.9, h: 0.4, fontSize: 22, color: BLUE, fontFace: "Arial", bold: true })
  s8.addText(s.unit, { x: 8.7, y: y + 0.4, w: 3.9, h: 0.25, fontSize: 11, color: MUTED, fontFace: "Arial" })
  s8.addText(s.label, { x: 8.7, y: y + 0.6, w: 3.9, h: 0.25, fontSize: 11, color: LIGHT, fontFace: "Arial" })
})

s8.addText("المصدر: JLL، Knight Frank، Cavendish Maxwell — 2026", { x: 0.6, y: 6.6, w: 12, h: 0.3, fontSize: 10, color: MUTED })
addFooter(s8, 8, TOTAL)

// ═══ Slide 9: Office Market ═══
const s9 = pptx.addSlide()
s9.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } })
s9.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: "9B59B6" } })
s9.addText("سوق المكاتب — مؤشر قوي", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: "9B59B6", fontFace: "Arial", bold: true })
s9.addText("الطلب على المساحات المكتبية يفوق المعروض", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: MUTED, fontFace: "Arial" })

const officeKpis = [
  { val: "97%", label: "الإشغال (Grade A)" },
  { val: "2,770", label: "ريال/م² الإيجار السنوي" },
  { val: "+6.3%", label: "نمو الإيجارات سنويًا" },
  { val: "3.2%", label: "نسبة الشواغر" },
]
officeKpis.forEach((k, i) => {
  const w = 2.8, gap = 0.3, x = 0.6 + i * (w + gap)
  s9.addShape(pptx.ShapeType.roundRect, { x, y: 1.6, w, h: 1.4, fill: { color: DARK2 }, line: { color: "9B59B6", width: 0.5 }, rectRadius: 0.08 })
  s9.addText(k.val, { x, y: 1.7, w, h: 0.6, fontSize: 30, color: "9B59B6", fontFace: "Arial", bold: true, align: "center" })
  s9.addText(k.label, { x, y: 2.3, w, h: 0.5, fontSize: 12, color: LIGHT, fontFace: "Arial", align: "center" })
})

const officeB = [
  "634 رخصة مقر إقليمي — 780+ شركة متعددة الجنسيات تلتزم بالرياض",
  "مركز الملك عبدالله المالي (KAFD) يتصدر قائمة الإيجارات في الرياض",
  "الطلب المدعوم بنقل المقرات الإقليمية ونمو قطاع الخدمات المهنية",
  "من المتوقع استمرار ضغط الطلب مع محدودية المعروض من المساحات المكتبية الفاخرة",
]
officeB.forEach((b, i) => {
  const y = 3.4 + i * 0.7
  s9.addShape(pptx.ShapeType.rect, { x: 0.6, y: y + 0.08, w: 0.06, h: 0.35, fill: { color: "9B59B6" } })
  s9.addText(b, { x: 0.9, y, w: 11.5, h: 0.5, fontSize: 13, color: LIGHT, fontFace: "Arial" })
})
addFooter(s9, 9, TOTAL)

// ═══ Slide 10: Regulatory ═══
const s10 = pptx.addSlide()
s10.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } })
s10.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: ACCENT } })
s10.addText("التطورات التنظيمية", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: ACCENT, fontFace: "Arial", bold: true })
s10.addText("أبرز القرارات المنظمة للسوق العقاري", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: MUTED, fontFace: "Arial" })

const regs = [
  { title: "تجميد الإيجارات 5 سنوات", date: "سبتمبر 2025", desc: "يمنع رفع إيجارات المساكن عند التجديد في الرياض حتى 2030. يستثنى العقود الجديدة لأول مرة." },
  { title: "تنظيم تملك غير السعوديين", date: "2026", desc: "إطار جديد يسمح لغير السعوديين بتملك العقارات في select areas — فتح السوق أمام رأس المال العالمي." },
  { title: "ضريبة الأراضي البيضاء", date: "مستمر", desc: "إصلاحات لتشجيع تطوير الأراضي غير المستغلة وزيادة المعروض السكني." },
  { title: "منصة إيجار", date: "مستمر", desc: "توثيق عقود الإيجار إلكترونيًا — توفير الشفافية وضبط الأسعار." },
  { title: "هيئة العقار (REGA)", date: "2025-2026", desc: "صلاحيات موسعة لضبط التوازن في السوق — زيادة الضخ السكني من 50 ألف إلى 65 ألف وحدة." },
]
regs.forEach((r, i) => {
  const y = 1.6 + i * 1.02
  s10.addShape(pptx.ShapeType.roundRect, { x: 0.6, y, w: 12, h: 0.85, fill: { color: DARK2 }, rectRadius: 0.06 })
  s10.addShape(pptx.ShapeType.rect, { x: 0.6, y, w: 0.06, h: 0.85, fill: { color: ACCENT } })
  s10.addText(r.title, { x: 0.9, y: y + 0.02, w: 4, h: 0.35, fontSize: 14, color: ACCENT, fontFace: "Arial", bold: true })
  s10.addText(r.date, { x: 10.5, y: y + 0.02, w: 1.8, h: 0.35, fontSize: 11, color: MUTED, fontFace: "Arial", align: "right" })
  s10.addText(r.desc, { x: 0.9, y: y + 0.35, w: 11.3, h: 0.4, fontSize: 11, color: "BBBBBB", fontFace: "Arial" })
})
addFooter(s10, 10, TOTAL)

// ═══ Slide 11: Forecast ═══
const s11 = pptx.addSlide()
s11.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } })
s11.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: GOLD } })
s11.addText("التوقعات المستقبلية", { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 30, color: GOLD, fontFace: "Arial", bold: true })
s11.addText("النمو المتوقع لسوق العقارات في الرياض", { x: 0.6, y: 1, w: 12, h: 0.4, fontSize: 14, color: MUTED, fontFace: "Arial" })

// Forecast chart
const forecastData = [
  { name: "نمو الأسعار %", labels: ["2022", "2023", "2024", "2025", "2026 (م)", "2027 (م)", "2028 (م)", "2030 (م)"],
    values: [17.7, 8.6, 8.6, 2.9, 5.5, 6.0, 6.5, 7.0] },
]
s11.addChart(pptx.charts.BAR, forecastData, {
  x: 0.6, y: 1.6, w: 7.5, h: 4.5,
  barGrouping: "clustered",
  barDir: "col",
  chartColors: [GOLD],
  catAxisLabelColor: MUTED, catAxisLabelFontSize: 9,
  valAxisLabelColor: MUTED, valAxisLabelFontSize: 10,
  valAxisTitle: "نمو سنوي %", valAxisTitleColor: MUTED,
  showLegend: false,
  dataLabelFormatCode: '0.0"%"', dataLabelColor: GOLD, dataLabelFontSize: 10,
  plotArea: { fill: { color: BG } },
})

const forecast = [
  "2026: نمو متوقع 4-7% (التقدير المركزي 5.5%) — تباطؤ من وتيرة العامين الماضيين",
  "التراكمي 5 سنوات (2026-2031): 25-40% نموًا في الأسعار",
  "التراكمي 10 سنوات (2026-2036): 55-90% نموًا في الأسعار",
  "المخزون السكني: من 2.7 مليون وحدة (2025) إلى 3.3 مليون وحدة (2030)",
  "أكثر من 830,000 منزل جديد مطلوب بحلول 2030 لاستيعاب النمو السكاني",
  "استعدادات إكسبو 2030 تدعم الطلب متوسط/طويل المدى",
  "الطلب على الشقق في الأحياء الشمالية — أعلى عائد إجمالي متوقع",
]
forecast.forEach((f, i) => {
  const y = 1.6 + i * 0.65
  s11.addText(`● ${f}`, { x: 8.5, y, w: 4.3, h: 0.5, fontSize: 11, color: LIGHT, fontFace: "Arial" })
})
addFooter(s11, 11, TOTAL)

// ═══ Slide 12: Summary ═══
const s12 = pptx.addSlide()
s12.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: BG } })
s12.addShape(pptx.ShapeType.rect, { x: 0, y: 2.6, w: 13.33, h: 0.06, fill: { color: GOLD } })
s12.addText("الملخص التنفيذي", { x: 1, y: 0.6, w: 11.33, h: 0.8, fontSize: 34, color: GOLD, fontFace: "Arial", bold: true, align: "center" })
s12.addText("السوق العقاري في الرياض — يونيو 2026", { x: 1, y: 1.4, w: 11.33, h: 0.5, fontSize: 18, color: WHITE, fontFace: "Arial", align: "center" })

const summary = [
  "🏗️  السوق في مرحلة إعادة توازن — تراجع الصفقات (-54%) مع استقرار الأسعار",
  "📈  الأسعار التراكمية: +38% في 5 سنوات — نمو متوقع 4-7% في 2026",
  "🏠  الإيجارات تتراجع (-15%) بفضل زيادة المعروض وتجميد الإيجارات 5 سنوات",
  "💰  العائد الإيجاري 7.1% — الأعلى مقارنة بالأسواق العالمية الكبرى",
  "🏢  سوق المكاتب يسخن — إشغال 97% وإيجارات ترتفع 6.3% سنويًا",
  "👨‍👩‍👧‍👦  النمو السكاني 3-4% سنويًا — 9.6 مليون نسمة بحلول 2030",
  "🛡️  التوسع التنظيمي — تملك الأجانب، تجميد الإيجارات، دعم التمويل العقاري",
  "🎯  أفضل فرص الاستثمار: الأحياء الشمالية (الملقا، حطين، الياسمين)",
]
summary.forEach((s, i) => {
  const y = 2 + i * 0.6
  s12.addText(s, { x: 1.5, y, w: 10.33, h: 0.45, fontSize: 14, color: LIGHT, fontFace: "Arial" })
})

s12.addText("إعداد: منصة التحليل العقاري  •  المصادر: هيئة العقار، CBRE، JLL، Knight Frank، Darak، Bayut  •  يونيو 2026", { x: 1, y: 6.8, w: 11.33, h: 0.3, fontSize: 10, color: MUTED, fontFace: "Arial", align: "center" })
addFooter(s12, 12, TOTAL)

// ── Save ──
const outPath = "E:\\N8N\\scraper\\scraper2\\csi-ultimate\\Riyadh_Real_Estate_Report_2026.pptx"
pptx.writeFile({ fileName: outPath }).then(() => {
  console.log("✅ تم إنشاء العرض: " + outPath)
  const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1)
  console.log("   الحجم: " + sizeKB + " كيلوبايت")
  console.log("   12 شريحة مع رسوم بيانية")
}).catch(err => {
  console.error("❌ خطأ:", err.message)
  process.exit(1)
})
