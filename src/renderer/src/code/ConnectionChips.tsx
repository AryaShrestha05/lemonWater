import type { NodeId, ProjectGraph } from '../../../core/types'
import { connections } from './connections'

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
  if (!uses.length && !usedBy.length)
    return <div className="chips empty">No connections to other files</div>
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
