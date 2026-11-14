import 'pixi.js/unsafe-eval'
import { useEffect, useRef, useState } from 'react'
import { Application, Circle, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js'
import { Viewport } from 'pixi-viewport'
import type { NodeId, ProjectGraph } from '../../../core/types'
import { createLayout, type SimNode } from './layout'
import { neighborhood, type Neighborhood } from './neighborhood'
import { prewarmInWorker } from './prewarm'

export interface GraphViewProps {
  graph: ProjectGraph
  selectedId: NodeId | null
  /** Fires with a file id on file click, with null on background click. */
  onSelect: (id: NodeId | null) => void
  /** When this changes, the viewport animates to center that node. */
  focusId?: NodeId | null
}

const BG = 0x1e1e22
const FILE_COLOR = 0xc8c8d2
const ROOT_COLOR = 0xe8e8ee
const FOLDER_PALETTE = [0xf2b84b, 0x60a5fa, 0xf472b6, 0x34d399, 0xfb923c, 0xa78bfa, 0x22d3ee, 0xfacc15]
const CONTAINS_COLOR = 0x5a5a66
const IMPORT_COLOR = 0xa78bfa
const OUT_COLOR = 0xa78bfa
const IN_COLOR = 0x34d399
const DIM = 0.12
const TEX_R = 32
/** File labels appear once zoomed this far past the initial fit (folder labels show at fit). */
const LABEL_ZOOM_FACTOR = 1.8

interface NodeView {
  sim: SimNode
  sprite: Sprite
  label: Text
}

function folderColor(id: NodeId, topLevel: string[]): number {
  if (id === '.') return ROOT_COLOR
  const top = id.split('/')[0]
  const i = topLevel.indexOf(top)
  return FOLDER_PALETTE[(i < 0 ? 0 : i) % FOLDER_PALETTE.length]
}

export default function GraphView({ graph, selectedId, onSelect, focusId }: GraphViewProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<NodeId | null>(selectedId)
  const onSelectRef = useRef(onSelect)
  const focusRef = useRef<(id: NodeId) => void>(() => {})
  const [arranging, setArranging] = useState(true)

  selectedRef.current = selectedId
  onSelectRef.current = onSelect

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let cancelled = false
    let cleanup: (() => void) | null = null

    setArranging(true)
    // Layout prewarm runs in a worker (main-thread fallback if it fails). The Pixi app is only created
    // after that, so a mount that's cancelled meanwhile (React StrictMode runs effects twice) never
    // builds a renderer — destroying a just-initialized Pixi app races its first frame.
    void (async () => {
      const initialPositions = await prewarmInWorker(graph).catch(() => null)
      if (cancelled) return
      const app = new Application()
      await app.init({ resizeTo: el, background: BG, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 })
      if (cancelled) {
        app.destroy(true, { children: true, texture: true })
        return
      }
      cleanup = mount(app, el, initialPositions)
      setArranging(false)
    })()

    function mount(app: Application, el: HTMLDivElement, initialPositions: Map<NodeId, { x: number; y: number }> | null): () => void {
      el.appendChild(app.canvas)
      const { nodes, links, sim } = initialPositions
        ? createLayout(graph, { prewarmTicks: 0, initialPositions })
        : createLayout(graph)

      const viewport = new Viewport({
        screenWidth: el.clientWidth,
        screenHeight: el.clientHeight,
        events: app.renderer.events,
        ticker: app.ticker
      })
      viewport.drag().pinch().wheel({ smooth: 4 }).decelerate({ friction: 0.92 }).clampZoom({ minScale: 0.08, maxScale: 6 })
      app.stage.addChild(viewport)

      const edgesG = new Graphics()
      const nodeLayer = new Container()
      const labelLayer = new Container()
      viewport.addChild(edgesG, nodeLayer, labelLayer)

      const circle = new Graphics().circle(0, 0, TEX_R).fill(0xffffff)
      const tex: Texture = app.renderer.generateTexture({ target: circle, resolution: 2, antialias: true })
      circle.destroy()

      const topLevel = [...new Set(graph.nodes.filter((n) => n.kind === 'folder' && n.id !== '.').map((n) => n.id.split('/')[0]))].sort()
      const nameOf = new Map(graph.nodes.map((n) => [n.id, n.name]))

      let hoverId: NodeId | null = null
      const views: NodeView[] = nodes.map((n) => {
        const sprite = new Sprite(tex)
        sprite.anchor.set(0.5)
        sprite.scale.set(n.radius / TEX_R)
        sprite.tint = n.kind === 'folder' ? folderColor(n.id, topLevel) : FILE_COLOR
        sprite.eventMode = 'static'
        sprite.cursor = n.kind === 'file' ? 'pointer' : 'default'
        // generous hit area in texture space (scaled with the sprite)
        sprite.hitArea = new Circle(0, 0, TEX_R * Math.max(1.6, 10 / n.radius))
        sprite.on('pointerover', () => (hoverId = n.id))
        sprite.on('pointerout', () => {
          if (hoverId === n.id) hoverId = null
        })
        nodeLayer.addChild(sprite)

        const label = new Text({
          text: nameOf.get(n.id) ?? n.id,
          style: {
            fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
            fontSize: n.kind === 'folder' ? 13 : 11,
            fontWeight: n.kind === 'folder' ? '600' : '400',
            fill: n.kind === 'folder' ? 0xe8e8ee : 0xb8b8c2
          },
          resolution: 3
        })
        label.anchor.set(0.5, 0)
        label.visible = false
        labelLayer.addChild(label)
        return { sim: n, sprite, label }
      })
      const viewById = new Map(views.map((v) => [v.sim.id, v]))

      // Click handling: pixi-viewport only emits 'clicked' when the pointer didn't drag.
      viewport.on('clicked', (e) => {
        let best: NodeView | null = null
        let bestD = Infinity
        for (const v of views) {
          const d = Math.hypot(v.sim.x - e.world.x, v.sim.y - e.world.y)
          const reach = Math.max(v.sim.radius * 1.6, 10 / viewport.scale.x)
          if (d < reach && d < bestD) {
            best = v
            bestD = d
          }
        }
        if (!best) onSelectRef.current(null)
        else if (best.sim.kind === 'file') onSelectRef.current(best.sim.id)
      })

      // Initial framing
      let fitZoom = 1
      const fit = (): void => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const n of nodes) {
          minX = Math.min(minX, n.x); minY = Math.min(minY, n.y)
          maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y)
        }
        const w = Math.max(maxX - minX, 200)
        const h = Math.max(maxY - minY, 200)
        fitZoom = Math.min(el.clientWidth / w, el.clientHeight / h) * 0.85
        viewport.setZoom(fitZoom, true)
        viewport.moveCenter((minX + maxX) / 2, (minY + maxY) / 2)
      }
      fit()

      focusRef.current = (id) => {
        const v = viewById.get(id)
        if (!v) return
        viewport.animate({
          position: { x: v.sim.x, y: v.sim.y },
          scale: Math.max(viewport.scale.x, 1.4),
          time: 550,
          ease: 'easeInOutSine'
        })
      }

      const onResize = (): void => viewport.resize(el.clientWidth, el.clientHeight)
      app.renderer.on('resize', onResize)
      // resizeTo only follows window resizes; the code panel changes our width too
      const ro = new ResizeObserver(() => app.resize())
      ro.observe(el)

      sim.restart()

      let lastActive: NodeId | null | undefined
      let nb: Neighborhood | null = null
      const draw = (): void => {
        const active = hoverId ?? selectedRef.current
        if (active !== lastActive) {
          nb = active ? neighborhood(graph, active) : null
          lastActive = active
        }
        const zoom = viewport.scale.x

        for (const v of views) {
          v.sprite.position.set(v.sim.x, v.sim.y)
          const lit = !nb || nb.nodes.has(v.sim.id)
          v.sprite.alpha = lit ? 1 : DIM
          const isActive = v.sim.id === active
          v.sprite.scale.set((v.sim.radius * (isActive ? 1.5 : 1)) / TEX_R)
          const showLabel =
            (nb && nb.nodes.has(v.sim.id)) ||
            (!nb && (v.sim.kind === 'folder' ? zoom > fitZoom * 0.6 : zoom > fitZoom * LABEL_ZOOM_FACTOR))
          v.label.visible = !!showLabel
          if (showLabel) {
            v.label.position.set(v.sim.x, v.sim.y + v.sim.radius + 3)
            // keep labels a readable on-screen size
            v.label.scale.set(Math.min(1.6, Math.max(0.6, 1 / zoom)))
            v.label.alpha = isActive ? 1 : 0.85
          }
        }

        edgesG.clear()
        const w = 1 / Math.max(zoom, 0.35)
        const strokeLinks = (pick: (i: number) => boolean, color: number, alpha: number, width: number): void => {
          let any = false
          for (let i = 0; i < links.length; i++) {
            if (!pick(i)) continue
            const l = links[i]
            edgesG.moveTo(l.source.x, l.source.y).lineTo(l.target.x, l.target.y)
            any = true
          }
          if (any) edgesG.stroke({ color, alpha, width })
        }
        const lit = (i: number): boolean => !nb || nb.edges.has(graphEdgeIndex[i])
        strokeLinks((i) => links[i].kind === 'contains' && lit(i), CONTAINS_COLOR, nb ? 0.55 : 0.4, w * 0.8)
        strokeLinks((i) => links[i].kind === 'contains' && !lit(i), CONTAINS_COLOR, 0.4 * DIM, w * 0.8)
        strokeLinks((i) => links[i].kind === 'import' && !lit(i), IMPORT_COLOR, 0.5 * DIM, w)
        if (!nb) {
          strokeLinks((i) => links[i].kind === 'import', IMPORT_COLOR, 0.5, w * 1.1)
        } else {
          strokeLinks((i) => links[i].kind === 'import' && lit(i) && links[i].source.id === active, OUT_COLOR, 0.95, w * 1.8)
          strokeLinks((i) => links[i].kind === 'import' && lit(i) && links[i].target.id === active, IN_COLOR, 0.95, w * 1.8)
          strokeLinks(
            (i) => links[i].kind === 'import' && lit(i) && links[i].source.id !== active && links[i].target.id !== active,
            IMPORT_COLOR,
            0.6,
            w
          )
        }
      }

      // links[i] ↔ graph.edges index (createLayout keeps edge order but skips dangling edges)
      const graphEdgeIndex: number[] = []
      {
        let li = 0
        graph.edges.forEach((e, gi) => {
          const l = links[li]
          if (l && l.source.id === e.source && l.target.id === e.target && l.kind === e.kind) {
            graphEdgeIndex[li] = gi
            li++
          }
        })
      }

      app.ticker.add(draw)

      if (import.meta.env.DEV) {
        // scripted verification hook: screen position of a node
        ;(window as unknown as { __lemonGraph?: unknown }).__lemonGraph = {
          screenOf: (id: NodeId) => {
            const v = viewById.get(id)
            return v ? viewport.toScreen(v.sim.x, v.sim.y) : null
          },
          zoom: () => viewport.scale.x
        }
      }

      return () => {
        app.ticker.remove(draw)
        app.renderer.off('resize', onResize)
        ro.disconnect()
        sim.stop()
        focusRef.current = () => {}
        // the viewport unhooks itself from app.ticker, so it must go before the app
        viewport.destroy({ children: true })
        tex.destroy(true)
        app.destroy(true, { children: true, texture: true })
      }
    }

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [graph])

  useEffect(() => {
    if (!focusId) return
    // wait a frame so a layout change (e.g. the code panel opening) has resized the viewport
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => focusRef.current(focusId))
    })
    return () => cancelAnimationFrame(raf)
  }, [focusId])

  return (
    <>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {arranging && <div className="arranging">Arranging…</div>}
    </>
  )
}
