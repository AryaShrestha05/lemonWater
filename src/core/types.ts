/** Project-relative POSIX path. The root folder is ".". */
export type NodeId = string

/** line is 1-based, col is 0-based. */
export interface Pos {
  line: number
  col: number
  length: number
}

export interface SymbolDef {
  /** "default" for anonymous default exports. */
  name: string
  kind: 'function' | 'class' | 'component' | 'variable'
  /** Position of the name (or of the `export default` keyword when anonymous). */
  pos: Pos
  exported: boolean
  isDefault: boolean
  /** Files that reference this definition. */
  usedBy: NodeId[]
  notUsedAnywhere: boolean
}

export interface FolderNode {
  id: NodeId
  kind: 'folder'
  name: string
  parent: NodeId | null
}

export interface FileNode {
  id: NodeId
  kind: 'file'
  name: string
  parent: NodeId
  parsed: boolean
  definitions: SymbolDef[]
}

export type GraphNode = FolderNode | FileNode

/** `name` is the name as defined in the target file. */
export interface SymbolUse {
  name: string
  targetPos: Pos | null
  refs: Pos[]
}

export interface ContainsEdge {
  kind: 'contains'
  source: NodeId
  target: NodeId
}

/** `symbols` is empty for side-effect imports. */
export interface ImportEdge {
  kind: 'import'
  source: NodeId
  target: NodeId
  symbols: SymbolUse[]
}

export type GraphEdge = ContainsEdge | ImportEdge

export interface ProjectGraph {
  root: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface Progress {
  phase: 'scan' | 'parse' | 'link'
  done: number
  total: number
}
