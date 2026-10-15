import { pick } from 'es-toolkit/object'

import type { CharacterStyleOverride, SceneNode } from '@open-pencil/scene-graph'

import { removeStyleFromRange } from '#core/text/style-runs'

import type { EditorContext } from './types'

/**
 * Figma's Copy properties and Paste properties: the look of one layer, applied to others.
 * Geometry, content, layout, and structure are never copied.
 */

const APPEARANCE_FIELDS = [
  'fills',
  'strokes',
  'effects',
  'opacity',
  'blendMode',
  'fillStyleId',
  'strokeStyleId',
  'effectStyleId',
  'strokeWeight',
  'strokeAlign',
  'strokeCap',
  'strokeJoin',
  'strokeMiterLimit',
  'dashPattern',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius',
  'independentCorners',
  'cornerSmoothing'
] as const satisfies ReadonlyArray<keyof SceneNode>

/** Corner fields, which a text layer does not have. */
const SHAPE_ONLY_FIELDS: ReadonlySet<string> = new Set([
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius',
  'independentCorners',
  'cornerSmoothing'
])

const TEXT_FIELDS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'italic',
  'lineHeight',
  'letterSpacing',
  'textAlignHorizontal',
  'textAlignVertical',
  'textCase',
  'textDecoration',
  'textDecorationStyle',
  'textStyleId',
  'fontFeatures',
  'fontVariations'
] as const satisfies ReadonlyArray<keyof SceneNode>

/** Character overrides a pasted text style replaces, so the new style covers the whole text. */
const TEXT_STYLE_RUN_KEYS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'italic',
  'lineHeight',
  'letterSpacing',
  'textDecoration'
] as const satisfies ReadonlyArray<keyof CharacterStyleOverride>

const NO_APPEARANCE: ReadonlySet<SceneNode['type']> = new Set(['CANVAS', 'SECTION', 'CONNECTOR'])

export interface CopiedProperties {
  appearance: Partial<SceneNode>
  /** Only copied from a text layer. */
  text: Partial<SceneNode> | null
  /** Variable bindings of the copied fields, so a bound color stays bound. */
  boundVariables: Record<string, string>
}

function boundTo(node: SceneNode, fields: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    Object.entries(node.boundVariables).filter(([key]) => fields.includes(key.split('/')[0]))
  )
}

/** The look of a layer, or null when it has none to copy. */
export function copyProperties(node: SceneNode): CopiedProperties | null {
  if (NO_APPEARANCE.has(node.type)) return null
  const isText = node.type === 'TEXT'
  return {
    appearance: structuredClone(pick(node, APPEARANCE_FIELDS)),
    text: isText ? structuredClone(pick(node, TEXT_FIELDS)) : null,
    boundVariables: boundTo(node, [...APPEARANCE_FIELDS, ...(isText ? TEXT_FIELDS : [])])
  }
}

function textRunChanges(target: SceneNode, keys: ReadonlyArray<keyof CharacterStyleOverride>) {
  if (target.styleRuns.length === 0) return {}
  const length = target.text.length
  return { styleRuns: removeStyleFromRange(target.styleRuns, 0, length, [...keys], length) }
}

/**
 * What pasting the copied look onto `target` changes, or null when the target takes none (a page,
 * a section, a locked layer). Text layers take a text style only from a copied text layer.
 */
export function pasteChanges(
  copied: CopiedProperties,
  target: SceneNode
): Partial<SceneNode> | null {
  if (NO_APPEARANCE.has(target.type) || target.locked) return null
  const isText = target.type === 'TEXT'
  const changes: Partial<SceneNode> = structuredClone(
    isText
      ? Object.fromEntries(
          Object.entries(copied.appearance).filter(([key]) => !SHAPE_ONLY_FIELDS.has(key))
        )
      : copied.appearance
  )
  if (isText) {
    if (copied.text) Object.assign(changes, structuredClone(copied.text))
    // A pasted fill or text style covers the whole text, over per-character overrides of it.
    const keys: Array<keyof CharacterStyleOverride> = copied.text
      ? ['fills', ...TEXT_STYLE_RUN_KEYS]
      : ['fills']
    Object.assign(changes, textRunChanges(target, keys))
  }
  const replaced = new Set(Object.keys(changes))
  // Bindings of the fields being replaced go; the copied ones come in.
  const kept = Object.entries(target.boundVariables).filter(
    ([key]) => !replaced.has(key.split('/')[0])
  )
  const brought = Object.entries(copied.boundVariables).filter(([key]) =>
    replaced.has(key.split('/')[0])
  )
  changes.boundVariables = Object.fromEntries([...kept, ...brought])
  return changes
}

export function createPropertiesClipboardActions(
  ctx: EditorContext,
  updateNodeWithUndo: (id: string, changes: Partial<SceneNode>, label?: string) => void
) {
  const LABEL = 'Paste properties'

  /** Copies the look of the selected layer; false unless exactly one layer with a look is selected. */
  function copySelectedProperties(): boolean {
    const [id, ...others] = ctx.state.selectedIds
    const node = id && others.length === 0 ? ctx.graph.getNode(id) : undefined
    const copied = node ? copyProperties(node) : null
    if (!copied) return false
    ctx.state.copiedProperties = copied
    return true
  }

  /** Pastes the copied look onto every selected layer in one undo step; returns how many changed. */
  function pasteSelectedProperties(): number {
    const copied = ctx.state.copiedProperties
    if (!copied) return 0
    const updates = [...ctx.state.selectedIds].flatMap((id) => {
      const node = ctx.graph.getNode(id)
      const changes = node ? pasteChanges(copied, node) : null
      return changes ? [{ id, changes }] : []
    })
    if (updates.length === 0) return 0
    ctx.undo.runBatch(LABEL, () => {
      for (const { id, changes } of updates) updateNodeWithUndo(id, changes, LABEL)
    })
    return updates.length
  }

  return { copySelectedProperties, pasteSelectedProperties }
}
