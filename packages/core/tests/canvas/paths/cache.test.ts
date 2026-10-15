import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import type { Path } from 'canvaskit-wasm'

import { SceneGraph, type Stroke } from '@open-pencil/scene-graph'

import { SkiaRenderer } from '#core/canvas'
import {
  cachePaths,
  createPathCache,
  releaseUncachedPaths,
  type PathOwner
} from '#core/canvas/paths/cache'
import { render } from '#core/canvas/renderer/pipeline'
import { initCanvasKit } from '#core/io'

const ck = await initCanvasKit()

function linePath(points: number): Path {
  const builder = new ck.PathBuilder()
  builder.moveTo(0, 0)
  for (let i = 1; i < points; i++) builder.lineTo(i, i % 2)
  return builder.detachAndDelete()
}

const STROKE: Stroke = {
  type: 'SOLID',
  color: { r: 0, g: 0, b: 0, a: 1 },
  weight: 1,
  opacity: 1,
  visible: true,
  align: 'CENTER'
}

function triangles(count: number, strokes: Stroke[] = []) {
  const graph = new SceneGraph()
  const page = expectDefined(graph.getPages()[0], 'default page')
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const node = graph.createNode('VECTOR', page.id, {
      x: (i % 20) * 10,
      y: Math.floor(i / 20) * 10,
      width: 8,
      height: 8,
      fills: [
        { type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.8, a: 1 }, opacity: 1, visible: true }
      ],
      strokes,
      vectorNetwork: {
        vertices: [
          { x: 0, y: 0 },
          { x: 8, y: 0 },
          { x: 8, y: 8 }
        ],
        segments: [0, 1, 2].map((start) => ({
          start,
          end: (start + 1) % 3,
          tangentStart: { x: 0, y: 0 },
          tangentEnd: { x: 0, y: 0 }
        })),
        regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2]] }]
      }
    })
    ids.push(node.id)
  }
  return { graph, pageId: page.id, ids }
}

function withRenderer(pageId: string, run: (renderer: SkiaRenderer) => void) {
  const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(256, 256), 'surface'))
  renderer.viewportWidth = 256
  renderer.viewportHeight = 256
  renderer.pageId = pageId
  renderer.pageColor = { r: 1, g: 1, b: 1, a: 1 }
  try {
    run(renderer)
  } finally {
    renderer.destroy()
  }
}

describe('path cache', () => {
  test('evicts the least recently used paths by point count and deletes them', () => {
    const cache = createPathCache(40)
    const [a, b, c] = [linePath(10), linePath(10), linePath(10)]
    cache.set('a', [a])
    cache.set('b', [b])
    cache.get('a')
    cache.set('c', [c])
    expect(cache.weight).toBeLessThanOrEqual(40)
    expect([...cache].map(([key]) => key)).toEqual(['a', 'c'])
    expect(b.isDeleted()).toBe(true)
    expect(a.isDeleted()).toBe(false)
    cache.clear()
    expect(a.isDeleted() && c.isDeleted()).toBe(true)
  })

  test('paths larger than the cache are drawn this frame and deleted with the next', () => {
    const owner: PathOwner = { uncachedPaths: [] }
    const cache = createPathCache(20)
    const huge = linePath(50)
    cachePaths(owner, cache, 'huge', [huge])
    expect(cache.has('huge')).toBe(false)
    expect(huge.isDeleted()).toBe(false)
    releaseUncachedPaths(owner)
    expect(huge.isDeleted()).toBe(true)
    expect(owner.uncachedPaths).toEqual([])
  })
})

describe('renderer path caches', () => {
  test('stay within their point budget however many vectors are drawn', () => {
    const { graph, pageId } = triangles(200)
    withRenderer(pageId, (renderer) => {
      renderer.vectorPathCache = createPathCache(400)
      const earliest = [linePath(4)]
      renderer.vectorPathCache.set('earliest', earliest)
      render(renderer, graph, new Set(), {}, 1, 'scene', true)
      expect(renderer.vectorPathCache.size).toBeGreaterThan(0)
      expect(renderer.vectorPathCache.weight).toBeLessThanOrEqual(400)
      expect(earliest.every((path) => path.isDeleted())).toBe(true)
    })
  })

  test('invalidating a vector deletes every path built for it and keeps the others', () => {
    const { pageId, ids } = triangles(2, [STROKE])
    const [edited, other] = ids
    withRenderer(pageId, (renderer) => {
      const caches = [
        renderer.vectorPathCache,
        renderer.vectorStrokePathCache,
        renderer.vectorStrokeOutlineCache,
        renderer.fillGeometryCache,
        renderer.strokeGeometryCache
      ]
      const built = caches.map((cache) => {
        const paths = [linePath(3)]
        cache.set(cache === renderer.vectorStrokeOutlineCache ? `${edited}|1|NONE` : edited, paths)
        cache.set(other, [linePath(3)])
        return paths
      })
      renderer.invalidateVectorPath(edited)
      for (const cache of caches) expect([...cache].map(([key]) => key)).toEqual([other])
      expect(built.flat().every((path) => path.isDeleted())).toBe(true)
    })
  })

  test('stroke outlines drawn without a cache entry are deleted when the next frame starts', () => {
    const { graph, pageId } = triangles(3, [STROKE])
    withRenderer(pageId, (renderer) => {
      render(renderer, graph, new Set(), {}, 1, 'scene', true)
      const outlines = renderer.uncachedPaths.flat()
      expect(outlines.length).toBe(3)
      render(renderer, graph, new Set(), {}, 1, 'scene', true)
      expect(outlines.every((path) => path.isDeleted())).toBe(true)
      expect(renderer.uncachedPaths.flat()).toHaveLength(3)
    })
  })
})
