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
