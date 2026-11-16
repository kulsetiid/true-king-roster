// Native-size controls sit outside the scaled paper board on short screens.
export function mountMobileNavigation(doc = document) {
  const style = doc.createElement('style');
  style.textContent = `.phone-nav{display:none}.phone-nav-dialog{max-width:calc(100vw - 24px);width:510px;border:1px solid #aa895e;border-radius:10px;background:#f5e8cd;color:#62482d;padding:18px;font:16px/1.5 KaiTi,serif}.phone-nav-dialog::backdrop{background:#17271dcc}.phone-nav-dialog h2{font-size:23px;margin:0 0 10px}.phone-nav-items{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.phone-nav-items button{min-height:44px;padding:8px;font-size:16px}.phone-nav-dialog form{text-align:right;margin:12px 0 0}@media(max-height:550px){.phone-nav{display:flex;gap:6px}.phone-nav button{min-height:36px;padding:6px 12px;font-size:15px}.pilot-bar{gap:8px;padding:3px 8px;min-height:42px}.pilot-bar>strong{display:none}#connection{font-size:11px}}`;
  doc.head.append(style);
  const nav = doc.createElement('div'); nav.className = 'phone-nav';
  const dialog = doc.createElement('dialog'); dialog.className = 'phone-nav-dialog';
  dialog.innerHTML = '<h2></h2><div class="phone-nav-items"></div><form method="dialog"><button>返回房间</button></form>';
  doc.body.append(dialog);
  for (const [label, selector] of [['房间','#roomDirectory button'],['人物','#residents button']]) {
    const button = doc.createElement('button'); button.textContent = label; button.type = 'button';
    button.onclick = () => {
      const room = doc.getElementById('room');
      const scene = (room?.shadowRoot || room)?.querySelector('iframe')?.contentDocument;
      dialog.querySelector('h2').textContent = label === '房间' ? '前往房间' : '此刻在';
      const items = dialog.querySelector('.phone-nav-items'); items.replaceChildren();
      for (const source of scene?.querySelectorAll(selector) || []) {
        const target = doc.createElement('button'); target.textContent = source.innerText; target.disabled = source.disabled;
        target.onclick = () => { dialog.close(); source.click(); }; items.append(target);
      }
      if (!items.childElementCount) items.textContent = '小帮手正在布置房间……';
      dialog.showModal();
    };
    nav.append(button);
  }
  doc.querySelector('.pilot-bar nav').before(nav);
  return { close() { if (dialog.open) dialog.close(); }, destroy() { nav.remove(); dialog.remove(); style.remove(); } };
}
