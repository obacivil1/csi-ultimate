/**
 * master-theme.mjs — Corporate Master Theme for Proposal Generation
 * McKinsey / Deloitte / PMI consulting style
 * Used by presentation-engine.mjs
 */

export const THEME = {
  layout: { name: 'WIDE', width: 13.33, height: 7.5 },
  font: 'Arial',
  fontLight: 'Arial',
  colors: {
    navy:     '1B2A4A',
    darkNavy: '111E35',
    gold:     'C8962E',
    teal:     '1A8A9E',
    white:    'FFFFFF',
    light:    'D0D5DD',
    muted:    '78909C',
    gray:     '95A5A6',
    red:      'C0392B',
    green:    '27AE60',
    orange:   'E67E22',
    darkRed:  '8E1B1B',
    bg:       'F4F6F9',
    card:     'F8F9FB',
  },
}

export function slideMaster(pptx) {
  pptx.defineLayout(THEME.layout)
  pptx.layout = THEME.layout.name
  pptx.author = 'CSI Ultimate — Sales Automation Engine'
  pptx.company = 'CSI Ultimate'
  pptx.subject = 'Corporate Proposal'
}

/**
 * Slide background with optional overlay
 */
export function slideBg(slide, color, opacity) {
  slide.addShape('rect', {
    x: 0, y: 0, w: THEME.layout.width, h: THEME.layout.height,
    fill: { color: color || THEME.colors.darkNavy, transparency: opacity || 0 },
  })
}

/**
 * Gold accent line — left edge
 */
export function goldAccent(slide, x, y, w, h) {
  slide.addShape('rect', {
    x: x || 0, y: y || 0,
    w: w || 0.08, h: h || THEME.layout.height,
    fill: { color: THEME.colors.gold },
  })
}

/**
 * Section header: gold bar + title + subtitle
 */
export function sectionHeader(slide, title, subtitle) {
  slide.addShape('rect', {
    x: 0, y: 0, w: THEME.layout.width, h: THEME.layout.height,
    fill: { color: THEME.colors.white },
  })
  goldAccent(slide)
  slide.addShape('rect', {
    x: 0.8, y: 0.4, w: 0.6, h: 0.04,
    fill: { color: THEME.colors.gold },
  })
  slide.addText(title, {
    x: 0.8, y: 0.55, w: 11.5, h: 0.6,
    fontSize: 24, color: THEME.colors.navy, fontFace: THEME.font, bold: true,
  })
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.8, y: 1.1, w: 11.5, h: 0.35,
      fontSize: 12, color: THEME.colors.muted, fontFace: THEME.fontLight,
    })
  }
}

/**
 * Company data card — used on cover slide
 */
export function companyBadge(slide, x, y, label, value, color) {
  slide.addShape('roundRect', {
    x, y, w: 2.5, h: 1.2,
    fill: { color: THEME.colors.darkNavy },
    line: { color: color || THEME.colors.gold, width: 0.5 },
    rectRadius: 0.06,
  })
  slide.addText(label, {
    x: x + 0.1, y: y + 0.05, w: 2.3, h: 0.35,
    fontSize: 8, color: THEME.colors.muted, fontFace: THEME.fontLight,
  })
  slide.addText(String(value), {
    x: x + 0.1, y: y + 0.4, w: 2.3, h: 0.6,
    fontSize: 18, color: color || THEME.colors.gold, fontFace: THEME.font, bold: true,
  })
}

/**
 * KPI Card
 */
export function kpiCard(slide, x, y, w, h, value, label, color) {
  slide.addShape('roundRect', {
    x, y, w, h,
    fill: { color: THEME.colors.bg },
    line: { color: color || THEME.colors.gold, width: 0.5 },
    rectRadius: 0.05,
  })
  slide.addText(String(value), {
    x, y: y + 0.05, w, h: h * 0.5,
    fontSize: 22, color: color || THEME.colors.navy, fontFace: THEME.font, bold: true, align: 'center',
  })
  slide.addText(label, {
    x, y: y + h * 0.5, w, h: h * 0.4,
    fontSize: 9, color: THEME.colors.gray, fontFace: THEME.fontLight, align: 'center',
  })
}

/**
 * Info card with icon dot
 */
export function infoCard(slide, x, y, w, h, title, body, color) {
  slide.addShape('roundRect', {
    x, y, w, h,
    fill: { color: THEME.colors.bg },
    rectRadius: 0.04,
  })
  slide.addShape('rect', {
    x, y, w: 0.05, h,
    fill: { color: color || THEME.colors.gold },
  })
  slide.addText(title, {
    x: x + 0.15, y: y + 0.05, w: w - 0.25, h: 0.35,
    fontSize: 11, color: THEME.colors.navy, fontFace: THEME.font, bold: true,
  })
  slide.addText(body, {
    x: x + 0.15, y: y + 0.38, w: w - 0.25, h: h - 0.45,
    fontSize: 9, color: THEME.colors.gray, fontFace: THEME.fontLight,
  })
}

/**
 * Footer with slide number
 */
export function slideFooter(slide, num, total) {
  slide.addShape('rect', {
    x: 0, y: 7.1, w: THEME.layout.width, h: 0.4,
    fill: { color: THEME.colors.darkNavy },
  })
  slide.addText(`CSI Ultimate  |  Sales Proposal`, {
    x: 0.3, y: 7.12, w: 8, h: 0.3,
    fontSize: 8, color: THEME.colors.muted, fontFace: THEME.fontLight,
  })
  slide.addText(`${num}/${total}`, {
    x: 11.8, y: 7.12, w: 0.8, h: 0.3,
    fontSize: 8, color: THEME.colors.muted, fontFace: THEME.font, align: 'center',
  })
}

export default THEME
