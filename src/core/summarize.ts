// One-line, plain-English summaries of files and folders, built from the graph (no AI).
import type { FileNode, ImportEdge, NodeId, ProjectGraph } from './types'

const TEST_FILE = /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$/
const CONFIG_FILE = /(^|\/)[^/]+\.config\.[cm]?[jt]s$/
/** Used by at least this many files → "shared building block". */
const SHARED_THRESHOLD = 5

// small path helpers: this module also runs in the renderer, where node:path doesn't exist
const base = (id: NodeId): string => id.slice(id.lastIndexOf('/') + 1)
const dirOf = (id: NodeId): string => (id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '.')
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

function importEdges(graph: ProjectGraph): ImportEdge[] {
  return graph.edges.filter((e): e is ImportEdge => e.kind === 'import')
}

function files(graph: ProjectGraph): FileNode[] {
  return graph.nodes.filter((n): n is FileNode => n.kind === 'file')
}

/** "a.ts" or "a.ts +2" */
function nameList(ids: NodeId[]): string {
  const names = ids.map(base).sort()
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0]
}

export function fileSummary(graph: ProjectGraph, fileId: NodeId): string {
  const file = files(graph).find((f) => f.id === fileId)
  if (!file) return ''
  if (file.doc) return file.doc

  const edges = importEdges(graph)
  const uses = [...new Set(edges.filter((e) => e.source === fileId).map((e) => e.target))]
  const usedBy = [...new Set(edges.filter((e) => e.target === fileId).map((e) => e.source))]

  if (TEST_FILE.test(fileId)) {
    const subjects = uses.filter((id) => !TEST_FILE.test(id))
    return subjects.length ? `Tests for ${nameList(subjects)}` : 'Test file'
  }
  if (CONFIG_FILE.test(fileId)) return 'Tool config file'
  if (!file.parsed) return 'Large file, not analyzed'

  const parts: string[] = []
  const components = file.definitions.filter((d) => d.kind === 'component').map((d) => d.name)
  const exported = file.definitions
    .filter((d) => d.exported && d.name !== 'default')
    .map((d) => d.name)
  if (components.length) {
    parts.push(
      `React component${components.length > 1 ? 's' : ''} ${components.slice(0, 2).join(', ')}${components.length > 2 ? ` +${components.length - 2}` : ''}`
    )
  } else if (exported.length) {
    parts.push(
      `Defines ${exported.slice(0, 2).join(', ')}${exported.length > 2 ? ` +${exported.length - 2}` : ''}`
    )
  }

  if (!uses.length && !usedBy.length) {
    parts.push(parts.length ? 'not connected to other files' : 'Not connected to other files')
    return parts.join(' · ')
  }
  if (!usedBy.length)
    parts.push(
      parts.length
        ? 'starting point: no other file uses it'
        : 'Starting point: no other file uses it'
    )
  if (uses.length) parts.push(`uses ${plural(uses.length, 'file')}`)
  if (usedBy.length >= SHARED_THRESHOLD)
    parts.push(`shared building block: used by ${plural(usedBy.length, 'file')}`)
  else if (usedBy.length) parts.push(`used by ${nameList(usedBy)}`)
  return parts.join(' · ')
}

export function folderSummary(graph: ProjectGraph, folderId: NodeId): string {
  const inside = (id: NodeId): boolean => folderId === '.' || id.startsWith(folderId + '/')
  const own = files(graph).filter((f) => inside(f.id))
  const count = plural(own.length, 'file')
  if (folderId === '.') return `Project root · ${count}`

  let kind = ''
  const tests = own.filter((f) => TEST_FILE.test(f.id)).length
  const comps = own.filter((f) => f.definitions.some((d) => d.kind === 'component')).length
  if (own.length && tests / own.length > 0.5) kind = ', mostly tests'
  else if (own.length && comps / own.length > 0.5) kind = ', mostly React components'

  // folders on the other end of import edges that cross this folder's boundary
  const partners = new Map<string, number>()
  for (const e of importEdges(graph)) {
    const a = inside(e.source)
    const b = inside(e.target)
    if (a === b) continue
    const other = a ? e.target : e.source
    const dir = dirOf(other)
    const trimmed =
      dir === '.'
        ? ''
        : dir
            .split('/')
            .slice(0, Math.max(1, folderId.split('/').length))
            .join('/')
    const label = (trimmed ? base(trimmed) : '(root)') + '/'
    partners.set(label, (partners.get(label) ?? 0) + 1)
  }
  const top = [...partners]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .slice(0, 2)
    .map(([l]) => l)
  return `${count}${kind}${top.length ? ` · works with ${top.join(', ')}` : ''}`
}
