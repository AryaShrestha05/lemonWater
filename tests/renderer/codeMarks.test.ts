import { describe, expect, test } from 'vitest'
import { codeMarks } from '../../src/renderer/src/code/codeMarks'
import type { FileNode, ProjectGraph, SymbolDef } from '../../src/core/types'

const def = (name: string, line: number, extra: Partial<SymbolDef> = {}): SymbolDef => ({
  name,
  kind: 'function',
  pos: { line, col: 16, length: name.length },
  exported: true,
  isDefault: false,
  usedBy: [],
  notUsedAnywhere: false,
  ...extra
})
const file = (id: string, definitions: SymbolDef[] = []): FileNode => ({ id, kind: 'file', name: id, parent: '.', parsed: true, definitions })

const graph: ProjectGraph = {
  root: '/x',
  nodes: [
    { id: '.', kind: 'folder', name: 'r', parent: null },
    file('App.tsx', [def('App', 4, { usedBy: ['main.tsx'] }), def('formatName', 9)]),
    file('api.ts', [def('fetchUser', 1)]),
    file('main.tsx'),
    file('lonely.ts', [def('solo', 1)])
  ],
  edges: [
    { kind: 'contains', source: '.', target: 'App.tsx' },
    {
      kind: 'import',
      source: 'App.tsx',
      target: 'api.ts',
      symbols: [{ name: 'fetchUser', targetPos: { line: 1, col: 16, length: 9 }, refs: [{ line: 6, col: 15, length: 9 }, { line: 7, col: 2, length: 9 }] }]
    },
    { kind: 'import', source: 'main.tsx', target: 'App.tsx', symbols: [{ name: 'App', targetPos: { line: 4, col: 16, length: 3 }, refs: [{ line: 2, col: 0, length: 3 }] }] }
  ]
}

describe('codeMarks', () => {
  test('every definition yields a definition mark', () => {
    const marks = codeMarks(graph, 'App.tsx').filter((m) => m.kind === 'definition')
    expect(marks.map((m) => m.name)).toEqual(['App', 'formatName'])
    expect(marks[0].pos).toEqual({ line: 4, col: 16, length: 3 })
  })

  test('every ref of an outgoing symbol yields an outgoing mark', () => {
    const out = codeMarks(graph, 'App.tsx').filter((m) => m.kind === 'outgoing')
    expect(out).toEqual([
      { kind: 'outgoing', pos: { line: 6, col: 15, length: 9 }, target: 'api.ts', targetPos: { line: 1, col: 16, length: 9 }, name: 'fetchUser' },
      { kind: 'outgoing', pos: { line: 7, col: 2, length: 9 }, target: 'api.ts', targetPos: { line: 1, col: 16, length: 9 }, name: 'fetchUser' }
    ])
  })

  test('a definition used by other files yields an incoming mark', () => {
    const inc = codeMarks(graph, 'App.tsx').filter((m) => m.kind === 'incoming')
    expect(inc).toEqual([{ kind: 'incoming', pos: { line: 4, col: 16, length: 3 }, name: 'App', from: ['main.tsx'] }])
  })

  test('a file with no edges yields only definition marks', () => {
    expect(codeMarks(graph, 'lonely.ts').map((m) => m.kind)).toEqual(['definition'])
  })

  test('unknown file yields nothing', () => {
    expect(codeMarks(graph, 'nope.ts')).toEqual([])
  })
})
