import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'

/** Reads `fileId` (project-relative) from `root`, refusing anything that resolves outside the root. */
export function readFileSafe(root: string, fileId: string): string {
  if (isAbsolute(fileId)) throw new Error('outside root')
  const realRoot = realpathSync(root)
  let real: string
  try {
    real = realpathSync(join(realRoot, fileId))
  } catch {
    throw new Error('outside root')
  }
  const rel = relative(realRoot, real)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('outside root')
  return readFileSync(real, 'utf8')
}
