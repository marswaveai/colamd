# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev          # Start dev server with HMR (electron-vite dev)
npm run build        # Compile all 3 bundles (main, preload, renderer)
npm run preview      # Preview production build
npm run dist         # Build + package for current platform
npm run dist:mac     # macOS build (.dmg + .zip)
npm run dist:win     # Windows build (.exe NSIS installer)
npm run dist:linux   # Linux build (.AppImage + .deb)
```

No test framework, linter, or formatter is configured. Type checking: `npx tsc --noEmit`.

Release is triggered by pushing `v*` tags (see `.github/workflows/release.yml`).

## Architecture

Electron 3-process model with a minimal, no-framework renderer:

```
Main Process (src/main/index.ts)
  Node.js APIs: fs.watch, dialog, shell, Menu
  Responsibilities: window lifecycle, file I/O, file watching, agent detection,
                    menus, PDF/HTML export, custom theme storage
        ↕ IPC (ipcMain / ipcRenderer)
Preload (src/preload/index.ts)
  contextBridge.exposeInMainWorld → window.electronAPI
  Defines typed ElectronAPI interface (invoke + event listener patterns)
        ↕
Renderer (src/renderer/)
  Plain TypeScript, no React/Vue — Milkdown IS the UI
  main.ts → wires IPC events to editor actions
  editor/editor.ts → Milkdown setup (commonmark, gfm, history, listener, clipboard)
  editor/html-view.ts → custom inline HTML node view
  themes/base.css → ALL CSS: reset, layout, 4 built-in themes (via CSS custom properties)
  themes/theme-manager.ts → theme switching & localStorage persistence
```

### Key Mechanism: File Hot Update (Core Feature)

The main process uses `fs.watch()` on the open file. When external changes are detected:

1. Check `isInternalSave` flag — if true (our own save within 100ms), ignore to prevent feedback loops
2. Agent activity state machine: `idle` → `active` (rapid writes, gap < 2s) → `cooldown` (3s after last write) → `idle` (2s later). Visual feedback via CSS animation on `#agent-dot`.
3. Debounce 100ms → read file → send `file-changed` IPC to renderer → `setMarkdown()` replaces all content

Each BrowserWindow has independent `WindowState` (filePath, watcher, agent state). Opening a file already open in another window focuses that window instead.

### IPC Pattern

- **Renderer → Main**: `ipcRenderer.invoke()` for request/response (openFile, saveFile, exportPDF, etc.)
- **Main → Renderer**: `webContents.send()` for push events (file-changed, set-theme, agent-activity, menu-* actions)
- All methods are typed via the `ElectronAPI` interface in `src/preload/index.ts`

### Theme System

- Built-in themes: `light`, `dark`, `elegant` (default), `newsprint` — switched by CSS class on `<body>`
- Custom themes: stored as `.css` files in `~/.colamd/themes/`, injected via `<style>` element
- Theme variables: `--bg-color`, `--text-color`, `--text-muted`, `--border-color`, `--link-color`, `--code-bg`, `--code-block-bg`, `--code-block-text`, `--blockquote-border`, `--blockquote-bg`, `--table-header-bg`, `--selection-bg`
- Menu is rebuilt when custom themes change (scans themes dir synchronously)

### Export

- **PDF**: `win.webContents.printToPDF()` — temporarily injects CSS to expand editor to full content height
- **HTML**: Renderer constructs standalone HTML with embedded theme CSS from computed styles, main process writes to disk

## Design Principles

**"如非必要，勿增实体"** — Do not add entities unless necessary. Every new UI element, feature, or line of code must justify itself. Default answer is no.

No toolbars, sidebars, status bars. UI is title bar + editor only.

Core priorities in order: file hot update → WYSIWYG → themes → export.

Things explicitly NOT done: file management, knowledge base, cloud sync, collaborative editing, note organization.

## Development Notes

- TypeScript strict mode (`tsconfig.json` base, 3 project references for main/preload/renderer)
- Main process is a single file (`src/main/index.ts`, ~450 lines). Keep it that way — simplicity is the point.
- Renderer has no framework. Milkdown (ProseMirror-based) is the entire UI.
- Only 2 runtime dependencies: `@milkdown/kit` and `remark-breaks`
- Security: `contextIsolation: true`, `nodeIntegration: false`, CSP header in index.html
- Custom themes dir: `~/.colamd/themes/` — auto-created on startup
