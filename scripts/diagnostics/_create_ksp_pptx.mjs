import PptxGenJS from "pptxgenjs"
import fs from "fs"

const pptx = new PptxGenJS()
pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 })
pptx.layout = "WIDE"

// ── Color Palette ──
const C = {
  dark:    "0A1628",  bg1: "0D1F3C",  bg2: "0C2D1F",  bg3: "1A0D2E",  bg4: "2D1A0E",
  card1:   "12233D",  card2: "0F2E24",  card3: "1E1035",  card4: "301F12",
  gold:    "D4AF37",  gold2: "C9A84C",
  emerald: "2ECC71",  teal: "1ABC9C",  blue: "2980B9",  sky: "3498DB",
  purple:  "9B59B6",  magenta:"E91E63",
  orange:  "F39C12",  coral: "E74C3C",
  white:   "FFFFFF",  light: "D0D5DD",  muted: "78909C",
  leaf:    "27AE60",  sand: "D4A76A",  water: "1ABC9C",
}
const F = "Arial"
const TOTAL = 30
const SIG = "عبيدة عمري"

function footer(s, n) {
  s.addShape(pptx.ShapeType.rect, { x:0, y:7.1, w:13.33, h:0.4, fill:{color:"0B1428"} })
  s.addText(`حديقة الملك سلمان — الرياض`, { x:0.3, y:7.12, w:5, h:0.3, fontSize:8, color:C.muted, fontFace:F })
  s.addText(`${n}/${TOTAL}`, { x:11.8, y:7.12, w:0.8, h:0.3, fontSize:8, color:C.muted, fontFace:F, align:"center" })
  s.addText(SIG, { x:12.5, y:7.12, w:0.8, h:0.3, fontSize:7, color:C.muted, fontFace:F, align:"right" })
}

function bg(s, color) { s.addShape(pptx.ShapeType.rect, { x:0, y:0, w:13.33, h:7.5, fill:{color:color || C.dark} }) }
function accent(s, color) { s.addShape(pptx.ShapeType.rect, { x:0, y:0, w:0.1, h:7.1, fill:{color:color || C.gold} }) }

function titleLine(s, text, color) {
  s.addText(text, { x:0.5, y:0.25, w:12.3, h:0.7, fontSize:28, color:color||C.gold, fontFace:F, bold:true })
}
function subtitle(s, text) {
  s.addText(text, { x:0.5, y:0.9, w:12.3, h:0.35, fontSize:13, color:C.muted, fontFace:F })
}

function kpiCard(s, x, y, w, h, val, label, barColor) {
  s.addShape(pptx.ShapeType.roundRect, { x, y, w, h, fill:{color:C.card1}, line:{color:barColor||C.gold, width:0.5}, rectRadius:0.08 })
  s.addText(String(val), { x, y:y+0.03, w, h:h*0.55, fontSize:24, color:barColor||C.gold, fontFace:F, bold:true, align:"center" })
  s.addText(label, { x, y:y+h*0.55, w, h:h*0.4, fontSize:10, color:C.white, fontFace:F, align:"center" })
}

function bulletCard(s, x, y, w, h, items, dotColor) {
  s.addShape(pptx.ShapeType.roundRect, { x, y, w, h, fill:{color:C.card1}, rectRadius:0.06 })
  items.forEach((t, i) => {
    const iy = y + 0.1 + i * 0.42
    s.addShape(pptx.ShapeType.rect, { x:x+0.1, y:iy+0.04, w:0.04, h:0.22, fill:{color:dotColor||C.gold} })
    s.addText(t, { x:x+0.25, y:iy-0.02, w:w-0.4, h:0.35, fontSize:9, color:C.light, fontFace:F })
  })
}

// ═══════════════════════════════════
// COLOR THEMES PER SECTION
// ═══════════════════════════════════
// 1-2: Intro (gold/dark)
// 3-6: Overview (blue)
// 7-10: Design (emerald)
// 11-14: Facilities (purple)
// 15-18: Sports/Golf (orange)
// 19-21: Sustainability (green)
// 22-25: Investment (gold2)
// 26-28: Impact (teal)
// 29-30: Future/Refs (dark)

// ═══ 1 — COVER ═══
const s1 = pptx.addSlide()
bg(s1, C.dark)
// Decorative top bar
s1.addShape(pptx.ShapeType.rect, { x:0, y:0, w:13.33, h:0.06, fill:{color:C.gold} })
// Large geometric circle (decorative)
s1.addShape(pptx.ShapeType.ellipse, { x:9.5, y:-2, w:6, h:6, fill:{color:"0B1A30"}, line:{color:C.gold, width:0.5} })
s1.addShape(pptx.ShapeType.ellipse, { x:10.5, y:-1, w:4, h:4, fill:{color:"0C1F35"}, line:{color:C.gold, width:0.3} })
// Background grid pattern abstraction
for (let i = 0; i < 8; i++) {
  s1.addShape(pptx.ShapeType.rect, { x:0.3+i*1.7, y:4.8, w:0.03, h:0.6, fill:{color:i%2===0?C.gold:C.muted, opacity:30} })
}
s1.addText("مشروع", { x:1, y:1, w:11.33, h:0.5, fontSize:20, color:C.muted, fontFace:F, align:"center" })
s1.addText("حديقة الملك سلمان", { x:1, y:1.4, w:11.33, h:1, fontSize:46, color:C.gold, fontFace:F, bold:true, align:"center" })
s1.addText("أكبر حدائق المدن في العالم", { x:1, y:2.3, w:11.33, h:0.6, fontSize:24, color:C.white, fontFace:F, align:"center" })
s1.addShape(pptx.ShapeType.rect, { x:4.5, y:3.1, w:4.33, h:0.04, fill:{color:C.gold} })
s1.addText("الرياض — المملكة العربية السعودية", { x:1, y:3.3, w:11.33, h:0.5, fontSize:16, color:C.muted, fontFace:F, align:"center" })
s1.addText("عرض تقديمي شامل — يونيو 2026", { x:1, y:3.7, w:11.33, h:0.4, fontSize:14, color:C.gold2, fontFace:F, align:"center" })
// Badges
const bgs = ["أكبر حديقة مدن في العالم", "رؤية السعودية 2030", "16.6 كم²", "1.1 مليون شجرة", "SR 72 مليار"]
bgs.forEach((b,i) => {
  const w=2.2, g=0.2, x=0.8+i*(w+g)
  s1.addShape(pptx.ShapeType.roundRect, { x, y:4.4, w, h:0.45, fill:{color:"12233D"}, line:{color:C.gold, width:0.3}, rectRadius:0.04 })
  s1.addText(b, { x, y:4.4, w, h:0.45, fontSize:10, color:C.gold, fontFace:F, align:"center" })
})
s1.addText("إعداد: عبيدة عمري", { x:1, y:5.1, w:11.33, h:0.3, fontSize:11, color:C.muted, fontFace:F, align:"center" })
s1.addShape(pptx.ShapeType.rect, { x:0, y:7.1, w:13.33, h:0.4, fill:{color:"0B1428"} })
s1.addText(SIG, { x:12.4, y:7.12, w:0.9, h:0.3, fontSize:7, color:C.muted, fontFace:F, align:"right" })
s1.addText("1/30", { x:11.8, y:7.12, w:0.8, h:0.3, fontSize:8, color:C.muted, fontFace:F, align:"center" })

// ═══ 2 — AGENDA ═══
const s2 = pptx.addSlide()
bg(s2, C.dark)
accent(s2, C.gold)
titleLine(s2, "فهرس المحتويات", C.gold)
const sections = [
  ["01", "المقدمة ورؤية 2030", "11-14", "المرافق الثقافية والترفيهية"],
  ["02", "لمحة عامة عن المشروع", "15-18", "المرافق الرياضية والجولف"],
  ["03", "المخطط الرئيسي والتصميم", "19-21", "الاستدامة والبيئة"],
  ["04", "المساحات الخضراء والغابة المركزية", "22-25", "الاستثمار والتطوير العقاري"],
  ["05", "الابتكار لوب والعناصر المائية", "26-28", "الأثر البيئي والاقتصادي"],
  ["06-10", "المرافق الرئيسية", "29-30", "الرؤية المستقبلية والمراجع"],
]
sections.forEach((r, i) => {
  const y = 1.5 + i * 0.55
  s2.addText(`${r[0]}  ${r[1]}`, { x:0.6, y, w:5.5, h:0.4, fontSize:13, color:C.light, fontFace:F })
  s2.addText(`${r[2]}  ${r[3]}`, { x:6.8, y, w:6, h:0.4, fontSize:13, color:C.light, fontFace:F })
  if (i < 6) s2.addShape(pptx.ShapeType.rect, { x:0.5, y:y+0.42, w:12.3, h:0.01, fill:{color:"1A2D4A"} })
})
footer(s2, 2)

// ═══ 3 — EXECUTIVE SUMMARY ═══
const s3 = pptx.addSlide()
bg(s3, C.bg1)
accent(s3, C.blue)
titleLine(s3, "ملخص تنفيذي", C.blue)
subtitle(s3, "أحد أكبر مشاريع التحول الحضري في العالم — رئة الرياض الخضراء")

const esKpis = [
  {v:"16.6", u:"كم²", l:"مساحة الحديقة", c:C.blue},
  {v:"5×", u:"سنترال بارك", l:"أكبر من حديقة نيويورك", c:C.blue},
  {v:"7×", u:"هايد بارك", l:"أكبر من حديقة لندن", c:C.blue},
  {v:"1.1M", u:"شجرة", l:"إجمالي الأشجار", c:C.blue},
  {v:"72", u:"مليار ريال", l:"تكلفة المشروع", c:C.blue},
]
esKpis.forEach((k,i) => kpiCard(s3, 0.5+i*2.5, 1.4, 2.2, 1.4, k.v, `${k.u}\n${k.l}`, k.c))

const esItems = [
  "أكبر حدائق المدن في العالم — مساحة تعادل 5 أضعاف سنترال بارك في نيويورك",
  "تقع في موقع مطار الرياض القديم — تحويل 16.6 كم² من منطقة عسكرية مغلقة إلى متنزه عام مفتوح",
  "مبادرة من الأمير محمد بن سلمان — أطلقها الملك سلمان بن عبدالعزيز في 19 مارس 2019",
  "أحد مشاريع الرياض الأربعة الكبرى: حديقة الملك سلمان، الرياض الخضراء، المسار الرياضي، الرياض آرت",
  "1.1 مليون شجرة و 30 مليون نبات من 800 نوع — 50% محلي + 50% مناخي متكيف",
  "18.4 مليون م³ من التربة التجديدية لتحويل الصحراء إلى تربة خصبة",
  "5 محطات قطار رياضي + 10 محطات حافلات — مرتبطة بشبكة النقل العام",
  "المرحلة الأولى تفتح في أواخر 2026 — الاكتمال الكامل بحلول 2030",
]
esItems.forEach((t,i) => {
  const y = 3.1 + i * 0.48
  s3.addShape(pptx.ShapeType.rect, { x:0.5, y:y+0.04, w:0.04, h:0.22, fill:{color:C.blue} })
  s3.addText(t, { x:0.75, y:y, w:12, h:0.35, fontSize:10.5, color:C.light, fontFace:F })
})
footer(s3, 3)

// ═══ 4 — VISION 2030 & 4 MEGA PROJECTS ═══
const s4 = pptx.addSlide()
bg(s4, C.bg1)
accent(s4, C.blue)
titleLine(s4, "رؤية 2030 ومشاريع الرياض الأربعة الكبرى", C.blue)
subtitle(s4, "86 مليار ريال — 4 مشاريع نوعية أطلقت في 19 مارس 2019")

const projs = [
  {n:"حديقة الملك سلمان", d:"أكبر حدائق المدن في العالم — 16.6 كم² — 1.1 مليون شجرة — مجمع ملكي للفنون", col:C.gold},
  {n:"الرياض الخضراء", d:"زراعة 7.5 مليون شجرة في جميع أنحاء الرياض — رفع نصيب الفرد من المساحات الخضراء من 1.7 إلى 28 م²", col:C.emerald},
  {n:"المسار الرياضي", d:"أكبر منتزه خطي في العالم — 135+ كم — يربط وادي حنيفة بوادي السلي — مسارات مشي ودراجات وخيول", col:C.orange},
  {n:"الرياض آرت", d:"1000 مشروع فني عام — تحويل الرياض إلى معرض فني مفتوح — فنون الشارع والنحت والجداريات", col:C.purple},
]
projs.forEach((p,i) => {
  const x = 0.5, y = 1.5 + i * 1.35
  s4.addShape(pptx.ShapeType.roundRect, { x, y, w:12.3, h:1.15, fill:{color:C.card1}, rectRadius:0.05 })
  s4.addShape(pptx.ShapeType.rect, { x, y, w:0.06, h:1.15, fill:{color:p.col} })
  s4.addText(p.n, { x:0.8, y:y+0.05, w:4, h:0.35, fontSize:15, color:p.col, fontFace:F, bold:true })
  s4.addText(`${p.col === C.gold ? "الميزانية: 72 مليار ريال —" : ""} ${p.d}`, { x:0.8, y:y+0.4, w:11.3, h:0.6, fontSize:11, color:C.light, fontFace:F })
})
footer(s4, 4)

// ═══ 5 — LOCATION & STRATEGIC IMPORTANCE ═══
const s5 = pptx.addSlide()
bg(s5, C.bg1)
accent(s5, C.sky)
titleLine(s5, "موقع المشروع وأهميته الاستراتيجية", C.sky)
subtitle(s5, "قلب العاصمة — موقع محوري على أرض مطار الرياض القديم")

const locItems = [
  "مطار الرياض القديم (قاعدة الملك سلمان الجوية سابقًا) — شمال وسط مدينة الرياض",
  "مساحة 16.6 كم² — موقع مركزي يربط بين شمال وجنوب وشرق وغرب الرياض",
  "مرتبط بـ 7 طرق رئيسية — أنفاق كبرى: أبو بكر الصديق (2,430 م) + العروبة (2,150 م)",
  "5 محطات قطار الرياض (4 على الخط الأخضر + 1 على الخط الأحمر)",
  "10 محطات حافلات الرياض — تكامل كامل مع مشروع الملك عبدالعزيز للنقل العام",
  "قريب من: جامعة الملك سعود، حي السفارات، مركز الملك عبدالله المالي، الدرعية",
  "الموقع يحوله من منطقة عسكرية مغلقة (60+ عامًا) إلى وجهة عامة مفتوحة 24 ساعة",
  "يعزز التصنيف العالمي للرياض ضمن أفضل المدن ملاءمة للعيش في العالم",
]
locItems.forEach((t,i) => {
  const y = 1.5 + i * 0.65
  s5.addShape(pptx.ShapeType.rect, { x:0.5, y:y+0.05, w:0.04, h:0.25, fill:{color:C.sky} })
  s5.addText(t, { x:0.8, y, w:11.5, h:0.45, fontSize:12, color:C.light, fontFace:F })
})
footer(s5, 5)

// ═══ 6 — SIZE COMPARISON ═══
const s6 = pptx.addSlide()
bg(s6, C.bg1)
accent(s6, C.blue)
titleLine(s6, "مساحة الحديقة — مقارنة عالمية", C.blue)
subtitle(s6, "أكبر حدائق المدن في العالم — أبعاد غير مسبوقة")

const cmp = [
  {name:"حديقة الملك سلمان", size:"16.6 كم²", pct:"100%"},
  {name:"سنترال بارك — نيويورك", size:"3.4 كم²", pct:"20%"},
  {name:"هايد بارك — لندن", size:"2.5 كم²", pct:"15%"},
  {name:"جاردنز باي ذا باي — سنغافورة", size:"1.0 كم²", pct:"6%"},
  {name:"بوا دي بولون — باريس", size:"8.5 كم²", pct:"51%"},
  {name:"ريتشارم — أمستردام", size:"0.5 كم²", pct:"3%"},
]
const hdr = [{text:"الحديقة", options:{fill:"0B1A30",color:C.gold,bold:true,fontSize:11}},{text:"المساحة",options:{fill:"0B1A30",color:C.gold,bold:true,fontSize:11,align:"center"}},{text:"مقارنة",options:{fill:"0B1A30",color:C.gold,bold:true,fontSize:11,align:"center"}},{text:"",options:{fill:"0B1A30",color:C.gold,bold:true,fontSize:11}}]
const tRows = [hdr]
cmp.forEach((c,i) => {
  const clr = i===0 ? C.gold : C.light
  const bClr = i===0 ? C.gold : C.muted
  tRows.push([
    {text:c.name, options:{color:clr,fontSize:11,bold:i===0}},
    {text:c.size, options:{color:clr,fontSize:11,align:"center"}},
    {text:c.pct, options:{color:clr,fontSize:11,align:"center"}},
    {text:"", options:{}},
  ])
  // Bar visualization
  const bw = parseFloat(c.pct)/100 * 6
  s6.addShape(pptx.ShapeType.roundRect, { x:9.5, y:1.85+i*0.7, w:bw, h:0.25, fill:{color:bClr}, rectRadius:0.03 })
})
s6.addTable(tRows, { x:0.5, y:1.5, w:8.5, h:4.5, colW:[4.5,1.8,1.2,1], border:{type:"solid",color:"1A2D4A",pt:0.3}, rowH:[0.35,0.45,0.45,0.45,0.45,0.45,0.45] })
s6.addText("• تعادل 5 أضعاف سنترال بارك • 7 أضعاف هايد بارك • 16 ضعف جاردنز باي ذا باي", { x:0.5, y:6.3, w:12, h:0.3, fontSize:12, color:C.light, fontFace:F })
s6.addText("• المساحة الخضراء: 11+ كم² موزعة على 11 مليون م² من المساحات المفتوحة", { x:0.5, y:6.6, w:12, h:0.3, fontSize:12, color:C.light, fontFace:F })
footer(s6, 6)

// ═══ 7 — TIMELINE ═══
const s7 = pptx.addSlide()
bg(s7, C.bg2)
accent(s7, C.emerald)
titleLine(s7, "الجدول الزمني للتطوير", C.emerald)
subtitle(s7, "من الإطلاق إلى الاكتمال الكامل — رحلة تحويل مطار إلى حديقة عالمية")

const tl = [
  {y:"2019", e:"إطلاق المشروع — 19 مارس — الملك سلمان يعلن المشروع بمبادرة من ولي العهد"},
  {y:"2020", e:"مرحلة التصميم — تشكيل فريق التصميم بقيادة Henning Larsen + Omrania"},
  {y:"2021", e:"بدء الأعمال الإنشائية — إعادة تأهيل الموقع وبدء التربة التجديدية"},
  {y:"2022", e:"الأعمال الهيكلية — الأنفاق والجسور والبنية التحتية للموقع"},
  {y:"2023", e:"الزراعة والتشجير — بدء زراعة الأشجار والنباتات — 93% من العقود الإنشائية"},
  {y:"2024", e:"تطوير المرافق — المجمع الملكي للفنون، المسرح الوطني، الابتكار لوب"},
  {y:"2025", e:"حائز على جائزة RIBA — فاز بجائزة المستقبل للهندسة المعمارية"},
  {y:"2026", e:"الافتتاح التدريجي — المرحلة الأولى (الحديقة الفنية) تفتح في أواخر 2026"},
  {y:"2027", e:"الاكتمال الجوهري — افتتاح معظم مرافق الحديقة"},
  {y:"2030", e:"الاكتمال الكامل — جميع المرافق التشغيلية والتجارية والسكنية"},
]
tl.forEach((t,i) => {
  const y = 1.5 + i * 0.55
  const clr = i === 7 || i === 8 ? C.gold : (i === 9 ? C.orange : C.light)
  s7.addShape(pptx.ShapeType.roundRect, { x:0.5, y, w:12.3, h:0.42, fill:{color:C.card2}, rectRadius:0.03 })
  s7.addText(t.y, { x:0.7, y:y+0.02, w:1, h:0.35, fontSize:10, color:C.emerald, fontFace:F, bold:true })
  s7.addShape(pptx.ShapeType.rect, { x:1.7, y:y+0.06, w:0.02, h:0.28, fill:{color:i<7?C.muted:C.gold} })
  s7.addText(t.e, { x:1.9, y:y+0.02, w:10.3, h:0.35, fontSize:10, color:clr, fontFace:F })
})
footer(s7, 7)

// ═══ 8 — MASTER PLAN ═══
const s8 = pptx.addSlide()
bg(s8, C.bg2)
accent(s8, C.emerald)
titleLine(s8, "المخطط الرئيسي — التصميم المعماري", C.emerald)
subtitle(s8, "فريق عالمي بقيادة Omrania + Henning Larsen + Gerber Architekten + Buro Happold")

// Design team
const teams = [
  {r:"المخطط الرئيسي", t:"Henning Larsen (الدنمارك) + Omrania (السعودية)"},
  {r:"التصميم التفصيلي", t:"Gerber Architekten + Buro Happold + Setec (مشروع مشترك)"},
  {r:"المنسق العام", t:"Omrania — استشاري التصميم الرئيسي للمشروع"},
  {r:"تصميم المناظر الطبيعية", t:"MVVA + SWA Group"},
  {r:"المجمع الملكي للفنون", t:"Bofill Taller de Arquitectura (إسبانيا)"},
  {r:"استشاري الإضاءة", t:"L-Plan"},
  {r:"العناصر المائية", t:"Wet Design"},
  {r:"التربة والزراعة", t:"SESL"},
]
teams.forEach((t,i) => {
  const y = 1.5 + i * 0.65
  s8.addShape(pptx.ShapeType.roundRect, { x:0.5, y, w:5.8, h:0.5, fill:{color:C.card2}, rectRadius:0.04 })
  s8.addShape(pptx.ShapeType.rect, { x:0.5, y, w:0.04, h:0.5, fill:{color:C.emerald} })
  s8.addText(t.r, { x:0.7, y, w:5.4, h:0.25, fontSize:9, color:C.muted, fontFace:F })
  s8.addText(t.t, { x:0.7, y:y+0.23, w:5.4, h:0.25, fontSize:9, color:C.light, fontFace:F })
})

// Master plan approach
const mpItems = [
  "مستوحى من أنظمة الوديان الإقليمية — شبكة من الوديان المتفرعة تتقارب نحو مساحة مفتوحة مركزية",
  "الغابة المركزية (Central Park) — قلب المشروع — 9.3 كم² من التضاريس المحوّلة",
  "الأصابع الخضراء — ممرات خضراء تمتد من الحديقة إلى المدينة المحيطة",
  "الابتكار لوب — ممشى دائري بطول 7.2 كم يربط جميع مرافق الحديقة",
  "منطقة الوادي — 1 كم² من العناصر المائية في قلب الحديقة",
  "مصاطب تضاريسية — تلال ومنحدرات مستوحاة من طبيعة نجد",
  "تكامل معماري — المباني تندمج مع المناظر الطبيعية وليس العكس",
]
mpItems.forEach((t,i) => {
  const y = 1.5 + i * 0.22
  s8.addText(`● ${t}`, { x:6.8, y:y, w:6, h:0.2, fontSize:8.5, color:C.light, fontFace:F })
})
footer(s8, 8)

// ═══ 9 — CENTRAL FOREST & GREEN SPACES ═══
const s9 = pptx.addSlide()
bg(s9, C.bg2)
accent(s9, C.emerald)
titleLine(s9, "الغابة المركزية والمساحات الخضراء", C.emerald)
subtitle(s9, "11+ كم² من المساحات الخضراء — رئة الرياض الجديدة")

const greenKpis = [
  {v:"11+", u:"كم²", l:"مساحات خضراء", c:C.emerald},
  {v:"1.1M", u:"شجرة", l:"في الغابة المركزية", c:C.emerald},
  {v:"30M", u:"نبات", l:"من 800 نوع", c:C.emerald},
  {v:"50%", u:"محلي", l:"نباتات أصيلة", c:C.emerald},
]
greenKpis.forEach((k,i) => kpiCard(s9, 0.5+i*3.1, 1.4, 2.7, 1.3, k.v, `${k.u} — ${k.l}`, k.c))

const gf = [
  "الغابة المركزية — 9.3 كم² من التضاريس المحولة — تلال، أودية، جداول، ومناخات دقيقة",
  "200 نوع نباتي موجود مسبقًا + 600 نوع جديد — 50% من النباتات من الأنواع المحلية المتأقلمة",
  "30 مليون نبات إجمالاً — من الزهور البرية إلى الأشجار العملاقة",
  "التربة التجديدية — 18.4 مليون م³ من خليط التربة الخصبة لتحويل الرمال الصحراوية",
  "الحديقة الإسلامية — تصميم تقليدي مستوحى من التراث المعماري الإسلامي",
  "الحدائق العمودية — جدران خضراء على واجهات المباني داخل الحديقة",
  "حديقة المتاهة — تجربة تفاعلية فريدة للزوار",
  "محمية الطيور والفراشات — موطن طبيعي للتنوع البيولوجي المحلي",
]
gf.forEach((t,i) => {
  const y = 3 + i * 0.48
  s9.addShape(pptx.ShapeType.rect, { x:0.5, y:y+0.04, w:0.04, h:0.22, fill:{color:C.emerald} })
  s9.addText(t, { x:0.8, y:y, w:12, h:0.35, fontSize:10.5, color:C.light, fontFace:F })
})
footer(s9, 9)

// ═══ 10 — INNOVATION LOOP ═══
const s10 = pptx.addSlide()
bg(s10, C.bg2)
accent(s10, C.teal)
titleLine(s10, "الابتكار لوب — ممشى دائري متكامل", C.teal)
subtitle(s10, "7.2 كم من المسار الدائري — شريان الحديقة الرئيسي")

const loopInfo = [
  "مسار دائري متعدد الاستخدامات بطول 7.2 كم — يلتف حول الغابة المركزية",
  "مخصص للمشي، الجري، ركوب الدراجات، والمركبات الكهربائية ذاتية القيادة",
  "يربط جميع مرافق الحديقة: المجمع الملكي للفنون، المسرح، المتاحف، المطاعم",
  "محطات توقف تفاعلية — نقاط معلومات، محطات استراحة، مناظر بانورامية",
  "إضاءة ذكية بتقنية LED — تتكيف مع حركة الزوار والوقت من اليوم",
  "ممرات منفصلة للمشاة والدراجات — آمنة ومريحة لجميع الأعمار",
  "نقاط تأجير دراجات وسكوترات كهربائية على طول المسار",
  "أكثر من 7 كم² من مسارات المشاة الإضافية داخل الحديقة",
]
loopInfo.forEach((t,i) => {
  const y = 1.5 + i * 0.65
  s10.addShape(pptx.ShapeType.roundRect, { x:0.5, y, w:12.3, h:0.5, fill:{color:C.card2}, rectRadius:0.04 })
  s10.addShape(pptx.ShapeType.rect, { x:0.5, y, w:0.05, h:0.5, fill:{color:C.teal} })
  s10.addText(t, { x:0.8, y:y+0.05, w:11.8, h:0.38, fontSize:11, color:C.light, fontFace:F })
})
footer(s10, 10)

// ═══ 11 — VALLEY & WATER FEATURES ═══
const s11 = pptx.addSlide()
bg(s11, C.bg2)
accent(s11, C.water)
titleLine(s11, "منطقة الوادي والعناصر المائية", C.water)
subtitle(s11, "1 كم² من الوادي — المسطحات المائية تغطي 300,000 م²")

const wf = [
  "منطقة الوادي — 1 كم² في قلب الحديقة — مستوحاة من أودية نجد الطبيعية",
  "جداول مائية جارية — نظام مائي متدفق بطول 3+ كم داخل الحديقة",
  "بحيرات تفاعلية — نوافير مائية رقمية — عروض ضوئية وصوتية",
  "300,000 م² من العناصر المائية موزعة في جميع أنحاء الحديقة",
  "جسور مشاه فوق الوادي — إطلالات بانورامية على المسطحات المائية",
  "نظام تبريد طبيعي — المسطحات المائية تخفض درجة الحرارة المحيطة 2-3 درجات",
  "مياه معالجة معاد تدويرها — نظام ري ذكي يغطي الحديقة بأكملها",
  "الحياة المائية — أنواع مختارة من الأسماك والنباتات المائية المحلية",
]
wf.forEach((t,i) => {
  const y = 1.5 + i * 0.65
  s11.addShape(pptx.ShapeType.roundRect, { x:0.5, y, w:12.3, h:0.5, fill:{color:C.card2}, rectRadius:0.04 })
  s11.addShape(pptx.ShapeType.rect, { x:0.5, y, w:0.05, h:0.5, fill:{color:C.water} })
  s11.addText(t, { x:0.8, y:y+0.05, w:11.8, h:0.38, fontSize:11, color:C.light, fontFace:F })
})
footer(s11, 11)

// ═══ 12 — ROYAL ARTS COMPLEX ═══
const s12 = pptx.addSlide()
bg(s12, C.bg3)
accent(s12, C.purple)
titleLine(s12, "المجمع الملكي للفنون", C.purple)
subtitle(s12, "تصميم Bofill Taller de Arquitectura — مركز ثقافي عالمي")

const rac = [
  "المجمع الملكي للفنون — أيقونة معمارية وثقافية في قلب الحديقة",
  "مساحات عرض عالمية — فنون تشكيلية، نحت، تصوير، فنون رقمية",
  "قاعات عرض متعددة — تستوعب المعارض الدولية الكبرى",
  "مركز للفنون الأدائية — مسرح داخلي، قاعة موسيقى، مساحات بروفة",
  "برامج فنية تعليمية — ورش عمل، محاضرات، برامج للإبداع الشبابي",
  "مطاعم ومقاهي فنية — تجربة ثقافية متكاملة للزوار",
  "استوديوهات فنانين — مساحات إقامة فنية للفنانين المحليين والعالميين",
  "حديقة النحت المفتوحة — منحوتات ضخمة في الهواء الطلق",
]
rac.forEach((t,i) => {
  const y = 1.5 + i * 0.6
  s12.addShape(pptx.ShapeType.rect, { x:0.5, y:y+0.04, w:0.04, h:0.22, fill:{color:C.purple} })
  s12.addText(t, { x:0.8, y, w:11.5, h:0.4, fontSize:11, color:C.light, fontFace:F })
})
footer(s12, 12)

// ═══ 13 — NATIONAL THEATER & MUSEUMS ═══
const s13 = pptx.addSlide()
bg(s13, C.bg3)
accent(s13, C.magenta)
titleLine(s13, "المسرح الوطني والمتاحف", C.magenta)
subtitle(s13, "5+ متاحف ومسرح وطني — وجهة ثقافية عالمية")

const tm = [
  "المسرح الوطني — مسرح رئيسي بسعة 2,000+ مقعد — عروض مسرحية وموسيقية عالمية",
  "متحف الأرض (Museum of the Earth) — يستعرض تاريخ الكوكب وتطور الحياة",
  "متحف التراث السعودي — رحلة عبر تاريخ المملكة وتراثها الثقافي",
  "متحف الفن الإسلامي — مخطوطات، فنون، وتحف من الحضارة الإسلامية",
  "متحف العلوم والتقنية — معارض تفاعلية للعلوم والتكنولوجيا والابتكار",
  "قاعة المعارض المؤقتة — معارض دولية متنقلة طوال العام",
  "السينما المفتوحة —露天 سينما في الهواء الطلق بسعة كبيرة",
  "المدرج الروماني — مدرج خارجي للحفلات والعروض الجماهيرية",
]
tm.forEach((t,i) => {
  const y = 1.5 + i * 0.65
  s13.addShape(pptx.ShapeType.roundRect, { x:0.5, y, w:12.3, h:0.5, fill:{color:C.card3}, rectRadius:0.04 })
  s13.addShape(pptx.ShapeType.rect, { x:0.5, y, w:0.05, h:0.5, fill:{color:C.magenta} })
  s13.addText(t, { x:0.8, y:y+0.05, w:11.8, h:0.38, fontSize:11, color:C.light, fontFace:F })
})
footer(s13, 13)

// ═══ 14 — RECREATION & ENTERTAINMENT ═══
const s14 = pptx.addSlide()
bg(s14, C.bg3)
accent(s14, C.purple)
titleLine(s14, "المرافق الترفيهية والعائلية", C.purple)
subtitle(s14, "مدينة ملاهي, حديقة مائية, مركز ترفيه عائلي — تجارب لجميع الأعمار")

const recKpis = [
  {v:"100,000", u:"م²", l:"مدينة الملاهي", c:C.orange},
  {v:"140,000", u:"م²", l:"الحديقة المائية", c:C.water},
  {v:"50,000", u:"م²", l:"المجمع الرياضي", c:C.emerald},
  {v:"280,000", u:"م²", l:"مواقف السيارات", c:C.muted},
]
recKpis.forEach((k,i) => kpiCard(s14, 0.5+i*3.1, 1.4, 2.7, 1.4, k.v, `${k.u} — ${k.l}`, k.c))

const rec = [
  "مدينة الملاهي (100,000 م²) — ألعاب ترفيهية عالمية — 40+ لعبة ومنطقة مغامرات",
  "الحديقة المائية (140,000 م²) — أكبر حديقة مائية في الرياض — شرائح، أمواج، أنهار كسولة",
  "مركز الترفيه العائلي (50,000 م²) — ألعاب تفاعلية، بولينج، تزلج جليدي، سينما 7D",
  "برج ومنصة مشاه — إطلالة 360° على الحديقة والمدينة — مطعم دوار",
  "جسر السماء (Skybridge) — ممشى زجاجي معلق على ارتفاع 100+ متر",
  "ساحة الأحداث الكبرى — مساحة مفتوحة للفعاليات والمهرجانات والحفلات الكبرى",
  "280,000 م² من مواقف السيارات — طاقة استيعابية تتجاوز 10,000 سيارة",
  "مساجد، مرافق صحية، أمنية، تعليمية واجتماعية — خدمات متكاملة",
]
rec.forEach((t,i) => {
  const y = 3.1 + i * 0.48
  s14.addShape(pptx.ShapeType.rect, { x:0.5, y:y+0.04, w:0.04, h:0.22, fill:{color:C.purple} })
  s14.addText(t, { x:0.8, y, w:12, h:0.35, fontSize:10.5, color:C.light, fontFace:F })
})
footer(s14, 14)

// ═══ 15 — SPORTS & GOLF ═══
const s15 = pptx.addSlide()
bg(s15, C.bg4)
accent(s15, C.orange)
titleLine(s15, "ملعب الجولف الملكي والمرافق الرياضية", C.orange)
subtitle(s15, "850,000 م² ملعب جولف — مرافق رياضية عالمية المستوى")

const sKpis = [
  {v:"850,000", u:"م²", l:"ملعب الجولف الملكي", c:C.orange},
  {v:"50,000", u:"م²", l:"المجمع الرياضي", c:C.orange},
  {v:"7.2", u:"كم", l:"مسار الجري الدائري", c:C.orange},
  {v:"1", u:"مركز", l:"القفز المظلي", c:C.orange},
]
sKpis.forEach((k,i) => kpiCard(s15, 0.5+i*3.1, 1.4, 2.7, 1.3, k.v, `${k.u} — ${k.l}`, k.c))

const spt = [
  "ملعب الجولف الملكي (850,000 م²) — 18 حفرة — تصميم عالمي — نادي جولف فاخر",
  "المجمع الرياضي المغطى (50,000 م²) — ملاعب كرة سلة، تنس، اسكواش، كرة طائرة",
  "مركز الفروسية — إسطبلات، ميدان فروسية، مسارات خيول بطول 15+ كم",
  "مركز القفز المظلي — منطقة هبوط وتدريب معتمدة دوليًا",
  "نادي الواقع الافتراضي — أحدث تقنيات VR في رياضة إلكترونية تفاعلية",
  "مسارات جري وركوب دراجات — متصلة بشبكة المسار الرياضي (135 كم)",
  "صالات لياقة بدنية — مراكز تدريب متكاملة على أعلى مستوى",
  "ملاعب كرة قدم متعددة — عشب طبيعي واصطناعي بمواصفات FIFA",
]
spt.forEach((t,i) => {
  const y = 3 + i * 0.48
  s15.addShape(pptx.ShapeType.rect, { x:0.5, y:y+0.04, w:0.04, h:0.22, fill:{color:C.orange} })
  s15.addText(t, { x:0.8, y, w:12, h:0.35, fontSize:10.5, color:C.light, fontFace:F })
})
footer(s15, 15)

// ═══ 16 — ISLAMIC & SPECIALTY GARDENS ═══
const s16 = pptx.addSlide()
bg(s16, C.bg4)
accent(s16, C.orange)
titleLine(s16, "الحدائق المتخصصة", C.orange)
subtitle(s16, "400,000 م² من الحدائق المتنوعة — تجارب طبيعية فريدة")

const sgs = [
  {t:"الحديقة الإسلامية", d:"تصميم تقليدي يستوحي عناصره من العمارة الإسلامية — نوافير، ظلال، نباتات عطرية، بلاط هندسي"},
  {t:"الحدائق العمودية", d:"جدران خضراء تغطي واجهات المباني — تقنية الزراعة الرأسية — تحسين جودة الهواء والعزل الحراري"},
  {t:"حديقة المتاهة", d:"متاهة طبيعية من النباتات — تجربة تفاعلية ممتعة — منطقة تصوير وإطلالات علوية"},
  {t:"محمية الطيور والفراشات", d:"موطن طبيعي محمي للطيور المحلية والمهاجرة — حضانة فراشات استوائية — مسارات مراقبة"},
  {t:"روضة المشتل الزائر", d:"مشتل تعليمي — يمكن للزوار تعلم الزراعة وزراعة النباتات بأنفسهم"},
  {t:"حدائق متنوعة 400,000 م²", d:"بساتين، حدائق ورود، حدائق أعشاب عطرية، حدائق صباريات — تنوع نباتي استثنائي"},
]
sgs.forEach((g,i) => {
  const y = 1.5 + i * 0.88
  s16.addShape(pptx.ShapeType.roundRect, { x:0.5, y, w:12.3, h:0.73, fill:{color:C.card4}, rectRadius:0.04 })
  s16.addShape(pptx.ShapeType.rect, { x:0.5, y, w:0.05, h:0.73, fill:{color:C.orange} })
  s16.addText(g.t, { x:0.8, y:y+0.03, w:11.5, h:0.28, fontSize:13, color:C.orange, fontFace:F, bold:true })
  s16.addText(g.d, { x:0.8, y:y+0.32, w:11.5, h:0.35, fontSize:10, color:C.light, fontFace:F })
})
footer(s16, 16)

// ═══ 17 — VISITOR PAVILION & TOWER ═══
const s17 = pptx.addSlide()
bg(s17, C.bg4)
accent(s17, C.orange)
titleLine(s17, "مركز الزوار والبرج والمزيد", C.orange)
subtitle(s17, "بوابة الحديقة — معالم بارزة تنتظر الزوار")

const vp = [
  "مركز الزوار — نقطة الانطلاق الرئيسية — معرض تفاعلي عن الحديقة وتاريخ الموقع ورحلة التطوير",
  "برج الحديقة — برج شاهق مع منصة مشاه 360° — إطلالة على الحديقة بالكامل وأفق الرياض",
  "جسر السماء — ممشى زجاجي يربط بين مبنى المبنى الرئيسي — تجربة مثيرة لعشاق المغامرة",
  "المطاعم والمقاهي — 50+ منفذ طعام موزعة في جميع أنحاء الحديقة — من المأكولات السريعة إلى الفاخرة",
  "منافذ البيع بالتجزئة — محلات تجارية، هدايا، تذكارات، منتجات حصرية للحديقة",
  "المكتبات العامة — مكتبات ثقافية داخل المجمع الفني — كتب، أبحاث، ورش قراءة",
  "Wi-Fi مجاني في جميع أنحاء الحديقة — تطبيق تفاعلي للملاحة والجولات الافتراضية",
  "مراكز الإسعافات الأولية والخدمات الأمنية — تغطية كاملة لجميع مناطق الحديقة",
]
vp.forEach((t,i) => {
  const y = 1.5 + i * 0.65
  s17.addShape(pptx.ShapeType.roundRect, { x:0.5, y, w:12.3, h:0.5, fill:{color:C.card4}, rectRadius:0.04 })
  s17.addShape(pptx.ShapeType.rect, { x:0.5, y, w:0.05, h:0.5, fill:{color:C.orange} })
  s17.addText(t, { x:0.8, y:y+0.05, w:11.8, h:0.38, fontSize:11, color:C.light, fontFace:F })
})
footer(s17, 17)

// ═══ 18 — GOLF & EQUESTRIAN ═══
const s18 = pptx.addSlide()
bg(s18, C.bg4)
accent(s18, C.sand)
titleLine(s18, "الجولف الملكي ومركز الفروسية", C.sand)
subtitle(s18, "رياضة وترفيه راقٍ في قلب الطبيعة")

const ge = [
  {t:"ملعب الجولف الملكي", items:["18 حفرة بطول 7,200 ياردة — تصميم عالمي", "نادي جولف فاخر — مطعم، سبا، غرف تبديل", "أكاديمية جولف للمبتدئين والمحترفين", "مساحات تدريب — driving range و putting green"]},
  {t:"مركز الفروسية الملكي", items:["إسطبلات تتسع لـ 100 حصان", "ميدان فروسية أولمبي", "مسارات خيول بطول 15+ كم في الحديقة", "أكاديمية فروسية — دروس لجميع المستويات"]},
]
ge.forEach((g,gi) => {
  const x = 0.5 + gi * 6.2
  s18.addShape(pptx.ShapeType.roundRect, { x, y:1.5, w:5.8, h:4.8, fill:{color:C.card4}, line:{color:C.sand, width:0.5}, rectRadius:0.08 })
  s18.addText(g.t, { x:x+0.2, y:1.6, w:5.4, h:0.4, fontSize:16, color:C.sand, fontFace:F, bold:true })
  g.items.forEach((it,i) => {
    s18.addShape(pptx.ShapeType.rect, { x:x+0.2, y:2.2+i*0.65, w:0.04, h:0.3, fill:{color:C.sand} })
    s18.addText(it, { x:x+0.4, y:2.2+i*0.65, w:5.2, h:0.45, fontSize:11, color:C.light, fontFace:F })
  })
})
footer(s18, 18)

// ═══ 19 — SUSTAINABILITY ═══
const s19 = pptx.addSlide()
bg(s19, C.bg2)
accent(s19, C.emerald)
titleLine(s19, "الاستدامة البيئية", C.emerald)
subtitle(s19, "تصميم مستدام — موارد متجددة — بصمة كربونية منخفضة")

const susKpis = [
  {v:"18.4M", u:"م³", l:"تربة تجديدية", c:C.emerald},
  {v:"100%", u:"مياه معالجة", l:"للري", c:C.water},
  {v:"50%", u:"نباتات", l:"محلية المنشأ", c:C.leaf},
  {v:"2-3°C", u:"تخفيض", l:"درجة الحرارة", c:C.blue},
]
susKpis.forEach((k,i) => kpiCard(s19, 0.5+i*3.1, 1.4, 2.7, 1.4, k.v, `${k.u} — ${k.l}`, k.c))

const sus = [
  "تحويل تربة الصحراء إلى تربة خصبة — 18.4 مليون م³ من خليط التربة المحسّن — يعمل كإسفنج لاحتجاز المياه",
  "الري بمياه الصرف الصحي المعالجة — 100% من احتياجات الري — محطة معالجة مخصصة داخل الموقع",
  "ألواح كهروضوئية — توليد طاقة متجددة لتشغيل مرافق الحديقة — تقليل الاعتماد على الشبكة العامة",
  "إعادة تدوير النفايات — نظام متكامل لإدارة النفايات — فرز، تدوير، تحويل عضوي",
  "إضاءة LED ذكية — تتكيف مع الحركة — توفير 60% من استهلاك الطاقة مقارنة بالإضاءة التقليدية",
  "مواد بناء مستدامة — 20% محتوى معاد تدويره — دهانات منخفضة المركبات العضوية المتطايرة",
  "العزل الحراري الطبيعي — الأسطح الخضراء والجدران العمودية تقلل اكتساب الحرارة",
  "شهادة LEED — جميع المباني الرئيسية مصممة وفق معايير الريادة في الطاقة والتصميم البيئي",
]
sus.forEach((t,i) => {
  const y = 3.1 + i * 0.48
  s19.addShape(pptx.ShapeType.rect, { x:0.5, y:y+0.04, w:0.04, h:0.2, fill:{color:C.emerald} })
  s19.addText(t, { x:0.8, y, w:12, h:0.35, fontSize:10, color:C.light, fontFace:F })
})
footer(s19, 19)

// ═══ 20 — PLANT DIVERSITY ═══
const s20 = pptx.addSlide()
bg(s20, C.bg2)
accent(s20, C.leaf)
titleLine(s20, "التنوع النباتي — 800 نوع و 1.1 مليون شجرة", C.leaf)
subtitle(s20, "50% محلي + 50% متكيف مناخيًا — أكبر غابة حضرية في المملكة")

// Plant chart
const plantData = [
  {name:"الأشجار", labels:["محلية", "مستوردة متكيفة"], values:[55, 45]},
]
s20.addChart(pptx.charts.PIE, plantData, {
  x:0.5, y:1.5, w:4.5, h:4.5,
  chartColors:[C.emerald, C.leaf],
  catAxisLabelColor:C.muted, catAxisLabelFontSize:10,
  showLegend:true, legendColor:C.white, legendFontSize:11,
  dataLabelFormatCode:'0"%"', dataLabelColor:C.white, dataLabelFontSize:11,
  plotArea:{fill:{color:C.dark}},
})

const pd = [
  "200 نوع نباتي موجود مسبقًا في الموقع — تم الحفاظ عليها وإعادة توطينها",
  "600 نوع نباتي جديد — تم اختيارها بعناية لتحمل الظروف المناخية القاسية",
  "55% من الأشجار من الأنواع المحلية المتأقلمة مع بيئة الرياض",
  "45% من الأشجار المستوردة المتكيفة — من مناطق مناخية مشابهة",
  "أكثر من 30 مليون نبات إجمالاً — تشمل الشجيرات، الأزهار، النباتات العطرية",
  "مشتل خاص للحديقة — إنتاج 70% من النباتات محليًا — تقليل البصمة الكربونية للنقل",
  "برنامج بحثي مستمر — مراقبة أداء النباتات وتكييفها مع المناخ المحلي",
  "مسارات تعليمية — لافتات تعريفية بجميع أنواع النباتات والموائل",
]
pd.forEach((t,i) => {
  const y = 1.5 + i * 0.48
  s20.addText(`● ${t}`, { x:5.5, y, w:7.3, h:0.38, fontSize:10, color:C.light, fontFace:F })
})
footer(s20, 20)

// ═══ 21 — WATER MANAGEMENT ═══
const s21 = pptx.addSlide()
bg(s21, C.bg2)
accent(s21, C.water)
titleLine(s21, "إدارة المياه والري الذكي", C.water)
subtitle(s21, "نظام ري متطور — مياه معالجة معاد تدويرها — استهلاك مسؤول")

const wi = [
  "محطة معالجة مياه مخصصة داخل الموقع — تعالج مياه الصرف الصحي البلدية لاستخدامها في الري",
  "100% من احتياجات الري من المياه المعاد تدويرها — صفر استخدام للمياه العذبة",
  "نظام ري ذكي — حساسات رطوبة التربة والطقس — تحكم آلي بكمية وتوقيت الري",
  "تخزين المياه — خزانات تحت الأرض بسعة 500,000 م³ — لتغطية فترات الذروة",
  "شبكة ري بالتنقيط — تغطي 100% من المساحات الخضراء — تقليل الفاقد إلى 5% فقط",
  "التربة التجديدية — خليط تربة مسامي يعمل كإسفنج — يحتفظ بالمياه ويطلقها ببطء",
  "إعادة تغذية المياه الجوفية — فائض مياه الري يعاد إلى الطبقات الجوفية",
  "توفير سنوي — أكثر من 40% من استهلاك المياه مقارنة بالري التقليدي في الرياض",
]
wi.forEach((t,i) => {
  const y = 1.5 + i * 0.65
  s21.addShape(pptx.ShapeType.roundRect, { x:0.5, y, w:12.3, h:0.52, fill:{color:C.card2}, rectRadius:0.04 })
  s21.addShape(pptx.ShapeType.rect, { x:0.5, y, w:0.05, h:0.52, fill:{color:C.water} })
  s21.addText(t, { x:0.8, y:y+0.05, w:11.8, h:0.38, fontSize:11, color:C.light, fontFace:F })
})
footer(s21, 21)

// ═══ 22 — TRANSPORT CONNECTIVITY ═══
const s22 = pptx.addSlide()
bg(s22, C.bg4)
accent(s22, C.gold2)
titleLine(s22, "الربط بشبكة النقل العام", C.gold2)
subtitle(s22, "5 محطات قطار + 10 محطات حافلات + 7 طرق رئيسية")

const tc = [
  {t:"قطار الرياض", d:"5 محطات (4 على الخط الأخضر + 1 على الخط الأحمر) — ربط مباشر من جميع أنحاء المدينة"},
  {t:"حافلات الرياض", d:"10 محطات حافلات — حافلات مغذية — ربط مع الأحياء السكنية المجاورة"},
  {t:"الطرق الرئيسية", d:"7 طرق رئيسية — أنفاق كبرى: أبو بكر الصديق (2,430 م) والعروبة (2,150 م)"},
  {t:"مواقف السيارات", d:"280,000 م² — 10,000+ موقف — Park & Ride لتشجيع استخدام النقل العام"},
  {t:"المسار الرياضي", d:"اتصال مباشر مع المسار الرياضي (135 كم) — شبكة مشي ودراجات متكاملة"},
  {t:"التنقل الذاتي", d:"مركبات كهربائية ذاتية القيادة داخل الحديقة — حافلات صغيرة كهربائية"},
]
tc.forEach((t,i) => {
  const y = 1.5 + i * 0.85
  s22.addShape(pptx.ShapeType.roundRect, { x:0.5, y, w:12.3, h:0.7, fill:{color:C.card4}, rectRadius:0.04 })
  s22.addShape(pptx.ShapeType.rect, { x:0.5, y, w:0.05, h:0.7, fill:{color:C.gold2} })
  s22.addText(t.t, { x:0.8, y:y+0.02, w:11.5, h:0.28, fontSize:13, color:C.gold2, fontFace:F, bold:true })
  s22.addText(t.d, { x:0.8, y:y+0.32, w:11.5, h:0.32, fontSize:10, color:C.light, fontFace:F })
})
footer(s22, 22)

// ═══ 23 — INVESTMENT OVERVIEW ═══
const s23 = pptx.addSlide()
bg(s23, C.bg4)
accent(s23, C.gold2)
titleLine(s23, "الاستثمار والتطوير العقاري", C.gold2)
subtitle(s23, "إجمالي الاستثمارات: 20+ مليار ريال — 5 مشاريع كبرى")

const invKpis = [
  {v:"20+", u:"مليار ريال", l:"إجمالي الاستثمارات", c:C.gold},
  {v:"14.2", u:"مليار ريال", l:"صندوقان عقاريان ($3.8B)", c:C.gold},
  {v:"3,700", u:"وحدة سكنية", l:"في الحي السكني", c:C.gold},
  {v:"300+", u:"مفتاح فندقي", l:"ضيافة فاخرة", c:C.gold},
]
invKpis.forEach((k,i) => kpiCard(s23, 0.5+i*3.1, 1.4, 2.7, 1.4, k.v, `${k.u} — ${k.l}`, k.c))

const inv = [
  "المنطقة السكنية — 3,700 وحدة سكنية + مدرسة K-12 + 300 مفتاح فندقي + 100,000 م² مكاتب Grade A",
  "المنطقة الثقافية — 600+ وحدة سكنية + 140+ غرفة فندقية + 50,000 م² مكاتب Grade A",
  "صندوق 1 (11 مليار ريال) — ائتلاف Kolaghassi + العثيم + RXR — بالقرب من محطة المترو",
  "صندوق 2 (3.2 مليار ريال) — ائتلاف Retal + أساسات + Bareeq — في المنطقة الثقافية",
  "مؤسسة حديقة الملك سلمان — مملوكة لصندوق الاستثمارات العامة (PIF)",
  "93% من العقود الإنشائية للمرافق الرئيسية قد تمت ترسيتها",
]
inv.forEach((t,i) => {
  const y = 3.1 + i * 0.6
  s23.addShape(pptx.ShapeType.rect, { x:0.5, y:y+0.04, w:0.04, h:0.22, fill:{color:C.gold} })
  s23.addText(t, { x:0.8, y, w:12, h:0.4, fontSize:11, color:C.light, fontFace:F })
})
footer(s23, 23)

// ═══ 24 — INVESTMENT DETAILS ═══
const s24 = pptx.addSlide()
bg(s24, C.bg4)
accent(s24, C.gold2)
titleLine(s24, "الفرص الاستثمارية — 5 مليار دولار", C.gold2)
subtitle(s24, "شراكات استراتيجية مع كبرى الشركات المحلية والعالمية")

const inv2 = [
  {p:"مولكيا للاستثمار + Kolaghassi", v:"11 مليار ريال", sec:"المنطقة السكنية — 3,700 وحدة + مدرسة K-12 + 300 مفتاح فندقي"},
  {p:"SAB Invest + Retal + أساسات", v:"3.2 مليار ريال", sec:"المنطقة الثقافية — 600 وحدة + 140 غرفة + 50,000 م² مكاتب"},
  {p:"RXR (الولايات المتحدة)", v:"شريك", sec:"مستثمر عقاري عالمي في المنطقة السكنية"},
  {p:"العثيم للاستثمار", v:"شريك", sec:"شريك استراتيجي في التطوير التجاري والسكني"},
]
inv2.forEach((i,idx) => {
  const y = 1.5 + idx * 1.25
  s24.addShape(pptx.ShapeType.roundRect, { x:0.5, y, w:12.3, h:1.05, fill:{color:C.card4}, line:{color:C.gold2, width:0.3}, rectRadius:0.06 })
  s24.addText(i.p, { x:0.8, y:y+0.05, w:6, h:0.3, fontSize:14, color:C.gold, fontFace:F, bold:true })
  s24.addText(i.v, { x:9.5, y:y+0.05, w:3, h:0.3, fontSize:13, color:C.orange, fontFace:F, bold:true, align:"right" })
  s24.addText(i.sec, { x:0.8, y:y+0.4, w:11.3, h:0.5, fontSize:11, color:C.light, fontFace:F })
})
s24.addText("• تم ترسية 93% من العقود الإنشائية • المؤسسة مملوكة بالكامل لصندوق الاستثمارات العامة (PIF)", { x:0.5, y:6.6, w:12, h:0.3, fontSize:11, color:C.muted, fontFace:F })
footer(s24, 24)

// ═══ 25 — ECONOMIC IMPACT ═══
const s25 = pptx.addSlide()
bg(s25, C.bg4)
accent(s25, C.orange)
titleLine(s25, "الأثر الاقتصادي", C.orange)
subtitle(s25, "عائد اقتصادي ضخم — آلاف الوظائف — تنشيط السياحة والاستثمار")

const ecKpis = [
  {v:"72B", u:"ريال", l:"تكلفة المشروع", c:C.orange},
  {v:"7,000+", u:"وظيفة", l:"فرصة عمل جديدة", c:C.orange},
  {v:"$19B", u:"عائد", l:"للرياض بحلول 2030", c:C.orange},
  {v:"20+", u:"مليار ريال", l:"استثمارات عقارية", c:C.orange},
]
ecKpis.forEach((k,i) => kpiCard(s25, 0.5+i*3.1, 1.4, 2.7, 1.4, k.v, `${k.u} — ${k.l}`, k.c))

const ec = [
  "7,000+ فرصة عمل جديدة مباشرة في التشغيل والصيانة والخدمات",
  "آلاف الوظائف غير المباشرة في قطاعات السياحة، التجزئة، المطاعم، والخدمات",
  "ارتفاع قيمة العقارات في المناطق المحيطة بالحديقة — جاذبية استثمارية عالية",
  "جذب السياح المحليين والدوليين — الرياض وجهة سياحية عالمية",
  "تحفيز القطاع الخاص — الشراكات مع المطورين والمستثمرين",
  "عائد اقتصادي يتجاوز 19 مليار دولار لمدينة الرياض بحلول 2030",
  "تعزيز الناتج المحلي الإجمالي من خلال الإنشاءات والتطوير والخدمات",
  "وفر في تكاليف الرعاية الصحية بفضل تحسين جودة الهواء ونمط الحياة الصحي",
]
ec.forEach((t,i) => {
  const y = 3.1 + i * 0.48
  s25.addShape(pptx.ShapeType.rect, { x:0.5, y:y+0.04, w:0.04, h:0.22, fill:{color:C.orange} })
  s25.addText(t, { x:0.8, y, w:12, h:0.35, fontSize:10.5, color:C.light, fontFace:F })
})
footer(s25, 25)

// ═══ 26 — ENVIRONMENTAL IMPACT ═══
const s26 = pptx.addSlide()
bg(s26, C.bg2)
accent(s26, C.emerald)
titleLine(s26, "الأثر البيئي — تحسين المناخ وجودة الهواء", C.emerald)
subtitle(s26, "خفض درجة الحرارة 1.5-2°C — زيادة الأكسجين — خفض CO₂")

const envKpis = [
  {v:"1.5-2°C", u:"تخفيض", l:"درجة حرارة الرياض", c:C.emerald},
  {v:"650", u:"GWh/سنة", l:"توفير استهلاك الطاقة", c:C.blue},
  {v:"28", u:"م²/فرد", l:"مساحة خضراء (من 1.7)", c:C.teal},
  {v:"9%", u:"مساحة خضراء", l:"(من 1.5% حاليًا)", c:C.leaf},
]
envKpis.forEach((k,i) => kpiCard(s26, 0.5+i*3.1, 1.4, 2.7, 1.4, k.v, `${k.u} — ${k.l}`, k.c))

// Environmental chart
const envChart = [
  {name:"م²/فرد", labels:["2020", "2026", "2030 (مستهدف)"], values:[1.7, 4.2, 28]},
]
s26.addChart(pptx.charts.BAR, envChart, {
  x:0.5, y:3.2, w:5.5, h:3.2,
  barGrouping:"clustered", barDir:"col",
  chartColors:[C.emerald],
  catAxisLabelColor:C.muted, catAxisLabelFontSize:9,
  valAxisLabelColor:C.muted, valAxisLabelFontSize:9,
  showLegend:false,
  dataLabelFormatCode:'#,##0', dataLabelColor:C.emerald, dataLabelFontSize:9,
  plotArea:{fill:{color:C.dark}},
})

const envTxt = [
  "زيادة نصيب الفرد من المساحات الخضراء 16 ضعفًا — من 1.7 م² إلى 28 م² بحلول 2030",
  "خفض استهلاك الطاقة 650 جيجاواط/ساعة سنويًا بفضل التبريد الطبيعي والغطاء النباتي",
  "امتصاص 3-6% من انبعاثات CO₂ في الرياض وتحسين جودة الهواء",
  "زيادة الرطوبة النسبية وتحسين المناخ المحلي في نطاق الحديقة والمناطق المحيطة",
  "موطن للتنوع البيولوجي — الحشرات، الطيور، الزواحف، والثدييات الصغيرة",
  "خفض الجزر الحرارية الحضرية — تأثير التبريد يمتد 2-3 كم خارج الحديقة",
]
envTxt.forEach((t,i) => {
  const y = 3.2 + i * 0.23
  s26.addText(`● ${t}`, { x:6.5, y, w:6.3, h:0.22, fontSize:8, color:C.light, fontFace:F })
})
footer(s26, 26)

// ═══ 27 — QUALITY OF LIFE ═══
const s27 = pptx.addSlide()
bg(s27, C.bg1)
accent(s27, C.sky)
titleLine(s27, "جودة الحياة والصحة المجتمعية", C.sky)
subtitle(s27, "مجتمع حيوي — نمط حياة صحي — بيئة إيجابية جاذبة")

const qol = [
  "مساحات مفتوحة للجميع — الحديقة متاحة 24 ساعة طوال أيام الأسبوع — دخول مجاني للمناطق العامة",
  "أنماط حياة صحية — مسارات جري وركوب دراجات — مرافق رياضية — تشجيع النشاط البدني اليومي",
  "برامج مجتمعية — فعاليات ثقافية، ورش عمل، أنشطة عائلية، مهرجانات موسمية",
  "مساحات للعب الأطفال — 17+ ملعب أطفال موزعة في جميع أنحاء الحديقة",
  "مناطق للاسترخاء والتأمل — مساحات هادئة، حدائق تأمل، مناطق ظليلة",
  "مرافق لذوي الاحتياجات الخاصة — تصميم شامل — مسارات كراسي متحركة — إرشاد صوتي",
  "تحسين الصحة العامة — الهواء النظيف، المساحات الخضراء، النشاط البدني — تقليل الأمراض المزمنة",
  "الحديقة كمساحة تلاقٍ اجتماعي — تجمع العائلات والأصدقاء — تعزيز النسيج الاجتماعي للمدينة",
]
qol.forEach((t,i) => {
  const y = 1.5 + i * 0.65
  s27.addShape(pptx.ShapeType.roundRect, { x:0.5, y, w:12.3, h:0.52, fill:{color:C.card1}, rectRadius:0.04 })
  s27.addShape(pptx.ShapeType.rect, { x:0.5, y, w:0.05, h:0.52, fill:{color:C.sky} })
  s27.addText(t, { x:0.8, y:y+0.05, w:11.8, h:0.38, fontSize:11, color:C.light, fontFace:F })
})
footer(s27, 27)

// ═══ 28 — TOURISM ═══
const s28 = pptx.addSlide()
bg(s28, C.bg1)
accent(s28, C.sky)
titleLine(s28, "السياحة والترفيه — وجهة عالمية", C.sky)
subtitle(s28, "أيقونة سياحية جديدة — جذب الزوار المحليين والدوليين")

const tur = [
  "وجهة سياحية رئيسية — من المتوقع استقطاب ملايين الزوار سنويًا من داخل المملكة وخارجها",
  "موسم الرياض — الحديقة ستكون أحد المواقع الرئيسية لفعاليات موسم الرياض السنوي",
  "إكسبو 2030 — الحديقة مرتبطة بشبكة النقل العام — وجهة رئيسية لزوار إكسبو",
  "السياحة الثقافية — المتاحف، المجمع الفني، المسرح الوطني — برنامج ثقافي على مدار العام",
  "سياحة المغامرات — القفز المظلي، الفروسية، الجولف، التسلق — تجارب متنوعة",
  "السياحة العائلية — مدينة الملاهي، الحديقة المائية، حديقة الفراشات — للكبار والصغار",
  "الضيافة الفاخرة — فنادق ومنتجعات داخل الحديقة — 300+ مفتاح فندقي في المنطقة السكنية",
  "المطاعم والتسوق — 50+ مطعمًا ومقهى — محلات تجارية — تجربة تسوق فريدة في الهواء الطلق",
]
tur.forEach((t,i) => {
  const y = 1.5 + i * 0.65
  s28.addShape(pptx.ShapeType.roundRect, { x:0.5, y, w:12.3, h:0.5, fill:{color:C.card1}, rectRadius:0.04 })
  s28.addShape(pptx.ShapeType.rect, { x:0.5, y, w:0.05, h:0.5, fill:{color:C.sky} })
  s28.addText(t, { x:0.8, y:y+0.05, w:11.8, h:0.38, fontSize:11, color:C.light, fontFace:F })
})
footer(s28, 28)

// ═══ 29 — FUTURE VISION ═══
const s29 = pptx.addSlide()
bg(s29, C.dark)
s29.addShape(pptx.ShapeType.rect, { x:0, y:2.5, w:13.33, h:0.06, fill:{color:C.gold} })
s29.addText("الرؤية المستقبلية — 2030 وما بعده", { x:1, y:0.5, w:11.33, h:0.7, fontSize:32, color:C.gold, fontFace:F, bold:true, align:"center" })
s29.addText("الحديقة الملكية تحول الرياض إلى واحدة من أفضل مدن العالم للعيش", { x:1, y:1.2, w:11.33, h:0.45, fontSize:15, color:C.muted, fontFace:F, align:"center" })

const fut = [
  "🏛️  نموذج عالمي — حديقة الملك سلمان نموذج يحتذى به للمدن المستدامة حول العالم",
  "🌳  رئة الرياض — 11+ كم² من المساحات الخضراء — تحسين جودة الهواء والمناخ للأجيال القادمة",
  "🏙️  تحول حضري — تحويل منطقة عسكرية مغلقة إلى وجهة عامة نابضة بالحياة",
  "💰  عائد استثمار — أكثر من 19 مليار دولار عائد اقتصادي — 7,000+ وظيفة",
  "🌐  وجهة عالمية — استقطاب 20+ مليون زائر سنويًا بحلول 2030",
  "♻️  استدامة — نموذج في إدارة الموارد — مياه معاد تدويرها — طاقة متجددة — تنوع بيولوجي",
  "🤝  شراكات — تعاون دولي مع كبرى المكاتب الهندسية والاستشارية العالمية",
  "🇸🇦  رؤية 2030 — المشروع يجسد طموح المملكة في مجتمع حيوي واقتصاد مزدهر",
]
fut.forEach((t,i) => {
  const y = 2.1 + i * 0.6
  s29.addText(t, { x:1.5, y, w:10.33, h:0.45, fontSize:13, color:C.light, fontFace:F })
})
footer(s29, 29)

// ═══ 30 — REFERENCES ═══
const s30 = pptx.addSlide()
bg(s30, C.dark)
accent(s30, C.muted)
s30.addText("المراجع والمصادر", { x:0.5, y:0.25, w:12, h:0.7, fontSize:28, color:C.gold, fontFace:F, bold:true })

const refs = [
  "مؤسسة حديقة الملك سلمان — kingsalmanpark.sa",
  "الهيئة الملكية لمدينة الرياض (RCRC) — مشاريع الرياض الأربعة الكبرى — rcrc.gov.sa",
  "رؤية المملكة 2030 — مشروع حديقة الملك سلمان — vision2030.gov.sa",
  "Gerber Architekten — King Salman Park — gerberarchitekten.de",
  "Buro Happold — King Salman Park — burohappold.com",
  "Omrania — King Salman Park Lead Design Consultant — omrania.com",
  "Henning Larsen — King Salman Park Masterplan — henninglarsen.com",
  "SWA Group — King Salman Park Landscape Design — swagroup.com",
  "ArchDaily — King Salman Park Advances Toward 2026 Opening — archdaily.com (فبراير 2026)",
  "AGBI — King Salman Park attracts $4bn for two projects — agbi.com (مارس 2026)",
  "Wikipedia — حديقة الملك سلمان — ar.wikipedia.org",
  "RIBA — King Salman Park — Future Project Winner 2025 — riba.org",
  "وزارة الشؤون البلدية والقروية — تنظيم مؤسسة حديقة الملك سلمان — laws.boe.gov.sa",
  "مجلة الجزيرة — حديقة الملك سلمان الرئة الخضراء لمدينة الرياض — أبريل 2024",
  "عقارماب — مشروع حديقة الملك سلمان: أكبر الحدائق في العالم — فبراير 2026",
  "برنامج الرياض الخضراء — Green Riyadh — rcrc.gov.sa",
  "المسار الرياضي — Sports Boulevard Foundation — sportsboulevard.sa",
  "الهيئة العامة للإحصاء (GASTAT) — بيانات سكان الرياض",
]
refs.forEach((r,i) => {
  const y = 1.2 + i * 0.32
  s30.addText(`• ${r}`, { x:0.5, y, w:12, h:0.28, fontSize:8, color:C.light, fontFace:F })
})
footer(s30, 30)

// ── Save ──
const outPath = "E:\\N8N\\scraper\\scraper2\\csi-ultimate\\King_Salman_Park_Report_2026.pptx"
pptx.writeFile({ fileName: outPath }).then(() => {
  console.log("✅ تم إنشاء العرض: " + outPath)
  const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1)
  console.log("   الحجم: " + sizeKB + " كيلوبايت")
  console.log("   30 شريحة — حديقة الملك سلمان")
}).catch(err => {
  console.error("❌ خطأ:", err.message)
  process.exit(1)
})
