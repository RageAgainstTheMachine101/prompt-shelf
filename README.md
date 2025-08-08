# PromptShelf (Chrome Extension)

Store, search, and organize AI prompts right from the browser. Select text on any page to quickly save it, or open an editor to add title/tags/category before saving.

## Features

- Select text to show a small PromptShelf bubble near the selection.
  - Quick add (title = first 5 words) saves immediately.
  - Save & Edit opens an editor (side panel when available, otherwise a popup window).
- Popup UI to browse, search, copy, favorite, move, and delete prompts.
- Tags and category support: `favorite`, `recent`, `other`.
- Import/Export prompts as JSON.
- All data stored locally via `chrome.storage.local` (no network calls).

## Install (Load Unpacked)

1. Open Chrome → go to `chrome://extensions`.
2. Toggle "Developer mode" on (top-right).
3. Click "Load unpacked" and select this project folder.
4. Pin the extension to your toolbar for quick access.

> First install seeds a few sample prompts (you can delete them).

## Usage

- Popup (toolbar → PromptShelf icon)
  - Search across title/text/tags/category.
  - Add new prompt with optional title, tags, and category.
  - Item actions: Copy, Favorite/Unfavorite, Move between categories, Delete.
  - Import/Export JSON.
- Select-and-save (on any regular web page)
  - Select text → a small bubble appears near the selection.
  - Choose Quick add or Save & Edit.
  - Right-click selection also shows context menu items: "PromptShelf: Quick add selection" and "PromptShelf: Add & open editor".
- Editor
  - Opens in the Chrome side panel when supported, otherwise in a small popup window.
  - Pre-fills from the current selection. Edit title/text/tags/category, then Save.

## Data model (chrome.storage.local)

- Key: `prompts` → Array of prompt items
- Key: `draftPrompt` → Temporary draft used by the editor

Prompt item shape:

```json
{
  "id": "uuid",
  "title": "string",
  "text": "string",
  "tags": ["string"],
  "category": "favorite" | "recent" | "other",
  "updatedAt": 1710000000000
}
```

## Files overview

- `manifest.json` — MV3 manifest (popup action, background service worker, side panel, content script).
- `background.js` — Service worker: seeds sample data, registers context menus, handles messages, opens side panel or popup editor.
- `contentScript.js` — Injects selection bubble UI, handles Quick add / Save & Edit, falls back gracefully if BG is unavailable.
- `contentScript.css` — Styles for the selection bubble/toast.
- `popup.html` / `popup.css` / `popup.js` — Popup UI for browsing, searching, adding, organizing prompts.
- `sidepanel.html` / `sidepanel.css` / `sidepanel.js` — Editor UI (also used by popup window fallback via `editor.html`).
- `editor.html` — Popup window fallback editor.
- `images/logo.png` — UI asset; exposed via web accessible resources.
- `icons/` — Extension icons (16/32/48/128).

## Permissions

- `storage` — Save prompts locally.
- `contextMenus` — Right-click actions for selected text.
- `activeTab` — Required for some UI interactions and side panel opening.

## Development

- No build step; edit files directly and click "Reload" on `chrome://extensions`.
- Content scripts don’t run on Chrome Web Store or browser-internal pages (e.g., `chrome://…`).
- Side panel API availability varies by Chrome version/platform; the extension falls back to a popup window when needed.

## Privacy

- All data is stored locally using `chrome.storage.local`.
- The extension does not send your data to any server.

## Troubleshooting

- Selection bubble doesn’t appear: ensure you’re on a regular web page (not a browser-internal page) and the extension is enabled.
- Edits not appearing: reload the extension on `chrome://extensions` and refresh the page.
- Side panel didn’t open: your Chrome may not support it on the current page; a popup editor will open instead.

## Roadmap ideas

- Optional cloud backup/sync (behind an opt-in setting).
- Richer tagging and keyboard shortcuts.

## License

TBD
