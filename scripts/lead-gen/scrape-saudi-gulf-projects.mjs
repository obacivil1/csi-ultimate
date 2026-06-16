import fs from 'fs';
import { resolve } from 'path';
import xml2js from 'xml2js';

const RSS_BASE = 'https://saudigulfprojects.com/feed/';
const OUTPUT = resolve('data/saudi_gulf_projects.json');
const PROGRESS = resolve('data/saudi_gulf_progress.json');
const MAX_PAGES = 300;

const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchFeed(page) {
  const url = page === 1 ? RSS_BASE : `${RSS_BASE}?paged=${page}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) return null;
  const xml = await r.text();
  const parsed = await parser.parseStringPromise(xml);
  const items = parsed?.rss?.channel?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

function stripHTML(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim();
}

const SAUDI_CITIES = /(?:in|في)\s+(Riyadh|Jeddah|Makkah|Madinah|Medina|Dammam|Tabuk|Abha|Hail|Najran|Jazan|Taif|Yanbu|Jubail|Buraidah|Al-Khobar|Khobar|Dhahran|Al-Ahsa|Hofuf|Al-Kharj|Qatif|Arar|Sakaka|Al-Bahah|NEOM|Diriyah|Jazan|Ras Al-Khair|Ras Tanura|Turaif|Umluj|Wadi Ad-Dawasir|Zulfi)\b/gi;

const SAUDI_KW = /Saudi\s+Arabia|الرياض|جدة|مكة|المدينة|الدمام|تبوك|King\s+Salman|King\s+Abdullah|NEOM|نيوم|Roshn|ACWA|Aramco|PIF|Public\s+Investment\s+Fund|Red\s+Sea|Diriyah|Qiddiya|Misk|Royal\s+Commission|Ministry\s+of|Riyadh\s+Metro|Mashroat|MODON|National\s+Industrial/gi;

function extractValue(text) {
  const patterns = [
    /((?:SAR|SR|USD|US\s?\$)\s*[\d,.]+\s*(?:billion|million|bn|mn|B|M|trillion))/gi,
    /([\d,.]+\s*(?:billion|million|bn|mn|B|M|trillion))\s*(?:SAR|USD|\$|ريال|دولار)/gi,
    /(\d+[.,]?\d*)\s*(بليون|مليار|مليون|ألف)\s*(ريال|دولار)/gi,
  ];
  for (const pat of patterns) { const m = stripHTML(text).match(pat); if (m) return m[0].trim(); }
  return null;
}

function extractLocation(text) {
  const m = text.match(SAUDI_CITIES);
  if (m) return m[1];
  if (/NEOM|نيوم/i.test(text)) return 'NEOM';
  return null;
}

const SECTOR_KEYWORDS = [
  [/power|energy|electricity|solar|wind|renewable/i, 'Power'],
  [/water|desalination|wastewater|sewage|irrigation/i, 'Water'],
  [/oil|gas|petroleum|refinery|petrochemical|hydrocarbon/i, 'Oil & Gas'],
  [/transport|road|rail|metro|bridge|tunnel|airport|port|logistics/i, 'Transport'],
  [/manufacturing|factory|industrial/i, 'Manufacturing'],
  [/hotel|tourism|hospitality|resort|entertainment/i, 'Tourism'],
  [/mining|mine|mineral/i, 'Mining'],
  [/data\s*center|cloud|digital|ai\b|technology|tech\b|telecom/i, 'Technology'],
  [/real\s*estate|residential|commercial|mixed-use|housing|villa|apartment/i, 'Real Estate'],
  [/mega|giga|giant|large-scale/i, 'Megaprojects'],
  [/construction|building|infrastructure|development|civil/i, 'Construction'],
];

function determineSector(text, categories) {
  const catTags = categories.map(c => c.toLowerCase().replace(/\s+/g, '-'));
  const mapping = { 'construction': 'Construction', 'transport': 'Transport', 'power': 'Power', 'water': 'Water', 'tourism': 'Tourism', 'real-estate': 'Real Estate', 'technology': 'Technology', 'oil-gas': 'Oil & Gas', 'mega-projects': 'Megaprojects' };
  for (const tag of catTags) { for (const [key, val] of Object.entries(mapping)) { if (tag.includes(key)) return val; } }
  for (const [regex, sector] of SECTOR_KEYWORDS) { if (regex.test(text)) return sector; }
  return 'General';
}

const REGION_MAP = {
  'Riyadh': 'الرياض', 'Jeddah': 'مكة المكرمة', 'Makkah': 'مكة المكرمة', 'Taif': 'مكة المكرمة',
  'Madinah': 'المدينة المنورة', 'Medina': 'المدينة المنورة', 'Yanbu': 'المدينة المنورة',
  'Dammam': 'المنطقة الشرقية', 'Khobar': 'المنطقة الشرقية', 'Al-Khobar': 'المنطقة الشرقية',
  'Dhahran': 'المنطقة الشرقية', 'Al-Ahsa': 'المنطقة الشرقية', 'Hofuf': 'المنطقة الشرقية',
  'Qatif': 'المنطقة الشرقية', 'Jubail': 'المنطقة الشرقية', 'Ras Al-Khair': 'المنطقة الشرقية',
  'Ras Tanura': 'المنطقة الشرقية', 'Al-Kharj': 'الرياض', 'Zulfi': 'الرياض',
  'Tabuk': 'تبوك', 'NEOM': 'تبوك', 'Umluj': 'تبوك',
  'Abha': 'عسير', 'Buraidah': 'القصيم', 'Hail': 'حائل',
  'Najran': 'نجران', 'Jazan': 'جازان', 'Arar': 'الحدود الشمالية',
  'Sakaka': 'الجوف', 'Al-Bahah': 'الباحة', 'Turaif': 'الحدود الشمالية',
  'Wadi Ad-Dawasir': 'الرياض', 'Diriyah': 'الرياض',
};

// Parse the first sentence to extract structured info
function extractFromFirstSentence(text) {
  // Get first sentence/paragraph
  const firstSentence = stripHTML(text).split(/[.?!\n]/)[0].trim();
  return firstSentence;
}

// Try to extract structured data from a title like:
// "X Awarded Y Contract in Z worth V"
// "X Launches Y Development in Z worth V"
// "X Appoints Y for Z"
function parseTitle(title) {
  const result = { owner: null, contractor: null, consultant: null };

  // Pattern: X Awarded Y Contract (X = contractor)
  let m = title.match(/^([A-Z][A-Za-z\u0600-\u06FF\s&.,'-]{3,60}?)\s+(Awarded|Wins|Secures|Signs|Gets)\s+(?:a|the)?\s*(.+?)(?:Contract|Agreement|Deal|Project)\s+(?:for|in|with|of|worth)/i);
  if (m) {
    result.contractor = m[1].trim();
    return result;
  }

  // Pattern: X Awarded Y Contract (no continuation)
  m = title.match(/^([A-Z][A-Za-z\u0600-\u06FF\s&.,'-]{3,60}?)\s+(?:Awarded|Wins|Secures|Signs|Gets)\s+(?:a|the)?\s*(?:.+?)(?:Contract|Agreement|Deal|Project)\s*$/i);
  if (m) {
    result.contractor = m[1].trim();
    return result;
  }

  // Pattern: X Launches Y (X = owner/developer)
  m = title.match(/^([A-Z][A-Za-z\u0600-\u06FF\s&.,'-]{3,60}?)\s+(?:Launches?|Announces|Plans?|Completes|Inaugurates|Unveils|Breaks?\s+Ground)\s+/i);
  if (m) {
    result.owner = m[1].trim();
    return result;
  }

  // Pattern: X Appoints Y (X = owner, Y = consultant/contractor)
  m = title.match(/^([A-Z][A-Za-z\u0600-\u06FF\s&.,'-]{3,60}?)\s+Appoints\s+([A-Z][A-Za-z\u0600-\u06FF\s&.,'-]{3,60}?)\s+(?:as|to|for)/i);
  if (m) {
    result.owner = m[1].trim();
    const appointed = m[2].trim();
    // Check if appointed is a known consultant
    if (/(?:Consult|Engineer|Design|Architect|Planning)/i.test(title)) result.consultant = appointed;
    else result.contractor = appointed;
    return result;
  }

  // Pattern: X Appointed as Developer for Y (X = contractor/consultant)
  m = title.match(/^([A-Z][A-Za-z\u0600-\u06FF\s&.,'-]{3,60}?)\s+Appointed\s+(?:as|to)\s+/i);
  if (m) {
    if (/(?:Consult|Engineer|Design)/i.test(title)) result.consultant = m[1].trim();
    else result.contractor = m[1].trim();
    return result;
  }

  // Pattern: X and Y Launch/Form Z
  m = title.match(/^([A-Z][A-Za-z\u0600-\u06FF\s&.,'-]{3,60}?)\s+and\s+([A-Z][A-Za-z\u0600-\u06FF\s&.,'-]{3,60}?)\s+(?:Launch|Form|Create|Establish)\s+/i);
  if (m) {
    result.owner = `${m[1].trim()} and ${m[2].trim()}`;
    return result;
  }

  // Pattern: X Opens Y in Z
  m = title.match(/^([A-Z][A-Za-z\u0600-\u06FF\s&.,'-]{3,60}?)\s+(?:Opens|Launches|Inaugurates)\s+/i);
  if (m) {
    result.owner = m[1].trim();
    return result;
  }

  return result;
}

function extractFromContent(text, titleParse) {
  const content = stripHTML(text);
  const result = { ...titleParse };

  // For articles with contractor from title, try to find owner in content
  if (result.contractor && !result.owner) {
    // "developed by X", "for X", "on behalf of X"
    const m = content.match(/(?:developed|being\s+developed|owned)\s+by\s+([A-Z][A-Za-z\s&.,'-]{5,60})/i);
    if (m) result.owner = m[1].trim();
    else {
      const m2 = content.match(/(?:for|on\s+behalf\s+of)\s+(?:the\s+)?((?:Saudi\s+)?(?:Ministry\s+of|Royal\s+Commission|Municipality|Authority|Company|Development)\s+[A-Z][A-Za-z\s]{3,50})/i);
      if (m2) result.owner = m2[1].trim();
    }
  }

  // For articles with owner from title, try to find contractor in content
  if (result.owner && !result.contractor) {
    const m = content.match(/(?:awarded|signed|secured|won)\s+(?:a|the)?\s*(?:contract|agreement|deal)\s+(?:to|with|for)\s+([A-Z][A-Za-z\s&.,'-]{5,60})/i);
    if (m) result.contractor = m[1].trim();
  }

  // Consultant from various patterns
  if (!result.consultant) {
    const m = content.match(/(?:appointed|selected)\s+([A-Z][A-Za-z\s&.,'-]{5,60}?)\s+(?:to\s+provide|as\s+(?:the\s+)?(?:consultant|engineering|design))/i);
    if (m) result.consultant = m[1].trim();
    else {
      const m2 = content.match(/([A-Z][A-Za-z\s&.,'-]{5,60}?)\s+(?:has\s+been\s+(?:awarded|appointed|selected))\s+(?:a|the)?\s*.+?(?:consultancy|consulting|design|engineering)\s+(?:contract|role|project)/i);
      if (m2) result.consultant = m2[1].trim();
    }
  }

  return result;
}

async function parseArticle(item) {
  const title = item.title?.trim() || '';
  const rawContent = item['content:encoded'] || item.description || '';
  const cleanText = stripHTML(rawContent);
  const fullText = title + ' ' + cleanText;

  const cats = Array.isArray(item.category) ? item.category : (item.category ? [item.category] : []);

  const titleParse = parseTitle(title);
  const result = extractFromContent(fullText, titleParse);

  const value = extractValue(fullText);
  const location = extractLocation(fullText);
  const region = location ? REGION_MAP[location] || null : null;
  const sector = determineSector(fullText, cats);

  let status = 'قيد الدراسة';
  if (/completed|completed|commenced|inaugurated|افتتاح|تدشين|تشغيل|opens|opened/i.test(fullText)) status = 'تم الانتهاء';
  else if (/under\s*construction|underway|ongoing|قيد\s*الإنشاء|قيد\s*التنفيذ/i.test(fullText)) status = 'قيد الإنشاء';
  else if (/planned|planned|announced|مخطط|معلن|قيد\s*الدراسة|to\s+develop|to\s+build|to\s+construct/i.test(fullText)) status = 'مخطط';
  else if (/awarded|signed|secured|contract|won|appointed|ترسية|إسناد|عقد/i.test(fullText)) status = 'قيد التنفيذ';

  const pubDate = item.pubDate || null;

  return {
    title,
    owner: result.owner || null,
    contractor: result.contractor || null,
    consultant: result.consultant || null,
    value: value || null,
    location: location || null,
    region: region || null,
    sector,
    status,
    category: cats[0] || null,
    source: item.link || null,
    publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
    scrapedAt: new Date().toISOString()
  };
}

async function main() {
  console.log('=== SaudiGulf Projects RSS Scraper v3 ===\n');

  let allProjects = [];
  let processedUrls = new Set();

  if (fs.existsSync(OUTPUT)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
      allProjects.push(...existing);
      existing.forEach(p => { if (p.source) processedUrls.add(p.source); });
      console.log(`Loaded existing: ${existing.length} projects\n`);
    } catch (e) { console.log('Starting fresh\n'); }
  }

  let lastPage = 0;
  if (fs.existsSync(PROGRESS)) {
    try {
      const p = JSON.parse(fs.readFileSync(PROGRESS, 'utf8'));
      lastPage = p.lastPage || 0;
      console.log(`Resuming from page ${lastPage + 1}`);
    } catch (e) {}
  }

  for (let page = lastPage + 1; page <= MAX_PAGES; page++) {
    process.stdout.write(`Page ${page}... `);
    const items = await fetchFeed(page);
    if (!items || items.length === 0) { console.log('DONE'); break; }

    let newCount = 0;
    for (const item of items) {
      const link = item.link || item.guid?._ || '';
      if (!link || processedUrls.has(link)) continue;
      processedUrls.add(link);

      const project = await parseArticle(item);
      if (project.title) { allProjects.push(project); newCount++; }
    }

    console.log(`+${newCount} (total: ${allProjects.length})`);

    if (page % 20 === 0) {
      fs.writeFileSync(OUTPUT, JSON.stringify(allProjects, null, 2), 'utf8');
      fs.writeFileSync(PROGRESS, JSON.stringify({ lastPage: page }), 'utf8');
    }

    await sleep(300);
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(allProjects, null, 2), 'utf8');
  fs.writeFileSync(PROGRESS, JSON.stringify({ lastPage: MAX_PAGES, done: true }), 'utf8');

  console.log(`\nDone! ${allProjects.length} projects`);

  const stats = {};
  for (const key of ['owner', 'contractor', 'consultant', 'value', 'location']) {
    stats[key] = allProjects.filter(p => p[key]).length;
  }
  console.log(`\nStats:`);
  for (const [key, val] of Object.entries(stats)) {
    console.log(`  ${key}: ${val}/${allProjects.length} (${(val/allProjects.length*100).toFixed(1)}%)`);
  }

  // Also filter to Saudi-only
  const saudi = allProjects.filter(p => {
    const t = (p.title || '') + ' ' + (p.owner || '') + ' ' + (p.contractor || '') + ' ' + (p.location || '');
    return SAUDI_KW.test(t) || /Riyadh|Jeddah|Dammam|Makkah|Madinah|Tabuk|Abha|Hail/gi.test(t);
  });
  console.log(`\nSaudi-only: ${saudi.length} projects`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
