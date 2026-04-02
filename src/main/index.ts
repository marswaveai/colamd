import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron'
import { join, basename } from 'path'
import { readFile, writeFile, copyFile, mkdir, stat } from 'fs/promises'
import { watch, FSWatcher, readdirSync } from 'fs'

// Custom themes directory
// Agent detection constants
const AGENT_ACTIVE_GAP_MS = 2000
const AGENT_COOLDOWN_MS = 3000
const AGENT_IDLE_MS = 2000
const FILE_DEBOUNCE_MS = 100
const INTERNAL_SAVE_SUPPRESS_MS = 250

const themesDir = join(app.getPath('home'), '.colamd', 'themes')
const MAX_OPEN_FILE_SIZE = 5 * 1024 * 1024 // 5MB

async function readTextDocument(filePath: string): Promise<string> {
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error('Not a regular file')
  if (info.size > MAX_OPEN_FILE_SIZE) throw new Error('File too large for live sync')
  return readFile(filePath, 'utf-8')
}

async function ensureThemesDir(): Promise<void> {
  await mkdir(themesDir, { recursive: true })
}

interface AppErrorPayload {
  message: string
}

// Per-window state
interface WindowState {
  filePath: string | null
  watcher: FSWatcher | null
  isInternalSave: boolean
  debounceTimer: ReturnType<typeof setTimeout> | null
  agentState: 'idle' | 'active' | 'cooldown'
  lastExternalChange: number
  agentCooldownTimer: ReturnType<typeof setTimeout> | null
}

const windowStates = new Map<number, WindowState>()
let pendingFilePaths: string[] = []

function getState(win: BrowserWindow): WindowState {
  let state = windowStates.get(win.id)
  if (!state) {
    state = { filePath: null, watcher: null, isInternalSave: false, debounceTimer: null, agentState: 'idle', lastExternalChange: 0, agentCooldownTimer: null }
    windowStates.set(win.id, state)
  }
  return state
}

function getWinFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function sendError(win: BrowserWindow, message: string): void {
  if (!win.isDestroyed()) {
    win.webContents.send('app-error', { message } satisfies AppErrorPayload)
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function formatReadError(error: unknown): string {
  const message = getErrorMessage(error, 'Could not open file.')
  if (message === 'Not a regular file') return 'Only regular text files can be opened.'
  if (message === 'File too large for live sync') return 'This file is too large for live sync.'
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return 'The file no longer exists.'
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'EACCES') return 'You do not have permission to open this file.'
  return 'Could not open this file as UTF-8 text.'
}

async function openDocumentInWindow(win: BrowserWindow, filePath: string): Promise<{ path: string; content: string } | null> {
  try {
    const content = await readTextDocument(filePath)
    const state = getState(win)
    state.filePath = filePath
    watchFile(win, state)
    updateTitle(win)
    return { path: filePath, content }
  } catch (error) {
    sendError(win, formatReadError(error))
    return null
  }
}

function createWindow(filePath?: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const state = getState(win)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.webContents.on('did-finish-load', () => {
    if (filePath) {
      void loadFileInWindow(win, filePath)
    }
  })

  win.on('closed', () => {
    stopWatching(state)
    windowStates.delete(win.id)
  })

  updateTitle(win)
  return win
}

function updateTitle(win: BrowserWindow): void {
  const state = getState(win)
  const fileName = state.filePath ? basename(state.filePath) : 'Untitled'
  win.setTitle(`${fileName} — ColaMD`)
}

function suggestFileName(win: BrowserWindow, content?: string): string | undefined {
  const state = getState(win)
  if (state.filePath) return basename(state.filePath, '.md')
  if (!content) return undefined
  // Extract first heading or first non-empty line
  const match = content.match(/^#\s+(.+)/m) || content.match(/^(.+)/m)
  if (!match) return undefined
  return match[1].trim().replace(/[/\\:*?"<>|]/g, '').slice(0, 60) || undefined
}

function stopWatching(state: WindowState): void {
  if (state.watcher) {
    state.watcher.close()
    state.watcher = null
  }
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer)
    state.debounceTimer = null
  }
  if (state.agentCooldownTimer) {
    clearTimeout(state.agentCooldownTimer)
    state.agentCooldownTimer = null
  }
  state.agentState = 'idle'
  state.lastExternalChange = 0
}

function transitionAgentState(win: BrowserWindow, state: WindowState, newState: 'idle' | 'active' | 'cooldown'): void {
  if (state.agentCooldownTimer) {
    clearTimeout(state.agentCooldownTimer)
    state.agentCooldownTimer = null
  }

  if (newState === 'active') {
    if (state.agentState !== 'active') {
      state.agentState = 'active'
      if (!win.isDestroyed()) win.webContents.send('agent-activity', 'active')
    }
    // Reset cooldown timer — 3s after last write
    state.agentCooldownTimer = setTimeout(() => {
      transitionAgentState(win, state, 'cooldown')
    }, AGENT_COOLDOWN_MS)
  } else if (newState === 'cooldown') {
    state.agentState = 'cooldown'
    if (!win.isDestroyed()) win.webContents.send('agent-activity', 'cooldown')
    state.agentCooldownTimer = setTimeout(() => {
      transitionAgentState(win, state, 'idle')
    }, AGENT_IDLE_MS)
  } else {
    state.agentState = 'idle'
    if (!win.isDestroyed()) win.webContents.send('agent-activity', 'idle')
  }
}

function watchFile(win: BrowserWindow, state: WindowState): void {
  if (!state.filePath) return
  stopWatching(state)
  const filePath = state.filePath
  try {
    state.watcher = watch(filePath, { persistent: false }, (eventType) => {
      if (state.isInternalSave) return

      // Handle rename (atomic saves from editors like vim)
      if (eventType === 'rename') {
        // Close watcher without resetting agent state
        if (state.watcher) {
          state.watcher.close()
          state.watcher = null
        }
        if (state.debounceTimer) {
          clearTimeout(state.debounceTimer)
          state.debounceTimer = null
        }
        // Re-read immediately since atomic save replaced the file
        setTimeout(() => {
          watchFile(win, state)
          readTextDocument(filePath)
            .then((data) => {
              if (!win.isDestroyed()) win.webContents.send('file-changed', data)
            })
            .catch((error) => {
              console.error('[watchFile] rename read error:', error)
            })
        }, 50)
        return
      }

      if (eventType !== 'change') return

      // Agent activity detection
      const now = Date.now()
      const gap = now - state.lastExternalChange
      state.lastExternalChange = now
      if (gap > 0 && gap < AGENT_ACTIVE_GAP_MS) {
        transitionAgentState(win, state, 'active')
      } else if (state.agentState === 'active') {
        transitionAgentState(win, state, 'active')
      }

      if (state.debounceTimer) clearTimeout(state.debounceTimer)
      state.debounceTimer = setTimeout(() => {
        readTextDocument(filePath)
          .then((data) => {
            if (!win.isDestroyed()) win.webContents.send('file-changed', data)
          })
          .catch((error) => {
            console.error('[watchFile] read error:', error)
            sendError(win, formatReadError(error))
          })
      }, FILE_DEBOUNCE_MS)
    })
  } catch (error) {
    console.error('[watchFile] watch error:', error)
    stopWatching(state)
    setTimeout(() => watchFile(win, state), 500)
    return
  }

  state.watcher.on('error', (error) => {
    console.error('[watchFile] watcher error:', error)
    stopWatching(state)
    setTimeout(() => watchFile(win, state), 500)
  })
}

async function loadFileInWindow(win: BrowserWindow, filePath: string): Promise<void> {
  const result = await openDocumentInWindow(win, filePath)
  if (result && !win.isDestroyed()) {
    win.webContents.send('file-opened', result)
  }
}

// Find window that already has this file open
function findWindowForFile(filePath: string): BrowserWindow | null {
  for (const [id, state] of windowStates) {
    if (state.filePath === filePath) {
      return BrowserWindow.fromId(id) || null
    }
  }
  return null
}

// Open file: reuse existing window or create new one
function openFile(filePath: string): void {
  // If already open, focus that window
  const existing = findWindowForFile(filePath)
  if (existing) {
    existing.focus()
    return
  }

  // Find an untitled empty window to reuse
  const emptyWin = findEmptyWindow()
  if (emptyWin) {
    void loadFileInWindow(emptyWin, filePath)
    emptyWin.focus()
    return
  }

  // Create new window
  const win = createWindow(filePath)
  win.focus()
}

function findEmptyWindow(): BrowserWindow | null {
  for (const [id, state] of windowStates) {
    if (!state.filePath) {
      return BrowserWindow.fromId(id) || null
    }
  }
  return null
}

async function saveToPath(win: BrowserWindow, filePath: string, content: string): Promise<boolean> {
  const state = getState(win)
  try {
    state.isInternalSave = true
    await writeFile(filePath, content, 'utf-8')
    state.filePath = filePath
    watchFile(win, state)
    updateTitle(win)
    return true
  } catch (error) {
    sendError(win, getErrorMessage(error, 'Could not save file.'))
    return false
  } finally {
    setTimeout(() => { state.isInternalSave = false }, INTERNAL_SAVE_SUPPRESS_MS)
  }
}

// IPC Handlers

ipcMain.on('open-external', (_event, url: string) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url)
  }
})

ipcMain.handle('open-file', async (event) => {
  const win = getWinFromEvent(event)
  if (!win) return null
  const result = await dialog.showOpenDialog(win, {
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
      { name: 'Text', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const filePath = result.filePaths[0]

  // If this window has no file, load here; otherwise open in new window
  const state = getState(win)
  if (!state.filePath) {
    return openDocumentInWindow(win, filePath)
  } else {
    openFile(filePath)
    return null
  }
})

ipcMain.handle('open-file-path', async (event, filePath: string) => {
  const win = getWinFromEvent(event)
  if (!win || typeof filePath !== 'string' || !filePath) return null
  const state = getState(win)

  // If this window has no file, load here
  if (!state.filePath) {
    return openDocumentInWindow(win, filePath)
  } else {
    openFile(filePath)
    return null
  }
})

ipcMain.handle('save-file', async (event, content: string) => {
  const win = getWinFromEvent(event)
  if (!win || typeof content !== 'string') return false
  const state = getState(win)
  if (!state.filePath) {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: suggestFileName(win, content),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) return false
    state.filePath = result.filePath
  }
  return saveToPath(win, state.filePath, content)
})

ipcMain.handle('save-file-as', async (event, content: string) => {
  const win = getWinFromEvent(event)
  if (!win || typeof content !== 'string') return false
  const result = await dialog.showSaveDialog(win, {
    defaultPath: suggestFileName(win, content),
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (result.canceled || !result.filePath) return false
  return saveToPath(win, result.filePath, content)
})

ipcMain.handle('export-pdf', async (event) => {
  const win = getWinFromEvent(event)
  if (!win) return false
  const result = await dialog.showSaveDialog(win, {
    defaultPath: suggestFileName(win),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (result.canceled || !result.filePath) return false

  let cssKey: string | null = null
  try {
    // Expand editor to full content height for printing
    cssKey = await win.webContents.insertCSS(
      'html, body { height: auto !important; overflow: visible !important; } #titlebar { display: none !important; } #editor { height: auto !important; overflow: visible !important; } #editor .ProseMirror { min-height: auto !important; }'
    )
    const pdfData = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4'
    })
    await writeFile(result.filePath, pdfData)
    return true
  } catch (error) {
    sendError(win, getErrorMessage(error, 'Could not export PDF.'))
    return false
  } finally {
    if (cssKey) {
      try { await win.webContents.removeInsertedCSS(cssKey) } catch { /* ignore cleanup failure */ }
    }
  }
})

ipcMain.handle('export-html', async (event, htmlContent: string) => {
  const win = getWinFromEvent(event)
  if (!win || typeof htmlContent !== 'string') return false
  const result = await dialog.showSaveDialog(win, {
    defaultPath: suggestFileName(win),
    filters: [{ name: 'HTML', extensions: ['html'] }]
  })
  if (result.canceled || !result.filePath) return false

  try {
    await writeFile(result.filePath, htmlContent, 'utf-8')
    return true
  } catch (error) {
    sendError(win, getErrorMessage(error, 'Could not export HTML.'))
    return false
  }
})

ipcMain.handle('load-custom-theme', async (event) => {
  const win = getWinFromEvent(event)
  if (!win) return null
  const result = await dialog.showOpenDialog(win, {
    filters: [{ name: 'CSS', extensions: ['css'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null

  try {
    await ensureThemesDir()
    const srcPath = result.filePaths[0]
    const fileName = basename(srcPath)
    const destPath = join(themesDir, fileName)
    await copyFile(srcPath, destPath)
    const css = await readFile(destPath, 'utf-8')
    buildMenu() // rebuild menu to include new theme
    return { name: fileName, css }
  } catch (error) {
    sendError(win, getErrorMessage(error, 'Could not import theme.'))
    return null
  }
})

function resolveThemePath(fileName: string): string | null {
  if (!fileName.endsWith('.css') || basename(fileName) !== fileName || fileName.includes('..')) return null
  return join(themesDir, fileName)
}

ipcMain.handle('load-theme-css', async (event, fileName: string) => {
  const win = getWinFromEvent(event)
  try {
    const themePath = resolveThemePath(fileName)
    if (!themePath) return null
    return await readFile(themePath, 'utf-8')
  } catch (error) {
    if (win) sendError(win, getErrorMessage(error, 'Could not load theme CSS.'))
    return null
  }
})

// Menu — targets the focused window

function getFocusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow()
}

function sendToFocused(channel: string, ...args: unknown[]): void {
  const win = getFocusedWindow()
  if (win) win.webContents.send(channel, ...args)
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'

  // Scan custom themes synchronously for menu building
  const customThemeItems: Electron.MenuItemConstructorOptions[] = []
  try {
    const files = readdirSync(themesDir).filter((f: string) => f.endsWith('.css')).sort()
    for (const file of files) {
      customThemeItems.push({
        label: file.replace(/\.css$/, ''),
        click: async () => {
          const win = getFocusedWindow()
          try {
            const css = await readFile(join(themesDir, file), 'utf-8')
            sendToFocused('set-theme', `custom:${file}`)
            sendToFocused('set-custom-css', css)
          } catch (error) {
            if (win) sendError(win, getErrorMessage(error, 'Could not load theme CSS.'))
          }
        }
      })
    }
  } catch { /* themes dir may not exist yet */ }

  const themeSubmenu: Electron.MenuItemConstructorOptions[] = [
    { label: 'Light', click: () => sendToFocused('set-theme', 'light') },
    { label: 'Dark', click: () => sendToFocused('set-theme', 'dark') },
    { label: 'Elegant', click: () => sendToFocused('set-theme', 'elegant') },
    { label: 'Newsprint', click: () => sendToFocused('set-theme', 'newsprint') },
  ]
  if (customThemeItems.length > 0) {
    themeSubmenu.push({ type: 'separator' }, ...customThemeItems)
  }
  themeSubmenu.push({ type: 'separator' }, {
    label: 'Import Theme...',
    click: () => sendToFocused('menu-import-theme')
  })

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: 'ColaMD',
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow()
        },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToFocused('menu-open')
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendToFocused('menu-save')
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendToFocused('menu-save-as')
        },
        { type: 'separator' },
        {
          label: 'Export PDF...',
          click: () => sendToFocused('menu-export-pdf')
        },
        {
          label: 'Export HTML...',
          click: () => sendToFocused('menu-export-html')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Theme',
      submenu: themeSubmenu
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About ColaMD',
          click: () => shell.openExternal('https://github.com/marswaveai/colamd')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// App lifecycle

app.whenReady().then(async () => {
  await ensureThemesDir()
  buildMenu()

  // Check command line args for file paths
  const args = process.argv.slice(app.isPackaged ? 1 : 2)
  const fileArgs = args.filter((arg) => !arg.startsWith('-'))
  if (fileArgs.length > 0) {
    pendingFilePaths = fileArgs
  }

  if (pendingFilePaths.length > 0) {
    for (const fp of pendingFilePaths) {
      createWindow(fp)
    }
    pendingFilePaths = []
  } else {
    createWindow()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (app.isReady()) {
    openFile(filePath)
  } else {
    pendingFilePaths.push(filePath)
  }
})
