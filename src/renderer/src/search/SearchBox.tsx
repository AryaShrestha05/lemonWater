import { useEffect, useMemo, useRef, useState } from 'react'
import type { NodeId, ProjectGraph } from '../../../core/types'

/** Case-insensitive file search: basename prefix > basename substring > path substring. */
export function searchFiles(graph: ProjectGraph, query: string, limit = 8): NodeId[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: { id: NodeId; rank: number }[] = []
  for (const n of graph.nodes) {
    if (n.kind !== 'file') continue
    const base = n.name.toLowerCase()
    const rank = base.startsWith(q) ? 0 : base.includes(q) ? 1 : n.id.toLowerCase().includes(q) ? 2 : -1
    if (rank >= 0) scored.push({ id: n.id, rank })
  }
  scored.sort((a, b) => a.rank - b.rank || a.id.length - b.id.length || a.id.localeCompare(b.id))
  return scored.slice(0, limit).map((s) => s.id)
}

export default function SearchBox({ graph, onPick }: { graph: ProjectGraph; onPick: (id: NodeId) => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const results = useMemo(() => searchFiles(graph, query), [graph, query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.isContentEditable)
      if (e.key === '/' && !typing) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pick = (id: NodeId): void => {
    onPick(id)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div className="search">
      <input
        ref={inputRef}
        value={query}
        placeholder="Find a file  ( / )"
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && results[active]) {
            pick(results[active])
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            setQuery('')
            inputRef.current?.blur()
          }
        }}
      />
      {open && results.length > 0 && (
        <ul className="search-results">
          {results.map((id, i) => {
            const slash = id.lastIndexOf('/')
            return (
              <li
                key={id}
                className={i === active ? 'active' : ''}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(id)
                }}
              >
                <span className="name">{id.slice(slash + 1)}</span>
                <span className="dir">{slash > 0 ? id.slice(0, slash) : ''}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
