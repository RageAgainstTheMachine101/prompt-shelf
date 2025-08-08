/* global chrome */
async function loadDraft(){
  const { draftPrompt } = await chrome.storage.local.get("draftPrompt");
  if (draftPrompt) {
    document.getElementById('title').value = draftPrompt.title || "";
    document.getElementById('text').value = draftPrompt.text || "";
    document.getElementById('tags').value = (draftPrompt.tags||[]).join(", ");
    document.getElementById('category').value = draftPrompt.category || "other";
  }
}
async function savePrompt(){
  const title = document.getElementById('title').value.trim();
  const text = document.getElementById('text').value.trim();
  const tags = document.getElementById('tags').value.split(',').map(s=>s.trim()).filter(Boolean);
  const category = document.getElementById('category').value;
  if (!text) return;
  const { prompts=[] } = await chrome.storage.local.get("prompts");
  prompts.push({ id: crypto.randomUUID(), title, text, tags, category, updatedAt: Date.now() });
  await chrome.storage.local.set({ prompts });
  await chrome.storage.local.remove("draftPrompt");
  chrome.runtime.sendMessage({type:"PROMPTS_UPDATED"});
}
document.getElementById('save').addEventListener('click', savePrompt);
document.getElementById('cancel').addEventListener('click', async ()=>{ await chrome.storage.local.remove("draftPrompt"); });
loadDraft();