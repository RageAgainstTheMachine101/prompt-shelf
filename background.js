
/* global chrome */
async function seedIfEmpty(){
  const {prompts}=await chrome.storage.local.get("prompts");
  if(Array.isArray(prompts)&&prompts.length) return;
  const now=Date.now();
  const sample=[
    {id:crypto.randomUUID(),title:"Bug Triage (Concise)",text:"You are a senior developer. Given an issue description, propose: 1) likely cause, 2) reproduction steps, 3) minimal test, 4) fix plan.",tags:["dev","triage","concise"],category:"favorite",updatedAt:now},
    {id:crypto.randomUUID(),title:"Summarize Meeting",text:"Summarize the transcript into decisions, owners, deadlines, risks, open questions. Be crisp.",tags:["summary","meetings"],category:"other",updatedAt:now},
    {id:crypto.randomUUID(),title:"SQL Explainer",text:"Explain the following SQL step-by-step, note performance pitfalls, and suggest an index if helpful.",tags:["sql","explain"],category:"recent",updatedAt:now}
  ];
  await chrome.storage.local.set({prompts:sample});
}

/* ===== PromptShelf Sync Engine (chrome.storage.sync) ===== */

const SYNC = {
  PREFIX: 'psync_ch_',
  INDEX: 'psync_index',
  // Keep well under 8192 bytes per item to include key/metadata overhead
  MAX_BYTES_PER_ITEM: 7000
};

const __te = new TextEncoder();

let lastWrittenSyncHash = null;   // hash of last payload we wrote to sync
let lastAppliedSyncHash = null;   // hash of last payload we applied from sync to local
let suppressLocalChange = false;  // guard to avoid echo loops
let __writeTimer = null;
let __applyTimer = null;

async function ensureDefaultSyncEnabled(){
  try{
    const {syncEnabled} = await chrome.storage.local.get('syncEnabled');
    if (syncEnabled === undefined) await chrome.storage.local.set({ syncEnabled: true });
  }catch(_){}
}

function djb2Hash(str){
  let h = 5381;
  for (let i=0;i<str.length;i++){
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

function splitByBytes(str, maxBytes=SYNC.MAX_BYTES_PER_ITEM){
  const out = [];
  let i = 0;
  while (i < str.length){
    // Binary search the largest slice not exceeding maxBytes when UTF-8 encoded
    let low = 1;
    let high = Math.min(str.length - i, maxBytes);
    let best = low;
    while (low <= high){
      const mid = Math.floor((low + high) / 2);
      const slice = str.slice(i, i + mid);
      const size = __te.encode(slice).length;
      if (size <= maxBytes){ best = mid; low = mid + 1; }
      else { high = mid - 1; }
    }
    const piece = str.slice(i, i + best);
    out.push(piece);
    i += best;
  }
  return out;
}

async function isSyncEnabled(){
  try{
    const {syncEnabled} = await chrome.storage.local.get('syncEnabled');
    return syncEnabled !== false; // default true
  }catch(_){ return true; }
}

async function writePromptsToSync(prompts){
  if (!(await isSyncEnabled())) return;
  try{
    const payload = JSON.stringify({ prompts: Array.isArray(prompts)?prompts:[], ts: Date.now() });
    const hash = djb2Hash(payload);
    if (hash === lastAppliedSyncHash || hash === lastWrittenSyncHash) return; // avoid echo
    const chunks = splitByBytes(payload, SYNC.MAX_BYTES_PER_ITEM);
    const index = { v:1, n: chunks.length, hash, ts: Date.now() };

    const prevIdxObj = await chrome.storage.sync.get(SYNC.INDEX);
    const prevN = prevIdxObj?.[SYNC.INDEX]?.n || 0;

    const toSet = { [SYNC.INDEX]: index };
    for (let i=0;i<chunks.length;i++) toSet[SYNC.PREFIX + i] = chunks[i];
    await chrome.storage.sync.set(toSet);

    if (prevN > chunks.length){
      const toRemove = [];
      for (let i=chunks.length;i<prevN;i++) toRemove.push(SYNC.PREFIX + i);
      if (toRemove.length) await chrome.storage.sync.remove(toRemove);
    }

    lastWrittenSyncHash = hash;
  }catch(e){
    console.warn('[PromptShelf][BG] writePromptsToSync error', e);
  }
}

async function readPromptsFromSync(){
  try{
    const idxObj = await chrome.storage.sync.get(SYNC.INDEX);
    const idx = idxObj?.[SYNC.INDEX];
    if (!idx || !idx.n) return null;
    const keys = Array.from({length: idx.n}, (_,i)=> SYNC.PREFIX + i);
    const chunksObj = await chrome.storage.sync.get(keys);
    let payload = '';
    for (let i=0;i<idx.n;i++) payload += (chunksObj[SYNC.PREFIX + i] || '');
    return { payload, idx };
  }catch(e){
    console.warn('[PromptShelf][BG] readPromptsFromSync error', e);
    return null;
  }
}

function mergePrompts(localArr, remoteArr){
  const map = new Map();
  for (const p of Array.isArray(localArr)?localArr:[]) if (p && p.id) map.set(p.id, p);
  for (const p of Array.isArray(remoteArr)?remoteArr:[]) if (p && p.id){
    const a = map.get(p.id);
    if (!a) map.set(p.id, p);
    else map.set(p.id, (p.updatedAt||0) > (a.updatedAt||0) ? p : a);
  }
  return Array.from(map.values()).sort((x,y)=>(y.updatedAt||0)-(x.updatedAt||0));
}

async function applySyncToLocal(){
  try{
    const res = await readPromptsFromSync();
    if (!res) return;
    const { payload } = res;
    const hash = djb2Hash(payload);
    if (hash === lastWrittenSyncHash || hash === lastAppliedSyncHash) return;

    let data = null;
    try{ data = JSON.parse(payload); }catch(e){ console.warn('[PromptShelf][BG] sync payload parse error', e); return; }
    const remote = Array.isArray(data.prompts) ? data.prompts : [];
    const {prompts: local=[]} = await chrome.storage.local.get('prompts');
    const merged = mergePrompts(local, remote);

    if (JSON.stringify(local) === JSON.stringify(merged)) {
      lastAppliedSyncHash = hash;
      return;
    }

    suppressLocalChange = true;
    await chrome.storage.local.set({prompts: merged});
    suppressLocalChange = false;
    lastAppliedSyncHash = hash;
    try{ chrome.runtime.sendMessage({type:"PROMPTS_UPDATED"}); }catch(_){}
  }catch(e){
    console.warn('[PromptShelf][BG] applySyncToLocal error', e);
  }
}

async function bootstrapSyncPushIfEmpty(){
  try{
    if (!(await isSyncEnabled())) return;
    const idxObj = await chrome.storage.sync.get(SYNC.INDEX);
    const idx = idxObj?.[SYNC.INDEX];
    if (idx && idx.n > 0) return; // sync already has data
    const {prompts=[]} = await chrome.storage.local.get('prompts');
    if (Array.isArray(prompts) && prompts.length){
      await writePromptsToSync(prompts);
    }
  }catch(e){
    console.warn('[PromptShelf][BG] bootstrapSyncPushIfEmpty error', e);
  }
}
 
function startSyncWatchers(){
  function debouncedWrite(prompts){ clearTimeout(__writeTimer); __writeTimer = setTimeout(()=> writePromptsToSync(prompts), 600); }
  function debouncedApply(){ clearTimeout(__applyTimer); __applyTimer = setTimeout(()=> applySyncToLocal(), 400); }

  chrome.storage.onChanged.addListener((changes, areaName)=>{
    if (areaName === 'local' && changes.prompts && !suppressLocalChange){
      const next = changes.prompts.newValue || [];
      debouncedWrite(next);
    }
    if (areaName === 'sync'){
      const keys = Object.keys(changes);
      if (keys.some(k => k === SYNC.INDEX || k.startsWith(SYNC.PREFIX))){
        debouncedApply();
      }
    }
  });
}

/* ===== End Sync Engine ===== */

function initContextMenus(){
  try { chrome.contextMenus.removeAll(); } catch (e) {}
  chrome.contextMenus.create({ id:"ps-quick", title:"PromptShelf: Quick add selection", contexts:["selection"] });
  chrome.contextMenus.create({ id:"ps-open",  title:"PromptShelf: Add & open editor",  contexts:["selection"] });
}

chrome.runtime.onInstalled.addListener(()=>{ (async()=>{
  await ensureDefaultSyncEnabled();
  initContextMenus();
  startSyncWatchers();
  await applySyncToLocal();
  await bootstrapSyncPushIfEmpty();
  await seedIfEmpty();
})() });
chrome.runtime.onStartup.addListener(()=>{
  initContextMenus();
  startSyncWatchers();
  applySyncToLocal();
  bootstrapSyncPushIfEmpty();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('[PromptShelf][BG] contextMenus.onClicked', {
    menuItemId: info && info.menuItemId,
    hasSelection: !!(info && info.selectionText),
    tabId: tab && tab.id,
    windowId: tab && tab.windowId
  });
  if (!info || !info.menuItemId || !info.selectionText) {
    console.log('[PromptShelf][BG] onClicked: missing required info/selection, ignoring');
    return;
  }
  const text = (info.selectionText || "").trim();
  const title = text.split(/\s+/).slice(0,5).join(" ") || "(untitled)";
  if (info.menuItemId === "ps-quick") {
    console.log('[PromptShelf][BG] ps-quick: saving selection', { selLen: text.length, title });
    const {prompts=[]} = await chrome.storage.local.get("prompts");
    prompts.push({id:crypto.randomUUID(), title, text, tags:[], category:"other", updatedAt:Date.now()});
    await chrome.storage.local.set({prompts});
    chrome.runtime.sendMessage({type:"PROMPTS_UPDATED"});
    console.log('[PromptShelf][BG] ps-quick: saved and notified');
  }
  if (info.menuItemId === "ps-open") {
    console.log('[PromptShelf][BG] ps-open: storing draft and opening editor', { selLen: text.length, title });
    await chrome.storage.local.set({draftPrompt:{title, text, tags:[], category:"other"}});
    try {
      if (chrome.sidePanel && chrome.sidePanel.open) {
        if (tab && tab.id && tab.windowId) {
          await chrome.sidePanel.setOptions({ tabId: tab.id, path: "sidepanel.html", enabled: true });
          await chrome.sidePanel.open({ windowId: tab.windowId });
          console.log('[PromptShelf][BG] ps-open: sidepanel opened');
          return;
        }
      }
    } catch (e) {
      console.warn('[PromptShelf][BG] ps-open: sidepanel open failed, will fallback', e);
    }
    chrome.windows.create({ url: "editor.html", type: "popup", width: 420, height: 600 });
    console.log('[PromptShelf][BG] ps-open: popup editor opened');
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[PromptShelf][BG] onMessage received', { type: msg && msg.type, from: sender && (sender.tab ? 'tab' : 'ext') });
  (async () => {
    if(msg?.type==="QUICK_SAVE_FROM_SELECTION"){
      try {
        const text=(msg.text||"").trim();
        console.log('[PromptShelf][BG] QUICK_SAVE_FROM_SELECTION', { selLen: text.length });
        if(!text) { sendResponse({ok:false, error:"empty"}); return; }
        const title=text.split(/\s+/).slice(0,5).join(" ")||"(untitled)";
        const {prompts=[]}=await chrome.storage.local.get("prompts");
        prompts.push({id:crypto.randomUUID(),title,text,tags:[],category:"other",updatedAt:Date.now()});
        await chrome.storage.local.set({prompts});
        chrome.runtime.sendMessage({type:"PROMPTS_UPDATED"});
        sendResponse({ok:true});
        console.log('[PromptShelf][BG] quick: saved and responded ok');
      } catch (e) { console.error('[PromptShelf][BG] quick error', e); sendResponse({ok:false, error:String(e)}); }
      return;
    }
    if(msg?.type==="OPEN_EDITOR_FROM_SELECTION"){
      try {
        const text=(msg.text||"").trim();
        const title=text.split(/\s+/).slice(0,5).join(" ")||"(untitled)";
        console.log('[PromptShelf][BG] OPEN_EDITOR_FROM_SELECTION', { selLen: text.length, title });
        await chrome.storage.local.set({draftPrompt:{title,text,tags:[],category:"other"}});
        if(chrome.sidePanel && chrome.sidePanel.open){
          const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
          if(tab && tab.windowId){
            await chrome.sidePanel.setOptions({tabId:tab.id,path:"sidepanel.html",enabled:true});
            await chrome.sidePanel.open({windowId:tab.windowId});
            sendResponse({ok:true, opened:"sidepanel"});
            console.log('[PromptShelf][BG] open: sidepanel opened and responded ok');
            return;
          }
        }
        chrome.windows.create({url:"editor.html",type:"popup",width:420,height:600});
        sendResponse({ok:true, opened:"popup"});
        console.log('[PromptShelf][BG] open: popup editor opened and responded ok');
      } catch (e) { console.error('[PromptShelf][BG] open error', e); sendResponse({ok:false, error:String(e)}); }
      return;
    }
  })();
  // Keep the message channel open for the async sendResponse above
  return true;
});
