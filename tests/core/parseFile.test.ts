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
    expect(def('const helper = () => 1', 'helper')).toMatchObject({
      kind: 'function',
      exported: false
    })
    expect(def('export class Store {}', 'Store')).toMatchObject({ kind: 'class', exported: true })
    expect(def('export const LIMIT = 5', 'LIMIT')).toMatchObject({
      kind: 'variable',
      exported: true
    })
  })

  test('marks capitalized functions in jsx/tsx as components', () => {
    expect(def('export default function App(){ return <div/> }', 'App', 'App.tsx')).toMatchObject({
      kind: 'component',
      isDefault: true,
      exported: true
    })
  })

  test('anonymous default export', () => {
    expect(def('export default () => 1', 'default')).toMatchObject({
      isDefault: true,
      exported: true
    })
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
    expect(def('exports.c = function(){}', 'c', 'x.js')).toMatchObject({
      exported: true,
      kind: 'function'
    })
    expect(def('module.exports = function main(){}', 'main', 'x.js')).toMatchObject({
      isDefault: true,
      exported: true
    })
    expect(def('const router = 1\nmodule.exports = router', 'router', 'x.js')).toMatchObject({
      isDefault: true,
      exported: true
    })
  })
})

describe('parseFile locallyUsed', () => {
  test('lists definitions referenced elsewhere in the same file', () => {
    const src =
      'export const LIMIT = 3\nexport function run() { return LIMIT }\nexport function idle() {}'
    expect(parseFile('a.ts', src).locallyUsed).toEqual(['LIMIT'])
  })

  test('export sites do not count as use', () => {
    const src =
      'function a() {}\nfunction b() {}\nconst c = 1\nmodule.exports = { a, b: b }\nexport { c }\nexports.d = d\nfunction d() {}'
    expect(parseFile('x.js', src).locallyUsed).toEqual([])
    expect(parseFile('y.ts', 'function e() {}\nexport default e').locallyUsed).toEqual([])
  })

  test('recursion inside the definition itself does not count', () => {
    expect(
      parseFile('a.ts', 'export function walk(n) { return n && walk(n - 1) }').locallyUsed
    ).toEqual([])
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
    expect(imports("const m = import('./lazy')")[0]).toMatchObject({
      specifier: './lazy',
      kind: 'dynamic'
    })
    expect(imports("export { a as b } from './x'")[0]).toMatchObject({
      kind: 'reexport',
      bindings: [{ imported: 'a', local: 'b' }]
    })
    expect(imports("export * from './y'")[0]).toMatchObject({
      kind: 'reexportAll',
      specifier: './y'
    })
    expect(imports("require('./setup')", 'b.js')[0]).toMatchObject({
      kind: 'sideEffect',
      specifier: './setup'
    })
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
    expect(parseFile('a.ts', null as any)).toEqual({
      parsed: false,
      definitions: [],
      imports: [],
      locallyUsed: [],
      docComment: null
    })
  })

  test('many references inside one huge function stay fast', { timeout: 60_000 }, () => {
    const body = Array.from({ length: 12_000 }, (_, i) => `var v${i + 1}=e(v${i});`).join('')
    const src = `var e=function(){};(function(){var v0=0;${body}})()`
    expect(src.length).toBeGreaterThan(200_000)
    const t0 = performance.now()
    parseFile('big.js', src)
    expect(performance.now() - t0).toBeLessThan(1500)
  })
})

describe('parseFile docComment', () => {
  const doc = (src: string, file = 'a.ts') => parseFile(file, src).docComment

  test('a comment at the very top of the file', () => {
    expect(doc("// Reads files from disk.\nimport x from './x'\nx()")).toBe(
      'Reads files from disk.'
    )
  })

  test('a detached comment after the imports', () => {
    const src =
      "import a from './a'\n\n// The switchboard: picks providers. More detail here.\n\nconst P = { a }"
    expect(doc(src)).toBe('The switchboard: picks providers.')
  })

  test('a comment attached to a function is not the file summary', () => {
    expect(doc("import a from './a'\n// adds one\nfunction f() { a() }")).toBeNull()
  })

  test('JSDoc header, first sentence only', () => {
    expect(doc('/**\n * Walks the tree.\n * More words.\n */\n\nexport function x() {}')).toBe(
      'Walks the tree.'
    )
  })

  test('consecutive line comments are joined', () => {
    const src =
      '// Every call the editor makes\n// to the backend, in one place.\n\nexport function b() {}'
    expect(doc(src)).toBe('Every call the editor makes to the backend, in one place.')
  })

  test('lint, license and directive noise is skipped', () => {
    expect(doc('/* eslint-disable */\n// Copyright 2024 Someone\n\nexport const a = 1')).toBeNull()
    expect(doc("'use strict'\n\n// Server entry.\n\nconst a = 1", 'x.js')).toBe('Server entry.')
  })

  test('long comments are cut to 140 characters', () => {
    const long = '// ' + 'word '.repeat(60) + '\n\nconst a = 1'
    const d = doc(long)!
    expect(d.length).toBeLessThanOrEqual(140)
    expect(d.endsWith('…')).toBe(true)
  })

  test('no comment means null', () => {
    expect(doc('export const a = 1')).toBeNull()
  })
})
