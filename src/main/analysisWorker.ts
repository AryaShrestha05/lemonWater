import { parentPort, workerData } from 'node:worker_threads'
import { analyzeProject } from '../core/analyzeProject'

const { root } = workerData as { root: string }
try {
  const graph = analyzeProject(root, (progress) => parentPort?.postMessage({ type: 'progress', progress }))
  parentPort?.postMessage({ type: 'done', graph })
} catch (err) {
  parentPort?.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
}
