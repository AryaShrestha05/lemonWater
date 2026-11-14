import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { scanFiles } from '../../src/core/scanFiles'
import { makeFixture } from '../helpers/fixture'

const ids = (root: string): string[] =>
  scanFiles(root)
    .files.map((f) => f.id)
    .sort()

describe('scanFiles', () => {
  test('includes only js/ts family files', () => {
    const root = makeFixture({ 'a.ts': '', 'b.jsx': '', 'c.css': '', 'd.md': '', 'e.mjs': '' })
    expect(ids(root)).toEqual(['a.ts', 'b.jsx', 'e.mjs'])
  })

  test('applies default excludes', () => {
    const root = makeFixture({
      'keep.js': '',
      'node_modules/x.js': '',
      'dist/x.js': '',
      'build/x.js': '',
      'out/x.js': '',
      '.next/x.js': '',
      '.hidden/x.js': ''
    })
    expect(ids(root)).toEqual(['keep.js'])
  })

  test('honours root and nested .gitignore', () => {
    const root = makeFixture({
      '.gitignore': 'backend/workspaces/\n',
      'frontend/.gitignore': 'gen/\n',
      'backend/workspaces/a.js': '',
      'frontend/gen/b.js': '',
      'backend/src/c.js': ''
    })
    expect(ids(root)).toEqual(['backend/src/c.js'])
  })

  test('lists only non-empty folders', () => {
    const root = makeFixture({ 'src/a/x.ts': '' })
    mkdirSync(join(root, 'src/empty'))
    expect(scanFiles(root).folders.sort()).toEqual(['.', 'src', 'src/a'])
  })

  test('empty project', () => {
    const root = makeFixture({ 'README.md': '# hi' })
    expect(scanFiles(root)).toEqual({ files: [], folders: ['.'] })
  })

  test('does not follow directory symlinks', () => {
    const root = makeFixture({ 'real/x.ts': '' })
    symlinkSync(join(root, 'real'), join(root, 'link'), 'dir')
    expect(ids(root)).toEqual(['real/x.ts'])
  })

  test('reports size so large files can be skipped', () => {
    const root = makeFixture({ 'big.js': 'x'.repeat(1_500_000) })
    const big = scanFiles(root).files.find((f) => f.id === 'big.js')
    expect(big?.size).toBeGreaterThan(1_000_000)
  })
})
