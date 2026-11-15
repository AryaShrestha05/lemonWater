/* Prints a summary of the graph for a project folder: npx tsx scripts/analyze.ts <folder> */
import { analyzeProject } from '../src/core/analyzeProject'
import type { FileNode, ImportEdge } from '../src/core/types'

const root = process.argv[2]
if (!root) {
  console.error('usage: tsx scripts/analyze.ts <folder>')
  process.exit(1)
}
const t0 = Date.now()
const g = analyzeProject(root)
const files = g.nodes.filter((n): n is FileNode => n.kind === 'file')
const imports = g.edges.filter((e): e is ImportEdge => e.kind === 'import')
const unused = files.flatMap((f) =>
  f.definitions.filter((d) => d.notUsedAnywhere).map((d) => `${f.id}:${d.name}`)
)
const degree = new Map<string, number>()
for (const e of imports)
  for (const id of [e.source, e.target]) degree.set(id, (degree.get(id) ?? 0) + 1)

console.log(`analyzed in ${Date.now() - t0}ms`)
console.log(
  `folders ${g.nodes.length - files.length}, files ${files.length} (unparsed ${files.filter((f) => !f.parsed).length}), import edges ${imports.length}, with symbols ${imports.filter((e) => e.symbols.length).length}`
)
console.log(`notUsedAnywhere ${unused.length}`)
console.log('top files by edges:')
for (const [id, n] of [...degree].sort((a, b) => b[1] - a[1]).slice(0, 5))
  console.log(`  ${n}  ${id}`)
if (process.argv.includes('--unused')) for (const u of unused) console.log(`  unused: ${u}`)
if (process.argv.includes('--paths')) for (const f of files) console.log(`  ${f.id}`)
