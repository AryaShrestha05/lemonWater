import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation
} from 'd3-force'
import type { NodeId, ProjectGraph } from '../../../core/types'

export interface SimNode {
  id: NodeId
  kind: 'file' | 'folder'
  x: number
  y: number
  vx?: number
  vy?: number
  radius: number
}

export interface SimLink {
  source: SimNode
  target: SimNode
  kind: 'contains' | 'import'
}

export interface LayoutOptions {
  /** Ticks to run synchronously before the first paint. Default 300. */
  prewarmTicks?: number
  /** Start positions (e.g. from a worker prewarm). */
  initialPositions?: Map<NodeId, { x: number; y: number }>
}

export interface Layout {
  nodes: SimNode[]
  links: SimLink[]
  sim: Simulation<SimNode, SimLink>
}

/** Gentle ongoing drift after the layout settles. */
export const DRIFT_ALPHA = 0.005

export function createLayout(graph: ProjectGraph, opts: LayoutOptions = {}): Layout {
  const childCount = new Map<NodeId, number>()
  for (const e of graph.edges)
    if (e.kind === 'contains') childCount.set(e.source, (childCount.get(e.source) ?? 0) + 1)

  const nodes: SimNode[] = graph.nodes.map((n) => {
    const start = opts.initialPositions?.get(n.id)
    const radius = n.kind === 'folder' ? 6 + 1.5 * Math.sqrt(childCount.get(n.id) ?? 0) : 4
    // NaN lets d3 seed its deterministic phyllotaxis spiral
    return { id: n.id, kind: n.kind, radius, x: start?.x ?? NaN, y: start?.y ?? NaN }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const links: SimLink[] = []
  for (const e of graph.edges) {
    const source = byId.get(e.source)
    const target = byId.get(e.target)
    if (source && target) links.push({ source, target, kind: e.kind })
  }

  const sim = forceSimulation<SimNode, SimLink>(nodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .distance((l) => (l.kind === 'contains' ? 30 + l.source.radius : 80))
        .strength((l) => (l.kind === 'contains' ? 1 : 0.1))
    )
    .force(
      'charge',
      forceManyBody<SimNode>().strength((n) => (n.kind === 'folder' ? -160 : -60))
    )
    .force(
      'collide',
      forceCollide<SimNode>((n) => n.radius + 2)
    )
    .force('center', forceCenter(0, 0))
    // weak pull to the middle keeps disconnected clusters on screen
    .force('x', forceX(0).strength(0.02))
    .force('y', forceY(0).strength(0.02))
    .stop()

  const ticks = opts.prewarmTicks ?? 300
  if (opts.initialPositions && ticks === 0) sim.alpha(0.02)
  for (let i = 0; i < ticks; i++) sim.tick()
  sim.alphaTarget(DRIFT_ALPHA)
  return { nodes, links, sim }
}
