import type { Vector, VectorNetwork, VectorSegment, VectorVertex } from '@open-pencil/scene-graph'

/**
 * Freehand drawing, as in Figma's pencil tool: the points a hand drew become a smooth
 * vector path. Points are thinned with Ramer-Douglas-Peucker, then cubic Beziers are fitted with
 * Schneider's algorithm ("An Algorithm for Automatically Fitting Digitized Curves", Graphics Gems
 * 1990), which splits the path only where one curve cannot follow it within the tolerance.
 */
export interface Bezier {
  p0: Vector
  c1: Vector
  c2: Vector
  p3: Vector
}

const add = (a: Vector, b: Vector): Vector => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: Vector, b: Vector): Vector => ({ x: a.x - b.x, y: a.y - b.y })
const scale = (a: Vector, k: number): Vector => ({ x: a.x * k, y: a.y * k })
const dot = (a: Vector, b: Vector) => a.x * b.x + a.y * b.y
const length = (a: Vector) => Math.hypot(a.x, a.y)
const distance = (a: Vector, b: Vector) => Math.hypot(a.x - b.x, a.y - b.y)

function normalize(a: Vector): Vector {
  const len = length(a)
  return len < 1e-12 ? { x: 0, y: 0 } : scale(a, 1 / len)
}

/** Drops points closer than `spacing` to the one before them; the last point is always kept. */
export function dedupePoints(points: readonly Vector[], spacing: number): Vector[] {
  const out: Vector[] = []
  for (const point of points) {
    const last = out.at(-1)
    if (!last || distance(last, point) >= spacing) out.push({ ...point })
  }
  // The end of the stroke is always kept, replacing a point it would crowd.
  const final = points.at(-1)
  const tail = out.at(-1)
  if (final && tail && (tail.x !== final.x || tail.y !== final.y)) {
    if (out.length > 1 && distance(tail, final) < spacing) out[out.length - 1] = { ...final }
    else out.push({ ...final })
  }
  return out
}

function perpendicularDistance(point: Vector, a: Vector, b: Vector): number {
  const segment = sub(b, a)
  const len = length(segment)
  if (len < 1e-12) return distance(point, a)
  return Math.abs(segment.x * (a.y - point.y) - (a.x - point.x) * segment.y) / len
}

/** Ramer-Douglas-Peucker: the fewest points that keep every dropped one within `epsilon`. */
export function simplifyRDP(points: readonly Vector[], epsilon: number): Vector[] {
  if (points.length < 3) return points.map((p) => ({ ...p }))
  const keep = Array.from({ length: points.length }, () => false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const range = stack.pop()
    if (!range) break
    const [first, last] = range
    let farthest = -1
    let farthestDistance = 0
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(points[i], points[first], points[last])
      if (d > farthestDistance) {
        farthestDistance = d
        farthest = i
      }
    }
    if (farthest !== -1 && farthestDistance > epsilon) {
      keep[farthest] = true
      stack.push([first, farthest], [farthest, last])
    }
  }
  return points.filter((_, index) => keep[index]).map((p) => ({ ...p }))
}

function bezierAt(b: Bezier, t: number): Vector {
  const mt = 1 - t
  const w0 = mt * mt * mt
  const w1 = 3 * mt * mt * t
  const w2 = 3 * mt * t * t
  const w3 = t * t * t
  return {
    x: w0 * b.p0.x + w1 * b.c1.x + w2 * b.c2.x + w3 * b.p3.x,
    y: w0 * b.p0.y + w1 * b.c1.y + w2 * b.c2.y + w3 * b.p3.y
  }
}

function bezierFirstDerivative(b: Bezier, t: number): Vector {
  const mt = 1 - t
  return {
    x:
      3 * mt * mt * (b.c1.x - b.p0.x) +
      6 * mt * t * (b.c2.x - b.c1.x) +
      3 * t * t * (b.p3.x - b.c2.x),
    y:
      3 * mt * mt * (b.c1.y - b.p0.y) +
      6 * mt * t * (b.c2.y - b.c1.y) +
      3 * t * t * (b.p3.y - b.c2.y)
  }
}

function bezierSecondDerivative(b: Bezier, t: number): Vector {
  const mt = 1 - t
  return {
    x: 6 * mt * (b.c2.x - 2 * b.c1.x + b.p0.x) + 6 * t * (b.p3.x - 2 * b.c2.x + b.c1.x),
    y: 6 * mt * (b.c2.y - 2 * b.c1.y + b.p0.y) + 6 * t * (b.p3.y - 2 * b.c2.y + b.c1.y)
  }
}

function chordLengthParameterize(points: readonly Vector[], first: number, last: number): number[] {
  const u = [0]
  for (let i = first + 1; i <= last; i++)
    u.push(u[u.length - 1] + distance(points[i], points[i - 1]))
  const total = u[u.length - 1]
  return total < 1e-12 ? u.map((_, i) => i / (u.length - 1)) : u.map((value) => value / total)
}

function generateBezier(
  points: readonly Vector[],
  first: number,
  last: number,
  u: readonly number[],
  tHat1: Vector,
  tHat2: Vector
): Bezier {
  const p0 = points[first]
  const p3 = points[last]
  const count = last - first + 1

  // Least squares for the two handle lengths (alpha) along the end tangents.
  let c00 = 0
  let c01 = 0
  let c11 = 0
  let x0 = 0
  let x1 = 0
  for (let i = 0; i < count; i++) {
    const t = u[i]
    const mt = 1 - t
    const b0 = mt * mt * mt
    const b1 = 3 * mt * mt * t
    const b2 = 3 * mt * t * t
    const b3 = t * t * t
    const a1 = scale(tHat1, b1)
    const a2 = scale(tHat2, b2)
    c00 += dot(a1, a1)
    c01 += dot(a1, a2)
    c11 += dot(a2, a2)
    const tmp = sub(points[first + i], add(scale(p0, b0 + b1), scale(p3, b2 + b3)))
    x0 += dot(a1, tmp)
    x1 += dot(a2, tmp)
  }
  const det = c00 * c11 - c01 * c01
  let alphaL = 0
  let alphaR = 0
  if (Math.abs(det) > 1e-12) {
    alphaL = (x0 * c11 - x1 * c01) / det
    alphaR = (c00 * x1 - c01 * x0) / det
  }
  const chord = distance(p0, p3)
  const epsilon = 1e-6 * chord
  // A negative or vanishing handle gives a loop or a cusp: fall back to the Wu/Barsky guess.
  if (alphaL < epsilon || alphaR < epsilon) {
    alphaL = chord / 3
    alphaR = chord / 3
  }
  return {
    p0,
    c1: add(p0, scale(tHat1, alphaL)),
    c2: add(p3, scale(tHat2, alphaR)),
    p3
  }
}

/** One Newton-Raphson step moving each parameter toward the closest point on the curve. */
function reparameterize(
  curve: Bezier,
  points: readonly Vector[],
  first: number,
  u: readonly number[]
): number[] {
  return u.map((t, i) => {
    const d = sub(bezierAt(curve, t), points[first + i])
    const d1 = bezierFirstDerivative(curve, t)
    const d2 = bezierSecondDerivative(curve, t)
    const numerator = dot(d, d1)
    const denominator = dot(d1, d1) + dot(d, d2)
    return Math.abs(denominator) < 1e-12 ? t : Math.min(1, Math.max(0, t - numerator / denominator))
  })
}

function maxError(
  points: readonly Vector[],
  first: number,
  last: number,
  curve: Bezier,
  u: readonly number[]
): { error: number; split: number } {
  let worst = 0
  let split = Math.floor((last - first + 1) / 2) + first
  for (let i = first + 1; i < last; i++) {
    const d = sub(bezierAt(curve, u[i - first]), points[i])
    const squared = dot(d, d)
    if (squared >= worst) {
      worst = squared
      split = i
    }
  }
  return { error: worst, split }
}

const MAX_ITERATIONS = 4

function fitCubic(
  points: readonly Vector[],
  first: number,
  last: number,
  tHat1: Vector,
  tHat2: Vector,
  error: number
): Bezier[] {
  if (last - first === 1) {
    const dist = distance(points[first], points[last]) / 3
    return [
      {
        p0: points[first],
        c1: add(points[first], scale(tHat1, dist)),
        c2: add(points[last], scale(tHat2, dist)),
        p3: points[last]
      }
    ]
  }

  let u = chordLengthParameterize(points, first, last)
  let curve = generateBezier(points, first, last, u, tHat1, tHat2)
  let { error: worst, split } = maxError(points, first, last, curve, u)
  if (worst < error) return [curve]

  // Close enough to be worth refining the parameters instead of splitting.
  if (worst < error * error) {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      u = reparameterize(curve, points, first, u)
      curve = generateBezier(points, first, last, u, tHat1, tHat2)
      ;({ error: worst, split } = maxError(points, first, last, curve, u))
      if (worst < error) return [curve]
    }
  }

  const center = normalize(sub(points[split - 1], points[split + 1]))
  return [
    ...fitCubic(points, first, split, tHat1, center, error),
    ...fitCubic(points, split, last, scale(center, -1), tHat2, error)
  ]
}

/**
 * Cubic Beziers following `points` within `tolerance` (a distance), joined end to end with
 * matching tangents. Needs two distinct points; fewer give no curves.
 */
export function fitBeziers(points: readonly Vector[], tolerance: number): Bezier[] {
  const distinct = points.filter((p, i) => i === 0 || distance(p, points[i - 1]) > 1e-9)
  if (distinct.length < 2) return []
  const tHat1 = normalize(sub(distinct[1], distinct[0]))
  const tHat2 = normalize(sub(distinct[distinct.length - 2], distinct[distinct.length - 1]))
  // The algorithm compares squared distances.
  return fitCubic(distinct, 0, distinct.length - 1, tHat1, tHat2, tolerance * tolerance)
}

export interface PencilOptions {
  /** How far, in the points' units, the path may stray from the drawn line. */
  tolerance: number
  /** A stroke ending this close to where it started closes into a loop. */
  closeDistance?: number
}

export interface PencilPath {
  network: VectorNetwork
  closed: boolean
}

/** The vector network a freehand stroke becomes; null when the stroke is a dot. */
export function pencilToNetwork(
  stroke: readonly Vector[],
  { tolerance, closeDistance = 0 }: PencilOptions
): PencilPath | null {
  const points = simplifyRDP(dedupePoints(stroke, tolerance / 4), tolerance / 2)
  if (points.length < 2) return null
  const first = points[0]
  const lastPoint = points[points.length - 1]
  const closed =
    closeDistance > 0 && points.length >= 4 && distance(first, lastPoint) <= closeDistance
  const curves = fitBeziers(closed ? [...points.slice(0, -1), first] : points, tolerance)
  if (curves.length === 0) return null

  const vertices: VectorVertex[] = curves.map((curve, index) => ({
    x: curve.p0.x,
    y: curve.p0.y,
    // Fitted joins share a tangent direction, so the handles stay in line.
    handleMirroring: index === 0 ? 'NONE' : 'ANGLE'
  }))
  const lastCurve = curves[curves.length - 1]
  if (!closed) vertices.push({ x: lastCurve.p3.x, y: lastCurve.p3.y, handleMirroring: 'NONE' })

  const segments: VectorSegment[] = curves.map((curve, index) => ({
    start: index,
    end: closed && index === curves.length - 1 ? 0 : index + 1,
    tangentStart: sub(curve.c1, curve.p0),
    tangentEnd: sub(curve.c2, curve.p3)
  }))
  return {
    network: {
      vertices,
      segments,
      regions: closed ? [{ windingRule: 'NONZERO', loops: [segments.map((_, i) => i)] }] : []
    },
    closed
  }
}
