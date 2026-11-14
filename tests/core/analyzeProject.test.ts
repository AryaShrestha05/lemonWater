import { describe, expect, test } from 'vitest'
import { analyzeProject } from '../../src/core/analyzeProject'
import type { FileNode, ImportEdge, ProjectGraph, Progress } from '../../src/core/types'
import { makeFixture } from '../helpers/fixture'

const importEdges = (g: ProjectGraph): ImportEdge[] => g.edges.filter((e): e is ImportEdge => e.kind === 'import')
const edge = (g: ProjectGraph, s: string, t: string) => importEdges(g).find((e) => e.source === s && e.target === t)
const file = (g: ProjectGraph, id: string) => g.nodes.find((n) => n.id === id) as FileNode
const defOf = (g: ProjectGraph, id: string, name: string) => file(g, id).definitions.find((d) => d.name === name)!

describe('analyzeProject', () => {
  test('folder nodes and contains edges', () => {
    const g = analyzeProject(makeFixture({ 'src/a.ts': '' }))
    expect(g.nodes.map((n) => [n.id, n.kind]).sort()).toEqual([['.', 'folder'], ['src', 'folder'], ['src/a.ts', 'file']])
    expect(g.edges.filter((e) => e.kind === 'contains').map((e) => `${e.source}>${e.target}`).sort()).toEqual(['.>src', 'src>src/a.ts'])
    expect(file(g, 'src/a.ts')).toMatchObject({ name: 'a.ts', parent: 'src', parsed: true })
  })

  test('import edge with symbol detail', () => {
    const g = analyzeProject(
      makeFixture({
        'src/api.ts': 'const x = 1\nexport function fetchUser() {}',
        'src/App.tsx': "import { fetchUser } from './api'\nfetchUser()"
      })
    )
    const e = importEdges(g).filter((x) => x.source === 'src/App.tsx')
    expect(e).toHaveLength(1)
    expect(e[0].target).toBe('src/api.ts')
    expect(e[0].symbols).toEqual([{ name: 'fetchUser', targetPos: { line: 2, col: 16, length: 9 }, refs: [{ line: 2, col: 0, length: 9 }] }])
  })

  test('merges multiple imports of the same target', () => {
    const g = analyzeProject(
      makeFixture({
        'api.ts': 'export function a() {}\nexport function b() {}',
        'App.ts': "import { a } from './api'\nimport { b } from './api'\na(); b()"
      })
    )
    const e = importEdges(g).filter((x) => x.source === 'App.ts')
    expect(e).toHaveLength(1)
    expect(e[0].symbols.map((s) => s.name).sort()).toEqual(['a', 'b'])
  })

  test('side-effect import gives an edge with no symbols', () => {
    const g = analyzeProject(makeFixture({ 'polyfill.js': 'globalThis.x = 1', 'main.js': "import './polyfill'" }))
    expect(edge(g, 'main.js', 'polyfill.js')?.symbols).toEqual([])
  })

  test('follows named barrels', () => {
    const g = analyzeProject(
      makeFixture({
        'components/Card.tsx': 'export function Card() { return <div/> }',
        'components/index.ts': "export { Card } from './Card'",
        'App.tsx': "import { Card } from './components'\nconst x = <Card />"
      })
    )
    expect(edge(g, 'App.tsx', 'components/Card.tsx')?.symbols[0].name).toBe('Card')
    expect(edge(g, 'App.tsx', 'components/index.ts')).toBeUndefined()
    expect(edge(g, 'components/index.ts', 'components/Card.tsx')).toBeDefined()
  })

  test('follows export * barrels', () => {
    const g = analyzeProject(
      makeFixture({
        'components/Card.tsx': 'export function Card() { return <div/> }',
        'components/index.ts': "export * from './Card'",
        'App.tsx': "import { Card } from './components'\nconst x = <Card />"
      })
    )
    expect(edge(g, 'App.tsx', 'components/Card.tsx')?.symbols[0].name).toBe('Card')
    expect(edge(g, 'App.tsx', 'components/index.ts')).toBeUndefined()
  })

  test('follows renamed barrel re-exports to the original name', () => {
    const g = analyzeProject(
      makeFixture({
        'lib/impl.ts': 'export function realName() {}',
        'lib/index.ts': "export { realName as nice } from './impl'",
        'App.ts': "import { nice } from './lib'\nnice()"
      })
    )
    expect(edge(g, 'App.ts', 'lib/impl.ts')?.symbols[0].name).toBe('realName')
  })

  test('circular barrels terminate', () => {
    const start = Date.now()
    const g = analyzeProject(
      makeFixture({
        'a.ts': "export * from './b'",
        'b.ts': "export * from './a'",
        'c.ts': "import { missing } from './a'\nmissing()"
      })
    )
    expect(Date.now() - start).toBeLessThan(1000)
    const fromC = importEdges(g).filter((e) => e.source === 'c.ts')
    expect(fromC.flatMap((e) => e.symbols)).toEqual([])
  })

  test('circular imports are fine', () => {
    const g = analyzeProject(
      makeFixture({
        'a.ts': "import { b } from './b'\nexport function a() { b() }",
        'b.ts': "import { a } from './a'\nexport function b() { a() }"
      })
    )
    expect(edge(g, 'a.ts', 'b.ts')).toBeDefined()
    expect(edge(g, 'b.ts', 'a.ts')).toBeDefined()
  })

  test('CommonJS require links to module.exports definitions', () => {
    const g = analyzeProject(
      makeFixture({
        'backend/src/services/user.service.js': 'function getUser() {}\nmodule.exports = { getUser }',
        'backend/src/routes/users.js': "const express = require('express')\nconst router = express.Router()\nmodule.exports = router",
        'backend/src/server.js':
          "const users = require('./routes/users')\nconst { getUser } = require('./services/user.service')\napp.use(users)\ngetUser()"
      })
    )
    expect(edge(g, 'backend/src/server.js', 'backend/src/routes/users.js')?.symbols[0].name).toBe('router')
    expect(edge(g, 'backend/src/server.js', 'backend/src/services/user.service.js')?.symbols[0].name).toBe('getUser')
  })

  test('a whole module object passed around marks all its exports used', () => {
    const g = analyzeProject(
      makeFixture({
        'claude.js': 'function create() {}\nconst MODEL = 1\nmodule.exports = { create, MODEL }',
        'util.ts': 'export function a() {}',
        'providers.js': "const claude = require('./claude')\nmodule.exports = { claude }",
        'other.ts': "import * as util from './util'\nregister(util)"
      })
    )
    expect(defOf(g, 'claude.js', 'create')).toMatchObject({ usedBy: ['providers.js'], notUsedAnywhere: false })
    expect(defOf(g, 'claude.js', 'MODEL').notUsedAnywhere).toBe(false)
    expect(defOf(g, 'util.ts', 'a').notUsedAnywhere).toBe(false)
    expect(edge(g, 'providers.js', 'claude.js')?.symbols).toEqual([])
  })

  test('usedBy and notUsedAnywhere', () => {
    const g = analyzeProject(
      makeFixture({
        'src/api.ts': 'export function fetchUser() {}\nexport function oldThing() {}\nfunction helper() {}\nexport const LIMIT = 3\nexport function internal() { return LIMIT }',
        'src/App.tsx': "import { fetchUser } from './api'\nfetchUser()"
      })
    )
    expect(defOf(g, 'src/api.ts', 'fetchUser')).toMatchObject({ usedBy: ['src/App.tsx'], notUsedAnywhere: false })
    expect(defOf(g, 'src/api.ts', 'oldThing').notUsedAnywhere).toBe(true)
    expect(defOf(g, 'src/api.ts', 'helper').notUsedAnywhere).toBe(false)
    expect(defOf(g, 'src/api.ts', 'LIMIT').notUsedAnywhere).toBe(false)
  })

  test('suppresses the note for framework conventions and entry defaults', () => {
    const g = analyzeProject(
      makeFixture({
        'pages/index.tsx': 'export function getServerSideProps() {}\nexport default function Home() { return <div/> }',
        'app/dash/page.tsx': 'export const metadata = {}\nexport default function Page() { return <div/> }',
        'app/api/x/route.ts': 'export function GET() {}',
        'src/main.tsx': 'export default function main() {}\nexport function unusedNamed() {}'
      })
    )
    expect(defOf(g, 'pages/index.tsx', 'getServerSideProps').notUsedAnywhere).toBe(false)
    expect(defOf(g, 'app/dash/page.tsx', 'metadata').notUsedAnywhere).toBe(false)
    expect(defOf(g, 'app/api/x/route.ts', 'GET').notUsedAnywhere).toBe(false)
    expect(defOf(g, 'src/main.tsx', 'main').notUsedAnywhere).toBe(false)
    expect(defOf(g, 'src/main.tsx', 'unusedNamed').notUsedAnywhere).toBe(true)
  })

  test('large files are nodes but not parsed', () => {
    const g = analyzeProject(
      makeFixture({
        'public/vendor.js': "import './x'\n" + '//'.padEnd(1_500_000, 'x'),
        'x.js': ''
      })
    )
    expect(file(g, 'public/vendor.js').parsed).toBe(false)
    expect(importEdges(g).filter((e) => e.source === 'public/vendor.js')).toEqual([])
  })

  test('reports progress', () => {
    const seen: Progress[] = []
    analyzeProject(makeFixture({ 'a.ts': '', 'b.ts': '', 'c.ts': '' }), (p) => seen.push(p))
    const phases = [...new Set(seen.map((p) => p.phase))]
    expect(phases).toEqual(['scan', 'parse', 'link'])
    const lastParse = seen.filter((p) => p.phase === 'parse').at(-1)!
    expect(lastParse.done).toBe(lastParse.total)
    expect(lastParse.total).toBe(3)
  })
})
