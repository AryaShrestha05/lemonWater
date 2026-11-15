import type { ProjectGraph } from '../../../core/types'
import { createLayout } from './layout'

self.onmessage = (event: MessageEvent<ProjectGraph>): void => {
  const { nodes, sim } = createLayout(event.data, { prewarmTicks: 300 })
  sim.stop()
  const positions: [string, number, number][] = nodes.map((n) => [n.id, n.x, n.y])
  ;(self as unknown as Worker).postMessage(positions)
}
