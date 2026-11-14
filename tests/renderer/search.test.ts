import { describe, expect, test } from 'vitest'
import { searchFiles } from '../../src/renderer/src/search/SearchBox'
import type { ProjectGraph } from '../../src/core/types'

const file = (id: string) => ({ id, kind: 'file' as const, name: id.slice(id.lastIndexOf('/') + 1), parent: '.', parsed: true, definitions: [] })
const g: ProjectGraph = {
  root: '/x',
  nodes: [
    { id: 'src', kind: 'folder', name: 'src', parent: '.' },
    file('src/app-utils/x.ts'),
    file('src/hooks/useApp.ts'),
    file('src/App.tsx'),
    file('src/other.ts')
  ],
  edges: []
}

describe('searchFiles', () => {
  test('ranks basename prefix > basename substring > path substring', () => {
    expect(searchFiles(g, 'app')).toEqual(['src/App.tsx', 'src/hooks/useApp.ts', 'src/app-utils/x.ts'])
  })

  test('empty query gives nothing', () => {
    expect(searchFiles(g, '')).toEqual([])
    expect(searchFiles(g, '   ')).toEqual([])
  })

  test('folders are not results and limit applies', () => {
    expect(searchFiles(g, 's', 2)).toHaveLength(2)
    expect(searchFiles(g, 'src')).not.toContain('src')
  })
})
