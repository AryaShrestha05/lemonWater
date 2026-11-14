import type { NodeId, ProjectGraph } from '../../../core/types'

export function connections(graph: ProjectGraph, fileId: NodeId): { uses: NodeId[]; usedBy: NodeId[] } {
  const uses = new Set<NodeId>()
  const usedBy = new Set<NodeId>()
  for (const e of graph.edges) {
    if (e.kind !== 'import') continue
    if (e.source === fileId) uses.add(e.target)
    if (e.target === fileId) usedBy.add(e.source)
  }
  return { uses: [...uses].sort(), usedBy: [...usedBy].sort() }
}

const baseName = (id: NodeId): string => id.slice(id.lastIndexOf('/') + 1)

export default function ConnectionChips({
  graph,
  fileId,
  onSelect
}: {
  graph: ProjectGraph
  fileId: NodeId
  onSelect: (id: NodeId) => void
}): React.JSX.Element | null {
  const { uses, usedBy } = connections(graph, fileId)
  if (!uses.length && !usedBy.length) return <div className="chips empty">No connections to other files</div>
  return (
    <div className="chips">
      {uses.length > 0 && (
        <div className="chip-row">
          <span className="chip-label">uses</span>
          {uses.map((id) => (
            <button key={id} className="chip out" title={id} onClick={() => onSelect(id)}>
              {baseName(id)}
            </button>
          ))}
        </div>
      )}
      {usedBy.length > 0 && (
        <div className="chip-row">
          <span className="chip-label">used by</span>
          {usedBy.map((id) => (
            <button key={id} className="chip in" title={id} onClick={() => onSelect(id)}>
              {baseName(id)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
