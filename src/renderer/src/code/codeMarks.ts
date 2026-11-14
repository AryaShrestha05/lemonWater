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

export interface LineNote {
  line: number
  text: string
  tone: 'out' | 'in' | 'unused'
}

const TONE_RANK: Record<LineNote['tone'], number> = { unused: 3, in: 2, out: 1 }
const baseName = (id: NodeId): string => id.slice(id.lastIndexOf('/') + 1)

/** At most one note per line; priority unused > in > out. */
export function lineNotes(graph: ProjectGraph, fileId: NodeId): LineNote[] {
  const byLine = new Map<number, LineNote>()
  const offer = (note: LineNote): void => {
    const cur = byLine.get(note.line)
    if (!cur || TONE_RANK[note.tone] > TONE_RANK[cur.tone]) byLine.set(note.line, note)
  }

  // outgoing: line → distinct target files, in edge order
  const targetsByLine = new Map<number, NodeId[]>()
  for (const e of graph.edges) {
    if (e.kind !== 'import' || e.source !== fileId) continue
    for (const s of e.symbols) {
      for (const r of s.refs) {
        const list = targetsByLine.get(r.line) ?? []
        if (!list.includes(e.target)) list.push(e.target)
        targetsByLine.set(r.line, list)
      }
    }
  }
  for (const [line, targets] of targetsByLine) {
    offer({ line, text: `→ ${targets[0]}${targets.length > 1 ? ` +${targets.length - 1}` : ''}`, tone: 'out' })
  }

  const file = findFile(graph, fileId)
  for (const d of file?.definitions ?? []) {
    if (d.notUsedAnywhere) {
      offer({ line: d.pos.line, text: '· not used anywhere', tone: 'unused' })
    } else if (d.usedBy.length) {
      const names = d.usedBy.map(baseName).sort()
      offer({ line: d.pos.line, text: `← called by ${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ''}`, tone: 'in' })
    }
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line)
}
