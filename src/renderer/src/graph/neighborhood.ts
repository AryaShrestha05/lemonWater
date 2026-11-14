import type { NodeId, ProjectGraph } from '../../../core/types'

export interface Neighborhood {
  nodes: Set<NodeId>
  /** Indexes into graph.edges */
  edges: Set<number>
}

/** The node itself plus everything joined to it by an import or contains edge, in either direction. */
export function neighborhood(graph: ProjectGraph, id: NodeId): Neighborhood {
  const nodes = new Set<NodeId>([id])
  const edges = new Set<number>()
  graph.edges.forEach((e, i) => {
    if (e.source === id || e.target === id) {
      edges.add(i)
      nodes.add(e.source)
      nodes.add(e.target)
    }
  })
  return { nodes, edges }
}
