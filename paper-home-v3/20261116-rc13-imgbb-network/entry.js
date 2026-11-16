(()=>{const CACHE_NAME='true-king-paper-home-pilot-art-v1', MAX_BYTES=128*1024*1024; const installArtCache=function installPilotAssetCache({ enabled, baseURL = location.href, fetchImpl = window.fetch.bind(window), storage = window.caches, allowedURLs = [], maxBytes = MAX_BYTES } = {}) {
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
}; const runNetworkLoader=function runNetworkLoader(configuration, installArtCache) {
  const win = window, key = '__TRUE_KING_NETWORK_LOADING__';
  win[key]?.abort();
  const controller = new AbortController(); win[key] = controller;
  const timer = setTimeout(() => controller.abort(), 120000);
  let host = win;
  try { while (host.parent !== host && host.parent.document?.body) host = host.parent; } catch {}
  const bannerId = 'true-king-network-loading';
  const status = (message, retry = false) => {
    let bar = host.document.getElementById(bannerId);
    if (!bar) { bar = host.document.createElement('div'); bar.id = bannerId; bar.setAttribute('role', 'status'); bar.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:2147483647;padding:14px;border:1px solid #a98b5a;border-radius:8px;background:#f6ecd7;color:#513e2b;font:15px/1.6 sans-serif'; host.document.body.append(bar); }
    bar.replaceChildren(host.document.createTextNode(message));
    if (retry) { const button = host.document.createElement('button'); button.textContent = '重新加载'; button.style.marginLeft = '16px'; button.onclick = () => runNetworkLoader(configuration, installArtCache); bar.append(button); }
  };
  const read = async (path, json = false) => {
    const response = await win.fetch(new URL(path, configuration.base), { signal: controller.signal, mode: 'cors' });
    if (!response.ok) throw Error(`${path}（${response.status}）`);
    return json ? response.json() : response.text();
  };
  const leave = () => controller.abort(); win.addEventListener('pagehide', leave, { once: true });
  status('小帮手正在准备真王核心……');
  return Promise.all([read('core-runtime.js'), read('core-seed.json', true), read('asset-pool.json', true), read('core-style.css')]).then(async ([code, seed, assetPool, uiStyle]) => {
    if (controller.signal.aborted || win[key] !== controller) return;
    if (!seed.catalogBundle?.packages || !Array.isArray(assetPool)) throw Error('人物资料没有读取完整');
    const art = installArtCache({ enabled: true, baseURL: configuration.base, allowedURLs: assetPool, fetchImpl: host.fetch.bind(host), storage: host.caches });
    host.__TRUE_KING_ART_FETCH__ = art.fetch;
    win.__TRUE_KING_LOCAL_CONTENT__ = { seed, assetPool, uiStyle };
    const script = win.document.createElement('script');
    script.textContent = code + '\n//# sourceURL=true-king-network-runtime.js';
    let executionError;
    const watch = event => { if (String(event.filename).includes('true-king-network-runtime.js')) executionError = event.error || Error(event.message); };
    win.addEventListener('error', watch);
    try { (win.document.head || win.document.documentElement).append(script); } finally { win.removeEventListener('error', watch); }
    if (executionError) throw executionError;
    host.document.getElementById(bannerId)?.remove();
    win.__TRUE_KING_NETWORK_RESULT__ = { ok: true, buildId: configuration.buildId, base: configuration.base };
    if (configuration.components) {
      const variables = win.getVariables({ type: 'script' });
      const id = 'network-' + configuration.buildId;
      if (variables.componentInstallRequest?.id !== id) win.replaceVariables({ ...variables, componentInstallRequest: { id, buildId: configuration.buildId } }, { type: 'script' });
      const installer = await import(new URL('component-installer.mjs', configuration.base).href);
      await installer.mountInstaller(win, { origin: configuration.base.replace(/\/$/, '') });
    }
  }).catch(error => {
    if (win[key] !== controller) return;
    win.__TRUE_KING_NETWORK_RESULT__ = { ok: false, message: error.message };
    status('真王核心尚未加载完成：' + (error.name === 'AbortError' ? '连接超时' : error.message), true);
  }).finally(() => { clearTimeout(timer); win.removeEventListener('pagehide', leave); });
};return runNetworkLoader({"base":"https://kulsetiid.github.io/true-king-roster/paper-home-v3/20261116-rc13-imgbb-network/","buildId":"20261116-rc13-imgbb-network","components":true},installArtCache);})();
