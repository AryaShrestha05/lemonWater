import { useCallback, useState } from 'react'
import type { NodeId, Progress, ProjectGraph } from '../../core/types'
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
  const [selectedId, setSelectedId] = useState<NodeId | null>(null)

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
      setSelectedId(null)
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

  const files = state.graph.nodes.filter((n) => n.kind === 'file').length
  const imports = state.graph.edges.filter((e) => e.kind === 'import').length
  const rootName = state.graph.nodes.find((n) => n.id === '.')?.name ?? ''
  return (
    <div className="workspace">
      <div className="graph-area">
        <GraphView graph={state.graph} selectedId={selectedId} onSelect={setSelectedId} />
        <div className="topbar">
          <span className="project">{rootName}</span>
          <span className="stats">
            {files} files · {imports} connections
          </span>
          <button onClick={openFolder}>Open folder…</button>
        </div>
      </div>
    </div>
  )
}
