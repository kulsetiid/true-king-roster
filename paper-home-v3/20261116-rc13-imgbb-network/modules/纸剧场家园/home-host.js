/* Home presentation may ask the host to open a feature; it never settles story state. */
(function (global) {
  'use strict';
  const baseURL = /^https?:|^file:/.test(global.document?.baseURI || '') ? global.document.baseURI : 'http://localhost/';
  const scriptURL = global.document?.currentScript?.src || (typeof URL === 'function' ? new URL('home-host.js', baseURL).href : 'http://localhost/home-host.js');
  const coreURL = typeof URL === 'function' ? new URL('../../../真王核心v2/', scriptURL) : 'http://localhost/真王核心v2/';
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const checkedId = value => {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError('入口必须提供非空 ID。');
    return value.trim();
  };
  const coreSpiritId = id => ({ caroline: 'carolyn', elena: 'yelena' }[id] || id);

  function describeRoster(context = {}) {
    const characters = context.characters || context.layout?.characters || [];
    const people = context.people || [];
    const entries = characters.map(character => {
      const residents = people.filter(person => (person.character || person.spiritId) === character.id);
      return {
        id: character.id, name: character.name || character.id, kind: character.kind || 'spirit',
        status: character.status || '', heightCm: character.heightCm ?? null, diameterCm: character.diameterCm ?? null,
        present: residents.length > 0,
        actions: (character.actions || []).filter(action => !action.measurementOnly && !action.dimensionOnly)
          .map(action => ({ id: action.group || action.id, name: action.name || '', pose: action.pose, target: action.target })),
        currentActions: residents.map(person => (character.actions || []).find(action => (action.group || action.id) === person.action)?.name || person.action || ''),
      };
    });
    return { spirits: entries.filter(entry => entry.kind !== 'disc'), helpers: entries.filter(entry => entry.kind === 'disc') };
  }

  /** A file stays on this computer. Importing never starts playback. */
  function createLocalAudioPlayer({ AudioClass = global.Audio, URLApi = global.URL, musicPreference } = {}) {
    const audio = typeof AudioClass === 'function' ? new AudioClass() : null;
    const listeners = new Set();
    let objectURL = null, track = null, error = '', disposed = false;
    let enabled = Boolean(musicPreference?.getState?.().enabled);
    const state = () => ({ track: track && { ...track }, playing: Boolean(audio && !audio.paused), enabled,
      currentTime: Number.isFinite(audio?.currentTime) ? audio.currentTime : 0,
      duration: Number.isFinite(audio?.duration) ? audio.duration : null, error, available: Boolean(audio) });
    const publish = () => { if (!disposed) for (const listener of listeners) listener(state()); };
    const events = ['play', 'pause', 'timeupdate', 'loadedmetadata', 'ended'];
    for (const event of events) audio?.addEventListener(event, publish);
    const onError = () => { error = '这个音频暂时无法播放，请换一个浏览器支持的音频文件。'; publish(); };
    audio?.addEventListener('error', onError);
    const offPreference = musicPreference?.subscribe?.(next => {
      enabled = Boolean(next.enabled);
      if (!enabled) audio?.pause();
      publish();
    });
    function clear() {
      audio?.pause();
      if (audio) { audio.removeAttribute('src'); audio.load(); }
      if (objectURL) URLApi?.revokeObjectURL?.(objectURL);
      objectURL = null; track = null; error = ''; publish();
    }
    return Object.freeze({
      getState: state,
      subscribe(listener) { if (disposed) return () => {}; listeners.add(listener); listener(state()); return () => listeners.delete(listener); },
      importFile(file) {
        if (disposed) throw new Error('唱片机已经关闭。');
        if (!audio || !URLApi?.createObjectURL) throw new Error('当前环境无法播放本地音频。');
        if (!file || (!/^audio\//i.test(file.type || '') && !/\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i.test(file.name || ''))) throw new TypeError('请选择音频文件。');
        clear();
        objectURL = URLApi.createObjectURL(file);
        track = { name: file.name || '本地音频', type: file.type || '', size: Number(file.size) || 0 };
        audio.src = objectURL; audio.preload = 'metadata'; audio.loop = true; audio.load();
        publish(); return state();
      },
      async play() {
        if (disposed || !audio || !track) return { ok: false, reason: '请先放入一份本地音频。' };
        error = '';
        try { await audio.play(); enabled = true; musicPreference?.setEnabled?.(true); publish(); return { ok: true }; }
        catch { error = '音频没有开始播放，请再点击一次播放或换一份音频。'; publish(); return { ok: false, reason: error }; }
      },
      pause() { if (!disposed) { audio?.pause(); publish(); } },
      setEnabled(value) {
        if (disposed) return;
        enabled = Boolean(value); musicPreference?.setEnabled?.(enabled);
        if (!enabled) audio?.pause();
        publish();
      },
      seek(value) { if (audio && track && Number.isFinite(value) && !disposed) audio.currentTime = Math.max(0, Math.min(Number.isFinite(audio.duration) ? audio.duration : value, value)); },
      clear,
      destroy() {
        if (disposed) return;
        clear(); disposed = true; offPreference?.();
        for (const event of events) audio?.removeEventListener(event, publish);
        audio?.removeEventListener('error', onError); listeners.clear();
      },
    });
  }

  // Reuse the accepted wish artwork and its controller only when a real wish module is supplied.
  async function mountOriginalWishes(container, { wishModule, onClose, hostWindow = global } = {}) {
    const [module, layoutReply, styleReply] = await Promise.all([
      import(new URL('ui/paper-wish-view.js', coreURL).href),
      global.fetch(new URL('assets/paper-roster/validation/小黑板愿望-v5/姬月愿望-黑板布局-v5.json', coreURL)),
      global.fetch(new URL('ui/paper-wish.css', coreURL)),
    ]);
    if (!layoutReply.ok || !styleReply.ok) throw new Error('愿望黑板素材暂时没有加载成功。');
    const layout = await layoutReply.json(); layout.styleText = await styleReply.text();
    delete layout.assetRoot; delete layout.navigation; delete layout.footerNote;
    for (const asset of Object.values(layout.assets)) {
      asset.src = new URL(asset.file, new URL('assets/paper-roster/', coreURL)).href;
      delete asset.file;
    }
    const view = module.mountPaperWishes(container, { hostWindow, layout, onClose });
    await view.initialize(wishModule || null); await view.prepare();
    return view;
  }

  function createHost(adapter = {}) {
    const entries = new Map();
    let disposed = false;
    const eventTarget = adapter.eventTarget || global;
    const descriptors = {
      roster: context => ({ id: 'roster', title: '花名册', kind: 'roster', summary: '冠冕之灵与小帮手的生活纸卡登记。', data: describeRoster(context) }),
      person: context => {
        const all = describeRoster(context), id = context.spiritId || context.character || context.person?.character;
        return { id: 'person', title: all.spirits.find(spirit => spirit.id === id)?.name || '人物资料', kind: 'person', summary: '当前角色的动作与尺寸登记。', data: { spirit: [...all.spirits, ...all.helpers].find(spirit => spirit.id === id) || null } };
      },
      wishes: context => ({ id: 'wishes', title: '姬月的愿望', kind: 'wishes', summary: context.wishModule ? '读取当前聊天中的真实愿望。' : '请从真王核心进入，以读取当前聊天中的真实愿望。', data: { connected: Boolean(context.wishModule), localNotesOnly: !context.wishModule, wishModule: context.wishModule || null },
        mount: context.wishModule ? (container, options = {}) => mountOriginalWishes(container, { ...options, wishModule: context.wishModule }) : null }),
      music: () => ({ id: 'music', title: '唱片机', kind: 'music', summary: adapter.musicPreference ? '音乐开关与真王核心的其他页面共用。' : '请从真王核心进入，以使用全局音乐开关。', data: { preference: adapter.musicPreference || null, globalSwitchConnected: Boolean(adapter.musicPreference) } }),
      chat: () => ({ id: 'chat', title: '返回聊天', kind: 'chat', summary: '当前是独立预览；可以返回真王核心的花名册页面。', data: { href: adapter.returnURL || new URL('index.html', coreURL).href, label: '打开真王核心花名册' } }),
    };
    const labels = { roster: '花名册', wishes: '姬月的愿望', music: '唱片机', chat: '返回聊天', person: '人物资料', phone: '纸卡手机', supply: '番茄酱的秘密补给', warehouse: '小帮手的仓库', tarot: '塔罗占卜', carolyn: '虚空武装', formation: '出场编制', helper: '逗逗小帮手' };
    for (const [id, label] of Object.entries(labels)) entries.set(id, { id, label, handler: adapter.callbacks?.[id], fallback: descriptors[id], spiritId: null });
    function registerEntry(entry) {
      if (disposed) throw new Error('家园入口已关闭。');
      const id = checkedId(entry?.id);
      if (entry.handler != null && typeof entry.handler !== 'function') throw new TypeError('入口 handler 必须是函数。');
      if (entry.fallback != null && typeof entry.fallback !== 'function') throw new TypeError('入口 fallback 必须是函数。');
      const stored = { ...entry, id, label: entry.label || id };
      entries.set(id, stored);
      return () => { if (entries.get(id) === stored) entries.delete(id); };
    }
    function capabilities({ spiritId } = {}) {
      return [...entries.values()].filter(entry => !spiritId || entry.spiritId === spiritId || entry.id === 'person')
        .map(entry => ({ id: entry.id, label: entry.label, spiritId: entry.spiritId || null,
          available: Boolean(entry.handler || entry.fallback), mode: entry.handler ? 'host' : entry.fallback ? 'standalone' : 'unavailable' }));
    }
    async function openEntry(rawId, extraContext = {}) {
      const id = checkedId(rawId), entry = entries.get(id);
      if (disposed) return { status: 'unavailable', entry: id, reason: '家园入口已关闭。' };
      if (!entry) return { status: 'unavailable', entry: id, reason: '这个入口尚未登记。' };
      const context = { ...(adapter.getContext?.() || {}), ...extraContext };
      if (entry.spiritId && !context.spiritId) context.spiritId = entry.spiritId;
      if (entry.handler) return { status: 'handled', entry: id, value: await entry.handler(context) };
      let accepted = false, acceptedValue;
      if (eventTarget?.dispatchEvent && typeof global.CustomEvent === 'function') {
        const event = new global.CustomEvent('paper-home:entry-request', { cancelable: true, detail: {
          id, context, accept(value) { if (!accepted) { accepted = true; acceptedValue = typeof value === 'function' ? value(context) : value; } },
        } });
        eventTarget.dispatchEvent(event);
        if (accepted || event.defaultPrevented) return { status: 'handled', entry: id, value: await acceptedValue };
      }
      if (!entry.fallback) return { status: 'unavailable', entry: id, reason: '这个入口需要接入真王核心宿主。' };
      const descriptor = await entry.fallback(context);
      if (!descriptor) return { status: 'unavailable', entry: id, reason: '这个入口暂时没有可展示的内容。' };
      const value = adapter.renderFallback ? await adapter.renderFallback(descriptor, context) : undefined;
      return { status: 'fallback', entry: id, descriptor, value };
    }
    return Object.freeze({
      openEntry, capabilities, registerEntry,
      registerSpiritEntry(spiritId, entry) {
        const spirit = checkedId(spiritId), localId = checkedId(entry?.id);
        return registerEntry({ ...entry, id: `spirit:${spirit}:${localId}`, spiritId: spirit });
      },
      getMusicPreference: () => adapter.musicPreference || null,
      getRoster: () => copy(describeRoster(adapter.getContext?.() || {})),
      destroy() { disposed = true; entries.clear(); },
    });
  }

  /** Adapts the existing mountPaperRoom arguments without changing the host's game rules. */
  function createPaperRoomAdapter(options = {}, overrides = {}) {
    const callbacks = {};
    for (const [id, option] of Object.entries({ roster: 'onRoster', wishes: 'onWishes', phone: 'onPhone', supply: 'onSupply', warehouse: 'onWarehouse', tarot: 'onTarot', carolyn: 'onCarolyn', chat: 'onClose' })) {
      if (typeof options[option] === 'function') callbacks[id] = context => options[option](context);
    }
    if (typeof options.onPerson === 'function') callbacks.person = context => options.onPerson(coreSpiritId(context.spiritId || context.character), context.mode || 'profile');
    if (typeof options.onFormation === 'function') callbacks.formation = context => options.onFormation(coreSpiritId(context.spiritId || context.character));
    if (typeof options.onHelper === 'function') callbacks.helper = context => options.onHelper({ helperId: context.helperId, interactionId: context.interactionId });
    const helperAssets = Object.fromEntries((options.data?.layers || []).filter(layer => /^helper-(notes|tea|candy)$/.test(layer?.id || '') && typeof layer.src === 'string').map(layer => [layer.id, layer.src]));
    return { eventTarget: options.hostWindow || global, musicPreference: options.musicPreference, loadRoom: options.onRoomLoad, ...overrides,
      helperAssets: { ...helperAssets, ...(overrides.helperAssets || {}) },
      callbacks: { ...callbacks, ...(overrides.callbacks || {}) } };
  }
  function createHostFromPaperRoom(options = {}, overrides = {}) { return createHost(createPaperRoomAdapter(options, overrides)); }
  global.PaperHomeHost = Object.freeze({ createHost, createHostFromPaperRoom, createPaperRoomAdapter, createLocalAudioPlayer, describeRoster, mountOriginalWishes, coreSpiritId });
})(typeof window !== 'undefined' ? window : globalThis);
