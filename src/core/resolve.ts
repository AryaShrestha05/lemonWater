import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import ts from 'typescript'
import type { NodeId } from './types'

export type Resolver = (specifier: string, fromFile: NodeId) => NodeId | null

const FORCED: ts.CompilerOptions = {
  allowJs: true,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.Preserve,
  resolveJsonModule: false
}

const CONFIG_RE = /^(tsconfig(\..+)?|jsconfig)\.json$/

interface FolderConfig {
  options: ts.CompilerOptions
  /** Absolute file names the config claims (empty when it lists none). */
  fileNames: Set<string>
}

function loadConfigs(absDir: string): FolderConfig[] {
  let names: string[]
  try {
    names = readdirSync(absDir).filter((n) => CONFIG_RE.test(n)).sort()
  } catch {
    return []
  }
  const out: FolderConfig[] = []
  for (const name of names) {
    const path = join(absDir, name)
    const read = ts.readConfigFile(path, ts.sys.readFile)
    if (read.error || !read.config) continue
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, absDir, undefined, path)
    out.push({
      options: { ...parsed.options, ...FORCED },
      fileNames: new Set(parsed.fileNames.map((f) => f.split('/').join(sep)))
    })
  }
  return out
}

/**
 * Builds a resolver for import specifiers inside `root`.
 * Each file uses the tsconfig/jsconfig files in its nearest ancestor folder that has any.
 * Returns null for anything outside the root, under node_modules, or not in `fileIds`.
 */
export function createResolver(root: string, fileIds: Set<NodeId>): Resolver {
  const realRoot = realpathSync(root)
  const configsByDir = new Map<string, FolderConfig[]>()
  const cache = new Map<string, NodeId | null>()
  const defaults: FolderConfig = { options: { ...FORCED }, fileNames: new Set() }

  const configsFor = (relDir: string): FolderConfig[] => {
    let dir = relDir
    for (;;) {
      if (!configsByDir.has(dir)) configsByDir.set(dir, loadConfigs(join(realRoot, dir)))
      const found = configsByDir.get(dir)!
      if (found.length) return found
      if (dir === '.' || dir === '') return [defaults]
      dir = posix.dirname(dir)
    }
  }

  const toId = (absPath: string): NodeId | null => {
    let real: string
    try {
      real = realpathSync(absPath)
    } catch {
      return null
    }
    const rel = relative(realRoot, real)
    if (!rel || rel.startsWith('..') || rel.split(sep).includes('node_modules')) return null
    const id = rel.split(sep).join('/')
    return fileIds.has(id) ? id : null
  }

  return (specifier, fromFile) => {
    const fromDir = posix.dirname(fromFile)
    const key = `${fromDir}\0${specifier}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit

    const absFrom = join(realRoot, fromFile)
    const candidates = configsFor(fromDir)
    // Prefer configs that claim this file, then the rest.
    const ordered = [
      ...candidates.filter((c) => c.fileNames.has(absFrom)),
      ...candidates.filter((c) => !c.fileNames.has(absFrom))
    ]
    let result: NodeId | null = null
    for (const cfg of ordered) {
      const resolved = ts.resolveModuleName(specifier, absFrom, cfg.options, ts.sys).resolvedModule
      if (resolved && existsSync(resolved.resolvedFileName)) {
        result = toId(resolved.resolvedFileName)
        if (result) break
      }
    }
    cache.set(key, result)
    return result
  }
}

