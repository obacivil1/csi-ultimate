import fs from 'fs';

const cache = {};
const TTL = parseInt(process.env.CACHE_TTL || '3600000');

export function getJSON(key, filePath) {
  const now = Date.now();
  const entry = cache[key];
  if (entry && now - entry.time < TTL) {
    return entry.data;
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    cache[key] = { data, time: now };
    return data;
  } catch {
    return [];
  }
}

export function invalidate(key) {
  delete cache[key];
}

export function preloadCache() {
  const files = {
    tenders: './data/etimad_all_tenders.json',
    contractors: './data/muqawil_all_regions.json',
    projects: './data/projects_database.json',
    awards_sample: './data/etimad_sample_awards.json'
  };
  for (const [key, file] of Object.entries(files)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      cache[key] = { data, time: Date.now() };
      console.log(`  [cache] Preloaded ${key}: ${data.length} records`);
    } catch (e) {
      console.error(`  [cache] Failed to preload ${key}: ${e.message}`);
    }
  }
}
