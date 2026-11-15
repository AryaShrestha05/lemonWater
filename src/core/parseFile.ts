import ts from 'typescript'
import type { Pos, SymbolDef } from './types'

export interface ImportRecord {
  specifier: string
  kind: 'named' | 'namespace' | 'sideEffect' | 'dynamic' | 'reexport' | 'reexportAll'
  /** imported is "default" for default imports, "*" for namespace / whole-module require. */
  bindings: { imported: string; local: string }[]
  /** Runtime (non-type) references in this file, keyed by imported name. */
  refs: Record<string, Pos[]>
}

export type ParsedDefinition = Omit<SymbolDef, 'usedBy' | 'notUsedAnywhere'>

export interface ParsedFile {
  parsed: boolean
  definitions: ParsedDefinition[]
  imports: ImportRecord[]
  /** Names of definitions referenced elsewhere in this same file (export sites and self-recursion don't count). */
  locallyUsed: string[]
  /** First sentence of the file's header comment, if it has one. */
  docComment: string | null
}

/** Imports of these extensions are assets, not code, and never become edges. */
const ASSET_EXTENSIONS = new Set([
  'css',
  'scss',
  'sass',
  'less',
  'styl',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'ico',
  'bmp',
  'json',
  'md',
  'mdx',
  'html',
  'txt',
  'csv',
  'xml',
  'yaml',
  'yml',
  'toml',
  'graphql',
  'gql',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'mp3',
  'mp4',
  'webm',
  'wav',
  'ogg',
  'wasm',
  'pdf'
])

function isCodeSpecifier(spec: string): boolean {
  const clean = spec.split(/[?#]/)[0]
  const m = /\.([a-z0-9]+)$/i.exec(clean)
  return !m || !ASSET_EXTENSIONS.has(m[1].toLowerCase())
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (fileName.endsWith('.ts') || fileName.endsWith('.mts') || fileName.endsWith('.cts'))
    return ts.ScriptKind.TS
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX
  return ts.ScriptKind.JS
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  !!ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((m) => m.kind === kind)

function isFunctionLike(expr: ts.Expression | undefined): boolean {
  if (!expr) return false
  while (ts.isParenthesizedExpression(expr)) expr = expr.expression
  return ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)
}

function containsJsx(node: ts.Node): boolean {
  let found = false
  const visit = (n: ts.Node): void => {
    if (found) return
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      found = true
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

function isRequireCall(node: ts.Node | undefined): node is ts.CallExpression {
  return (
    !!node &&
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0])
  )
}

function isDynamicImport(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length >= 1 &&
    ts.isStringLiteralLike(node.arguments[0])
  )
}

/** `module.exports` or `exports` */
function isModuleExports(expr: ts.Expression): boolean {
  return (
    (ts.isIdentifier(expr) && expr.text === 'exports') ||
    (ts.isPropertyAccessExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === 'module' &&
      expr.name.text === 'exports')
  )
}

/** True when the identifier sits in a type-only position. */
function inTypePosition(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isTypeNode(p) || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p))
      return true
    if (ts.isHeritageClause(p) && p.token === ts.SyntaxKind.ImplementsKeyword) return true
    if (ts.isExpressionStatement(p) || ts.isBlock(p) || ts.isSourceFile(p)) return false
  }
  return false
}

function bindingNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) out.add(name.text)
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name, out)
}

/** Names declared directly by a scope-like node (params, block-level declarations, …), cached per node. */
const scopeNameCache = new WeakMap<ts.Node, Set<string>>()
function scopeNames(p: ts.Node): Set<string> {
  const cached = scopeNameCache.get(p)
  if (cached) return cached
  const names = new Set<string>()
  if (ts.isFunctionLike(p)) {
    for (const param of p.parameters) bindingNames(param.name, names)
    if ((ts.isFunctionExpression(p) || ts.isClassExpression(p)) && p.name) names.add(p.name.text)
  }
  if (ts.isCatchClause(p) && p.variableDeclaration) bindingNames(p.variableDeclaration.name, names)
  if (
    (ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p)) &&
    p.initializer &&
    ts.isVariableDeclarationList(p.initializer)
  ) {
    for (const d of p.initializer.declarations) bindingNames(d.name, names)
  }
  if (ts.isBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)) {
    for (const st of p.statements) {
      if (ts.isVariableStatement(st))
        for (const d of st.declarationList.declarations) bindingNames(d.name, names)
      if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name)
        names.add(st.name.text)
    }
  }
  scopeNameCache.set(p, names)
  return names
}

/** True when `name` is redeclared by a scope between `node` and the top level. */
function isShadowed(node: ts.Node, name: string): boolean {
  for (let p: ts.Node | undefined = node.parent; p && !ts.isSourceFile(p); p = p.parent) {
    if (scopeNames(p).has(name)) return true
  }
  return false
}

/** Identifiers that are names, not references (property names, declaration names, JSX attribute names). */
function isNonReferenceIdentifier(id: ts.Identifier): boolean {
  const p = id.parent
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true
  if (
    (ts.isPropertyAssignment(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isPropertySignature(p) ||
      ts.isGetAccessor(p) ||
      ts.isSetAccessor(p)) &&
    p.name === id
  )
    return true
  if (ts.isJsxAttribute(p) && p.name === id) return true
  if (
    (ts.isVariableDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isClassDeclaration(p) ||
      ts.isClassExpression(p)) &&
    p.name === id
  )
    return true
  if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) return true
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return true
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true
  if (ts.isExportSpecifier(p) && p.name === id && p.propertyName) return true
  return false
}

export function parseFile(fileName: string, source: string): ParsedFile {
  try {
    return parseUnsafe(fileName, source)
  } catch {
    return { parsed: false, definitions: [], imports: [], locallyUsed: [], docComment: null }
  }
}

function parseUnsafe(fileName: string, source: string): ParsedFile {
  if (typeof source !== 'string') throw new TypeError('source must be a string')
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName)
  )

  const posOf = (node: ts.Node, length?: number): Pos => {
    const start = node.getStart(sf)
    const lc = sf.getLineAndCharacterOfPosition(start)
    return { line: lc.line + 1, col: lc.character, length: length ?? node.getEnd() - start }
  }

  // ---------- definitions ----------
  const defs = new Map<string, ParsedDefinition>()
  const declNodes = new Map<string, ts.Node>()
  const exportSites = new Set<ts.Node>()
  const addDef = (
    name: string,
    kind: ParsedDefinition['kind'],
    pos: Pos,
    exported: boolean,
    isDefault: boolean,
    decl?: ts.Node
  ): void => {
    if (decl && !declNodes.has(name)) declNodes.set(name, decl)
    const existing = defs.get(name)
    if (existing) {
      existing.exported ||= exported
      existing.isDefault ||= isDefault
      return
    }
    defs.set(name, { name, kind, pos, exported, isDefault })
  }
  const markExported = (name: string, isDefault: boolean): boolean => {
    const d = defs.get(name)
    if (!d) return false
    d.exported = true
    if (isDefault) d.isDefault = true
    return true
  }
  const fnKind = (name: string, body: ts.Node): ParsedDefinition['kind'] =>
    /^[A-Z]/.test(name) && containsJsx(body) ? 'component' : 'function'
  const anonDefaultPos = (st: ts.Node): Pos => posOf(st, 'export default'.length)
  const kindOfExpr = (name: string, expr: ts.Expression): ParsedDefinition['kind'] =>
    isFunctionLike(expr) ? fnKind(name, expr) : ts.isClassExpression(expr) ? 'class' : 'variable'

  const deferredExports: (() => void)[] = []

  for (const st of sf.statements) {
    const exported = hasModifier(st, ts.SyntaxKind.ExportKeyword)
    const isDefault = hasModifier(st, ts.SyntaxKind.DefaultKeyword)

    if (ts.isFunctionDeclaration(st)) {
      if (st.name)
        addDef(st.name.text, fnKind(st.name.text, st), posOf(st.name), exported, isDefault, st)
      else if (isDefault) addDef('default', 'function', anonDefaultPos(st), true, true)
    } else if (ts.isClassDeclaration(st)) {
      if (st.name) addDef(st.name.text, 'class', posOf(st.name), exported, isDefault, st)
      else if (isDefault) addDef('default', 'class', anonDefaultPos(st), true, true)
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || isRequireCall(d.initializer)) continue
        addDef(
          d.name.text,
          d.initializer ? kindOfExpr(d.name.text, d.initializer) : 'variable',
          posOf(d.name),
          exported,
          false,
          d
        )
      }
    } else if (ts.isExportAssignment(st) && !st.isExportEquals) {
      const e = st.expression
      if (ts.isIdentifier(e)) exportSites.add(e)
      deferredExports.push(() => {
        if (ts.isIdentifier(e) && markExported(e.text, true)) return
        addDef('default', kindOfExpr('default', e), anonDefaultPos(st), true, true)
      })
    } else if (
      ts.isExportDeclaration(st) &&
      !st.moduleSpecifier &&
      !st.isTypeOnly &&
      st.exportClause &&
      ts.isNamedExports(st.exportClause)
    ) {
      for (const el of st.exportClause.elements) {
        exportSites.add(el.name)
        if (el.propertyName) exportSites.add(el.propertyName)
        if (el.isTypeOnly) continue
        const local = (el.propertyName ?? el.name).text
        const exportedAs = el.name.text
        deferredExports.push(() => void markExported(local, exportedAs === 'default'))
      }
    } else if (
      ts.isExpressionStatement(st) &&
      ts.isBinaryExpression(st.expression) &&
      st.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const { left, right } = st.expression
      if (ts.isPropertyAccessExpression(left) && isModuleExports(left)) {
        // module.exports = …
        deferredExports.push(() => handleModuleExportsAssignment(right))
      } else if (ts.isPropertyAccessExpression(left) && isModuleExports(left.expression)) {
        // exports.x = … / module.exports.x = …
        const name = left.name.text
        if (ts.isIdentifier(right)) exportSites.add(right)
        deferredExports.push(() => {
          if (ts.isIdentifier(right) && right.text === name && markExported(name, false)) return
          addDef(name, kindOfExpr(name, right), posOf(left.name), true, false, st)
        })
      }
    }
  }

  function handleModuleExportsAssignment(right: ts.Expression): void {
    if (ts.isObjectLiteralExpression(right)) {
      for (const prop of right.properties) {
        if (ts.isShorthandPropertyAssignment(prop)) exportSites.add(prop.name)
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer))
          exportSites.add(prop.initializer)
        if (ts.isShorthandPropertyAssignment(prop)) {
          if (!markExported(prop.name.text, false))
            addDef(prop.name.text, 'variable', posOf(prop.name), true, false)
        } else if (
          ts.isPropertyAssignment(prop) &&
          (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
        ) {
          const name = prop.name.text
          if (
            ts.isIdentifier(prop.initializer) &&
            prop.initializer.text === name &&
            markExported(name, false)
          )
            continue
          addDef(name, kindOfExpr(name, prop.initializer), posOf(prop.name), true, false)
        } else if (ts.isMethodDeclaration(prop) && ts.isIdentifier(prop.name)) {
          addDef(prop.name.text, 'function', posOf(prop.name), true, false)
        }
      }
      return
    }
    if (ts.isIdentifier(right)) exportSites.add(right)
    if (ts.isIdentifier(right) && markExported(right.text, true)) return
    if ((ts.isFunctionExpression(right) || ts.isClassExpression(right)) && right.name) {
      const name = right.name.text
      addDef(
        name,
        ts.isClassExpression(right) ? 'class' : fnKind(name, right),
        posOf(right.name),
        true,
        true
      )
      return
    }
    addDef('default', kindOfExpr('default', right), posOf(right.parent.parent), true, true)
  }

  for (const run of deferredExports) run()

  // ---------- imports ----------
  const imports: ImportRecord[] = []
  /** local name → (record, imported name, isRequire) for reference tracking */
  const locals = new Map<string, { rec: ImportRecord; imported: string; viaRequire: boolean }>()
  const skipNodes = new Set<ts.Node>()

  const addBinding = (
    rec: ImportRecord,
    imported: string,
    local: string,
    viaRequire: boolean
  ): void => {
    rec.bindings.push({ imported, local })
    locals.set(local, { rec, imported, viaRequire })
  }

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteralLike(st.moduleSpecifier)) {
      const specifier = st.moduleSpecifier.text
      skipNodes.add(st)
      if (!isCodeSpecifier(specifier)) continue
      const clause = st.importClause
      if (!clause) {
        imports.push({ specifier, kind: 'sideEffect', bindings: [], refs: {} })
        continue
      }
      if (clause.isTypeOnly) continue
      const nb = clause.namedBindings
      const rec: ImportRecord = {
        specifier,
        kind: nb && ts.isNamespaceImport(nb) ? 'namespace' : 'named',
        bindings: [],
        refs: {}
      }
      if (clause.name) addBinding(rec, 'default', clause.name.text, false)
      if (nb && ts.isNamespaceImport(nb)) addBinding(rec, '*', nb.name.text, false)
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          if (el.isTypeOnly) continue
          addBinding(rec, (el.propertyName ?? el.name).text, el.name.text, false)
        }
      }
      if (rec.bindings.length) imports.push(rec)
    } else if (
      ts.isExportDeclaration(st) &&
      st.moduleSpecifier &&
      ts.isStringLiteralLike(st.moduleSpecifier)
    ) {
      skipNodes.add(st)
      const specifier = st.moduleSpecifier.text
      if (st.isTypeOnly || !isCodeSpecifier(specifier)) continue
      if (!st.exportClause) {
        imports.push({ specifier, kind: 'reexportAll', bindings: [], refs: {} })
      } else if (ts.isNamespaceExport(st.exportClause)) {
        imports.push({
          specifier,
          kind: 'reexport',
          bindings: [{ imported: '*', local: st.exportClause.name.text }],
          refs: {}
        })
      } else {
        const bindings = st.exportClause.elements
          .filter((el) => !el.isTypeOnly)
          .map((el) => ({ imported: (el.propertyName ?? el.name).text, local: el.name.text }))
        if (bindings.length) imports.push({ specifier, kind: 'reexport', bindings, refs: {} })
      }
    }
  }

  // require(), dynamic import() anywhere in the file
  const scanCalls = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && isRequireCall(node.initializer)) {
      const specifier = (node.initializer.arguments[0] as ts.StringLiteralLike).text
      skipNodes.add(node)
      if (isCodeSpecifier(specifier)) {
        if (ts.isIdentifier(node.name)) {
          const rec: ImportRecord = { specifier, kind: 'namespace', bindings: [], refs: {} }
          addBinding(rec, '*', node.name.text, true)
          imports.push(rec)
        } else if (ts.isObjectBindingPattern(node.name)) {
          const rec: ImportRecord = { specifier, kind: 'named', bindings: [], refs: {} }
          for (const el of node.name.elements) {
            if (!ts.isIdentifier(el.name)) continue
            const imported =
              el.propertyName && ts.isIdentifier(el.propertyName)
                ? el.propertyName.text
                : el.name.text
            addBinding(rec, imported, el.name.text, true)
          }
          if (rec.bindings.length) imports.push(rec)
        }
      }
      return
    }
    if (isRequireCall(node)) {
      const specifier = (node.arguments[0] as ts.StringLiteralLike).text
      if (isCodeSpecifier(specifier))
        imports.push({ specifier, kind: 'sideEffect', bindings: [], refs: {} })
    } else if (isDynamicImport(node)) {
      const specifier = (node.arguments[0] as ts.StringLiteralLike).text
      if (isCodeSpecifier(specifier))
        imports.push({ specifier, kind: 'dynamic', bindings: [], refs: {} })
    }
    ts.forEachChild(node, scanCalls)
  }
  for (const st of sf.statements) if (!skipNodes.has(st)) scanCalls(st)

  // ---------- references ----------
  const addRef = (rec: ImportRecord, key: string, pos: Pos): void => {
    ;(rec.refs[key] ??= []).push(pos)
  }
  const locallyUsed = new Set<string>()
  const isInside = (node: ts.Node, ancestor: ts.Node | undefined): boolean => {
    for (let p: ts.Node | undefined = node; p; p = p.parent) if (p === ancestor) return true
    return false
  }
  const visit = (node: ts.Node): void => {
    if (skipNodes.has(node)) return
    if (
      ts.isIdentifier(node) &&
      defs.has(node.text) &&
      !locals.has(node.text) &&
      !exportSites.has(node) &&
      !isNonReferenceIdentifier(node) &&
      !isInside(node, declNodes.get(node.text)) &&
      !inTypePosition(node) &&
      !isShadowed(node, node.text)
    ) {
      locallyUsed.add(node.text)
    }
    if (ts.isIdentifier(node) && !isNonReferenceIdentifier(node)) {
      const binding = locals.get(node.text)
      if (binding && !inTypePosition(node) && !isShadowed(node, node.text)) {
        const parent = node.parent
        if (binding.imported === '*') {
          if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
            addRef(binding.rec, parent.name.text, posOf(parent.name))
          } else {
            addRef(binding.rec, binding.viaRequire ? 'default' : '*', posOf(node))
          }
        } else {
          addRef(binding.rec, binding.imported, posOf(node))
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  const kept = imports.filter(
    (rec) => !(rec.kind === 'named' || rec.kind === 'namespace') || Object.keys(rec.refs).length > 0
  )

  return {
    docComment: fileDocComment(sf, source),
    parsed: true,
    definitions: [...defs.values()],
    imports: kept,
    locallyUsed: [...locallyUsed]
  }
}

const DOC_MAX = 140
const NOISE = /eslint|prettier|@ts-|copyright|license|@flow|@jsx|istanbul|c8 ignore/i

function isImportLike(st: ts.Statement): boolean {
  if (ts.isImportDeclaration(st) || ts.isImportEqualsDeclaration(st)) return true
  if (ts.isExportDeclaration(st) && st.moduleSpecifier) return true
  if (ts.isExpressionStatement(st)) {
    if (ts.isStringLiteral(st.expression)) return true // 'use strict' and friends
    if (isRequireCall(st.expression)) return true
  }
  if (ts.isVariableStatement(st))
    return st.declarationList.declarations.every((d) => isRequireCall(d.initializer))
  return false
}

/** Turns one comment block's raw text into plain words. */
function cleanComment(raw: string): string {
  return raw
    .replace(/^\/\*\*?|\*\/$/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*(\/\/+|\*)?\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstSentence(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text)
  const s = m ? m[1] : text
  return s.length > DOC_MAX ? s.slice(0, DOC_MAX - 1).trimEnd() + '…' : s
}

/**
 * The file's own description: a comment block at the very top of the file, or a block after the
 * imports that is separated from the next statement by a blank line (so it isn't about that statement).
 */
function fileDocComment(sf: ts.SourceFile, source: string): string | null {
  const firstCode = sf.statements.find((st) => !isImportLike(st))
  const spots = [0]
  if (firstCode) spots.push(firstCode.getFullStart())
  for (const spot of spots) {
    const ranges = ts.getLeadingCommentRanges(source, spot) ?? []
    // group comments into blocks separated by blank lines
    const blocks: { text: string; end: number }[] = []
    for (const r of ranges) {
      const text = source.slice(r.pos, r.end)
      const prev = blocks[blocks.length - 1]
      const gap = prev ? source.slice(prev.end, r.pos) : ''
      if (
        prev &&
        (gap.match(/\n/g) ?? []).length < 2 &&
        r.kind === ts.SyntaxKind.SingleLineCommentTrivia
      ) {
        prev.text += '\n' + text
        prev.end = r.end
      } else {
        blocks.push({ text, end: r.end })
      }
    }
    const nextCodeStart =
      spot === 0 ? (sf.statements[0]?.getStart(sf) ?? source.length) : firstCode!.getStart(sf)
    for (const b of blocks) {
      const words = cleanComment(b.text)
      if (!words || NOISE.test(words)) continue
      const detached = (source.slice(b.end, nextCodeStart).match(/\n/g) ?? []).length >= 2
      const atTopBeforeImports =
        spot === 0 && sf.statements[0] !== undefined && sf.statements[0] !== firstCode
      if (detached || atTopBeforeImports || !firstCode) return firstSentence(words)
    }
  }
  return null
}
