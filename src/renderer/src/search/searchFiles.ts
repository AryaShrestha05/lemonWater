import type { NodeId, ProjectGraph } from '../../../core/types'

/** Case-insensitive file search: basename prefix > basename substring > path substring. */
export function searchFiles(graph: ProjectGraph, query: string, limit = 8): NodeId[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: { id: NodeId; rank: number }[] = []
  for (const n of graph.nodes) {
    if (n.kind !== 'file') continue
    const base = n.name.toLowerCase()
    const rank = base.startsWith(q)
      ? 0
      : base.includes(q)
        ? 1
        : n.id.toLowerCase().includes(q)
          ? 2
          : -1
    if (rank >= 0) scored.push({ id: n.id, rank })
  }
  scored.sort((a, b) => a.rank - b.rank || a.id.length - b.id.length || a.id.localeCompare(b.id))
  return scored.slice(0, limit).map((s) => s.id)
}
