import { contextBridge, ipcRenderer, webUtils } from 'electron'

type Unsubscribe = () => void

function on<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export interface ElectronAPI {
  openFile: () => Promise<{ path: string; content: string } | null>
  openFilePath: (path: string) => Promise<{ path: string; content: string } | null>
  saveFile: (content: string) => Promise<boolean>
  saveFileAs: (content: string) => Promise<boolean>
  exportPDF: () => Promise<boolean>
  exportHTML: (html: string) => Promise<boolean>
  loadCustomTheme: () => Promise<{ name: string; css: string } | null>
  loadThemeCSS: (fileName: string) => Promise<string | null>
  getPathForFile: (file: File) => string
  openExternal: (url: string) => void
  onAppError: (callback: (payload: { message: string }) => void) => Unsubscribe
  onFileChanged: (callback: (content: string) => void) => Unsubscribe
  onNewFile: (callback: () => void) => Unsubscribe
  onFileOpened: (callback: (data: { path: string; content: string }) => void) => Unsubscribe
  onMenuOpen: (callback: () => void) => Unsubscribe
  onMenuSave: (callback: () => void) => Unsubscribe
  onMenuSaveAs: (callback: () => void) => Unsubscribe
  onMenuExportPDF: (callback: () => void) => Unsubscribe
  onMenuExportHTML: (callback: () => void) => Unsubscribe
  onSetTheme: (callback: (theme: string) => void) => Unsubscribe
  onSetCustomCSS: (callback: (css: string) => void) => Unsubscribe
  onMenuImportTheme: (callback: () => void) => Unsubscribe
  onAgentActivity: (callback: (state: string) => void) => Unsubscribe
}

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('open-file'),
  openFilePath: (path: string) => ipcRenderer.invoke('open-file-path', path),
  saveFile: (content: string) => ipcRenderer.invoke('save-file', content),
  saveFileAs: (content: string) => ipcRenderer.invoke('save-file-as', content),
  exportPDF: () => ipcRenderer.invoke('export-pdf'),
  exportHTML: (html: string) => ipcRenderer.invoke('export-html', html),
  loadCustomTheme: () => ipcRenderer.invoke('load-custom-theme'),
  loadThemeCSS: (fileName: string) => ipcRenderer.invoke('load-theme-css', fileName),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),
  onAppError: (callback) => on('app-error', callback),
  onFileChanged: (callback) => on('file-changed', callback),
  onNewFile: (callback) => on('new-file', callback),
  onFileOpened: (callback) => on('file-opened', callback),
  onMenuOpen: (callback) => on('menu-open', callback),
  onMenuSave: (callback) => on('menu-save', callback),
  onMenuSaveAs: (callback) => on('menu-save-as', callback),
  onMenuExportPDF: (callback) => on('menu-export-pdf', callback),
  onMenuExportHTML: (callback) => on('menu-export-html', callback),
  onSetTheme: (callback) => on('set-theme', callback),
  onSetCustomCSS: (callback) => on('set-custom-css', callback),
  onMenuImportTheme: (callback) => on('menu-import-theme', callback),
  onAgentActivity: (callback) => on('agent-activity', callback)
} satisfies ElectronAPI)
