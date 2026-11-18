const clone=x=>structuredClone(x);
const canonical=x=>x instanceof RegExp?x.toString():Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function toHelperRegex(r){return {id:r.id,script_name:r.scriptName,enabled:!r.disabled,find_regex:r.findRegex,replace_string:r.replaceString,trim_strings:r.trimStrings||[],source:{user_input:r.placement.includes(1),ai_output:r.placement.includes(2),slash_command:r.placement.includes(3),world_info:r.placement.includes(5),reasoning:r.placement.includes(6)},destination:{display:!!r.markdownOnly,prompt:!!r.promptOnly},run_on_edit:!!r.runOnEdit,min_depth:r.minDepth??null,max_depth:r.maxDepth??null};}
export function mergeRawRegexes(raw,next){return next.map(r=>{const old=raw.find(x=>x.id===r.id)||raw.find(x=>x.findRegex===r.find_regex&&/真王|命定系统/.test(x.scriptName));if(old&&equal(toHelperRegex(old),r))return old;return {...old,id:r.id,scriptName:r.script_name,disabled:!r.enabled,findRegex:r.find_regex,replaceString:r.replace_string,trimStrings:r.trim_strings,placement:[[1,'user_input'],[2,'ai_output'],[3,'slash_command'],[5,'world_info'],[6,'reasoning']].filter(([id,k])=>r.source[k]).map(([id])=>id),markdownOnly:r.destination.display,promptOnly:r.destination.prompt,runOnEdit:r.run_on_edit,minDepth:r.min_depth,maxDepth:r.max_depth,substituteRegex:old?.substituteRegex??0};});}
const sameRule=(a,b)=>a&&b&&a.find_regex===b.find_regex&&a.replace_string===b.replace_string&&a.enabled===b.enabled;
const matches=(a,b)=>a.id===b.id||(a.find_regex===b.find_regex&&/真王|命定系统/.test(a.script_name));
const ownEntry=(e,b)=>e.extra?.trueKingComponent===b.worldbook.id||e.name===b.worldbook.name||(/true_king_v2\.prompt_payload/.test(e.content)&&/true-king-composition-v2/.test(e.content));
function newEntry(b,uid){return {uid,name:b.worldbook.name,enabled:true,content:b.worldbook.content,strategy:{type:'constant',keys:[],keys_secondary:{logic:'and_any',keys:[]},scan_depth:'same_as_global'},position:{type:'at_depth',role:'system',depth:1,order:1100},probability:100,recursion:{prevent_incoming:true,prevent_outgoing:true,delay_until:null},effect:{sticky:null,cooldown:null,delay:null},extra:{trueKingComponent:b.worldbook.id}};}
export async function planComponents(api,bundle,state={}){
  const target=api.getCurrentCharacterName();if(!target)throw Error('请先在酒馆打开要安装的角色卡，再点击安装。');
  const targetId=api.getCurrentCharacterId();
  const binding=api.getCharWorldbookNames('current');
  const names=[...new Set([binding.primary,...binding.additional,...api.getGlobalWorldbookNames(),api.getChatWorldbookName('current')].filter(Boolean))];
  const books=[];for(const name of names)books.push({name,before:await api.getWorldbook(name)});
  let chosen=books.find(x=>x.before.some(e=>ownEntry(e,bundle)));
  let newBinding=clone(binding);
  if(!chosen){
    chosen=books.find(x=>x.name===binding.primary);
    if(!chosen){let name='真王核心·配套世界书';const all=api.getWorldbookNames();let n=2;while(all.includes(name))name='真王核心·配套世界书 '+n++;chosen={name,before:[],created:true};books.push(chosen);newBinding.additional.push(name);}
  }
  const conflicts=[];
  for(const book of books){
    const owned=book.before.filter(e=>ownEntry(e,bundle));
    for(const e of owned){const last=state.receipt?.entries?.find(x=>x.book===book.name&&x.uid===e.uid);if(last&&e.content!==last.content)conflicts.push(book.name+' / '+e.name);}
    const first=owned[0];book.affected=owned;book.after=clone(book.before);
    if(book===chosen){
      if(first)book.after=book.after.map(e=>e.uid===first.uid?{...e,name:bundle.worldbook.name,content:bundle.worldbook.content,enabled:true,extra:{...e.extra,trueKingComponent:bundle.worldbook.id}}:ownEntry(e,bundle)?{...e,enabled:false}:e);
      else book.after.push(newEntry(bundle,Math.max(-1,...book.before.map(e=>e.uid))+1));
    }else book.after=book.after.map(e=>ownEntry(e,bundle)?{...e,enabled:false}:e);
    book.changed=!equal(book.before,book.after);
  }
  const scopes=['global','character'].map(type=>({type,before:api.getTavernRegexes({type})}));
  for(const s of scopes){s.after=clone(s.before);s.ids=[];}
  for(const item of bundle.regexes){
    const next=toHelperRegex(item.rule);
    const globals=scopes[0].before.filter(r=>matches(r,next));
    // Preserve an existing global installation; fresh rules belong to this card.
    const destination=globals.length?'global':'character';
    for(const s of scopes){
      const prior=s.before.filter(r=>matches(r,next));
      for(const r of prior){const last=state.receipt?.regexes?.find(x=>x.type===s.type&&x.rule.id===r.id);if(last&&!sameRule(r,last.rule))conflicts.push(r.script_name);}
      if(prior.length||s.type===destination){
        s.ids.push(next.id,...prior.map(r=>r.id));let placed=false;
        s.after=s.after.flatMap(r=>{if(!matches(r,next))return [r];if(s.type===destination&&!placed){placed=true;return [next];}return [];});
        if(s.type===destination&&!placed)s.after.push(next);
      }
    }
  }
  for(const s of scopes){s.ids=[...new Set(s.ids)];s.changed=!equal(s.before,s.after);}
  return {target,targetId,binding,newBinding,books:books.filter(b=>b.changed),scopes,conflicts:[...new Set(conflicts)],bundle,worldbook:chosen.name};
}
export async function applyComponents(api,plan,state,save,{overwrite=false}={}){
  if(['installing','incomplete'].includes(state.phase))throw Error('上次组件安装未完成，请先撤回上次组件安装，再重新安装。');
  if(plan.conflicts.length&&!overwrite)throw Error('以下已安装内容被手动修改，请选择保留或使用本包版本：'+plan.conflicts.join('、'));
  const check=()=>{if(api.getCurrentCharacterId()!==plan.targetId)throw Error('角色卡已切换，请在目标卡重新安装。');};check();
  const changed=plan.books.length||plan.scopes.some(s=>s.changed)||!equal(plan.binding,plan.newBinding);
  const backup=changed?{target:plan.target,targetId:plan.targetId,binding:plan.binding,localEnabled:api.isCharacterTavernRegexesEnabled?.(),books:plan.books.map(b=>({name:b.name,created:b.created||false,before:b.affected,ids:b.after.filter(e=>ownEntry(e,plan.bundle)).map(e=>e.uid)})),scopes:plan.scopes.filter(s=>s.changed).map(s=>({type:s.type,ids:s.ids,before:s.before.map((rule,index)=>({rule,index})).filter(x=>s.ids.includes(x.rule.id))}))}:state.backup;
  const next={...state,target:plan.target,targetId:plan.targetId,phase:'installing',backup};await save(next);
  try{
    for(const b of plan.books){check();if(b.created){if(!await api.createWorldbook(b.name,b.after))throw Error('配套世界书名称已被占用，请重新安装。');}else await api.replaceWorldbook(b.name,b.after);}
    check();if(!equal(plan.binding,plan.newBinding))await api.rebindCharWorldbooks('current',plan.newBinding);
    if(plan.scopes.find(s=>s.type==='character').after.some(r=>r.enabled&&plan.bundle.regexes.some(x=>r.id===x.rule.id)))await api.setLocalRegexEnabled?.(true);
    for(const s of plan.scopes.filter(s=>s.changed)){check();await api.replaceTavernRegexes(s.after,{type:s.type});}
    check();
    const entries=[];let enabled=0;
    const names=[...new Set([plan.worldbook,...plan.books.map(b=>b.name)])];
    for(const name of names){const es=await api.getWorldbook(name);for(const e of es.filter(e=>ownEntry(e,plan.bundle))){if(e.enabled)enabled++;entries.push({book:name,uid:e.uid,content:e.content});}}
    if(enabled!==1)throw Error('世界书生效入口数量不是 1，请查看组件详情。');
    const binding=api.getCharWorldbookNames('current');if(!equal(binding,plan.newBinding))throw Error('世界书绑定尚未保存。');
    const regexes=[];for(const s of plan.scopes){const actual=api.getTavernRegexes({type:s.type});for(const id of s.ids){const expected=s.after.find(r=>r.id===id),found=actual.filter(r=>r.id===id);if(expected){if(found.length!==1||!sameRule(found[0],expected))throw Error('美化正则保存未完成：'+id);regexes.push({type:s.type,rule:found[0]});}else if(found.length)throw Error('旧正则仍有重复：'+id);}}
    const result={...next,phase:'complete',buildId:plan.bundle.buildId,receipt:{entries,regexes},completedAt:new Date().toISOString()};await save(result);return result;
  }catch(error){await save({...next,phase:'incomplete',error:error.message});throw error;}
}
export async function rollbackComponents(api,state,save){
  const b=state.backup;if(!b)throw Error('还没有组件安装备份。');
  if(api.getCurrentCharacterId()!==b.targetId)throw Error('请先打开 '+b.target+' 再撤回安装。');
  for(const book of b.books){if(!api.getWorldbookNames().includes(book.name))continue;const now=await api.getWorldbook(book.name);await api.replaceWorldbook(book.name,[...now.filter(e=>!book.ids.includes(e.uid)),...book.before]);}
  await api.rebindCharWorldbooks('current',b.binding);
  for(const s of b.scopes){const now=api.getTavernRegexes({type:s.type}).filter(r=>!s.ids.includes(r.id));for(const x of s.before)now.splice(Math.min(x.index,now.length),0,x.rule);await api.replaceTavernRegexes(now,{type:s.type});}
  if(b.localEnabled!==undefined)await api.setLocalRegexEnabled?.(b.localEnabled);
  await save({...state,phase:'rolled-back',receipt:null});
}

export async function mountInstaller(api,{origin}){
  const helper=api;
  api=new Proxy(helper,{get(target,key){
    if(key==='replaceTavernRegexes')return async (rules,{type})=>{const ctx=helper.parent.SillyTavern.getContext();if(type==='global'){ctx.extensionSettings.regex=mergeRawRegexes(ctx.extensionSettings.regex||[],rules);ctx.saveSettingsDebounced();}else{const raw=ctx.characters[ctx.characterId]?.data?.extensions?.regex_scripts||[];await ctx.writeExtensionField(String(ctx.characterId),'regex_scripts',mergeRawRegexes(raw,rules));}await ctx.reloadCurrentChat();};
    if(key==='setLocalRegexEnabled')return async enabled=>{const ctx=helper.parent.SillyTavern.getContext(),avatar=ctx.characters[ctx.characterId]?.avatar;if(!avatar)throw Error('当前角色卡不可用。');const list=ctx.extensionSettings.character_allowed_regex||[];ctx.extensionSettings.character_allowed_regex=enabled?[...new Set([...list,avatar])]:list.filter(x=>x!==avatar);ctx.saveSettingsDebounced();};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  const vars=()=>api.getVariables({type:'script'}),request=vars().componentInstallRequest;
  if(!request)return;
  let state=vars().componentInstallState||{};
  if(state.requestId===request.id&&['complete','rolled-back'].includes(state.phase))return;
  const save=async value=>{state={...value,requestId:request.id};api.replaceVariables({...vars(),componentInstallState:state},{type:'script'});};
  const doc=api.parent.document;doc.getElementById('true-king-component-installer')?.remove();
  const panel=doc.createElement('section');panel.id='true-king-component-installer';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','真王核心完整组件安装');
  Object.assign(panel.style,{position:'fixed',right:'24px',top:'45px',zIndex:2147483647,width:'min(460px,90vw)',padding:'24px',boxSizing:'border-box',background:'#fff7e8',color:'#493520',border:'2px solid #ae8446',borderRadius:'14px',font:'16px/1.7 sans-serif',boxShadow:'0 8px 32px #0005'});
  panel.innerHTML='<h2 style="margin:0 0 12px">真王核心 · 完整组件安装</h2><p data-summary></p><p>核心脚本 → 世界书 → 角色美化</p><pre data-status style="white-space:pre-wrap;font:14px/1.7 sans-serif;max-height:35vh;overflow:auto"></pre><div style="display:flex;flex-wrap:wrap;gap:10px"><button data-install>安装到当前角色卡</button><button data-rollback>撤回上次组件安装</button><button data-close>稍后处理</button></div>';
  doc.body.append(panel);const status=panel.querySelector('[data-status]'),summary=panel.querySelector('[data-summary]'),button=panel.querySelector('[data-install]');
  summary.textContent='请在酒馆打开目标角色卡。首次确认后，会记住这张卡；已有全局美化沿用原作用范围，新美化安装到当前卡。';
  const required=['getCurrentCharacterName','getCurrentCharacterId','getCharWorldbookNames','getGlobalWorldbookNames','getChatWorldbookName','getWorldbook','getWorldbookNames','createWorldbook','replaceWorldbook','rebindCharWorldbooks','getTavernRegexes','replaceTavernRegexes'];
  const missing=required.filter(k=>typeof api[k]!=='function');if(missing.length){status.textContent='请更新酒馆助手后重试。缺少接口：'+missing.join('、');button.disabled=true;return;}
  let overwrite=false;
  const run=async()=>{
    button.disabled=true;
    try{
      const name=api.getCurrentCharacterName();if(!name)throw Error('请先打开目标角色卡。');summary.textContent='安装目标：'+name;
      if(!api.EjsTemplate&&!api.parent.EjsTemplate)throw Error('请先启用提示词模板插件（EjsTemplate），世界书固定入口需要它来展开正文。');
      const response=await api.fetch(origin+'/本地内容/安装/完整组件.json',{cache:'no-store'});if(!response.ok)throw Error('未找到本包组件清单。');const bundle=await response.json();
      const plan=await planComponents(api,bundle,state);
      if(plan.conflicts.length&&!overwrite){status.textContent='发现手动修改：\n'+plan.conflicts.join('\n')+'\n点击“使用本包版本”更新，或稍后处理以保留当前内容。';button.textContent='使用本包版本';overwrite=true;return;}
      status.textContent='✓ 核心脚本已运行\n正在保存世界书与 '+bundle.regexes.length+' 组角色美化…';
      await applyComponents(api,plan,state,save,{overwrite});status.textContent='✓ 核心脚本已运行\n✓ 世界书已保存并绑定：'+plan.worldbook+'\n✓ '+bundle.regexes.length+' 组美化正则已保存并启用\n安装完成。';button.textContent='重新核对／更新';panel.querySelector('[data-close]').textContent='完成';
    }catch(e){status.textContent=e.message;}finally{button.disabled=false;}
  };
  button.onclick=run;panel.querySelector('[data-close]').onclick=()=>panel.remove();
  panel.querySelector('[data-rollback]').onclick=async()=>{try{await rollbackComponents(api,state,save);status.textContent='世界书与正则已恢复到本次安装前。核心脚本回退可在一键包中操作。';}catch(e){status.textContent=e.message;}};
  if(state.targetId&&state.targetId===api.getCurrentCharacterId())await run();
}
