
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

function initContextMenus(){
  try { chrome.contextMenus.removeAll(); } catch (e) {}
  chrome.contextMenus.create({ id:"ps-quick", title:"PromptShelf: Quick add selection", contexts:["selection"] });
  chrome.contextMenus.create({ id:"ps-open",  title:"PromptShelf: Add & open editor",  contexts:["selection"] });
}

chrome.runtime.onInstalled.addListener(()=>{ seedIfEmpty(); initContextMenus(); });
chrome.runtime.onStartup.addListener(()=>{ initContextMenus(); });

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
