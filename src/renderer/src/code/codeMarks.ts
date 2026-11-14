import type { FileNode, NodeId, Pos, ProjectGraph } from '../../../core/types'

export type CodeMark =
  /** gold: defined in this file */
  | { kind: 'definition'; pos: Pos; name: string }
  /** purple, clickable: a call into another file */
  | { kind: 'outgoing'; pos: Pos; target: NodeId; targetPos: Pos | null; name: string }
  /** green: a definition other files use */
  | { kind: 'incoming'; pos: Pos; name: string; from: NodeId[] }

export function findFile(graph: ProjectGraph, fileId: NodeId): FileNode | undefined {
  return graph.nodes.find((n): n is FileNode => n.kind === 'file' && n.id === fileId)
}

export function codeMarks(graph: ProjectGraph, fileId: NodeId): CodeMark[] {
  const file = findFile(graph, fileId)
  if (!file) return []
  const marks: CodeMark[] = file.definitions.map((d) => ({ kind: 'definition', pos: d.pos, name: d.name }))
  for (const e of graph.edges) {
    if (e.kind !== 'import' || e.source !== fileId) continue
    for (const s of e.symbols) {
      for (const pos of s.refs) marks.push({ kind: 'outgoing', pos, target: e.target, targetPos: s.targetPos, name: s.name })
    }
  }
  for (const d of file.definitions) {
    if (d.usedBy.length) marks.push({ kind: 'incoming', pos: d.pos, name: d.name, from: d.usedBy })
  }
  return marks
}
