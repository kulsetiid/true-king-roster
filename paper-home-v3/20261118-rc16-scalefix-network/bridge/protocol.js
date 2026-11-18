export const PROTOCOL = 'true-king-paper-home-pilot/1';
export const FEATURES = Object.freeze(['roster', 'wishes', 'phone', 'supply', 'warehouse', 'tarot', 'carolyn', 'person', 'formation']);
export const ACTIONS = Object.freeze(['snapshot.read', 'helper.reward', 'warehouse.open', 'feature.open', 'music.setEnabled']);
const INTERACTION = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/;
const HELPERS = new Set(['helper-notes', 'helper-tea', 'helper-candy',
  ...['archive-room', 'reading-room', 'kitchen', 'basement', 'storeroom'].flatMap(room => Array.from({ length: 6 }, (_, index) => `${room}-helper-${index}`))]);
const SPIRIT = /^(?:spirit\.)?[a-z][a-z0-9-]{0,79}$/;

export function bridgeError(code, message, uncertain = false) {
  return Object.assign(new Error(message), { code, uncertain });
}

export function exactOrigin(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.origin === 'null' || url.username || url.password) {
    throw bridgeError('INVALID_ORIGIN', '连接地址必须是明确的 HTTP 或 HTTPS 来源。');
  }
  return url.origin;
}

export function randomToken(crypto = globalThis.crypto) {
  if (!crypto?.getRandomValues) throw bridgeError('CRYPTO_UNAVAILABLE', '无法创建安全连接标识。');
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), value => value.toString(16).padStart(2, '0')).join('');
}

export function normalizeContext(value) {
  if (!value || typeof value !== 'object') throw bridgeError('NO_CONTEXT', '尚未选择可连接的聊天。');
  const scalar = key => {
    const field = value[key];
    if (!(typeof field === 'string' && field.length > 0 && field.length <= 512)
      && !(Number.isSafeInteger(field) && field >= 0)) throw bridgeError('NO_CONTEXT', `无法确认聊天位置：${key}。`);
    return String(field);
  };
  return Object.freeze({ chatId: scalar('chatId'), messageId: scalar('messageId'),
    swipeId: scalar('swipeId'), revision: scalar('revision') });
}

export const sameContext = (left, right) => left && right
  && ['chatId', 'messageId', 'swipeId', 'revision'].every(key => left[key] === right[key]);

export function validateAction(action, payload = {}, operationId) {
  if (!ACTIONS.includes(action)) throw bridgeError('ACTION_NOT_ALLOWED', '此连接不支持该操作。');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw bridgeError('INVALID_REQUEST', '操作参数无效。');
  if (action === 'helper.reward') {
    if (Object.keys(payload).some(key => !['helperId', 'interactionId'].includes(key))
      || !HELPERS.has(payload.helperId) || !INTERACTION.test(payload.interactionId || '')
      || payload.interactionId !== operationId) throw bridgeError('INVALID_REQUEST', '小帮手互动标识无效。');
  } else if (action === 'music.setEnabled') {
    if (Object.keys(payload).length !== 1 || typeof payload.enabled !== 'boolean') throw bridgeError('INVALID_REQUEST', '音乐开关须为明确的开启或关闭。');
  } else if (action === 'feature.open') {
    if (!FEATURES.includes(payload.feature)&&payload.feature!=='registered') throw bridgeError('INVALID_REQUEST', '未知的功能入口。');
    const allowed = payload.feature === 'person' ? ['feature', 'spiritId', 'mode']
      : payload.feature === 'formation' ? ['feature', 'spiritId', 'slot'] : payload.feature==='registered'?['feature','featureId']:['feature'];
    if(payload.feature==='registered'&&!/^[a-z][a-z0-9_.:-]{1,100}$/.test(payload.featureId||''))throw bridgeError('INVALID_REQUEST','功能编号无效。');
    if (Object.keys(payload).some(key => !allowed.includes(key))) throw bridgeError('INVALID_REQUEST', '此入口不接受这些参数。');
    if (payload.feature === 'person' && (!SPIRIT.test(payload.spiritId || '')
      || payload.mode !== undefined && !['profile', 'authority'].includes(payload.mode))) throw bridgeError('INVALID_REQUEST', '角色资料入口无效。');
    if (payload.feature === 'formation' && (payload.spiritId !== undefined && !SPIRIT.test(payload.spiritId)
      || payload.slot !== undefined && (!Number.isInteger(payload.slot) || payload.slot < 0 || payload.slot > 1)
      || payload.spiritId !== undefined && payload.slot !== undefined)) throw bridgeError('INVALID_REQUEST', '编队入口无效。');
  } else if (Object.keys(payload).length) throw bridgeError('INVALID_REQUEST', '此操作不接受附加参数。');
  if (action !== 'snapshot.read' && !INTERACTION.test(operationId || '')) {
    throw bridgeError('INVALID_REQUEST', '缺少本次操作的唯一标识。');
  }
  return action !== 'snapshot.read';
}

export function readPilotConnectionParams(location = globalThis.location) {
  const params = new URLSearchParams(String(location?.hash || '').replace(/^#/, ''));
  const hostOrigin = params.get('tkHost');
  const nonce = params.get('tkSession');
  if (!hostOrigin && !nonce) return null;
  if (!hostOrigin || !/^[a-f0-9]{48}$/.test(nonce || '')) throw bridgeError('INVALID_SESSION', '连接信息不完整，请从酒馆重新打开。');
  return { hostOrigin: exactOrigin(hostOrigin), nonce };
}
