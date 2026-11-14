import { readFileSync } from 'node:fs'
import { basename, join, posix } from 'node:path'
import { parseFile, type ParsedDefinition, type ParsedFile } from './parseFile'
import { createResolver } from './resolve'
import { scanFiles } from './scanFiles'
import type { FileNode, FolderNode, GraphEdge, ImportEdge, NodeId, Pos, Progress, ProjectGraph, SymbolDef } from './types'

/** Files larger than this are shown as nodes but not parsed. */
export const MAX_PARSE_BYTES = 1_000_000

const CONVENTION_FILE = [
  /(^|\/)pages\//,
  /(^|\/)app\/(.+\/)?(page|layout|route|loading|error|not-found|template|default)\.[jt]sx?$/
]

interface Resolved {
  file: NodeId
  def: ParsedDefinition
}

export function analyzeProject(root: string, onProgress?: (p: Progress) => void): ProjectGraph {
  onProgress?.({ phase: 'scan', done: 0, total: 1 })
  const scan = scanFiles(root)
  onProgress?.({ phase: 'scan', done: 1, total: 1 })

  // ---------- parse ----------
  const parsed = new Map<NodeId, ParsedFile>()
  const total = scan.files.length
  scan.files.forEach((f, i) => {
    if (f.size > MAX_PARSE_BYTES) {
      parsed.set(f.id, { parsed: false, definitions: [], imports: [], locallyUsed: [] })
    } else {
      let source: string | null = null
      try {
        source = readFileSync(join(root, f.id), 'utf8')
      } catch {
        // unreadable → unparsed node
      }
      parsed.set(f.id, source === null ? { parsed: false, definitions: [], imports: [], locallyUsed: [] } : parseFile(f.id, source))
    }
    if ((i + 1) % 10 === 0 || i + 1 === total) onProgress?.({ phase: 'parse', done: i + 1, total })
  })
  if (total === 0) onProgress?.({ phase: 'parse', done: 0, total: 0 })

  // ---------- link ----------
  onProgress?.({ phase: 'link', done: 0, total: 1 })
  const resolve = createResolver(root, new Set(parsed.keys()))

  const findOwnExport = (file: NodeId, name: string): ParsedDefinition | undefined => {
    const defs = parsed.get(file)?.definitions ?? []
    if (name === 'default') return defs.find((d) => d.isDefault)
    return defs.find((d) => d.name === name && d.exported) ?? defs.find((d) => d.name === name && !d.isDefault)
  }

  /** Finds where `name` exported from `file` is actually defined, following barrels. */
  const resolveExport = (file: NodeId, name: string, visited = new Set<string>()): Resolved | null => {
    const key = `${file}#${name}`
    if (visited.has(key)) return null
    visited.add(key)
    const own = findOwnExport(file, name)
    if (own) return { file, def: own }
    const imports = parsed.get(file)?.imports ?? []
    for (const rec of imports) {
      if (rec.kind !== 'reexport') continue
      const b = rec.bindings.find((x) => x.local === name)
      if (!b || b.imported === '*') continue
      const target = resolve(rec.specifier, file)
      if (target) return resolveExport(target, b.imported, visited)
    }
    if (name === 'default') return null
    for (const rec of imports) {
      if (rec.kind !== 'reexportAll') continue
      const target = resolve(rec.specifier, file)
      const hit = target ? resolveExport(target, name, visited) : null
      if (hit) return hit
    }
    return null
  }

  const edges = new Map<string, ImportEdge>()
  const usedBy = new Map<ParsedDefinition, Set<NodeId>>()
  const edgeFor = (source: NodeId, target: NodeId): ImportEdge | null => {
    if (source === target) return null
    const key = `${source}\0${target}`
    let e = edges.get(key)
    if (!e) {
      e = { kind: 'import', source, target, symbols: [] }
      edges.set(key, e)
    }
    return e
  }
  const addSymbol = (source: NodeId, hit: Resolved, refs: Pos[], countsAsUse: boolean): void => {
    const e = edgeFor(source, hit.file)
    if (!e) return
    const existing = e.symbols.find((s) => s.name === hit.def.name)
    if (existing) existing.refs.push(...refs)
    else e.symbols.push({ name: hit.def.name, targetPos: hit.def.pos, refs: [...refs] })
    if (countsAsUse) {
      if (!usedBy.has(hit.def)) usedBy.set(hit.def, new Set())
      usedBy.get(hit.def)!.add(source)
    }
  }

  /**
   * The whole module object is used as a value (passed around, stored in a map), so any of its
   * exports may be called later: count them all as used by `source`.
   */
  const markModuleEscaped = (source: NodeId, target: NodeId): void => {
    if (source === target) return
    for (const d of parsed.get(target)?.definitions ?? []) {
      if (!d.exported) continue
      if (!usedBy.has(d)) usedBy.set(d, new Set())
      usedBy.get(d)!.add(source)
    }
  }

  for (const [source, file] of parsed) {
    for (const rec of file.imports) {
      const target = resolve(rec.specifier, source)
      if (!target) continue
      switch (rec.kind) {
        case 'sideEffect':
        case 'dynamic':
        case 'reexportAll':
          edgeFor(source, target)
          break
        case 'reexport':
          for (const b of rec.bindings) {
            const hit = b.imported === '*' ? null : resolveExport(target, b.imported)
            if (hit) addSymbol(source, hit, [], false)
            else edgeFor(source, target)
          }
          break
        case 'named':
        case 'namespace':
          for (const [name, refs] of Object.entries(rec.refs)) {
            const hit = name === '*' ? null : resolveExport(target, name)
            if (hit) {
              addSymbol(source, hit, refs, true)
              continue
            }
            edgeFor(source, target)
            if (name === '*' || name === 'default') markModuleEscaped(source, target)
          }
          break
      }
    }
  }

  // ---------- nodes ----------
  const incoming = new Set([...edges.values()].map((e) => e.target))
  const folderNodes: FolderNode[] = scan.folders.map((id) => ({
    id,
    kind: 'folder',
    name: id === '.' ? basename(root) : posix.basename(id),
    parent: id === '.' ? null : posix.dirname(id)
  }))
  const fileNodes: FileNode[] = [...parsed].map(([id, p]) => {
    const isConvention = CONVENTION_FILE.some((re) => re.test(id))
    const local = new Set(p.locallyUsed)
    const definitions: SymbolDef[] = p.definitions.map((d) => {
      const users = [...(usedBy.get(d) ?? [])].sort()
      return {
        ...d,
        usedBy: users,
        notUsedAnywhere:
          d.exported && users.length === 0 && !local.has(d.name) && !isConvention && !(d.isDefault && !incoming.has(id))
      }
    })
    return { id, kind: 'file', name: posix.basename(id), parent: posix.dirname(id), parsed: p.parsed, definitions }
  })

  const contains: GraphEdge[] = [
    ...folderNodes.filter((f) => f.parent !== null).map((f) => ({ kind: 'contains' as const, source: f.parent!, target: f.id })),
    ...fileNodes.map((f) => ({ kind: 'contains' as const, source: f.parent, target: f.id }))
  ]

  onProgress?.({ phase: 'link', done: 1, total: 1 })
  return { root, nodes: [...folderNodes, ...fileNodes], edges: [...contains, ...edges.values()] }
}
