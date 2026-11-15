import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Writes `files` (relative path → contents) into a fresh temp dir and returns its absolute path. */
export function makeFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'lemon-fixture-'))
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, contents)
  }
  return root
}
