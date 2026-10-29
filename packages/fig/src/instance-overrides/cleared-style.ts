import { uniq } from 'es-toolkit'

import type { NodeChange, StyleReference } from '@open-pencil/kiwi/fig/codec'
import { isUnsetGuid } from '@open-pencil/kiwi/fig/guid'
import { SHARED_STYLE_FIELDS, sharedStyleRefKey } from '@open-pencil/scene-graph/shared-styles'

import { ownFigmaRawFields } from '../source-metadata'
import { OVERRIDE_FIELDS, SCENE_OVERRIDE_FIELDS } from './fields'
import type { InstanceOccurrence } from './occurrence/types'

/**
 * Each style's raw reference with the raw fields of the scene fields it gives: those a claim
 * names, and those the record keeps beside them, such as `textTracking` beside `letterSpacing`.
 */
const STYLE_CLAIM_FIELDS = Object.entries(SHARED_STYLE_FIELDS).map(([kind, sceneFields]) => ({
  reference: ownFigmaRawFields([sharedStyleRefKey(kind as keyof typeof SHARED_STYLE_FIELDS)])[0],
  governed: uniq([
    ...sceneFields.flatMap(
      (field) => SCENE_OVERRIDE_FIELDS.get(field)?.map(({ raw }) => raw) ?? []
    ),
    ...ownFigmaRawFields(sceneFields)
  ])
}))

function isCleared(reference: unknown): boolean {
  const guid = (reference as StyleReference | undefined)?.guid
  return guid !== undefined && isUnsetGuid(guid)
}

/** The value the source record gives a field, or Figma's default when the record leaves it out. */
function sourceValue(source: NodeChange | undefined, field: string): unknown {
  const own: unknown = source ? Reflect.get(source, field) : undefined
  if (own !== undefined || !(field in OVERRIDE_FIELDS)) return own
  const spec: { absent?: unknown } = Reflect.get(OVERRIDE_FIELDS, field)
  return spec.absent
}

/**
 * A style reference and the fields it governs are one override: an outer instance that clears a
 * style an intermediate component applied, and leaves a governed field out of its claim, shows the
 * value of the component the layer comes from for that field, not the intermediate one. The claim
 * is completed with those values, as Figma writes it, so later claims and export see them.
 */
export function completeClearedStyleClaim(
  target: InstanceOccurrence,
  claim: Partial<NodeChange>,
  source: NodeChange | undefined
): void {
  for (const { reference, governed } of STYLE_CLAIM_FIELDS) {
    if (!isCleared(Reflect.get(claim, reference))) continue
    for (const field of governed) {
      if (field in claim) continue
      const value = sourceValue(source, field)
      if (value === undefined) Reflect.deleteProperty(target.properties, field)
      else Reflect.set(claim, field, structuredClone(value))
    }
  }
}
