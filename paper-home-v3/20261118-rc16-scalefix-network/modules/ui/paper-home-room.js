import '../纸剧场家园/home-host.js';
import '../纸剧场家园/home-room-factory.js';

const paperHomeBootMarker = '<!--PAPER_HOME_EMBEDDED_BOOT-->';
const escapePaperHomeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');
const imagePattern = /data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+|https?:\/\/[^\s"'<>]+\.(?:png|webp|jpe?g|gif|svg)(?:\?[^\s"'<>]*)?/g;
// Completed images can survive room close. A live view owns every URL handed to
// it (including hidden rooms and action caches); only unowned entries may leave
// the LRU cache. The budget bounds idle cache, never invalidates displayed art.
const paperHomeImageSessions = new WeakMap();
const paperHomeImageCacheLimits = Object.freeze({ maxIdleBytes: 192 * 1024 * 1024, maxIdleEntries: 96 });
export function paperImagePolicy(hostWindow) {
  const compact = hostWindow.matchMedia?.('(pointer: coarse)')?.matches === true
    || (Number(hostWindow.navigator?.deviceMemory) > 0 && hostWindow.navigator.deviceMemory <= 4);
  return compact ? { concurrency: 2, maxIdleBytes: 32 * 1024 * 1024, maxIdleEntries: 24, releaseHidden: true }
    : { concurrency: 4, ...paperHomeImageCacheLimits, releaseHidden: false };
}
let paperHomeBridgeSequence = 0;
const aborted = () => Object.assign(new Error('家园加载已取消。'), { name: 'AbortError' });
const abortReason = signal => signal?.reason?.name === 'TimeoutError' ? signal.reason : aborted();
const throwIfAborted = signal => { if (signal?.aborted) throw abortReason(signal); };
const timedOut = message => Object.assign(new Error(message), { name: 'TimeoutError' });
function imageSession(hostWindow, cacheLimits) {
  if (!paperHomeImageSessions.has(hostWindow)) { const policy = paperImagePolicy(hostWindow); paperHomeImageSessions.set(hostWindow, { images: new Map(), clock: 0, evicted: 0, limits: { maxIdleBytes: policy.maxIdleBytes, maxIdleEntries: policy.maxIdleEntries } }); }
  const session = paperHomeImageSessions.get(hostWindow);
  for (const key of Object.keys(paperHomeImageCacheLimits)) {
    if (Number.isFinite(cacheLimits?.[key]) && cacheLimits[key] >= 0) session.limits[key] = Math.floor(cacheLimits[key]);
  }
  return session;
}
function trimImageCache(session, hostWindow) {
  const idle = [...session.images.entries()].filter(([, entry]) => entry.complete && !entry.users && !entry.owners.size).sort((a, b) => a[1].used - b[1].used);
  let bytes = idle.reduce((sum, [, entry]) => sum + entry.bytes, 0), count = idle.length;
  for (const [source, entry] of idle) {
    if (bytes <= session.limits.maxIdleBytes && count <= session.limits.maxIdleEntries) break;
    session.images.delete(source); bytes -= entry.bytes; count--; session.evicted++;
    if (entry.ownedURL) { (hostWindow.URL || URL).revokeObjectURL(entry.url); entry.ownedURL = false; }
  }
}
function retainImage(entry, owner, session) {
  if (!owner.released) { entry.owners.add(owner); owner.entries.add(entry); }
  entry.used = ++session.clock;
}
function releaseImages(owner, session, hostWindow) {
  if (owner.released) return;
  owner.released = true;
  for (const entry of owner.entries) entry.owners.delete(owner);
  owner.entries.clear(); trimImageCache(session, hostWindow);
}
export function getPaperImageCacheStats(hostWindow) {
  const session = imageSession(hostWindow), owners = new Set(), stats = { entries: 0, bytes: 0, activeEntries: 0, activeBytes: 0, activeOwners: 0, idleEntries: 0, idleBytes: 0, pendingEntries: 0, evicted: session.evicted, limits: { ...session.limits } };
  for (const entry of session.images.values()) {
    for (const owner of entry.owners) owners.add(owner);
    if (!entry.complete) { stats.pendingEntries++; continue; }
    stats.entries++; stats.bytes += entry.bytes;
    const state = entry.owners.size || entry.users ? 'active' : 'idle';
    stats[`${state}Entries`]++; stats[`${state}Bytes`] += entry.bytes;
  }
  stats.activeOwners = owners.size;
  return stats;
}

async function decodeImage(hostWindow, url, signal) {
  throwIfAborted(signal);
  if (typeof hostWindow.Image !== 'function') {
    // DOM-less packaging tests have no browser decoder; browser windows do.
    if (typeof hostWindow.createImageBitmap === 'function') {
      const response = await (hostWindow.fetch || fetch)(url, { signal });
      const bitmap = await hostWindow.createImageBitmap(await response.blob());
      if (!(bitmap.width > 0 && bitmap.height > 0)) throw new Error('家园图片未能完整解码。');
      const dimensions = { width: bitmap.width, height: bitmap.height }; bitmap.close?.(); return dimensions;
    }
    return { width: 0, height: 0 };
  }
  return await new Promise((resolve, reject) => {
    const image = new hostWindow.Image();
    const cleanup = () => { image.onload = image.onerror = null; signal?.removeEventListener('abort', cancel); };
    const done = error => { cleanup(); if (error) reject(error); else resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    const cancel = () => { cleanup(); image.src = ''; reject(abortReason(signal)); };
    image.onload = () => {
      if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) { done(new Error('家园图片未能完整解码。')); return; }
      if (typeof image.decode === 'function') image.decode().then(() => done(), error => done(error)); else done();
    };
    image.onerror = () => done(new Error('家园图片未能完整解码。'));
    signal?.addEventListener('abort', cancel, { once: true }); image.src = url;
    if (signal?.aborted) cancel();
  });
}

function acquireImage(source, hostWindow, fallbacks, signal, owner, timeoutMs = 60000) {
  throwIfAborted(signal);
  const session = imageSession(hostWindow), URLs = hostWindow.URL || URL, BlobType = hostWindow.Blob || Blob;
  let entry = session.images.get(source);
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, users: 0, owners: new Set(), complete: false, url: null, ownedURL: false, bytes: 0, used: ++session.clock, promise: null };
    session.images.set(source, entry);
    const timeout = setTimeout(() => controller.abort(timedOut('家园图片加载超过 60 秒，请检查网络后重试。')), timeoutMs);
    entry.promise = (async () => {
      let lastError;
      for (const candidate of [...new Set([source, ...(fallbacks || [])])]) {
        let url;
        try {
          throwIfAborted(controller.signal);
          let blob;
          if (candidate.startsWith('data:image/')) {
            const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(candidate);
            if (!match) throw new Error('家园图片编码不受支持。');
            const binary = (hostWindow.atob || atob)(match[2]), bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
            blob = new BlobType([bytes], { type: match[1] });
          } else if (candidate.startsWith('blob:')) {
            const dimensions = await decodeImage(hostWindow, candidate, controller.signal);
            throwIfAborted(controller.signal);
            entry.bytes = dimensions.width * dimensions.height * 4;
            entry.url = candidate; entry.complete = true; return candidate;
          } else {
            const response = await (hostWindow.__TRUE_KING_ART_FETCH__ || hostWindow.fetch || fetch)(candidate, { signal: controller.signal, mode: 'cors' });
            if (!response.ok) throw new Error('家园网络纸卡加载失败。');
            blob = await response.blob();
            if (!blob.type.startsWith('image/')) throw new Error('家园网络素材不是图片。');
          }
          throwIfAborted(controller.signal); url = URLs.createObjectURL(blob);
          const dimensions = await decodeImage(hostWindow, url, controller.signal);
          throwIfAborted(controller.signal);
          entry.bytes = blob.size + dimensions.width * dimensions.height * 4;
          entry.url = url; entry.ownedURL = true; entry.complete = true; return url;
        } catch (error) {
          if (url) URLs.revokeObjectURL(url);
          lastError = error; if (controller.signal.aborted) throw abortReason(controller.signal);
        }
      }
      throw lastError || new Error('家园网络纸卡加载失败。');
    })().catch(error => { if (session.images.get(source) === entry) session.images.delete(source); throw error; }).finally(() => clearTimeout(timeout));
  }
  if (entry.complete) { retainImage(entry, owner, session); return Promise.resolve(entry.url); }
  entry.users += 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; signal?.removeEventListener('abort', cancel); entry.users -= 1;
      if (!entry.complete && entry.users === 0 && signal?.aborted) {
        entry.controller.abort(); if (session.images.get(source) === entry) session.images.delete(source);
      }
      if (error) reject(error); else { retainImage(entry, owner, session); resolve(value); }
      trimImageCache(session, hostWindow);
    };
    const cancel = () => finish(abortReason(signal));
    signal?.addEventListener('abort', cancel, { once: true });
    entry.promise.then(value => finish(null, value), error => finish(error));
    if (signal?.aborted) cancel();
  });
}

export function createPaperImageBatch(hostWindow, { signal: externalSignal, onProgress, imageFallbacks = {}, baseSources = [], imageTimeoutMs = 60000, batchTimeoutMs = 180000, cacheLimits } = {}) {
  const session = imageSession(hostWindow, cacheLimits), fallbacks = imageFallbacks, lifecycle = new AbortController(), owner = { entries: new Set(), released: false };
  trimImageCache(session, hostWindow);
  const cancel = () => lifecycle.abort(externalSignal?.reason);
  if(externalSignal?.aborted)cancel();else externalSignal?.addEventListener('abort',cancel,{once:true});
  const signal = lifecycle.signal;
  let disposed = false, cycle = 0, latest = { loaded: 0, total: 0, cached: 0, failed: 0, cycle: 0, phase: 'images', state: 'idle' };
  const notify = () => { try { onProgress?.({ ...latest }); } catch { /* Display callbacks cannot stop loading. */ } };
  const resolveImage = async (source, requestSignal = signal) => {
    if (disposed) throw aborted(); throwIfAborted(signal);
    // A caller's per-request signal must not detach the request from view disposal.
    if (requestSignal === signal) return acquireImage(source, hostWindow, fallbacks[source], signal, owner, imageTimeoutMs);
    const linked = new AbortController(), cancelLife = () => linked.abort(signal.reason), cancelRequest = () => linked.abort(requestSignal?.reason);
    signal.addEventListener('abort', cancelLife, { once: true }); requestSignal?.addEventListener('abort', cancelRequest, { once: true });
    if (requestSignal?.aborted) cancelRequest();
    try { return await acquireImage(source, hostWindow, fallbacks[source], linked.signal, owner, imageTimeoutMs); }
    finally { signal.removeEventListener('abort', cancelLife); requestSignal?.removeEventListener('abort', cancelRequest); }
  };
  const ensureImages = async (references, phase = 'images', { signal: requestSignal } = {}) => {
    if (disposed) throw aborted(); throwIfAborted(signal);
    const batch = [...new Set([...(phase === 'shell' ? [] : baseSources), ...references].filter(Boolean))];
    const ownCycle = ++cycle, cachedSources = new Set(batch.filter(source => session.images.get(source)?.complete)), cached = cachedSources.size;
    for (const source of cachedSources) retainImage(session.images.get(source), owner, session);
    latest = { cycle: ownCycle, loaded: cached, total: batch.length, cached, failed: 0, phase, state: cached === batch.length ? 'complete' : 'loading' }; notify();
    const batchController = new AbortController(), cancel = () => batchController.abort(signal?.reason), cancelRequest = () => batchController.abort(requestSignal?.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    requestSignal?.addEventListener('abort', cancelRequest, { once: true });
    if(requestSignal?.aborted)cancelRequest();
    const timeout = setTimeout(() => batchController.abort(timedOut('这次图片准备超过 180 秒，请检查网络后重试。')), batchTimeoutMs);
    let cursor = 0; const errors = [];
    const workers = Array.from({ length: Math.min(paperImagePolicy(hostWindow).concurrency, batch.length) }, async () => {
      while (cursor < batch.length) {
        if(batchController.signal.aborted)break;
        const source = batch[cursor++]; if (cachedSources.has(source)) continue;
        try { await resolveImage(source,batchController.signal); if (ownCycle === cycle && !disposed) { latest.loaded += 1; notify(); } }
        catch (error) { errors.push(error); if (ownCycle === cycle && !disposed) { latest.failed += 1; notify(); } }
      }
    });
    await Promise.all(workers);
    clearTimeout(timeout);signal?.removeEventListener('abort',cancel);requestSignal?.removeEventListener('abort',cancelRequest);
    if(batchController.signal.aborted&&!errors.length)errors.push(abortReason(batchController.signal));
    if (ownCycle === cycle) { latest.state = errors.length ? 'failed' : 'complete'; notify(); }
    throwIfAborted(signal); if (disposed) throw aborted();
    throwIfAborted(batchController.signal);
    if (errors.length) throw errors[0];
    return { ...latest };
  };
  return Object.freeze({ resolveImage, ensureImages, getProgress: () => ({ ...latest }), getCacheStats: () => getPaperImageCacheStats(hostWindow),
    dispose() { if(disposed)return;disposed=true;lifecycle.abort();externalSignal?.removeEventListener('abort',cancel);releaseImages(owner,session,hostWindow); },
  });
}

// Only visible shell images are prepared now. JSON references remain lazy until
// the child planner supplies the current scene's chosen actions and furniture.
export async function prepareEmbeddedPaperHome(seed, hostWindow, { signal, onProgress, imageTimeoutMs = 60000, batchTimeoutMs = 180000, cacheLimits } = {}) {
  if (seed?.schemaVersion !== 1 || typeof seed.document !== 'string' || !seed.document.includes(paperHomeBootMarker)) throw new Error('新版家园资料尚未完整打包。');
  const session = imageSession(hostWindow), sourceToVirtual = new Map(), virtualToSource = new Map();
  const fallbacks = seed.metadata?.imageFallbacks || seed.imageFallbacks || {};
  const baseSources = [...new Set(seed.document.match(imagePattern) || [])];
  let disposed = false, roomProgress = null;
  const blobSources = new Map();
  const sourceOf = source => virtualToSource.get(source) || blobSources.get(source) || source;
  const emitRoomProgress = () => {
    if (!roomProgress) return;
    const cards = [...roomProgress.cards.values()];
    const snapshot = { cycle: batch.getProgress().cycle, roomId: roomProgress.room.id, roomName: roomProgress.room.name,
      phase: roomProgress.phase, state: roomProgress.state, loaded: cards.filter(card => session.images.get(card.source)?.complete).length,
      total: cards.length, cached: cards.filter(card => card.cached).length, failed: cards.filter(card => card.failed).length,
      placed: roomProgress.placed, placementTotal: roomProgress.placementTotal };
    roomProgress.latest = snapshot;
    try { onProgress?.(snapshot); } catch { /* UI observers cannot stop placement. */ }
    return snapshot;
  };
  const trackSources = sources => {
    if (!roomProgress || roomProgress.phase !== 'cards') return;
    for (const source of sources) if (source && !roomProgress.cards.has(source)) {
      roomProgress.cards.set(source, { source, cached: !!session.images.get(source)?.complete, failed: false });
    }
    emitRoomProgress();
  };
  const batch = createPaperImageBatch(hostWindow,{signal,onProgress:progress=>roomProgress?emitRoomProgress():onProgress?.(progress),imageFallbacks:fallbacks,baseSources,imageTimeoutMs,batchTimeoutMs,cacheLimits});
  const resolveImage = async (reference,requestSignal) => {
    const source=sourceOf(reference);trackSources([source]);
    try { const url=await batch.resolveImage(source,requestSignal);blobSources.set(url,source);emitRoomProgress();return url; }
    catch(error){const card=roomProgress?.cards.get(source);if(card)card.failed=true;emitRoomProgress();throw error;}
  };
  const ensureImages = async (references,phase='scene') => {
    const sources=references.map(sourceOf);trackSources(sources);
    try { return await batch.ensureImages(sources,phase); }
    catch(error){for(const source of sources){const card=roomProgress?.cards.get(source);if(card&&!session.images.get(source)?.complete)card.failed=true;}emitRoomProgress();throw error;}
  };
  const getProgress = batch.getProgress;
  const assertActive = () => { if (disposed) throw aborted(); throwIfAborted(signal); };
  const paint = () => new Promise(resolve => typeof hostWindow.requestAnimationFrame==='function'?hostWindow.requestAnimationFrame(resolve):resolve());
  async function placeScene(stage, roomId) {
    assertActive();
    const operation = roomProgress;
    const background = stage.ownerDocument.getElementById(roomId==='living-room'?'background':'room-background');
    const images = new Set([...stage.querySelectorAll('img'), ...(background?[background]:[])]), cards = new Map();
    trackSources([...images].map(image=>image.getAttribute('src')).filter(Boolean).map(sourceOf));
    for (const image of images) {
      if (!image.getAttribute('src')) continue;
      const owner=image.closest('[data-instance-id],.piece,[data-helper-id]');
      const id=owner?.dataset.instanceId||owner?.dataset.id||owner?.dataset.helperId||image;
      if(!cards.has(id))cards.set(id,[]);cards.get(id).push(image);
    }
    if(operation){operation.phase='placement';operation.placed=0;operation.placementTotal=cards.size;emitRoomProgress();}
    await paint();
    assertActive();
    await Promise.all([...cards.values()].map(async images=>{
      await Promise.all(images.map(async image=>{
        await (async function decodeStablePlacedImage(image){
  for(let attempt=0;attempt<4;attempt++){
    const source=image.src;
    try{if(typeof image.decode==='function')await image.decode();}
    catch(error){if(image.src===source)throw error;continue;}
    if(image.src!==source)continue;
    if(!image.complete||!(image.naturalWidth>0))throw Error('房间中仍有纸卡没有显示完成，请重试。');
    return;
  }
  throw Error('房间纸卡仍在切换，请稍后重试。');
})(image);
      }));
      assertActive();
      if(operation&&operation===roomProgress){operation.placed++;emitRoomProgress();}
    }));
    // Give the browser a complete frame with all decoded art and its final layers.
    await paint();await paint();assertActive();
  }
  async function trackRoom(room, load) {
    assertActive();
    if(roomProgress)throw Error('小帮手正在布置房间，请稍候。');
    const operation={room,cards:new Map(),phase:'cards',state:'loading',placed:0,placementTotal:0};
    roomProgress=operation;emitRoomProgress();
    try {
      const outcome=await load();
      assertActive();
      const progress=emitRoomProgress();
      if(outcome?.applied===false||progress.failed||progress.loaded<progress.total||operation.phase!=='placement'||progress.placed<progress.placementTotal)throw Error('房间纸卡尚未准备完整，请重试。');
      operation.state='complete';return {...outcome,...emitRoomProgress(),applied:true};
    } catch(error){operation.state='failed';emitRoomProgress();throw error;}
    finally {if(roomProgress===operation)roomProgress=null;}
  }
  const virtualImage = source => {
    if (!sourceToVirtual.has(source)) { const url = `https://paper-home.invalid/image/${sourceToVirtual.size}.png`; sourceToVirtual.set(source, url); virtualToSource.set(url, source); }
    return sourceToVirtual.get(source);
  };
  const replaceImages = value => {
    if (typeof value === 'string') return value.replace(imagePattern, virtualImage);
    if (Array.isArray(value)) return value.map(replaceImages);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceImages(child)]));
    return value;
  };
  let bridgeKey;
  const dispose = () => { if (disposed) return; disposed = true; batch.dispose(); if (bridgeKey) delete hostWindow[bridgeKey]; };
  try {
    await ensureImages(baseSources, 'shell');
    const data = { layout: replaceImages(seed.layout), resources: replaceImages(seed.resources || {}) };
    let document = seed.document;
    for (const source of baseSources) {const url=session.images.get(source).url;blobSources.set(url,source);document=document.replaceAll(source,url);}
    bridgeKey = `__TRUE_KING_PAPER_HOME_IMAGES_${++paperHomeBridgeSequence}__`;
    hostWindow[bridgeKey] = Object.freeze({ managed: true, resolveImage, ensureImages, getProgress, placeScene });
    const bootstrap = `<script>(function(){'use strict';window.PaperHomeAssetLoader=parent[${escapePaperHomeJSON(bridgeKey)}];const layout=${escapePaperHomeJSON(data.layout)};const resources=${escapePaperHomeJSON(data.resources)};const nativeFetch=window.fetch.bind(window);window.fetch=function(input,options){const raw=typeof input==='string'?input:input.url;let key=raw;try{key=new URL(raw,document.baseURI).href;}catch{}const value=raw==='scene-layout.json'||key.endsWith('/scene-layout.json')?layout:resources[key];if(value!==undefined)return Promise.resolve(new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}}));if(key.startsWith('https://paper-home.invalid/'))return Promise.reject(new Error('未打包的家园资料'));return nativeFetch(input,options);};})();<\/script>`;
    return { srcdoc: document.replace(paperHomeBootMarker, bootstrap), metadata: seed.metadata, dispose, resolveImage, ensureImages, getProgress, getCacheStats: batch.getCacheStats, trackRoom, placeScene };
  } catch (error) { dispose(); throw error; }
}

export function mountEmbeddedPaperHomeRoom(container, options = {}) {
  const hostWindow = options.hostWindow || container.ownerDocument.defaultView;
  const sourceGlobal = typeof window !== 'undefined' ? window : globalThis;
  let controller = new AbortController(), generation = 0;
  let inner = null, prepared = null, destroyed = false, active = false, pendingVisits = 0;
  let arrangementId = options.data?.arrangementId || options.data?.id || '';
  const fail = (error, id = arrangementId, reason) => ({ id, applied: false, error, ...(reason ? { reason } : {}), ...(prepared?.getProgress() || {}) });
  const initialize = async candidate => {
    const ownGeneration = generation, ownController = controller;
    let ownPrepared = null, ownInner = null;
    const stale = () => destroyed || ownGeneration !== generation;
    try {
      prepared?.dispose();
      ownPrepared = await prepareEmbeddedPaperHome(options.paperHome, hostWindow, { signal: ownController.signal, onProgress: progress => { if (!stale()) options.onLoadProgress?.(progress); } });
      if (stale()) { ownPrepared.dispose(); return fail(destroyed ? 'destroyed' : 'cancelled'); }
      prepared = ownPrepared;
      const factory = sourceGlobal.PaperHomeRoomFactory.createRoomFactory({ srcdoc: ownPrepared.srcdoc, hostAPI: sourceGlobal.PaperHomeHost,
        timeoutMs: 180000, resolveImage: ownPrepared.resolveImage,
        getAssetProgress: ownPrepared.getProgress,
        getInstalledIds: opts => opts.getInstalledIds?.() ?? opts.installedIds ?? opts.data?.groups?.map(group => group.id),
        getWishModule: opts => opts.getWishModule?.() || opts.wishModule || null });
      const initialOptions = candidate ? { ...options, data: { ...options.data, arrangementId: candidate.id, groups: candidate.groups } } : options;
      ownInner = factory(container, {...initialOptions,onRoomLoad:(room,load)=>{
        if (stale()) return Promise.reject(aborted());
        const prepare=()=>stale()?Promise.reject(aborted()):ownPrepared.trackRoom(room,load);
        return options.onRoomLoad?options.onRoomLoad(room,prepare):prepare();
      }}); inner = ownInner; ownInner.setActive(active);
      for (let visit = 0; visit < pendingVisits; visit++) ownInner.beginVisit(); pendingVisits = 0;
      const result = await ownInner.ready;
      return stale() ? fail(destroyed ? 'destroyed' : 'cancelled', candidate?.id) : result;
    } catch (error) {
      if (!ownInner || stale()) { ownPrepared?.dispose(); if (prepared === ownPrepared) prepared = null; }
      return fail(destroyed ? 'destroyed' : stale() || error.name === 'AbortError' ? 'cancelled' : 'home-load-failed', candidate?.id || arrangementId, error.message);
    }
  };
  let initialization = options.deferLoad ? Promise.resolve({ id: arrangementId, applied: true, deferred: true, loaded: 0, total: 0, cached: 0 }) : initialize();
  const ready = initialization;
  let operations = Promise.resolve(), revision = 0;
  return Object.freeze({
    ready,
    get home() { return !destroyed ? inner?.home || null : null; },
    get lastLoadOutcome() { return inner?.lastLoadOutcome || null; },
    get arrangementId() { return inner?.arrangementId || arrangementId; },
    dismissSelection() { return inner?.dismissSelection() || false; },
    beginVisit() { if (destroyed) return fail('destroyed'); if (inner) return inner.beginVisit(); pendingVisits++; return { applied: true }; },
    setArrangement(candidate) {
      const request = ++revision, ownGeneration = generation;
      const pending = operations.then(async () => {
        await initialization;
        if (destroyed) return fail('destroyed', candidate?.id);
        if (request !== revision || ownGeneration !== generation) return fail('superseded', candidate?.id);
        let result;
        if (!inner) { initialization = initialize(candidate); result = await initialization; }
        else result = await inner.setArrangement(candidate);
        if (destroyed || request !== revision || ownGeneration !== generation) return fail(destroyed ? 'destroyed' : 'superseded', candidate?.id);
        if (result.applied) arrangementId = candidate.id; return result;
      });
      operations = pending.then(() => undefined, () => undefined); return pending;
    },
    setActive(value) {
      if (destroyed) return;
      const wasActive = active; active = Boolean(value); container.hidden = !active; inner?.setActive(active);
      // Remove the iframe and its alpha/action caches before releasing blob URLs.
      // Reopening uses setArrangement (core) or boot (web), retaining saved layouts.
      if (wasActive && !active && paperImagePolicy(hostWindow).releaseHidden) {
        arrangementId = inner?.arrangementId || arrangementId;
        generation++; revision++; controller.abort(); inner?.destroy(); prepared?.dispose(); inner = null; prepared = null;
        controller = new AbortController(); initialization = Promise.resolve({ applied: true, deferred: true }); operations = Promise.resolve();
      }
    },
    getCacheStats() { return getPaperImageCacheStats(hostWindow); },
    cancelLoad() {
      if (destroyed) return fail('destroyed');
      generation++; revision++; controller.abort(); inner?.destroy(); prepared?.dispose(); inner = null; prepared = null;
      controller = new AbortController(); pendingVisits = 0;
      initialization = Promise.resolve({ applied: false, error: 'cancelled' }); operations = Promise.resolve();
      return fail('cancelled');
    },
    resize() { inner?.resize(); },
    destroy() { if (destroyed) return; destroyed = true; generation++; revision++; controller.abort(); inner?.destroy(); prepared?.dispose(); },
  });
}
