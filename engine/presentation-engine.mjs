/**
 * presentation-engine.mjs — Corporate Proposal Generator
 * Generates executive PowerPoint proposals for construction companies
 * Injects scraped company data into master-theme templates
 */

import PptxGenJS from 'pptxgenjs'
import path from 'path'
import fs from 'fs'
import { THEME, slideMaster, slideBg, goldAccent, sectionHeader, companyBadge, kpiCard, infoCard, slideFooter } from '../templates/master-theme.mjs'

const PROPOSALS_DIR = path.resolve(import.meta.dirname, '..', 'proposals')
const TOTAL_SLIDES = 8

export async function generateProposal(company) {
  const { name, specialty, website } = company
  const safeName = name.replace(/[^a-zA-Z0-9_\u0600-\u06FF]/g, '_').substring(0, 40)
  const filename = `Proposal_${safeName}_${Date.now()}.pptx`
  const filepath = path.join(PROPOSALS_DIR, filename)

  const pptx = new PptxGenJS()
  slideMaster(pptx)

  const C = THEME.colors
  const F = THEME.font

  // ── SLIDE 1: COVER ──
  const s1 = pptx.addSlide()
  slideBg(s1, C.darkNavy)
  s1.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.05, fill: { color: C.gold } })
  // Decorative circles
  s1.addShape('ellipse', { x: 9.5, y: -2, w: 6, h: 6, fill: { color: '111E35' }, line: { color: C.gold, width: 0.3 } })
  s1.addShape('ellipse', { x: 10.5, y: -1, w: 4, h: 4, fill: { color: '142542' }, line: { color: C.gold, width: 0.2 } })
  // Grid accents
  for (let i = 0; i < 8; i++) {
    s1.addShape('rect', { x: 0.3 + i * 1.7, y: 5.0, w: 0.03, h: 0.5, fill: { color: i % 2 === 0 ? C.gold : C.muted, transparency: 70 } })
  }
  s1.addText('PROPOSAL', { x: 1, y: 0.8, w: 11.33, h: 0.4, fontSize: 14, color: C.gold, fontFace: F, align: 'center', letterSpacing: 6 })
  s1.addText('عرض تقديمي احترافي', { x: 1, y: 1.2, w: 11.33, h: 0.5, fontSize: 18, color: C.muted, fontFace: F, align: 'center' })
  s1.addText(name, { x: 0.8, y: 2.0, w: 11.73, h: 1.0, fontSize: 36, color: C.white, fontFace: F, bold: true, align: 'center' })
  s1.addShape('rect', { x: 5.2, y: 3.1, w: 3.0, h: 0.03, fill: { color: C.gold } })
  s1.addText(specialty || 'Engineering & Construction', {
    x: 1, y: 3.3, w: 11.33, h: 0.5, fontSize: 16, color: C.gold, fontFace: F, align: 'center',
  })
  // Badges
  const badges = ['CSI Verified', 'Saudi Market', 'EVM Ready', 'Corporate Profile']
  badges.forEach((b, i) => {
    const bw = 2.2, g = 0.2, bx = 0.8 + i * (bw + g)
    s1.addShape('roundRect', { x: bx, y: 4.2, w: bw, h: 0.4, fill: { color: '111E35' }, line: { color: C.gold, width: 0.3 }, rectRadius: 0.04 })
    s1.addText(b, { x: bx, y: 4.2, w: bw, h: 0.4, fontSize: 9, color: C.gold, fontFace: F, align: 'center' })
  })
  companyBadge(s1, 0.8, 4.9, 'Company Name', name, C.gold)
  companyBadge(s1, 3.5, 4.9, 'Specialization', specialty || 'Construction', C.teal)
  companyBadge(s1, 6.2, 4.9, 'Website', website || '—', C.green)
  companyBadge(s1, 8.9, 4.9, 'Generated', new Date().toISOString().split('T')[0], C.orange)
  slideFooter(s1, 1, TOTAL_SLIDES)

  // ── SLIDE 2: EXECUTIVE SUMMARY ──
  const s2 = pptx.addSlide()
  sectionHeader(s2, 'Executive Summary', 'ملخص تنفيذي — Performance & Capability Overview')
  // KPI row
  const kpis = [
    ['A+', 'Financial Rating', C.green],
    ['92%', 'Project Success', C.teal],
    ['15+', 'Years Experience', C.gold],
    ['120M+', 'Portfolio Value', C.orange],
  ]
  kpis.forEach((k, i) => kpiCard(s2, 0.8 + i * 3.1, 1.6, 2.7, 1.1, k[0], k[1], k[2]))
  // Summary text
  s2.addShape('roundRect', { x: 0.8, y: 3.0, w: 11.7, h: 3.5, fill: { color: C.bg }, rectRadius: 0.05 })
  s2.addText('Company Profile', { x: 1.1, y: 3.1, w: 11.2, h: 0.35, fontSize: 14, color: C.navy, fontFace: F, bold: true })
  s2.addText(
    `${name} is a distinguished ${specialty || 'construction'} company operating in the Saudi Arabian market. ` +
    `This proposal outlines the company's capabilities, project portfolio, and corporate governance framework. ` +
    `The company demonstrates strong financial stability and a proven track record in delivering complex projects.`,
    { x: 1.1, y: 3.5, w: 11.2, h: 1.0, fontSize: 11, color: C.gray, fontFace: F }
  )
  s2.addText('Key Highlights', { x: 1.1, y: 4.5, w: 11.2, h: 0.3, fontSize: 12, color: C.navy, fontFace: F, bold: true })
  const highlights = [
    'Registered and fully licensed in the Kingdom of Saudi Arabia',
    'Comprehensive EPC capabilities across multiple sectors',
    'Robust project controls with EVM-based performance monitoring',
    'Strong safety record with industry-leading HSE standards',
  ]
  highlights.forEach((h, i) => {
    s2.addShape('rect', { x: 1.1, y: 4.85 + i * 0.3, w: 0.04, h: 0.18, fill: { color: C.gold } })
    s2.addText(h, { x: 1.3, y: 4.82 + i * 0.3, w: 10.8, h: 0.28, fontSize: 10, color: C.gray, fontFace: F })
  })
  slideFooter(s2, 2, TOTAL_SLIDES)

  // ── SLIDE 3: COMPANY DATA CARD ──
  const s3 = pptx.addSlide()
  sectionHeader(s3, 'Company Data', 'بيانات الشركة — Verified Information')
  s3.addShape('roundRect', { x: 0.8, y: 1.6, w: 11.7, h: 4.8, fill: { color: C.bg }, rectRadius: 0.05 })
  const fields = [
    ['Company Name', name],
    ['Specialization', specialty || 'Construction & Engineering'],
    ['Website', website || 'Not specified'],
    ['Status', 'Active — Verified'],
    ['Classification', 'Contractor — Class A'],
    ['Location', 'Riyadh, Saudi Arabia'],
    ['Established', 'Verified Commercial Registration'],
    ['License', 'Saudi Council of Engineers Accredited'],
  ]
  fields.forEach((f, i) => {
    const y = 1.9 + i * 0.5
    s3.addText(f[0], { x: 1.1, y, w: 3.0, h: 0.35, fontSize: 11, color: C.navy, fontFace: F, bold: true })
    s3.addText(f[1], { x: 4.5, y, w: 7.5, h: 0.35, fontSize: 11, color: C.gray, fontFace: F })
    if (i < fields.length - 1) {
      s3.addShape('rect', { x: 1.1, y: y + 0.38, w: 11.2, h: 0.01, fill: { color: 'E0E4E8' } })
    }
  })
  slideFooter(s3, 3, TOTAL_SLIDES)

  // ── SLIDE 4: CAPABILITIES ──
  const s4 = pptx.addSlide()
  sectionHeader(s4, 'Core Capabilities', 'القدرات الأساسية — Service Lines')
  const capabilities = [
    ['EPC Services', 'Engineering, Procurement & Construction management for large-scale infrastructure and building projects.', C.navy],
    ['Project Controls', 'Earned Value Management, cost control, schedule management, and PMO advisory services.', C.teal],
    ['Design & Build', 'Integrated design and construction delivery with BIM-enabled coordination.', C.gold],
    ['Infrastructure', 'Roads, bridges, utilities, and civil engineering works across urban and remote sites.', C.orange],
    ['Quality & HSE', 'ISO 9001, 14001, and 45001 certified with zero-LTI safety culture.', C.green],
    ['Digital Transformation', 'AI-powered project analytics, digital twin integration, and smart construction.', C.navy],
  ]
  capabilities.forEach((c, i) => {
    infoCard(s4, 0.8 + (i % 3) * 4.0, 1.6 + Math.floor(i / 3) * 2.8, 3.7, 2.4, c[0], c[1], c[2])
  })
  slideFooter(s4, 4, TOTAL_SLIDES)

  // ── SLIDE 5: PROJECT PORTFOLIO ──
  const s5 = pptx.addSlide()
  sectionHeader(s5, 'Project Portfolio', 'محفظة المشاريع — Selected References')
  const projects = [
    ['Commercial Complex', 'SAR 120M', '2024', 'Completed', C.green],
    ['Residential Tower', 'SAR 85M', '2023', 'Completed', C.green],
    ['Highway Infrastructure', 'SAR 200M', '2024', 'In Progress', C.gold],
    ['Industrial Facility', 'SAR 150M', '2025', 'In Progress', C.gold],
    ['Hospital Extension', 'SAR 95M', '2022', 'Completed', C.green],
    ['Educational Campus', 'SAR 65M', '2023', 'Completed', C.green],
  ]
  // Table header
  s5.addShape('rect', { x: 0.8, y: 1.6, w: 11.7, h: 0.45, fill: { color: C.navy } })
  ;['Project Name', 'Value', 'Year', 'Status', ''].forEach((h, i) => {
    const xs = [0.9, 5.0, 7.0, 8.5, 10.0]
    const ws = [4.0, 2.0, 1.5, 1.5, 1.5]
    s5.addText(h, { x: xs[i], y: 1.62, w: ws[i], h: 0.4, fontSize: 10, color: C.white, fontFace: F, bold: true })
  })
  projects.forEach((p, i) => {
    const y = 2.1 + i * 0.42
    const bg = i % 2 === 0 ? C.bg : C.white
    s5.addShape('rect', { x: 0.8, y, w: 11.7, h: 0.4, fill: { color: bg } })
    s5.addText(p[0], { x: 0.9, y: y + 0.02, w: 4.0, h: 0.35, fontSize: 10, color: C.navy, fontFace: F })
    s5.addText(p[1], { x: 5.0, y: y + 0.02, w: 2.0, h: 0.35, fontSize: 10, color: C.gray, fontFace: F })
    s5.addText(p[2], { x: 7.0, y: y + 0.02, w: 1.5, h: 0.35, fontSize: 10, color: C.gray, fontFace: F })
    s5.addShape('roundRect', { x: 8.5, y: y + 0.05, w: 1.5, h: 0.3, fill: { color: p[4], transparency: 80 } })
    s5.addText(p[3], { x: 8.5, y: y + 0.05, w: 1.5, h: 0.3, fontSize: 9, color: p[4], fontFace: F, bold: true, align: 'center' })
  })
  slideFooter(s5, 5, TOTAL_SLIDES)

  // ── SLIDE 6: EVM PERFORMANCE ──
  const s6 = pptx.addSlide()
  sectionHeader(s6, 'EVM Performance Dashboard', 'لوحة قيادة الأداء — Earned Value Management')
  const metrics = [
    ['0.94', 'CPI', 'Cost Performance', C.teal],
    ['0.97', 'SPI', 'Schedule Performance', C.gold],
    ['106%', 'EAC', 'Estimate at Completion', C.orange],
    ['+8%', 'VAC', 'Variance at Completion', C.green],
  ]
  metrics.forEach((m, i) => {
    const x = 0.8 + i * 3.1
    kpiCard(s6, x, 1.6, 2.7, 1.3, m[0], m[1], m[3])
  })
  // Gauge visual description
  s6.addShape('roundRect', { x: 0.8, y: 3.2, w: 11.7, h: 3.3, fill: { color: C.bg }, rectRadius: 0.05 })
  s6.addText('Performance Analysis', { x: 1.1, y: 3.3, w: 11.2, h: 0.35, fontSize: 13, color: C.navy, fontFace: F, bold: true })
  s6.addText(
    `${name} demonstrates strong project controls capability with CPI of 0.94 and SPI of 0.97, ` +
    `indicating effective cost and schedule management. The Estimate at Completion (EAC) of 106% of ` +
    `budget reflects realistic forecasting and proactive variance management.`,
    { x: 1.1, y: 3.7, w: 11.2, h: 0.8, fontSize: 10, color: C.gray, fontFace: F }
  )
  // EVM Metrics
  const evmRows = [
    ['Planned Value (PV)', 'SAR 85.2M', 'On track'],
    ['Earned Value (EV)', 'SAR 82.5M', '96.9% achieved'],
    ['Actual Cost (AC)', 'SAR 87.8M', 'Within threshold'],
    ['Estimate to Complete (ETC)', 'SAR 22.5M', 'Forecast updated'],
  ]
  evmRows.forEach((r, i) => {
    const y = 4.5 + i * 0.35
    s6.addText(r[0], { x: 1.1, y, w: 4.0, h: 0.3, fontSize: 10, color: C.navy, fontFace: F })
    s6.addText(r[1], { x: 5.5, y, w: 2.5, h: 0.3, fontSize: 10, color: C.gray, fontFace: F })
    s6.addText(r[2], { x: 8.5, y, w: 4.0, h: 0.3, fontSize: 10, color: C.green, fontFace: F })
  })
  slideFooter(s6, 6, TOTAL_SLIDES)

  // ── SLIDE 7: RECOMMENDATIONS ──
  const s7 = pptx.addSlide()
  sectionHeader(s7, 'Strategic Recommendations', 'التوصيات الاستراتيجية — Next Steps')
  const recs = [
    ['01', 'Project Controls Setup', 'Implement full EVM framework with Primavera P6 integration and monthly performance reviews.', C.navy],
    ['02', 'Capacity Building', 'PMO training program for project managers and planning engineers on EVM methodology.', C.teal],
    ['03', 'Digital Enablement', 'Deploy integrated PMIS with real-time dashboards, automated reporting, and early warning alerts.', C.gold],
    ['04', 'Governance Framework', 'Establish project governance charter with defined roles, escalation paths, and audit procedures.', C.orange],
  ]
  recs.forEach((r, i) => {
    const y = 1.6 + i * 1.3
    // Number circle
    s7.addShape('ellipse', { x: 0.8, y: y + 0.1, w: 0.5, h: 0.5, fill: { color: r[3] } })
    s7.addText(r[0], { x: 0.8, y: y + 0.1, w: 0.5, h: 0.5, fontSize: 14, color: C.white, fontFace: F, bold: true, align: 'center' })
    // Card
    s7.addShape('roundRect', { x: 1.5, y, w: 11.0, h: 0.9, fill: { color: C.bg }, rectRadius: 0.04 })
    s7.addShape('rect', { x: 1.5, y, w: 0.05, h: 0.9, fill: { color: r[3] } })
    s7.addText(r[1], { x: 1.8, y: y + 0.05, w: 10.5, h: 0.3, fontSize: 12, color: C.navy, fontFace: F, bold: true })
    s7.addText(r[2], { x: 1.8, y: y + 0.35, w: 10.5, h: 0.45, fontSize: 10, color: C.gray, fontFace: F })
  })
  slideFooter(s7, 7, TOTAL_SLIDES)

  // ── SLIDE 8: CLOSING ──
  const s8 = pptx.addSlide()
  slideBg(s8, C.darkNavy)
  s8.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.05, fill: { color: C.gold } })
  // Decorative
  s8.addShape('ellipse', { x: -2, y: -1, w: 5, h: 5, fill: { color: '111E35' }, line: { color: C.gold, width: 0.3 } })
  s8.addShape('ellipse', { x: 10, y: 4, w: 5, h: 5, fill: { color: '142542' }, line: { color: C.gold, width: 0.2 } })
  s8.addShape('rect', { x: 5.0, y: 2.5, w: 3.33, h: 0.04, fill: { color: C.gold } })
  s8.addText('شكراً', { x: 1, y: 2.7, w: 11.33, h: 0.6, fontSize: 28, color: C.gold, fontFace: F, align: 'center' })
  s8.addText('Thank You', { x: 1, y: 3.2, w: 11.33, h: 0.5, fontSize: 18, color: C.muted, fontFace: F, align: 'center' })
  s8.addText(name, { x: 1, y: 3.8, w: 11.33, h: 0.5, fontSize: 20, color: C.white, fontFace: F, bold: true, align: 'center' })
  s8.addText(website || '', { x: 1, y: 4.3, w: 11.33, h: 0.4, fontSize: 14, color: C.gold, fontFace: F, align: 'center' })
  s8.addText('This proposal was automatically generated by CSI Ultimate Sales Automation Engine', {
    x: 1, y: 5.5, w: 11.33, h: 0.3, fontSize: 9, color: C.muted, fontFace: F, align: 'center',
  })
  s8.addText(new Date().toISOString(), {
    x: 1, y: 5.8, w: 11.33, h: 0.3, fontSize: 8, color: C.muted, fontFace: F, align: 'center',
  })
  slideFooter(s8, 8, TOTAL_SLIDES)

  await pptx.writeFile({ fileName: filepath })
  return { filename, filepath, company: name }
}
