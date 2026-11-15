import type { NodeId, Progress, ProjectGraph } from '../../core/types'

/** Everything the renderer needs from its host (Electron today, a VS Code webview later). */
export interface GraphHost {
  pickFolder(): Promise<string | null>
  analyze(root: string, onProgress: (p: Progress) => void): Promise<ProjectGraph>
  readFile(root: string, fileId: NodeId): Promise<string>
}

declare global {
  interface Window {
    lemon: GraphHost
  }
}

export const host: GraphHost = window.lemon
