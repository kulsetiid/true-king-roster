// Only immutable trial artwork belongs here. Chat state and business responses never enter this cache.
export const CACHE_NAME = 'true-king-paper-home-pilot-art-v1';
const MAX_BYTES = 128 * 1024 * 1024;
export function installPilotAssetCache({ enabled, baseURL = location.href, fetchImpl = window.fetch.bind(window), storage = window.caches, allowedURLs = [], maxBytes = MAX_BYTES } = {}) {
  const scope = new URL('./assets/', baseURL).href;
  const allowed = new Set(allowedURLs);
  const stats = { enabled: Boolean(enabled && storage), hits: 0, downloads: 0, networkBodyBytes: 0, savedBytes: 0, warnings: [] };
  const used = new Map();
  let cachePromise;
  const warn = error => { const message = String(error?.message || error); if (!stats.warnings.includes(message)) stats.warnings.push(message); };
  const getCache = () => cachePromise ||= storage.open(CACHE_NAME).catch(error => { stats.enabled = false; warn(error); return null; });
  async function fetchAsset(input, options = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, baseURL).href;
    const method = options.method || input?.method || 'GET';
    if (method !== 'GET' || !(url.startsWith(scope) || allowed.has(url)) || !/\/[a-f0-9]{64}\.(png|webp|jpg|svg)(?:$|\?)/.test(url)) return fetchImpl(input, options);
    options.signal?.throwIfAborted();
    const cache = stats.enabled ? await getCache() : null;
    let cached;
    try { cached = await cache?.match(url); } catch (error) { warn(error); }
    options.signal?.throwIfAborted();
    if (cached?.ok && cached.headers.get('Content-Type')?.startsWith('image/')) {
      stats.hits++; used.set(url, performance.now()); return cached;
    }
    const response = await fetchImpl(input, options);
    if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/')) return response;
    stats.downloads++;
    // Read the downloaded body once; its size is compressed image bytes, not wire transfer.
    const blob = await response.blob(); stats.networkBodyBytes += blob.size;
    const headers = new Headers(response.headers); headers.set('X-Pilot-Asset-Bytes', String(blob.size));
    const copy = new Response(blob, { status: response.status, statusText: response.statusText, headers });
    if (cache) {
      try { await cache.put(url, copy.clone()); stats.savedBytes += blob.size; used.set(url, performance.now()); }
      catch (error) { warn(error); }
    }
    if (cache && stats.downloads % 8 === 0) await trim();
    return copy;
  }
  async function trim() {
    if (!stats.enabled) return;
    const cache = await getCache(); if (!cache) return;
    try {
      const records = await Promise.all((await cache.keys()).map(async request => ({ request, size: Number((await cache.match(request))?.headers.get('X-Pilot-Asset-Bytes')) || 0, used: used.get(request.url) || 0 })));
      let bytes = records.reduce((sum, item) => sum + item.size, 0);
      for (const record of records.sort((a, b) => a.used - b.used)) { if (bytes <= maxBytes) break; await cache.delete(record.request); bytes -= record.size; }
    } catch (error) { warn(error); }
  }
  async function clear() {
    try { if (storage) await storage.delete(CACHE_NAME); cachePromise = null; used.clear(); return true; }
    catch (error) { warn(error); cachePromise = null; return false; }
  }
  return { fetch: fetchAsset, stats, trim, clear };
}
