import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { isUnsetGuid } from '@open-pencil/kiwi/fig/guid'

import { OVERRIDE_FIELDS, type RawOverrideField, STYLE_GOVERNED_FIELDS } from './fields'
import type { InstanceOccurrence } from './occurrence/types'

function isOverrideField(field: PropertyKey): field is RawOverrideField {
  return field in OVERRIDE_FIELDS
}

/** The value the source record gives a field, or Figma's default when the record leaves it out. */
function sourceValue(source: NodeChange | undefined, field: keyof NodeChange): unknown {
  if (source?.[field] !== undefined) return source[field]
  if (!isOverrideField(field)) return undefined
  const spec = OVERRIDE_FIELDS[field]
  return 'absent' in spec ? spec.absent : undefined
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
  for (const [reference, governed] of Object.entries(STYLE_GOVERNED_FIELDS)) {
    const guid = claim[reference as keyof typeof STYLE_GOVERNED_FIELDS]?.guid
    if (!guid || !isUnsetGuid(guid)) continue
    for (const field of governed) {
      if (field in claim) continue
      const value = sourceValue(source, field)
      if (value === undefined) Reflect.deleteProperty(target.properties, field)
      else Object.assign(claim, { [field]: structuredClone(value) })
    }
  }
}
