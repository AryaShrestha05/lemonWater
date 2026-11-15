import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import ignore, { type Ignore } from 'ignore'
import type { NodeId } from './types'

export const CODE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'out'])

export interface ScanResult {
  files: { id: NodeId; size: number }[]
  folders: NodeId[]
}

interface IgnoreRule {
  /** Folder the .gitignore lives in, relative to root ("" for root). */
  base: string
  ig: Ignore
}

export function isCodeFile(name: string): boolean {
  return CODE_EXTENSIONS.some((ext) => name.endsWith(ext)) && !name.endsWith('.d.ts')
}

function isIgnored(rules: IgnoreRule[], rel: string, isDir: boolean): boolean {
  for (const { base, ig } of rules) {
    if (base && !rel.startsWith(base + '/')) continue
    const sub = base ? rel.slice(base.length + 1) : rel
    if (ig.ignores(isDir ? sub + '/' : sub)) return true
  }
  return false
}

/** Walks `root` and returns the code files and the folders that (transitively) contain them. */
export function scanFiles(root: string): ScanResult {
  const files: ScanResult['files'] = []
  const folders = new Set<NodeId>(['.'])

  const walk = (rel: string, inherited: IgnoreRule[]): boolean => {
    const abs = rel ? join(root, rel) : root
    let rules = inherited
    const gitignore = join(abs, '.gitignore')
    if (existsSync(gitignore)) {
      rules = [...inherited, { base: rel, ig: ignore().add(readFileSync(gitignore, 'utf8')) }]
    }

    let entries
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      return false // unreadable folder (permissions, vanished mid-scan): skip it, keep the rest
    }
    let hasCode = false
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const childRel = rel ? posix.join(rel, entry.name) : entry.name
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name)) continue
        if (isIgnored(rules, childRel, true)) continue
        if (walk(childRel, rules)) {
          folders.add(childRel)
          hasCode = true
        }
      } else if (entry.isFile() && isCodeFile(entry.name)) {
        if (isIgnored(rules, childRel, false)) continue
        files.push({ id: childRel, size: statSync(join(root, childRel)).size })
        hasCode = true
      }
    }
    return hasCode
  }

  walk('', [])
  return { files, folders: [...folders] }
}
