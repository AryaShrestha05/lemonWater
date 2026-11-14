import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

// Mirrors GraphHost in src/renderer/src/host.ts.
const lemon = {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('lemon:pickFolder'),
  analyze: async (root: string, onProgress: (p: unknown) => void): Promise<unknown> => {
    const listener = (_e: IpcRendererEvent, p: unknown): void => onProgress(p)
    ipcRenderer.on('lemon:progress', listener)
    try {
      return await ipcRenderer.invoke('lemon:analyze', root)
    } finally {
      ipcRenderer.removeListener('lemon:progress', listener)
    }
  },
  readFile: (root: string, fileId: string): Promise<string> => ipcRenderer.invoke('lemon:readFile', root, fileId)
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('lemon', lemon)
} else {
  // @ts-ignore (typed in renderer/src/host.ts)
  window.lemon = lemon
}
