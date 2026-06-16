import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_DICTIONARY_PATH = resolve(__dirname, '../config/semantic-classifier/dictionaries.json');

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean);
}

export class SemanticPageClassifier {
  constructor({ dictionaryPath = DEFAULT_DICTIONARY_PATH } = {}) {
    this.dictionaryPath = dictionaryPath;
    this.dictionaries = this._loadDictionaries();
  }

  _loadDictionaries() {
    try {
      const raw = readFileSync(this.dictionaryPath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  _getDictionaryEntries() {
    const entries = [];
    for (const [lang, categories] of Object.entries(this.dictionaries)) {
      for (const [category, keywords] of Object.entries(categories)) {
        for (const keyword of keywords) {
          entries.push({ lang, category, keyword: normalizeText(keyword) });
        }
      }
    }
    return entries;
  }

  _extractVisibleText(pageContent) {
    const html = String(pageContent || '');
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
    const descriptionMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/is) ||
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/is);
    const headingMatches = [...html.matchAll(/<(h[1-6])[^>]*>(.*?)<\/h[1-6]>/gis)].map(([, , text]) => text);
    const bodyText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');

    const linkTexts = [...html.matchAll(/<a[^>]*>(.*?)<\/a>/gis)].map(([, text]) => text);

    return {
      title: titleMatch?.[1] || '',
      description: descriptionMatch?.[1] || '',
      headings: headingMatches,
      bodyText,
      linkTexts,
    };
  }

  _collectCandidateText(pageContent) {
    const { title, description, headings, bodyText, linkTexts } = this._extractVisibleText(pageContent);
    return [title, description, ...headings, bodyText, ...linkTexts].join(' ');
  }

  _scoreCategory(category, text, tokens) {
    const categories = this.dictionaries;
    const categoryKeywords = [];
    for (const lang of Object.keys(categories)) {
      const keywords = categories[lang]?.[category] || [];
      categoryKeywords.push(...keywords);
    }

    const normalizedKeywords = categoryKeywords.map((keyword) => normalizeText(keyword));
    const matched = [];
    let score = 0;

    for (const keyword of normalizedKeywords) {
      if (!keyword) continue;
      const regex = new RegExp(`\\b${keyword.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'iu');
      const count = (text.match(regex) || []).length;
      if (count > 0) {
        matched.push(keyword);
        score += count * (keyword.split(/\s+/).length > 1 ? 2 : 1);
      }
    }

    const tokenSet = new Set(tokens);
    const tokenMatches = normalizedKeywords.filter((keyword) => tokenSet.has(keyword));
    if (tokenMatches.length > 0) {
      score += tokenMatches.length;
    }

    if (category.endsWith('_AD_PAGE')) {
      const actionTerms = /(contact|owner|seller|apply|details|now|price|available|call|owner|employer|salary|تواصل|مالك|بائع|تقدم|تفاصيل|الآن|السعر|متاح|اتصل)/i;
      if (actionTerms.test(text)) {
        score += 5;
      }
    }

    if (category === 'REAL_ESTATE_LISTING_PAGE' || category === 'VEHICLE_LISTING_PAGE' || category === 'JOB_LISTING_PAGE') {
      const listingTerms = /(for rent|for sale|details|contact|owner|seller|apply|salary|required|مطلوب|للإيجار|للبيع|تفاصيل|اتصل|مالك|بائع)/i;
      if (listingTerms.test(text)) {
        score -= 2;
      }
    }

    return { category, score, matchedKeywords: [...new Set(matched)].slice(0, 20) };
  }

  classifyPage(pageContent) {
    const text = this._collectCandidateText(pageContent);
    const tokens = tokenize(text);
    const categories = [
      'JOB_LISTING_PAGE',
      'JOB_AD_PAGE',
      'REAL_ESTATE_LISTING_PAGE',
      'REAL_ESTATE_AD_PAGE',
      'VEHICLE_LISTING_PAGE',
      'VEHICLE_AD_PAGE',
      'DIRECTORY_PAGE',
      'CATEGORY_PAGE',
      'BLOG_ARTICLE_PAGE',
    ];

    const scores = categories
      .map((category) => this._scoreCategory(category, text, tokens))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    if (!scores.length) {
      return {
        pageType: 'UNKNOWN_PAGE',
        confidence: 0,
        scores: [],
        matchedKeywords: [],
      };
    }

    const top = scores[0];
    const maxScore = Math.max(...scores.map((entry) => entry.score));
    const confidence = Math.min(0.99, maxScore / 8);

    return {
      pageType: top.category,
      confidence,
      scores: scores.map((entry) => ({
        category: entry.category,
        confidence: entry.score > 0 ? Number((entry.score / Math.max(1, maxScore)).toFixed(3)) : 0,
        matchedKeywords: entry.matchedKeywords,
      })),
      matchedKeywords: top.matchedKeywords,
    };
  }
}
