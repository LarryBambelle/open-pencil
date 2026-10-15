import type { Path } from 'canvaskit-wasm'

import { ResourceCache } from '#core/cache/resource'

/**
 * Points one path cache keeps, about 40 MB of CanvasKit heap. A page of 20,000 icons with 25 points
 * each takes two thirds of it; without a bound every vector of every page drawn stays decoded.
 */
export const PATH_CACHE_POINTS = 1_000_000
export const PATH_CACHE_ENTRIES = 65_536
/** Weight of a path beyond its points, so many tiny paths still count against the budget. */
const PATH_OVERHEAD_POINTS = 8

export type PathCache = ResourceCache<string, Path[]>

/** A renderer, which frees the paths its caches could not keep when the next frame starts. */
export interface PathOwner {
  uncachedPaths: Path[][]
}

function pathWeight(paths: readonly Path[]): number {
  let weight = 0
  for (const path of paths) weight += path.countPoints() + PATH_OVERHEAD_POINTS
  return weight
}

function deletePaths(paths: readonly Path[]): void {
  for (const path of paths) path.delete()
}

/** Owns the paths built for each node; evicted, replaced, and deleted entries delete their paths. */
export function createPathCache(
  maxPoints = PATH_CACHE_POINTS,
  maxEntries = PATH_CACHE_ENTRIES
): PathCache {
  return new ResourceCache<string, Path[]>({
    maxEntries,
    maxWeight: maxPoints,
    weight: pathWeight,
    dispose: deletePaths
  })
}

/**
 * Stores paths built for drawing. Paths larger than the whole cache stay with the renderer until
 * the next frame starts, so the caller can draw them now without leaking them.
 */
export function cachePaths(owner: PathOwner, cache: PathCache, key: string, paths: Path[]): void {
  if (!cache.set(key, paths)) owner.uncachedPaths.push(paths)
}

/** Keeps paths for the rest of the frame only, such as outlines drawn without a cache key. */
export function borrowPathsForFrame(owner: PathOwner, paths: Path[]): void {
  owner.uncachedPaths.push(paths)
}

/** Deletes the paths `cachePaths` or `borrowPathsForFrame` could not keep. */
export function releaseUncachedPaths(owner: PathOwner): void {
  const paths = owner.uncachedPaths
  if (paths.length === 0) return
  owner.uncachedPaths = []
  for (const set of paths) deletePaths(set)
}

/** Deletes every entry whose key starts with `prefix`, such as a node's stroke outlines. */
export function deletePathsWithPrefix(cache: PathCache, prefix: string): void {
  const keys: string[] = []
  for (const [key] of cache) if (key.startsWith(prefix)) keys.push(key)
  for (const key of keys) cache.delete(key)
}
