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

// Warmup cache asynchronously (non-blocking) 
// Called after server starts to preload data in background
export async function preloadWarmup(files) {
  for (const [key, filePath] of Object.entries(files)) {
    try {
      const data = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      cache[key] = { data, time: Date.now() };
      console.log(`  [cache] Preloaded ${key}: ${data.length} records`);
    } catch (e) {
      console.error(`  [cache] Failed to preload ${key}: ${e.message}`);
    }
    // Yield to event loop between files
    await new Promise(r => setTimeout(r, 10));
  }
}
