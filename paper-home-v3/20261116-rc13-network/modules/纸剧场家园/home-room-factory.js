/* Local same-origin installation seam for options.paperFactories.room. */
(function (global) {
  'use strict';
  const baseURL = /^https?:|^file:/.test(global.document?.baseURI || '') ? global.document.baseURI : 'http://localhost/';
  const sourceURL = global.document?.currentScript?.src || (typeof URL === 'function' ? new URL('home-room-factory.js', baseURL).href : 'http://localhost/home-room-factory.js');
  const homeSpiritId = id => ({ carolyn: 'caroline', yelena: 'elena' }[id] || id);
  const cleanIds = ids => [...new Set(ids.map(homeSpiritId))];

  function createRoomFactory(configuration = {}) {
    const embeddedDocument = typeof configuration.srcdoc === 'string' ? configuration.srcdoc : null;
    const requestedURL = new URL(configuration.url || '网格测试预览.html', sourceURL);
    const timeoutMs = Number.isFinite(configuration.timeoutMs) && configuration.timeoutMs > 0 ? configuration.timeoutMs : 45000;
    return function mountPaperHomeRoom(container, options = {}) {
      const document = container?.ownerDocument;
      const hostWindow = options.hostWindow || document?.defaultView || global;
      const hostAPI = configuration.hostAPI || hostWindow.PaperHomeHost || global.PaperHomeHost;
      if (!document || !hostAPI?.createPaperRoomAdapter) throw new Error('请先在宿主载入 home-host.js 和 home-room-factory.js。');
      const parentOrigin = new URL(document.baseURI || hostWindow.location?.href).origin;
      if (embeddedDocument === null && (requestedURL.origin !== parentOrigin || !/^https?:$/.test(requestedURL.protocol))) throw new Error('家园页面需要通过 HTTP 在当前宿主的同一来源打开。');
      const root = container.shadowRoot || container.attachShadow?.({ mode: 'open' }) || container;
      const iframe = document.createElement('iframe');
      iframe.title = '孤儿院纸剧场'; iframe.setAttribute('aria-label', '孤儿院纸剧场');
      Object.assign(iframe.style, { display: 'block', width: '100%', height: '100%', border: '0', background: '#29352b' });
      let home = null, childWindow = null, connected = false, destroyed = false, active = false;
      let requestRevision = 0, visit = 0, loadCycle = 0, loadGeneration = 0, arrangementId = options.data?.arrangementId || options.data?.id || '';
      let booting = null, operations = Promise.resolve(), readinessTimer, readySettled = false;
      let loadingFailed = false;
      let lastLoadOutcome = null;
      const assetProgress = () => configuration.getAssetProgress?.() || {};
      const reportOutcome = outcome => { outcome = { ...outcome, ...assetProgress() }; lastLoadOutcome = outcome; try { options.onLoadOutcome?.(outcome); } catch { /* Diagnostics cannot stop scene readiness. */ } return outcome; };
      const pendingImages = new Set();
      let readyResolve;
      const ready = new Promise(resolve => { readyResolve = resolve; });
      let currentReady = ready;
      const failed = (error, id = arrangementId, reason) => ({ id, applied: false, error, ...(reason ? { reason } : {}) });
      const progress = (loaded, state) => {
        if(typeof configuration.getAssetProgress==='function')return;
        try { options.onLoadProgress?.({ cycle: loadCycle, loaded, total: 1, state }); } catch { /* Progress cannot stop the room. */ }
      };
      const settle = outcome => {
        if (readySettled) return;
        readySettled = true; loadingFailed = outcome.applied === false;
        outcome=reportOutcome(outcome);
        global.clearTimeout(readinessTimer); readyResolve(outcome);
      };
      const inspectErrors = () => {
        const state = home?.scene.getState?.();
        if (state?.errors?.length || state?.people?.some(person => person.error)) throw new Error('部分房间纸卡没有完整加载：' + JSON.stringify({ errors: state?.errors, people: state?.people?.filter(person => person.error) }));
      };
      async function waitForBackground(windowForLoad) {
        const image = windowForLoad?.document?.getElementById?.('background');
        if (!image?.src) return;
        const usable = () => image.complete && image.naturalWidth > 0;
        if (image.complete) { if (!usable()) throw new Error('固定房间背景没有完整加载。'); return; }
        const loaded = await new Promise(resolve => {
          let finished = false;
          const finish = value => {
            if (finished) return; finished = true;
            image.removeEventListener('load', onImageLoad); image.removeEventListener('error', onImageError);
            pendingImages.delete(cancel); resolve(value);
          };
          const onImageLoad = () => finish(usable());
          const onImageError = () => finish(false);
          const cancel = () => finish(false);
          pendingImages.add(cancel);
          image.addEventListener('load', onImageLoad); image.addEventListener('error', onImageError);
          if (image.complete) finish(usable());
        });
        if (!loaded) throw new Error('固定房间背景没有完整加载。');
      }
      function installedIds(groups) {
        const explicit = typeof configuration.getInstalledIds === 'function' ? configuration.getInstalledIds(options) : options.installedIds;
        const ids = explicit == null ? (groups || []).map(person => person?.id) : explicit;
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id)) throw new Error('已安装冠冕之灵需要有效 ID 数组。');
        return cleanIds(ids);
      }
      async function arrange(candidate, variant, targetHome = home, targetWindow = childWindow) {
        if (!targetHome || destroyed) return failed(destroyed ? 'destroyed' : 'home-unavailable', candidate.id);
        if (targetHome.scene.getState?.().mode === 'decoration') targetHome.scene.setMode('life');
        await targetHome.setInstalledSpirits(installedIds(candidate.groups));
        const result = await targetHome.scene.arrangeDaily(variant);
        if (result?.ok === false) return failed('invalid-arrangement', candidate.id, result.reason);
        await waitForBackground(targetWindow); inspectErrors();
        return { id: candidate.id, applied: true, ...(typeof configuration.getAssetProgress==='function'?assetProgress():{loaded:1,total:1}) };
      }
      const onHomeReady = () => { void inspectHome(); };
      const onChildKeydown = event => {
        if (event.key !== 'Escape' || !active || !connected || typeof options.onClose !== 'function') return;
        // Keyboard events inside an iframe cannot reach the core window.
        event.preventDefault(); event.stopImmediatePropagation?.();
        if (!home.dismissSelection()) options.onClose();
      };
      async function inspectHome() {
        if (destroyed || connected || booting || loadingFailed) return booting;
        let candidate;
        try { candidate = childWindow?.PaperHome; } catch { settle(failed('home-origin-mismatch')); return; }
        if (!candidate) return;
        const needed = ['connectHost', 'setInstalledSpirits', 'setActive', 'dismissSelection', 'destroy'];
        if (needed.some(name => typeof candidate[name] !== 'function') || typeof candidate.scene?.arrangeDaily !== 'function') {
          settle(failed('home-api-missing', arrangementId, '家园页面的宿主接口尚未完整。')); return;
        }
        home = candidate;
        const generation = loadGeneration, targetWindow = childWindow;
        booting = (async () => {
          try {
            const adapterOverrides = configuration.adapter || {};
            const getWishModule = () => configuration.getWishModule?.(options) || options.getWishModule?.() || options.wishModule || null;
            const adapter = hostAPI.createPaperRoomAdapter(options, {
              ...adapterOverrides,
              getContext: () => ({ ...(adapterOverrides.getContext?.() || {}), wishModule: getWishModule() }),
            });
            if(typeof configuration.resolveImage==='function'&&adapter.helperAssets){
              adapter.helperAssets=Object.fromEntries(await Promise.all(Object.entries(adapter.helperAssets).map(async([id,url])=>[id,await configuration.resolveImage(url)])));
            }
            home.connectHost(adapter);
            home.setActive(active);
            const outcome = await arrange({ id: arrangementId, groups: options.data?.groups || [] }, visit, candidate, targetWindow);
            if (generation !== loadGeneration) return;
            if (destroyed || loadingFailed) { settle(failed(destroyed ? 'destroyed' : 'home-load-timeout')); return; }
            if (outcome.applied) { connected = true; progress(1, 'complete'); }
            settle(outcome);
          } catch (error) { if (generation === loadGeneration) settle(failed('home-load-failed', arrangementId, error.message)); }
        })();
        return booting;
      }
      function onLoad() {
        if (destroyed) return;
        try {
          const nextWindow = iframe.contentWindow;
          if (!nextWindow || nextWindow.location?.href === 'about:blank') return;
          if (embeddedDocument === null && new URL(nextWindow.location.href).origin !== parentOrigin) throw new Error('来源改变');
          if (embeddedDocument !== null && nextWindow.location.href !== 'about:srcdoc') throw new Error('内嵌页面来源改变');
          childWindow?.removeEventListener?.('paper-home:ready', onHomeReady);
          childWindow?.removeEventListener?.('keydown', onChildKeydown, true);
          childWindow = nextWindow;
          const generation = loadGeneration, windowForLoad = childWindow;
          childWindow.addEventListener('paper-home:ready', onHomeReady);
          childWindow.addEventListener('keydown', onChildKeydown, true);
          // The script can have finished before load, or the ready event can follow it.
          void inspectHome();
          if (childWindow.PaperHomeScene?.ready) Promise.resolve(childWindow.PaperHomeScene.ready).then(result => {
            if (generation !== loadGeneration || windowForLoad !== childWindow) return;
            if (result?.error) settle(failed('home-load-failed', arrangementId, result.error));
            else void inspectHome();
          }, error => { if (generation === loadGeneration && windowForLoad === childWindow) settle(failed('home-load-failed', arrangementId, error.message)); });
        } catch { home = null; connected = false; settle(failed('home-origin-mismatch')); }
      }
      const onError = () => settle(failed('home-load-failed'));
      function reloadHome() {
        loadGeneration += 1; loadCycle += 1;
        global.clearTimeout(readinessTimer);
        childWindow?.removeEventListener?.('paper-home:ready', onHomeReady);
        childWindow?.removeEventListener?.('keydown', onChildKeydown, true);
        for (const cancel of [...pendingImages]) cancel();
        home?.destroy(); home = null; childWindow = null; connected = false; booting = null;
        loadingFailed = false; readySettled = false;
        currentReady = new Promise(resolve => { readyResolve = resolve; });
        readinessTimer = global.setTimeout(() => settle(failed('home-load-timeout')), timeoutMs);
        progress(0, 'loading'); if (embeddedDocument !== null) iframe.srcdoc = embeddedDocument; else iframe.src = requestedURL.href;
        return currentReady;
      }
      iframe.addEventListener('load', onLoad); iframe.addEventListener('error', onError);
      readinessTimer = global.setTimeout(() => settle(failed('home-load-timeout')), timeoutMs);
      progress(0, 'loading'); if (embeddedDocument !== null) iframe.srcdoc = embeddedDocument; else iframe.src = requestedURL.href; root.replaceChildren(iframe);

      return Object.freeze({
        ready,
        get home() { return connected && !destroyed ? home : null; },
        get lastLoadOutcome() { return lastLoadOutcome; },
        get arrangementId() { return arrangementId; },
        dismissSelection() { return !destroyed && connected ? Boolean(home.dismissSelection()) : false; },
        beginVisit() {
          if (destroyed) return failed('destroyed');
          const helperVisit = home?.beginVisit?.();
          if (helperVisit?.applied === false) return helperVisit;
          visit += 1; home?.dismissSelection();
          return { applied: true };
        },
        setArrangement(candidate = {}) {
          const id = candidate.id || '';
          if (destroyed) return Promise.resolve(failed('destroyed', id));
          const groups = candidate.groups;
          if (!Array.isArray(groups) || groups.some((person, index) => typeof person?.id !== 'string' || !person.id || groups.findIndex(other => other.id === person.id) !== index)) return Promise.resolve(failed('invalid-arrangement', id));
          const next = { id, groups: groups.map(person => ({ id: person.id })) }, request = ++requestRevision, variant = visit;
          const pending = operations.then(async () => {
            let initial = await currentReady;
            if (destroyed) return failed('destroyed', id);
            if (request !== requestRevision) return failed('superseded', id);
            // The existing host's Retry button calls setArrangement again.
            if (initial.applied === false || !connected) initial = await reloadHome();
            if (destroyed) return failed('destroyed', id);
            if (request !== requestRevision) return failed('superseded', id);
            if (initial.applied === false || !connected) return failed(initial.error || 'home-unavailable', id);
            loadCycle += 1; progress(0, 'loading');
            try {
              const result = await arrange(next, variant);
              if (destroyed || request !== requestRevision) return failed(destroyed ? 'destroyed' : 'superseded', id);
              if (result.applied) { arrangementId = id; progress(1, 'complete'); }
              return result;
            } catch (error) { return failed('home-load-failed', id, error.message); }
          });
          const reported = pending.then(reportOutcome);
          operations = reported.then(() => undefined, () => undefined); return reported;
        },
        setActive(value) {
          if (destroyed) return;
          active = Boolean(value); container.hidden = !active;
          home?.setActive(active);
        },
        resize() {
          if (destroyed || !childWindow) return;
          try { childWindow.dispatchEvent(new childWindow.Event('resize')); } catch { /* Container resize is observed by the child too. */ }
        },
        destroy() {
          if (destroyed) return;
          destroyed = true; requestRevision += 1;
          settle(failed('destroyed')); global.clearTimeout(readinessTimer);
          iframe.removeEventListener('load', onLoad); iframe.removeEventListener('error', onError);
          childWindow?.removeEventListener?.('paper-home:ready', onHomeReady);
          childWindow?.removeEventListener?.('keydown', onChildKeydown, true);
          for (const cancel of [...pendingImages]) cancel();
          home?.destroy(); home = null; connected = false; iframe.remove();
        },
      });
    };
  }
  global.PaperHomeRoomFactory = Object.freeze({ createRoomFactory });
})(typeof window !== 'undefined' ? window : globalThis);
