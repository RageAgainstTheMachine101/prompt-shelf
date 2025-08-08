
(() => {
  if (window.__pshelfInjected) return; window.__pshelfInjected = true;
  console.log('[PromptShelf] content script injected');

  const fab = document.createElement('div');
  fab.id='pshelf-fab';
  fab.innerHTML=`
    <div class="pshelf-btn" title="PromptShelf">
      <img src="${chrome.runtime.getURL('images/logo.png')}" alt="PromptShelf">
    </div>
    <div class="pshelf-menu">
      <button id="ps-quick">➕ Quick add (title = first 5 words)</button>
      <button id="ps-open">✏️ Add & open editor</button>
    </div>`;
  document.documentElement.appendChild(fab);

  const toast = document.createElement('div');
  toast.id = 'pshelf-toast';
  toast.textContent = 'Saved to PromptShelf';
  document.documentElement.appendChild(toast);

  function showToast(msg='Saved to PromptShelf'){
    toast.textContent = msg;
    toast.style.display = 'block';
    clearTimeout(showToast._t); showToast._t = setTimeout(()=>{ toast.style.display='none'; }, 1200);
  }

  const btn=fab.querySelector('.pshelf-btn');
  const quick=fab.querySelector('#ps-quick');
  const openBtn=fab.querySelector('#ps-open');
  
  // Preserve the most recently detected selection so clicks don't lose it
  let lastSelection = "";
  
  function getSelectedText() {
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && /text|search|url|tel|email|password/.test(active.type)))) {
      const start = active.selectionStart, end = active.selectionEnd;
      if (typeof start === 'number' && typeof end === 'number' && end > start) {
        return active.value.slice(start, end);
      }
    }
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed) return "";
    return String(sel.toString()).trim();
  }

  function showAt(x,y){
    fab.style.left=Math.max(8,Math.min(x+12,window.innerWidth-280))+'px';
    fab.style.top=Math.max(8,Math.min(y+10,window.innerHeight-140))+'px';
    fab.style.display='block';
    fab.classList.add('open');
  }
  function hide(){ fab.style.display='none'; fab.classList.remove('open'); }
  
  // Robust messaging with timeout fallback
  async function sendMessageWithTimeout(message, ms=1500){
    return new Promise((resolve)=>{
      let settled=false;
      const to=setTimeout(()=>{ if(!settled){ settled=true; resolve(null); } }, ms);
      try {
        chrome.runtime.sendMessage(message, (resp)=>{
          if (settled) return;
          settled=true; clearTimeout(to);
          resolve(resp);
        });
      } catch(e){
        if (settled) return;
        settled=true; clearTimeout(to);
        resolve(null);
      }
    });
  }
  
  // Direct storage save fallback (content script path)
  async function savePromptDirect(text){
    try{
      const title = String(text||'').trim().split(/\s+/).slice(0,5).join(' ') || '(untitled)';
      const {prompts=[]} = await chrome.storage.local.get('prompts');
      prompts.push({ id: crypto.randomUUID(), title, text: String(text||'').trim(), tags: [], category: 'other', updatedAt: Date.now() });
      await chrome.storage.local.set({prompts});
      try { chrome.runtime.sendMessage({type:'PROMPTS_UPDATED'}); } catch(_) {}
      return true;
    } catch(e){
      console.error('[PromptShelf] savePromptDirect error', e);
      return false;
    }
  }
  
  // Open editor fallback from CS (popup window)
  function openEditorPopupFallback(){
    const url = chrome.runtime.getURL('editor.html');
    try {
      window.open(url, '_blank', 'width=420,height=600,noopener,noreferrer');
      return true;
    } catch(e){
      console.error('[PromptShelf] openEditorPopupFallback error', e);
      return false;
    }
  }

  let t;
  function considerShow() {
    const text = getSelectedText();
    if (text) {
      // Capture selection now; clicking the menu can collapse selection
      lastSelection = text;
      const sel = window.getSelection && window.getSelection();
      let rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      let x = (rect && rect.width) ? rect.left + rect.width/2 : (window.innerWidth/2);
      let y = (rect && rect.bottom) ? rect.bottom : (window.innerHeight/2);
      showAt(x, y);
    } else {
      hide();
    }
  }
  document.addEventListener('mouseup', () => { clearTimeout(t); t=setTimeout(considerShow, 10); }, true);
  document.addEventListener('selectionchange', () => { clearTimeout(t); t=setTimeout(considerShow, 50); }, true);

  btn.addEventListener('click',()=> {
    console.log('[PromptShelf] FAB toggle click');
    fab.classList.toggle('open');
  });
  quick.addEventListener('click', async ()=>{
    const selNow = getSelectedText();
    const text = selNow || lastSelection;
    console.log('[PromptShelf] ps-quick clicked', { selNowLen: selNow ? selNow.length : 0, usedFallback: !selNow && !!lastSelection, textLen: text ? text.length : 0, preview: (text||'').slice(0,50) });
    if(!text){
      console.log('[PromptShelf] ps-quick: no selection (even after fallback), hiding menu');
      hide();
      return;
    }
    // Try background first (side effects: storage + PROMPTS_UPDATED)
    console.log('[PromptShelf] sending QUICK_SAVE_FROM_SELECTION');
    const res = await sendMessageWithTimeout({type:"QUICK_SAVE_FROM_SELECTION", text}, 1500);
    if (res && res.ok){
      console.log('[PromptShelf] quick response ok (BG path)');
      showToast('Saved');
      hide();
      return;
    }
    // Fallback: save directly from content script
    console.log('[PromptShelf] BG quick save failed/no response; attempting direct save fallback');
    const ok = await savePromptDirect(text);
    showToast(ok ? 'Saved' : 'Failed');
    hide();
  });
  openBtn.addEventListener('click', async ()=>{
    const selNow = getSelectedText();
    const text = selNow || lastSelection;
    console.log('[PromptShelf] ps-open clicked', { selNowLen: selNow ? selNow.length : 0, usedFallback: !selNow && !!lastSelection, textLen: text ? text.length : 0, preview: (text||'').slice(0,50) });
    if(!text){
      console.log('[PromptShelf] ps-open: no selection (even after fallback), hiding menu');
      hide();
      return;
    }
    // Always persist draft first (works from CS)
    try{
      const title = String(text||'').trim().split(/\s+/).slice(0,5).join(' ') || '(untitled)';
      await chrome.storage.local.set({draftPrompt:{title, text: String(text||'').trim(), tags:[], category:'other'}});
    } catch(e){
      console.error('[PromptShelf] storing draftPrompt failed', e);
    }
    // Ask BG to open side panel or popup, with timeout
    console.log('[PromptShelf] sending OPEN_EDITOR_FROM_SELECTION');
    const res = await sendMessageWithTimeout({type:"OPEN_EDITOR_FROM_SELECTION", text}, 2000);
    if (res && res.ok){
      console.log('[PromptShelf] open response ok (BG path)', res);
      showToast(res.opened==='sidepanel'?'Editor opened':'Popup opened');
      hide();
      return;
    }
    // Fallback: open editor window from CS
    console.log('[PromptShelf] BG open failed/no response; attempting window.open fallback');
    const opened = openEditorPopupFallback();
    showToast(opened ? 'Popup opened' : 'Failed');
    hide();
  });

  ['scroll','resize'].forEach(evt=>window.addEventListener(evt, hide, true));
  document.addEventListener('mousedown', (e)=>{ if (!fab.contains(e.target)) hide(); }, true);
  // Prevent default mousedown to avoid collapsing selection when clicking the menu
  fab.addEventListener('mousedown',e=>{ e.preventDefault(); },true);
})();