import { describe, expect, test } from 'bun:test'

import {
  dedupePoints,
  fitBeziers,
  pencilToNetwork,
  simplifyRDP,
  type Bezier
} from '@open-pencil/core/vector'
import type { Vector } from '@open-pencil/scene-graph'

const distance = (a: Vector, b: Vector) => Math.hypot(a.x - b.x, a.y - b.y)

function circle(count: number, radius = 50, center: Vector = { x: 100, y: 100 }): Vector[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / (count - 1)) * Math.PI * 2
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
  })
}

function bezierPoint(b: Bezier, t: number): Vector {
  const mt = 1 - t
  return {
    x: mt ** 3 * b.p0.x + 3 * mt * mt * t * b.c1.x + 3 * mt * t * t * b.c2.x + t ** 3 * b.p3.x,
    y: mt ** 3 * b.p0.y + 3 * mt * mt * t * b.c1.y + 3 * mt * t * t * b.c2.y + t ** 3 * b.p3.y
  }
}

/** The farthest any input point is from the fitted curves (by dense sampling). */
function deviation(points: Vector[], curves: Bezier[]): number {
  const samples = curves.flatMap((curve) =>
    Array.from({ length: 600 }, (_, i) => bezierPoint(curve, i / 599))
  )
  return Math.max(...points.map((p) => Math.min(...samples.map((s) => distance(p, s)))))
}

describe('simplifyRDP', () => {
  test('collinear points collapse to the two ends', () => {
    const line = Array.from({ length: 20 }, (_, i) => ({ x: i * 5, y: i * 2 }))
    expect(simplifyRDP(line, 0.5)).toEqual([line[0], line[19]])
  })

  test('a corner survives, and every dropped point stays within epsilon', () => {
    const path: Vector[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ x: i * 10, y: 0 })),
      ...Array.from({ length: 10 }, (_, i) => ({ x: 90, y: (i + 1) * 10 }))
    ]
    const simplified = simplifyRDP(path, 1)
    expect(simplified).toHaveLength(3)
    expect(simplified[1]).toEqual({ x: 90, y: 0 })
  })

  test('fewer than three points are returned as they are', () => {
    expect(simplifyRDP([{ x: 1, y: 2 }], 5)).toEqual([{ x: 1, y: 2 }])
    expect(simplifyRDP([], 5)).toEqual([])
  })
})

describe('dedupePoints', () => {
  test('drops points that crowd the last one but keeps where the stroke ended', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.2, y: 0 },
      { x: 5, y: 0 },
      { x: 5.1, y: 0 }
    ]
    const out = dedupePoints(points, 1)
    expect(out[0]).toEqual({ x: 0, y: 0 })
    expect(out.at(-1)).toEqual({ x: 5.1, y: 0 })
    expect(out).toHaveLength(2)
  })

  test('a stroke that never moved far enough still keeps its two ends', () => {
    expect(
      dedupePoints(
        [
          { x: 0, y: 0 },
          { x: 0.1, y: 0 }
        ],
        1
      )
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0.1, y: 0 }
    ])
  })
})

describe('fitBeziers', () => {
  test('a straight line is one curve', () => {
    const line = Array.from({ length: 30 }, (_, i) => ({ x: i * 4, y: i * 1.5 }))
    const curves = fitBeziers(line, 1)
    expect(curves).toHaveLength(1)
    expect(deviation(line, curves)).toBeLessThan(0.5)
  })

  test('a circle takes a few curves and stays within tolerance of the drawn points', () => {
    const points = circle(120)
    const curves = fitBeziers(points, 1.5)
    expect(curves.length).toBeGreaterThan(1)
    expect(curves.length).toBeLessThanOrEqual(8)
    expect(deviation(points, curves)).toBeLessThan(2)
  })

  test('a sine wave stays within tolerance', () => {
    const points = Array.from({ length: 150 }, (_, i) => ({
      x: i * 2,
      y: 40 * Math.sin((i * 2) / 30)
    }))
    const curves = fitBeziers(points, 1.5)
    expect(deviation(points, curves)).toBeLessThan(2.5)
  })

  test('curves join end to end with the same tangent direction (no kinks)', () => {
    const curves = fitBeziers(circle(120), 1.5)
    for (let i = 0; i < curves.length - 1; i++) {
      expect(curves[i].p3).toEqual(curves[i + 1].p0)
      const out = {
        x: curves[i + 1].c1.x - curves[i + 1].p0.x,
        y: curves[i + 1].c1.y - curves[i + 1].p0.y
      }
      const into = { x: curves[i].p3.x - curves[i].c2.x, y: curves[i].p3.y - curves[i].c2.y }
      const cross = out.x * into.y - out.y * into.x
      const scale = Math.hypot(out.x, out.y) * Math.hypot(into.x, into.y)
      // Parallel handles: the cross product vanishes relative to their lengths.
      expect(Math.abs(cross) / scale).toBeLessThan(0.05)
    }
  })

  test('a sharp corner splits into separate curves instead of rounding it off', () => {
    const points: Vector[] = [
      ...Array.from({ length: 20 }, (_, i) => ({ x: i * 5, y: 0 })),
      ...Array.from({ length: 20 }, (_, i) => ({ x: 95, y: (i + 1) * 5 }))
    ]
    const curves = fitBeziers(points, 1)
    expect(curves.length).toBeGreaterThanOrEqual(2)
    expect(deviation(points, curves)).toBeLessThan(1.5)
  })

  test('too few distinct points give no curve', () => {
    expect(fitBeziers([], 1)).toEqual([])
    expect(fitBeziers([{ x: 1, y: 1 }], 1)).toEqual([])
    expect(
      fitBeziers(
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 }
        ],
        1
      )
    ).toEqual([])
  })
})

describe('pencilToNetwork', () => {
  test('a dot is nothing', () => {
    expect(pencilToNetwork([{ x: 5, y: 5 }], { tolerance: 1 })).toBeNull()
    expect(
      pencilToNetwork(
        [
          { x: 5, y: 5 },
          { x: 5, y: 5 }
        ],
        { tolerance: 1 }
      )
    ).toBeNull()
  })

  test('an open stroke has one more vertex than segments and no region', () => {
    const wave = Array.from({ length: 80 }, (_, i) => ({ x: i * 3, y: 25 * Math.sin(i / 8) }))
    const path = pencilToNetwork(wave, { tolerance: 1.5, closeDistance: 5 })
    expect(path?.closed).toBe(false)
    const network = path?.network
    expect(network?.vertices.length).toBe((network?.segments.length ?? 0) + 1)
    expect(network?.regions).toEqual([])
    // Segment tangents are handle offsets from their own vertices.
    const first = network?.segments[0]
    expect(Math.hypot(first?.tangentStart.x ?? 0, first?.tangentStart.y ?? 0)).toBeGreaterThan(0)
  })

  test('a stroke that ends where it began closes into one loop', () => {
    const path = pencilToNetwork(circle(100), { tolerance: 1.5, closeDistance: 6 })
    expect(path?.closed).toBe(true)
    const network = path?.network
    expect(network?.vertices.length).toBe(network?.segments.length)
    expect(network?.segments.at(-1)?.end).toBe(0)
    expect(network?.regions).toHaveLength(1)
    expect(network?.regions[0].loops[0]).toEqual(network?.segments.map((_, i) => i))
  })

  test('closing needs enough points and is off without a distance', () => {
    expect(pencilToNetwork(circle(100), { tolerance: 1.5 })?.closed).toBe(false)
    const near: Vector[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 2, y: 1 }
    ]
    expect(pencilToNetwork(near, { tolerance: 1, closeDistance: 6 })?.closed).toBe(false)
  })

  test('a looser tolerance gives fewer curves', () => {
    const noisy = Array.from({ length: 200 }, (_, i) => ({
      x: i * 2,
      y: 30 * Math.sin(i / 12) + ((i * 7) % 5) - 2
    }))
    const tight = pencilToNetwork(noisy, { tolerance: 0.8 })?.network.segments.length ?? 0
    const loose = pencilToNetwork(noisy, { tolerance: 6 })?.network.segments.length ?? 0
    expect(loose).toBeLessThan(tight)
  })
})
