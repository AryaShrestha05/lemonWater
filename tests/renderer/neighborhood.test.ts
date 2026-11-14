import { describe, expect, test } from 'vitest'
import { neighborhood } from '../../src/renderer/src/graph/neighborhood'
import type { ProjectGraph } from '../../src/core/types'

const file = (id: string, parent: string) => ({ id, kind: 'file' as const, name: id, parent, parsed: true, definitions: [] })
const g: ProjectGraph = {
  root: '/x',
  nodes: [
    { id: '.', kind: 'folder', name: 'r', parent: null },
    { id: 'src', kind: 'folder', name: 'src', parent: '.' },
    file('src/a.ts', 'src'),
    file('src/b.ts', 'src'),
    file('src/c.ts', 'src'),
    file('src/lonely.ts', 'src')
  ],
  edges: [
    { kind: 'contains', source: '.', target: 'src' }, // 0
    { kind: 'contains', source: 'src', target: 'src/a.ts' }, // 1
    { kind: 'contains', source: 'src', target: 'src/b.ts' }, // 2
    { kind: 'contains', source: 'src', target: 'src/c.ts' }, // 3
    { kind: 'import', source: 'src/a.ts', target: 'src/b.ts', symbols: [] }, // 4
    { kind: 'import', source: 'src/c.ts', target: 'src/a.ts', symbols: [] } // 5
  ]
}

describe('neighborhood', () => {
  test('a file gets its importers, imports and parent folder', () => {
    const n = neighborhood(g, 'src/a.ts')
    expect([...n.nodes].sort()).toEqual(['src', 'src/a.ts', 'src/b.ts', 'src/c.ts'])
    expect([...n.edges].sort()).toEqual([1, 4, 5])
  })

  test('a folder gets its children and its parent', () => {
    const n = neighborhood(g, 'src')
    expect([...n.nodes].sort()).toEqual(['.', 'src', 'src/a.ts', 'src/b.ts', 'src/c.ts'])
    expect([...n.edges].sort()).toEqual([0, 1, 2, 3])
  })

  test('an isolated file gets just itself', () => {
    const n = neighborhood(g, 'src/lonely.ts')
    expect([...n.nodes]).toEqual(['src/lonely.ts'])
    expect(n.edges.size).toBe(0)
  })
})
