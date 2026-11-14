import { describe, expect, test } from 'vitest'
import { parseFile } from '../../src/core/parseFile'

const def = (src: string, name: string, file = 'a.ts') =>
  parseFile(file, src).definitions.find((d) => d.name === name)

describe('parseFile definitions', () => {
  test('finds top-level definitions with positions', () => {
    expect(def('export function fetchUser(){}', 'fetchUser')).toMatchObject({
      name: 'fetchUser',
      kind: 'function',
      exported: true,
      isDefault: false,
      pos: { line: 1, col: 16, length: 9 }
    })
    expect(def('const helper = () => 1', 'helper')).toMatchObject({ kind: 'function', exported: false })
    expect(def('export class Store {}', 'Store')).toMatchObject({ kind: 'class', exported: true })
    expect(def('export const LIMIT = 5', 'LIMIT')).toMatchObject({ kind: 'variable', exported: true })
  })

  test('marks capitalized functions in jsx/tsx as components', () => {
    expect(def('export default function App(){ return <div/> }', 'App', 'App.tsx')).toMatchObject({
      kind: 'component',
      isDefault: true,
      exported: true
    })
  })

  test('anonymous default export', () => {
    expect(def('export default () => 1', 'default')).toMatchObject({ isDefault: true, exported: true })
  })

  test('export list and default-export of an identifier mark existing definitions', () => {
    const src = 'function a(){}\nfunction b(){}\nexport { a }\nexport default b'
    expect(def(src, 'a')).toMatchObject({ exported: true, isDefault: false })
    expect(def(src, 'b')).toMatchObject({ exported: true, isDefault: true })
  })

  test('CommonJS exports', () => {
    const src = 'function a(){}\nfunction b(){}\nmodule.exports = { a, b }'
    expect(def(src, 'a', 'x.js')).toMatchObject({ exported: true })
    expect(def(src, 'b', 'x.js')).toMatchObject({ exported: true })
    expect(def('exports.c = function(){}', 'c', 'x.js')).toMatchObject({ exported: true, kind: 'function' })
    expect(def('module.exports = function main(){}', 'main', 'x.js')).toMatchObject({ isDefault: true, exported: true })
    expect(def('const router = 1\nmodule.exports = router', 'router', 'x.js')).toMatchObject({ isDefault: true, exported: true })
  })
})

describe('parseFile imports', () => {
  const imports = (src: string, file = 'a.ts') => parseFile(file, src).imports

  test('named import refs', () => {
    const [imp] = imports("import { fetchUser as f } from './api'\nf()\nf()")
    expect(imp.specifier).toBe('./api')
    expect(imp.kind).toBe('named')
    expect(imp.bindings).toEqual([{ imported: 'fetchUser', local: 'f' }])
    expect(imp.refs.fetchUser).toEqual([
      { line: 2, col: 0, length: 1 },
      { line: 3, col: 0, length: 1 }
    ])
  })

  test('default import refs are keyed "default"', () => {
    const [imp] = imports("import api from './api'\napi()")
    expect(imp.bindings).toEqual([{ imported: 'default', local: 'api' }])
    expect(imp.refs.default).toHaveLength(1)
  })

  test('namespace refs map to member names', () => {
    const [imp] = imports("import * as api from './api'\napi.save()")
    expect(imp.kind).toBe('namespace')
    expect(imp.refs.save).toEqual([{ line: 2, col: 4, length: 4 }])
  })

  test('require forms', () => {
    const [named] = imports("const { a } = require('./x')\na()", 'b.js')
    expect(named).toMatchObject({ kind: 'named', specifier: './x' })
    expect(named.refs.a).toHaveLength(1)
    const [ns] = imports("const x = require('./x')\nx.b()", 'b.js')
    expect(ns).toMatchObject({ kind: 'namespace', specifier: './x' })
    expect(ns.refs.b).toHaveLength(1)
  })

  test('a required module used directly counts as its default export', () => {
    const [imp] = imports("const router = require('./router')\napp.use(router)", 'b.js')
    expect(imp.refs.default).toHaveLength(1)
  })

  test('JSX usage counts as a ref', () => {
    const [imp] = imports("import Card from './Card'\nconst x = <Card />", 'a.tsx')
    expect(imp.refs.default).toHaveLength(1)
  })

  test('type-only imports are dropped', () => {
    expect(imports("import type { T } from './t'\nlet a: T")).toEqual([])
    expect(imports("import { type U } from './u'\nlet a: U")).toEqual([])
    expect(imports("import { V } from './v'\nlet x: V")).toEqual([])
  })

  test('unused value imports are dropped', () => {
    expect(imports("import { unused } from './v'")).toEqual([])
  })

  test('side-effect, dynamic and re-exports', () => {
    expect(imports("import './polyfill'")).toEqual([
      { specifier: './polyfill', kind: 'sideEffect', bindings: [], refs: {} }
    ])
    expect(imports("const m = import('./lazy')")[0]).toMatchObject({ specifier: './lazy', kind: 'dynamic' })
    expect(imports("export { a as b } from './x'")[0]).toMatchObject({
      kind: 'reexport',
      bindings: [{ imported: 'a', local: 'b' }]
    })
    expect(imports("export * from './y'")[0]).toMatchObject({ kind: 'reexportAll', specifier: './y' })
    expect(imports("require('./setup')", 'b.js')[0]).toMatchObject({ kind: 'sideEffect', specifier: './setup' })
  })

  test('ignores non-code imports', () => {
    expect(imports("import './styles.css'\nimport logo from './logo.svg'\nlogo")).toEqual([])
  })

  test('a local variable shadowing an import is not a ref', () => {
    const [imp] = imports("import { a } from './x'\na()\nfunction f(a) { return a }")
    expect(imp.refs.a).toHaveLength(1)
  })
})

describe('parseFile robustness', () => {
  test('syntax errors do not throw', () => {
    const res = parseFile('a.ts', 'function (\nexport function ok(){}')
    expect(res.parsed).toBe(true)
  })

  test('a parser crash yields an unparsed result', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseFile('a.ts', null as any)).toEqual({ parsed: false, definitions: [], imports: [] })
  })
})
