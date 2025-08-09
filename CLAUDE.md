# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

PromptShelf is a Chrome extension for storing, searching, and organizing AI prompts. Users can select text on any page to quickly save it, or open an editor to add title/tags/category before saving. All data is stored locally via `chrome.storage.local` with an optional sync engine using `chrome.storage.sync`.

## Architecture

- `manifest.json` - MV3 manifest defining extension structure, permissions, and entry points
- `background.js` - Service worker handling data seeding, context menus, messaging, sync engine, and editor opening
- `contentScript.js` - Injected UI for selection bubble, handles quick add/save operations with fallbacks
- `popup.js` - Main UI for browsing, searching, and managing prompts with import/export
- `sidepanel.js` - Editor UI that works in Chrome side panel or popup window fallback

## Data Model

Stored in `chrome.storage.local`:
- `prompts` - Array of prompt objects with id, title, text, tags, category, updatedAt
- `draftPrompt` - Temporary draft object for the editor
- `syncEnabled` - Boolean for sync feature toggle

Sync engine in `background.js` uses `chrome.storage.sync` with chunked storage due to size limits.

## Development

No build step required. Edit files directly and reload extension at `chrome://extensions`. Content scripts don't run on browser-internal pages.

## Key Features

- Selection-based prompt saving with quick add or editor
- Popup UI for browsing and organizing prompts
- Side panel editor with popup fallback
- Local storage with optional sync across devices
- Import/export prompts as JSON
- Context menu integration

## Permissions

- `storage` - Local prompt storage
- `contextMenus` - Right-click actions for selected text
- `activeTab` - UI interactions and side panel opening