import type { NodeId, ProjectGraph } from '../../../core/types'

/** Runs the 300-tick layout prewarm off the main thread and returns the settled positions. */
export function prewarmInWorker(graph: ProjectGraph): Promise<Map<NodeId, { x: number; y: number }>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./layoutWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<[string, number, number][]>): void => {
      resolve(new Map(event.data.map(([id, x, y]) => [id, { x, y }])))
      worker.terminate()
    }
    worker.onerror = (err): void => {
      reject(err)
      worker.terminate()
    }
    worker.postMessage(graph)
  })
}
