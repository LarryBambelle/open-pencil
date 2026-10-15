import { round } from 'es-toolkit'

import type { Fill, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

/** What "Select matching layers" can compare, in the order a menu lists them. */
export const MATCH_CRITERIA = [
  'type',
  'name',
  'fill',
  'stroke',
  'effects',
  'opacity',
  'size',
  'cornerRadius',
  'component',
  'textStyle',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'textColor'
] as const

export type MatchCriterion = (typeof MATCH_CRITERIA)[number]

const PRECISION = 3

function paintSignature(paints: readonly Fill[]): string | null {
  const visible = paints.filter((paint) => paint.visible)
  if (visible.length === 0) return null
  return JSON.stringify(
    visible.map((paint) => [
      paint.type,
      round(paint.color.r, PRECISION),
      round(paint.color.g, PRECISION),
      round(paint.color.b, PRECISION),
      round(paint.color.a * paint.opacity, PRECISION),
      paint.gradientStops?.map((stop) => [
        round(stop.position, PRECISION),
        round(stop.color.r, PRECISION),
        round(stop.color.g, PRECISION),
        round(stop.color.b, PRECISION),
        round(stop.color.a, PRECISION)
      ]),
      paint.imageHash
    ])
  )
}

function textOnly(node: SceneNode, value: () => string | null): string | null {
  return node.type === 'TEXT' ? value() : null
}

function effectsSignature(node: SceneNode): string | null {
  const effects = node.effects.filter((effect) => effect.visible)
  if (effects.length === 0) return null
  if (node.effectStyleId) return `style:${node.effectStyleId}`
  return JSON.stringify(
    effects.map((effect) => [
      effect.type,
      effect.radius,
      effect.spread,
      effect.offset.x,
      effect.offset.y,
      round(effect.color.r, PRECISION),
      round(effect.color.g, PRECISION),
      round(effect.color.b, PRECISION),
      round(effect.color.a, PRECISION)
    ])
  )
}

function cornerSignature(node: SceneNode): string | null {
  const radii = node.independentCorners
    ? [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius]
    : [node.cornerRadius]
  return radii.some((radius) => radius > 0) ? radii.map((r) => round(r, PRECISION)).join(',') : null
}

function strokeSignature(node: SceneNode): string | null {
  const paints = paintSignature(node.strokes)
  return paints ? `${paints}|${round(node.strokeWeight, PRECISION)}` : null
}

function componentSignature(node: SceneNode): string | null {
  if (node.type === 'INSTANCE') return node.componentId
  if (node.type === 'COMPONENT') return node.id
  return null
}

const SIGNATURES: Record<MatchCriterion, (node: SceneNode) => string | null> = {
  type: (node) => node.type,
  name: (node) => node.name,
  fill: (node) => (node.fillStyleId ? `style:${node.fillStyleId}` : paintSignature(node.fills)),
  stroke: strokeSignature,
  effects: effectsSignature,
  opacity: (node) => (node.opacity < 1 ? String(round(node.opacity, PRECISION)) : null),
  size: (node) => `${round(node.width, PRECISION)}x${round(node.height, PRECISION)}`,
  cornerRadius: cornerSignature,
  component: componentSignature,
  textStyle: (node) => textOnly(node, () => node.textStyleId),
  fontFamily: (node) => textOnly(node, () => node.fontFamily),
  fontSize: (node) => textOnly(node, () => String(node.fontSize)),
  fontWeight: (node) => textOnly(node, () => `${node.fontWeight}${node.italic ? 'i' : ''}`),
  textColor: (node) => textOnly(node, () => paintSignature(node.fills))
}

/**
 * What a layer has for a criterion, as a string two layers share when they match. Null when the
 * criterion does not apply to the layer (no visible fill, not a text layer, ...).
 */
export function matchSignature(node: SceneNode, criterion: MatchCriterion): string | null {
  return SIGNATURES[criterion](node)
}

/** The criteria that mean something for a layer: the ones it has a value for. */
export function availableCriteria(node: SceneNode): MatchCriterion[] {
  return MATCH_CRITERIA.filter((criterion) => {
    if (criterion === 'name' || criterion === 'type' || criterion === 'size') return true
    return matchSignature(node, criterion) !== null
  })
}

function* selectableNodes(graph: SceneGraph, rootId: string): Generator<SceneNode> {
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined) break
    const node = graph.getNode(id)
    if (!node || node.internalOnly || !node.visible || node.locked) continue
    if (node.type !== 'CANVAS') yield node
    for (let index = node.childIds.length - 1; index >= 0; index--) stack.push(node.childIds[index])
  }
}

/**
 * Ids of the layers under `rootId` (the reference included) whose value for `criterion` equals the
 * reference layer's, in layer order. Hidden and locked layers, and what they contain, are left out.
 */
export function matchingNodeIds(
  graph: SceneGraph,
  referenceId: string,
  criterion: MatchCriterion,
  rootId: string
): string[] {
  const reference = graph.getNode(referenceId)
  if (!reference) return []
  const wanted = matchSignature(reference, criterion)
  if (wanted === null) return []
  const ids: string[] = []
  for (const node of selectableNodes(graph, rootId)) {
    if (matchSignature(node, criterion) === wanted) ids.push(node.id)
  }
  return ids
}
