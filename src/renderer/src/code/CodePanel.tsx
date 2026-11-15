import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { EditorState, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  lineNumbers,
  highlightActiveLine,
  type DecorationSet
} from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import type { NodeId, Pos, ProjectGraph } from '../../../core/types'
import ConnectionChips from './ConnectionChips'
import { codeMarks, lineNotes, type CodeMark, type LineNote } from './codeMarks'
import { fileSummary } from '../../../core/summarize'

export interface CodePanelProps {
  graph: ProjectGraph
  fileId: NodeId
  source: string
  /** Scroll this position into view (center) when it changes. */
  scrollTo?: Pos | null
  onNavigate: (target: NodeId, pos: Pos | null) => void
  /** A "uses" / "used by" chip was clicked. */
  onSelectFile: (id: NodeId) => void
  onClose: () => void
}

class NoteWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly tone: LineNote['tone']
  ) {
    super()
  }
  eq(other: NoteWidget): boolean {
    return other.text === this.text && other.tone === this.tone
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = `cm-lw-note cm-lw-note-${this.tone}`
    span.textContent = this.text
    return span
  }
  ignoreEvent(): boolean {
    return true
  }
}

const defMark = Decoration.mark({ class: 'cm-lw-def' })
const inMark = Decoration.mark({ class: 'cm-lw-in' })
const outMark = Decoration.mark({ class: 'cm-lw-out' })

const panelTheme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'var(--bg-panel)', fontSize: '12.5px' },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      lineHeight: '1.6'
    },
    '.cm-gutters': { backgroundColor: 'var(--bg-panel)', borderRight: '1px solid var(--border)' },
    '.cm-lw-def': {
      color: '#f2b84b !important',
      backgroundColor: 'rgba(242,184,75,.16)',
      borderRadius: '3px'
    },
    '.cm-lw-def *': { color: '#f2b84b !important' },
    '.cm-lw-in': { textDecoration: 'underline 2px #34d399', textUnderlineOffset: '3px' },
    '.cm-lw-out, .cm-lw-out *': { color: '#a78bfa !important', cursor: 'pointer' },
    '.cm-lw-out': { textDecoration: 'underline dotted #a78bfa', textUnderlineOffset: '3px' },
    '.cm-lw-out:hover': { backgroundColor: 'rgba(167,139,250,.18)', borderRadius: '3px' },
    '.cm-lw-flash': { backgroundColor: 'rgba(167,139,250,.22) !important' },
    '.cm-lw-note': {
      marginLeft: '2.5em',
      fontFamily: '-apple-system, system-ui, sans-serif',
      fontSize: '11px',
      userSelect: 'none'
    },
    '.cm-lw-note-out': { color: '#6f6f7a' },
    '.cm-lw-note-in': { color: '#34d399' },
    '.cm-lw-note-unused': { color: '#8a8a94', fontStyle: 'italic', opacity: 0.8 }
  },
  { dark: true }
)

/** Converts a mark position to document offsets, or null if it no longer fits the text. */
function toRange(state: EditorState, pos: Pos): { from: number; to: number } | null {
  if (pos.line < 1 || pos.line > state.doc.lines) return null
  const line = state.doc.line(pos.line)
  const from = line.from + pos.col
  const to = from + pos.length
  if (pos.col < 0 || to > line.to || pos.length <= 0) return null
  return { from, to }
}

function buildDecorations(state: EditorState, marks: CodeMark[], notes: LineNote[]): DecorationSet {
  const ranges: Range<Decoration>[] = []
  for (const n of notes) {
    if (n.line < 1 || n.line > state.doc.lines) continue
    const widget = Decoration.widget({ widget: new NoteWidget(n.text, n.tone), side: 1 })
    ranges.push(widget.range(state.doc.line(n.line).to))
  }
  for (const m of marks) {
    const r = toRange(state, m.pos)
    if (!r) continue
    const deco = m.kind === 'definition' ? defMark : m.kind === 'incoming' ? inMark : outMark
    ranges.push(deco.range(r.from, r.to))
  }
  return Decoration.set(ranges, true)
}

export default function CodePanel({
  graph,
  fileId,
  source,
  scrollTo,
  onNavigate,
  onSelectFile,
  onClose
}: CodePanelProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const navigateRef = useRef(onNavigate)
  useLayoutEffect(() => {
    navigateRef.current = onNavigate
  })

  const marks = useMemo(() => codeMarks(graph, fileId), [graph, fileId])
  const summary = useMemo(() => fileSummary(graph, fileId), [graph, fileId])
  const notes = useMemo(() => lineNotes(graph, fileId), [graph, fileId])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const isTs = /\.[mc]?tsx?$/.test(fileId)
    const outgoing = marks.filter(
      (m): m is Extract<CodeMark, { kind: 'outgoing' }> => m.kind === 'outgoing'
    )

    const state = EditorState.create({
      doc: source,
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        lineNumbers(),
        highlightActiveLine(),
        javascript({ jsx: true, typescript: isTs }),
        oneDark,
        panelTheme,
        EditorView.decorations.of((view) => buildDecorations(view.state, marks, notes)),
        EditorView.domEventHandlers({
          click: (event, view) => {
            const at = view.posAtCoords({ x: event.clientX, y: event.clientY })
            if (at === null) return false
            const hit = outgoing.find((m) => {
              const r = toRange(view.state, m.pos)
              return r && at >= r.from && at <= r.to
            })
            if (!hit) return false
            navigateRef.current(hit.target, hit.targetPos)
            return true
          }
        })
      ]
    })
    const view = new EditorView({ state, parent: el })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [source, fileId, marks, notes])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !scrollTo) return
    const r = toRange(view.state, scrollTo)
    const line = Math.min(Math.max(scrollTo.line, 1), view.state.doc.lines)
    const anchor = r ? r.from : view.state.doc.line(line).from
    view.dispatch({
      selection: { anchor },
      effects: EditorView.scrollIntoView(anchor, { y: 'center' })
    })
  }, [scrollTo, source])

  return (
    <aside className="code-panel">
      <header>
        <span className="path" title={fileId}>
          {fileId}
        </span>
        <button className="close" onClick={onClose} title="Close (Esc)">
          ✕
        </button>
      </header>
      {summary && <p className="panel-summary">{summary}</p>}
      <ConnectionChips graph={graph} fileId={fileId} onSelect={onSelectFile} />
      <div className="code-host" ref={hostRef} />
    </aside>
  )
}
