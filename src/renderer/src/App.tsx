import { useCallback, useEffect, useRef, useState } from 'react'
import type { NodeId, Pos, Progress, ProjectGraph } from '../../core/types'
import CodePanel from './code/CodePanel'
import GraphView from './graph/GraphView'
import { host } from './host'

type State =
  | { kind: 'idle'; error?: string }
  | { kind: 'loading'; root: string; progress: Progress | null }
  | { kind: 'empty'; root: string }
  | { kind: 'ready'; graph: ProjectGraph }

const PHASE_LABEL: Record<Progress['phase'], string> = {
  scan: 'Finding files…',
  parse: 'Reading code…',
  link: 'Connecting files…'
}

export default function App(): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' })

  const openFolder = useCallback(async () => {
    const root = await host.pickFolder()
    if (!root) {
      setState((s) => (s.kind === 'ready' ? s : { kind: 'idle' }))
      return
    }
    setState({ kind: 'loading', root, progress: null })
    try {
      const graph = await host.analyze(root, (progress) =>
        setState((s) => (s.kind === 'loading' && s.root === root ? { ...s, progress } : s))
      )
      const hasFiles = graph.nodes.some((n) => n.kind === 'file')
      setState(hasFiles ? { kind: 'ready', graph } : { kind: 'empty', root })
    } catch (err) {
      setState({ kind: 'idle', error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  if (state.kind === 'idle') {
    return (
      <div className="center-screen">
        <h1>lemonWater</h1>
        <p>See how a codebase fits together: which files call which, and how.</p>
        <button className="primary" onClick={openFolder}>
          Open a project folder
        </button>
        {state.error && <p className="error">Couldn’t analyze that folder: {state.error}</p>}
      </div>
    )
  }

  if (state.kind === 'loading') {
    const p = state.progress
    const pct = p && p.total > 0 ? (p.done / p.total) * 100 : 0
    return (
      <div className="center-screen">
        <p>{p ? PHASE_LABEL[p.phase] : 'Starting…'}</p>
        <div className="progress">
          <div style={{ width: `${pct}%` }} />
        </div>
        {p?.phase === 'parse' && (
          <p>
            {p.done} / {p.total} files
          </p>
        )}
      </div>
    )
  }

  if (state.kind === 'empty') {
    return (
      <div className="center-screen">
        <p>No JavaScript or TypeScript files found in {state.root}</p>
        <button className="primary" onClick={openFolder}>
          Open another folder
        </button>
      </div>
    )
  }

  return <Workspace graph={state.graph} onOpenFolder={openFolder} />
}

interface OpenFile {
  id: NodeId
  source: string
}

function Workspace({ graph, onOpenFolder }: { graph: ProjectGraph; onOpenFolder: () => void }): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<NodeId | null>(null)
  const [focusId, setFocusId] = useState<NodeId | null>(null)
  const [scrollTo, setScrollTo] = useState<Pos | null>(null)
  const [openFile, setOpenFile] = useState<OpenFile | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const loadSeq = useRef(0)

  const select = useCallback(
    (id: NodeId | null, pos: Pos | null = null) => {
      setSelectedId(id)
      setScrollTo(pos)
      setLoadError(null)
      if (!id) {
        setOpenFile(null)
        return
      }
      const seq = ++loadSeq.current
      host
        .readFile(graph.root, id)
        .then((source) => {
          if (seq === loadSeq.current) setOpenFile({ id, source })
        })
        .catch((err) => {
          if (seq === loadSeq.current) setLoadError(err instanceof Error ? err.message : String(err))
        })
    },
    [graph.root]
  )

  const navigate = useCallback(
    (target: NodeId, pos: Pos | null) => {
      select(target, pos)
      setFocusId(target)
    },
    [select]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [select])

  const files = graph.nodes.filter((n) => n.kind === 'file').length
  const imports = graph.edges.filter((e) => e.kind === 'import').length
  const rootName = graph.nodes.find((n) => n.id === '.')?.name ?? ''
  const panelOpen = selectedId !== null

  return (
    <div className="workspace">
      <div className="graph-area">
        <GraphView
          graph={graph}
          selectedId={selectedId}
          onSelect={(id) => {
            select(id)
            // the panel narrows the graph; keep the clicked file in view
            if (id) setFocusId(id)
          }}
          focusId={focusId}
        />
        <div className="topbar">
          <span className="project">{rootName}</span>
          <span className="stats">
            {files} files · {imports} connections
          </span>
          <button onClick={onOpenFolder}>Open folder…</button>
        </div>
      </div>
      {panelOpen &&
        (openFile && openFile.id === selectedId ? (
          <CodePanel
            graph={graph}
            fileId={openFile.id}
            source={openFile.source}
            scrollTo={scrollTo}
            onNavigate={navigate}
            onSelectFile={(id) => navigate(id, null)}
            onClose={() => select(null)}
          />
        ) : (
          <aside className="code-panel">
            <header>
              <span className="path">{selectedId}</span>
            </header>
            <p className="panel-note">{loadError ? `Couldn’t open this file: ${loadError}` : 'Loading…'}</p>
          </aside>
        ))}
    </div>
  )
}
