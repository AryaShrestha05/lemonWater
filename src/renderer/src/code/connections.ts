import type { NodeId, ProjectGraph } from '../../../core/types'

/** Files this file imports from (uses) and files that import it (usedBy), from import edges only. */
export function connections(
  graph: ProjectGraph,
  fileId: NodeId
): { uses: NodeId[]; usedBy: NodeId[] } {
  const uses = new Set<NodeId>()
  const usedBy = new Set<NodeId>()
  for (const e of graph.edges) {
    if (e.kind !== 'import') continue
    if (e.source === fileId) uses.add(e.target)
    if (e.target === fileId) usedBy.add(e.source)
  }
  return { uses: [...uses].sort(), usedBy: [...usedBy].sort() }
}
