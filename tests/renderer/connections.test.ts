import { describe, expect, test } from 'vitest'
import { connections } from '../../src/renderer/src/code/ConnectionChips'
import type { ProjectGraph } from '../../src/core/types'

const g: ProjectGraph = {
  root: '/x',
  nodes: [],
  edges: [
    { kind: 'contains', source: 'src', target: 'src/a.ts' },
    { kind: 'import', source: 'src/a.ts', target: 'src/z.ts', symbols: [] },
    { kind: 'import', source: 'src/a.ts', target: 'src/b.ts', symbols: [] },
    { kind: 'import', source: 'src/main.ts', target: 'src/a.ts', symbols: [] }
  ]
}

describe('connections', () => {
  test('uses and usedBy come from import edges, sorted', () => {
    expect(connections(g, 'src/a.ts')).toEqual({ uses: ['src/b.ts', 'src/z.ts'], usedBy: ['src/main.ts'] })
  })

  test('contains edges are ignored', () => {
    expect(connections(g, 'src')).toEqual({ uses: [], usedBy: [] })
  })
})
