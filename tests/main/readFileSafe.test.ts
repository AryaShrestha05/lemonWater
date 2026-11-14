import { symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { readFileSafe } from '../../src/main/readFileSafe'
import { makeFixture } from '../helpers/fixture'

describe('readFileSafe', () => {
  test('reads a file inside the root', () => {
    const root = makeFixture({ 'src/a.ts': 'hello' })
    expect(readFileSafe(root, 'src/a.ts')).toBe('hello')
  })

  test('refuses ../ escapes', () => {
    const root = makeFixture({ 'a.ts': '' })
    writeFileSync(join(root, '..', 'secret.txt'), 'nope')
    expect(() => readFileSafe(root, '../secret.txt')).toThrow('outside root')
  })

  test('refuses absolute paths', () => {
    const root = makeFixture({ 'a.ts': '' })
    expect(() => readFileSafe(root, '/etc/hosts')).toThrow('outside root')
  })

  test('refuses symlinks that point outside the root', () => {
    const outside = makeFixture({ 'secret.ts': 'nope' })
    const root = makeFixture({ 'a.ts': '' })
    symlinkSync(join(outside, 'secret.ts'), join(root, 'link.ts'))
    expect(() => readFileSafe(root, 'link.ts')).toThrow('outside root')
  })
})
