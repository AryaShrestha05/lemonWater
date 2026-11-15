import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, resolve } from 'path'
import { Worker } from 'node:worker_threads'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import workerPath from './analysisWorker?modulePath'
import type { ProjectGraph, Progress } from '../core/types'
import { readFileSafe } from './readFileSafe'

/** Roots the user picked; readFile only serves files inside one of these. */
const allowedRoots = new Set<string>()

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    backgroundColor: '#1e1e22',
    title: 'lemonWater',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('lemon:pickFolder', async (event) => {
    // Dev-only shortcut for scripted runs and demos: LEMON_OPEN=/path/to/project npm run dev
    if (is.dev && process.env['LEMON_OPEN']) {
      const root = resolve(process.env['LEMON_OPEN'])
      allowedRoots.add(root)
      return root
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    const root = resolve(result.filePaths[0])
    allowedRoots.add(root)
    return root
  })

  ipcMain.handle('lemon:analyze', (event, root: string) => {
    if (!allowedRoots.has(root)) throw new Error('folder was not opened through the picker')
    return new Promise<ProjectGraph>((resolvePromise, reject) => {
      const worker = new Worker(workerPath, { workerData: { root } })
      worker.on(
        'message',
        (msg: { type: string; progress?: Progress; graph?: ProjectGraph; message?: string }) => {
          if (msg.type === 'progress' && !event.sender.isDestroyed())
            event.sender.send('lemon:progress', msg.progress)
          if (msg.type === 'done') resolvePromise(msg.graph!)
          if (msg.type === 'error') reject(new Error(msg.message))
        }
      )
      worker.on('error', reject)
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`analysis stopped (exit ${code})`))
      })
    })
  })

  ipcMain.handle('lemon:readFile', (_event, root: string, fileId: string) => {
    if (!allowedRoots.has(root)) throw new Error('outside root')
    return readFileSafe(root, fileId)
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.lemonwater')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
