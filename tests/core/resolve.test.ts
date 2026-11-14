import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createResolver } from '../../src/core/resolve'
import { scanFiles } from '../../src/core/scanFiles'
import { makeFixture } from '../helpers/fixture'

function resolverFor(files: Record<string, string>, setup?: (root: string) => void) {
  const root = makeFixture(files)
  setup?.(root)
  const ids = new Set(scanFiles(root).files.map((f) => f.id))
  return createResolver(root, ids)
}

describe('createResolver', () => {
  test('resolves relative paths without extension', () => {
    const r = resolverFor({ 'src/a.js': '', 'src/b.js': '', 'src/dir/index.js': '' })
    expect(r('./b', 'src/a.js')).toBe('src/b.js')
    expect(r('./dir', 'src/a.js')).toBe('src/dir/index.js')
  })

  test('resolves .js specifiers to .ts sources', () => {
    const r = resolverFor({ 'src/a.ts': '', 'src/b.ts': '' })
    expect(r('./b.js', 'src/a.ts')).toBe('src/b.ts')
  })

  test('uses tsconfig paths', () => {
    const r = resolverFor({
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }),
      'src/a.ts': '',
      'src/util.ts': ''
    })
    expect(r('@/util', 'src/a.ts')).toBe('src/util.ts')
  })

  test('uses the nearest config for each file', () => {
    const r = resolverFor({
      'frontend/jsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '~/*': ['src/*'] } } }),
      'frontend/src/a.js': '',
      'frontend/src/x.js': '',
      'backend/b.js': ''
    })
    expect(r('~/x', 'frontend/src/a.js')).toBe('frontend/src/x.js')
    expect(r('~/x', 'backend/b.js')).toBeNull()
  })

  test('handles configs with extends and comments', () => {
    const r = resolverFor({
      'base.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }),
      'tsconfig.json': '{\n  // a comment\n  "extends": "./base.json",\n}\n',
      'src/a.ts': '',
      'src/util.ts': ''
    })
    expect(r('@/util', 'src/a.ts')).toBe('src/util.ts')
  })

  test('returns null for packages', () => {
    const r = resolverFor({ 'src/a.ts': '', 'node_modules/react/index.js': '', 'node_modules/react/package.json': '{"name":"react","main":"index.js"}' })
    expect(r('react', 'src/a.ts')).toBeNull()
  })

  test('treats in-root workspace packages as internal', () => {
    const r = resolverFor(
      { 'apps/web/a.js': '', 'packages/ui/index.js': '', 'packages/ui/package.json': '{"name":"@app/ui","main":"index.js"}' },
      (root) => {
        mkdirSync(join(root, 'node_modules/@app'), { recursive: true })
        symlinkSync(join(root, 'packages/ui'), join(root, 'node_modules/@app/ui'), 'dir')
      }
    )
    expect(r('@app/ui', 'apps/web/a.js')).toBe('packages/ui/index.js')
  })

  test('JS-only project with no config', () => {
    const r = resolverFor({ 'backend/src/server.js': '', 'backend/src/routes/index.js': '' })
    expect(r('./routes', 'backend/src/server.js')).toBe('backend/src/routes/index.js')
  })
})
