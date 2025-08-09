
/* global chrome */
const $ = (sel, ctx=document) => ctx.querySelector(sel);
const state = { prompts: [], query: "" };
const normalize = s => (s||"").toLowerCase();
const escapeHtml = str => (str||"").replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

function filterPrompts(){
  const q = normalize(state.query);
  if(!q) return state.prompts;
  return state.prompts.filter(p =>
    normalize(p.title).includes(q) || normalize(p.text).includes(q) ||
    (Array.isArray(p.tags) && normalize(p.tags.join(' ')).includes(q)) ||
    normalize(p.category).includes(q));
}

function render(){
  const byCat = {favorite:[], recent:[], other:[]};
  for(const p of filterPrompts()) (byCat[p.category]||byCat.other).push(p);
  for(const cat of ["favorite","recent","other"]){
    const list = document.querySelector(`ul.list[data-cat="${cat}"]`);
    list.innerHTML = "";
    const arr = byCat[cat];
    document.querySelector(`.count[data-for="${cat}"]`).textContent = arr.length;
    for(const p of arr){
      const li = document.createElement("li");
      li.className = "item"; li.dataset.id = p.id;
      li.innerHTML = `
        <div class="title-row">
          <span class="title">${escapeHtml(p.title || "(untitled)")}</span>
          <div class="actions">
            <button class="icon btn-copy">Copy</button>
            <button class="icon btn-fav">${p.category==="favorite"?"★":"☆"}</button>
            <select class="icon sel-move">
              <option value="${p.category}" selected>Move: ${p.category}</option>
              ${["favorite","recent","other"].filter(c=>c!==p.category).map(c=>`<option value="${c}">${c}</option>`).join("")}
            </select>
            <button class="icon btn-del">Del</button>
          </div>
        </div>
        <div class="text">${escapeHtml(p.text)}</div>
        <div class="tags">${(p.tags||[]).map(t=>`#${escapeHtml(t)}`).join(" ")}</div>`;
      list.appendChild(li);
    }
  }
}

async function load(){ 
  const {prompts=[]}=await chrome.storage.local.get("prompts"); 
  prompts.sort((a,b) => (b.updatedAt||0)-(a.updatedAt||0)); 
  state.prompts = prompts; 
  await loadDraft(); 
  render(); 
}
async function save(){ await chrome.storage.local.set({prompts: state.prompts}); }
const findById = id => state.prompts.find(p=>p.id===id);
function toRecentTop(p){ p.category="recent"; p.updatedAt=Date.now(); state.prompts=state.prompts.filter(x=>x.id!==p.id).concat([p]); }

async function loadDraft(){
  const { draftPrompt } = await chrome.storage.local.get("draftPrompt");
  if (draftPrompt) {
    $("#new-title").value = draftPrompt.title || "";
    $("#new-text").value = draftPrompt.text || "";
    $("#new-tags").value = (draftPrompt.tags||[]).join(", ");
    $("#new-category").value = draftPrompt.category || "other";
    // Focus the text area to make it clear this is for editing
    $("#new-text").focus();
  }
}

chrome.runtime.onMessage.addListener((msg)=>{ if(msg?.type==="PROMPTS_UPDATED"){ load(); } });

document.addEventListener("click", e=>{
  const item = e.target.closest("li.item"); if(!item) return;
  const id = item.dataset.id; const p = findById(id); if(!p) return;
  if(e.target.matches(".btn-copy")){ navigator.clipboard.writeText(p.text).catch(()=>{}); toRecentTop(p); save().then(render); }
  if(e.target.matches(".btn-fav")){ p.category = p.category==="favorite"?"other":"favorite"; p.updatedAt=Date.now(); save().then(render); }
  if(e.target.matches(".btn-del")){ state.prompts = state.prompts.filter(x=>x.id!==id); save().then(render); }
});
document.addEventListener("change", e=>{
  if(!e.target.matches(".sel-move")) return;
  const item = e.target.closest("li.item"); const id = item?.dataset.id; const p = findById(id); if(!p) return;
  const val = e.target.value; if(["favorite","recent","other"].includes(val)){ p.category=val; p.updatedAt=Date.now(); save().then(render); }
});

function debounce(fn, ms=200){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }
$("#search").addEventListener("input", debounce(e=>{ state.query=e.target.value; render(); },120));
$("#add-btn").addEventListener("click", async ()=>{
  const title=$("#new-title").value.trim(); const text=$("#new-text").value.trim();
  const tags=$("#new-tags").value.split(",").map(s=>s.trim()).filter(Boolean);
  const category=$("#new-category").value; if(!text) return;
  const p={id:crypto.randomUUID(), title, text, tags, category, updatedAt:Date.now()};
  state.prompts.push(p); await save();
  // Clear draft after saving
  await chrome.storage.local.remove("draftPrompt");
  $("#new-title").value=""; $("#new-text").value=""; $("#new-tags").value=""; $("#new-category").value="other"; render();
});
$("#export-btn").addEventListener("click", async ()=>{
  const {prompts=[]}=await chrome.storage.local.get("prompts");
  const blob = new Blob([JSON.stringify({prompts},null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="promptshelf-export.json"; a.click(); URL.revokeObjectURL(url);
});
$("#import-file").addEventListener("change", async e=>{
  const file=e.target.files?.[0]; if(!file) return;
  try{ const txt=await file.text(); const data=JSON.parse(txt);
    state.prompts = Array.isArray(data) ? data : (Array.isArray(data.prompts)?data.prompts:[]);
    await save(); render();
  } catch(err){ alert("Import failed: "+err.message); }
  e.target.value="";
});
document.addEventListener("DOMContentLoaded", load);
