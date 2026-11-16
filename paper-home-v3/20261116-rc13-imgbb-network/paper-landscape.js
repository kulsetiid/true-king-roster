// One policy for every screen inside the paper theatre, including standalone previews.
export function needsPaperLandscape(width, height) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > width && width <= 900;
}

export const PAPER_LANDSCAPE_CSS = `
.paper-orientation{position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;padding:28px;border:0;background:radial-gradient(ellipse at 50% 35%,#f7e9cd,#d7bd92);color:#65472f;font-family:KaiTi,STKaiti,serif;text-align:center;box-sizing:border-box}
.paper-orientation[open]{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}.paper-orientation::backdrop{background:#36291d}.paper-orientation h2{font-size:27px;font-weight:normal;margin:8px 0 0}.paper-orientation p{max-width:280px;font-size:17px;line-height:1.8;margin:0}.paper-orientation button{font:16px KaiTi,STKaiti,serif;border:1px solid #a58960;background:#f8ecd3;color:#795938;padding:10px 22px;margin-top:15px;cursor:pointer}.paper-orientation button:focus-visible{outline:3px solid #758765;outline-offset:4px}.paper-rotate-phone{position:relative;display:block;width:110px;height:65px;border:4px solid #8f7453;border-radius:12px;box-shadow:4px 5px 0 #8e71482b;background:#f8ecd1}.paper-rotate-phone::before{content:'↷';position:absolute;left:20px;top:-40px;font:43px Georgia,serif;color:#879267}.paper-rotate-phone::after{content:'';position:absolute;right:7px;top:24px;width:6px;height:6px;border:1px solid #ab916c;border-radius:50%}
`;

export function paperLandscapeMarkup(exitLabel = '返回') {
  return `<dialog class="paper-orientation" aria-label="请横着使用手机"><span class="paper-rotate-phone" aria-hidden="true"></span><h2>把手机横过来吧</h2><p>纸剧场要横着看，才能铺开完整的场景与纸页。</p><button type="button" class="paper-orientation-exit">${exitLabel}</button></dialog>`;
}

export function createPaperLandscapeGuard(root, { hostWindow, isOpen = () => true, onExit, onChange } = {}) {
  const win = hostWindow || root.ownerDocument.defaultView;
  const dialog = root.querySelector('.paper-orientation');
  const exitButton = dialog.querySelector('.paper-orientation-exit');
  if (exitButton) exitButton.hidden = typeof onExit !== 'function';
  let blocked = false;
  const sync = () => {
    const width = win.visualViewport?.width || win.innerWidth;
    const height = win.visualViewport?.height || win.innerHeight;
    const next = isOpen() && needsPaperLandscape(width, height);
    if (next && !dialog.open) dialog.showModal?.();
    else if (!next && dialog.open) dialog.close?.();
    if (blocked !== next) { blocked = next; onChange?.(blocked); }
    return blocked;
  };
  const exit = () => { onExit?.(); sync(); };
  const cancel = event => { event.preventDefault(); exit(); };
  exitButton?.addEventListener('click', exit);
  dialog.addEventListener('cancel', cancel);
  win.addEventListener('resize', sync);
  win.addEventListener('orientationchange', sync);
  win.visualViewport?.addEventListener('resize', sync);
  sync();
  return { sync, get blocked() { return blocked; }, destroy() {
    win.removeEventListener('resize', sync); win.removeEventListener('orientationchange', sync);
    win.visualViewport?.removeEventListener('resize', sync);
    exitButton?.removeEventListener('click', exit);
    dialog.removeEventListener('cancel', cancel); if (dialog.open) dialog.close?.();
  } };
}
