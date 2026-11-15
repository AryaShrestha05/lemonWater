import { useEffect, useMemo, useRef, useState } from 'react'
import type { NodeId, ProjectGraph } from '../../../core/types'
import { searchFiles } from './searchFiles'

export default function SearchBox({
  graph,
  onPick
}: {
  graph: ProjectGraph
  onPick: (id: NodeId) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const results = useMemo(() => searchFiles(graph, query), [graph, query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' || e.target.isContentEditable)
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
