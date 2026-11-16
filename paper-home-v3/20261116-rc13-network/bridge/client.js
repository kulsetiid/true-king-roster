import { PROTOCOL, bridgeError, exactOrigin, normalizeContext, randomToken, sameContext, validateAction } from './protocol.js';
export { readPilotConnectionParams } from './protocol.js';

export function createPilotClient({ window: clientWindow = globalThis.window, hostWindow = clientWindow?.opener,
  hostOrigin, nonce, requestTimeoutMs = 15000, connectTimeoutMs = 15000, heartbeatTimeoutMs = 15000 } = {}) {
  const origin = exactOrigin(hostOrigin);
  if (!hostWindow || !/^[a-f0-9]{48}$/.test(nonce || '')) throw bridgeError('NO_HOST', '请从酒馆中的入口打开真王核心。');
  let port = null, context = null, state = 'connecting', closed = false, uncertain = false, lastSeen = Date.now();
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Consumers may paint their view before awaiting the handshake.
  ready.catch(() => {});
  const pending = new Map(), listeners = new Set(), eventListeners = new Set();
  const emit = (next, detail = {}) => { state = next; for (const callback of listeners) { try { callback({ state, context, ...detail }); } catch {} } };
  const finish = (code = 'DISCONNECTED', message = '与酒馆的连接已断开。') => {
    if (closed) return;
    closed = true;
    clearInterval(connectInterval); clearInterval(watchdog); clearTimeout(connectTimer);
    clientWindow.removeEventListener('message', onMessage); clientWindow.removeEventListener('pagehide', onUnload);
    port?.close();
    rejectReady(bridgeError(code, message));
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(bridgeError(item.mutation ? 'RESULT_UNCERTAIN' : code,
      item.mutation ? '连接中断，操作结果未确认。请在酒馆核对，勿重复提交。' : message, item.mutation)); }
    pending.clear();
    emit(code === 'STALE_CONTEXT' ? 'stale' : 'disconnected', { code, message });
  };
  const onPortMessage = event => {
    const message = event.data;
    if (closed || message?.protocol !== PROTOCOL || message.nonce !== nonce) return;
    lastSeen = Date.now();
    if (message.type === 'invalidated') { finish(message.error?.code, message.error?.message); return; }
    if (message.type === 'event') {
      if (!sameContext(message.context, context) || !['feature.opening', 'feature.returned', 'feature.failed'].includes(message.name)) return;
      for (const callback of eventListeners) { try { callback({ name: message.name, ...message.data }); } catch {} }
      return;
    }
    if (message.type !== 'response') return;
    const item = pending.get(message.requestId);
    if (!item) return;
    pending.delete(message.requestId); clearTimeout(item.timer);
    if (!message.ok) {
      if (message.error?.uncertain) { uncertain = true; emit('uncertain', { message: message.error.message }); }
      item.reject(bridgeError(message.error?.code || 'HOST_ERROR', message.error?.message || '未能完成操作。', Boolean(message.error?.uncertain)));
    } else if (!sameContext(message.context, context)) {
      item.reject(bridgeError('STALE_CONTEXT', '返回结果属于之前的聊天位置。', item.mutation)); finish('STALE_CONTEXT', '聊天位置发生变化。');
    } else item.resolve(message.result);
  };
  const onMessage = event => {
    const message = event.data;
    if (closed || port || event.origin !== origin || event.source !== hostWindow
      || message?.protocol !== PROTOCOL || message.nonce !== nonce) return;
    if (message.type === 'rejected') { finish(message.error?.code, message.error?.message); return; }
    if (message.type !== 'connected' || !event.ports?.[0]) return;
    try { context = normalizeContext(message.context); } catch (error) { finish(error.code, error.message); return; }
    port = event.ports[0]; port.onmessage = onPortMessage; port.start?.();
    clearInterval(connectInterval); clearTimeout(connectTimer); lastSeen = Date.now();
    emit('connected'); resolveReady({ context, capabilities: message.capabilities });
  };
  const onUnload = () => { try { port?.postMessage({ protocol: PROTOCOL, type: 'disconnect', nonce }); } catch {} finish(); };
  clientWindow.addEventListener('message', onMessage); clientWindow.addEventListener('pagehide', onUnload);
  const connect = () => { if (!closed && !port) hostWindow.postMessage({ protocol: PROTOCOL, type: 'connect', nonce }, origin); };
  const connectInterval = setInterval(connect, 250);
  const connectTimer = setTimeout(() => finish('CONNECT_TIMEOUT', '未能连接酒馆，请返回酒馆重新打开。'), connectTimeoutMs);
  const watchdog = setInterval(() => {
    if (port && (hostWindow.closed || Date.now() - lastSeen > heartbeatTimeoutMs)) finish('DISCONNECTED', '酒馆连接已失去响应，请重新连接。');
  }, Math.max(10, Math.min(1000, heartbeatTimeoutMs / 2)));
  connect();
  const request = async (action, payload = {}, operationId, timeoutMs = requestTimeoutMs) => {
    validateAction(action, payload, operationId);
    const mutation = action === 'helper.reward';
    await ready;
    if (closed) throw bridgeError('DISCONNECTED', '当前页面已经断开连接。');
    if (mutation && uncertain) throw bridgeError('RESULT_UNCERTAIN', '上一项操作尚未确认，请先在酒馆核对并重新连接。', true);
    const requestId = randomToken(clientWindow.crypto);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        if (mutation) { uncertain = true; emit('uncertain', { message: '操作结果未确认，请在酒馆核对。' }); }
        reject(bridgeError(mutation ? 'RESULT_UNCERTAIN' : 'REQUEST_TIMEOUT', mutation
          ? '操作结果未确认，请在酒馆核对，勿重复提交。' : '读取超时，请稍后重试。', mutation));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer, mutation });
      try { port.postMessage({ protocol: PROTOCOL, type: 'request', nonce, context, requestId, action, payload, operationId }); }
      catch { clearTimeout(timer); pending.delete(requestId); reject(bridgeError('DISCONNECTED', '请求未能发送，请重新连接。')); finish(); }
    });
  };
  return {
    ready,
    readSnapshot: () => request('snapshot.read'),
    rewardHelper: ({ helperId, interactionId }) => request('helper.reward', { helperId, interactionId }, interactionId),
    openWarehouse: () => request('warehouse.open', {}, `warehouse:${randomToken(clientWindow.crypto)}`),
    openFeature: (feature, payload = {}) => request('feature.open', { ...payload, feature }, `feature:${randomToken(clientWindow.crypto)}`, Math.max(requestTimeoutMs, 120000)),
    setMusicEnabled: enabled => request('music.setEnabled', { enabled }, `music:${randomToken(clientWindow.crypto)}`),
    onEvent(callback) { eventListeners.add(callback); return () => eventListeners.delete(callback); },
    onStatus(callback) { listeners.add(callback); callback({ state, context }); return () => listeners.delete(callback); },
    getContext: () => context && { ...context },
    disconnect: onUnload,
  };
}
