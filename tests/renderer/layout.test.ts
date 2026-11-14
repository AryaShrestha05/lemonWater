import { describe, expect, test } from 'vitest'
import { createLayout, type SimNode } from '../../src/renderer/src/graph/layout'
import type { GraphEdge, GraphNode, ProjectGraph } from '../../src/core/types'

/** 3 folders × 10 files, a few cross-folder imports. */
function synthetic(): ProjectGraph {
  const nodes: GraphNode[] = [{ id: '.', kind: 'folder', name: 'root', parent: null }]
  const edges: GraphEdge[] = []
  for (const f of ['a', 'b', 'c']) {
    nodes.push({ id: f, kind: 'folder', name: f, parent: '.' })
    edges.push({ kind: 'contains', source: '.', target: f })
    for (let i = 0; i < 10; i++) {
      const id = `${f}/${i}.ts`
      nodes.push({ id, kind: 'file', name: `${i}.ts`, parent: f, parsed: true, definitions: [] })
      edges.push({ kind: 'contains', source: f, target: id })
    }
  }
  edges.push({ kind: 'import', source: 'a/0.ts', target: 'b/0.ts', symbols: [] })
  edges.push({ kind: 'import', source: 'b/1.ts', target: 'c/1.ts', symbols: [] })
  return { root: '/x', nodes, edges }
}

const dist = (a: SimNode, b: SimNode): number => Math.hypot(a.x - b.x, a.y - b.y)

describe('createLayout', () => {
  test('every node gets a finite position after prewarm', () => {
    const { nodes, sim } = createLayout(synthetic())
    sim.stop()
    expect(nodes).toHaveLength(34)
    for (const n of nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true)
  })

  test('the simulation is calm after prewarm', () => {
    const { sim } = createLayout(synthetic())
    sim.stop()
    expect(sim.alpha()).toBeLessThan(0.05)
  })

  test('files sit near their folder', () => {
    const { nodes, sim } = createLayout(synthetic())
    sim.stop()
    const byId = new Map(nodes.map((n) => [n.id, n]))
    for (const f of ['a', 'b', 'c']) {
      const own = byId.get(f)!
      const others = ['a', 'b', 'c'].filter((x) => x !== f).map((x) => byId.get(x)!)
      const files = nodes.filter((n) => n.id.startsWith(f + '/'))
      const meanOwn = files.reduce((s, n) => s + dist(n, own), 0) / files.length
      const meanOther = files.reduce((s, n) => s + Math.min(...others.map((o) => dist(n, o))), 0) / files.length
      expect(meanOwn).toBeLessThan(meanOther)
    }
  })

  test('folders are bigger than files', () => {
    const { nodes, sim } = createLayout(synthetic())
    sim.stop()
    const folder = nodes.find((n) => n.id === 'a')!
    const file = nodes.find((n) => n.id === 'a/0.ts')!
    expect(folder.radius).toBeGreaterThan(file.radius)
  })

  test('links reference sim nodes and keep their kind', () => {
    const { links, sim } = createLayout(synthetic())
    sim.stop()
    expect(links.filter((l) => l.kind === 'import')).toHaveLength(2)
    expect(typeof links[0].source).toBe('object')
  })

  test('handles a graph with only the root folder', () => {
    const { nodes, sim } = createLayout({ root: '/x', nodes: [{ id: '.', kind: 'folder', name: 'r', parent: null }], edges: [] })
    sim.stop()
    expect(nodes).toHaveLength(1)
    expect(Number.isFinite(nodes[0].x)).toBe(true)
  })
})
