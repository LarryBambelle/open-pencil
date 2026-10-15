import type { MatchCriterion } from '@open-pencil/core/editor'
import type { MenuEntry, TestId } from '@open-pencil/vue'

import type { EditorStore } from '@/app/editor/active-store'

export const CANVAS_SELECT_MATCHING_TEST_ID = 'context-select-matching' satisfies TestId

export type CanvasMatchingLabels = {
  selectMatching: string
  matchType: string
  matchName: string
  matchFill: string
  matchStroke: string
  matchEffects: string
  matchOpacity: string
  matchSize: string
  matchCornerRadius: string
  matchComponent: string
  matchTextStyle: string
  matchFontFamily: string
  matchFontSize: string
  matchFontWeight: string
  matchTextColor: string
}

const CRITERION_LABEL: Record<MatchCriterion, keyof CanvasMatchingLabels> = {
  type: 'matchType',
  name: 'matchName',
  fill: 'matchFill',
  stroke: 'matchStroke',
  effects: 'matchEffects',
  opacity: 'matchOpacity',
  size: 'matchSize',
  cornerRadius: 'matchCornerRadius',
  component: 'matchComponent',
  textStyle: 'matchTextStyle',
  fontFamily: 'matchFontFamily',
  fontSize: 'matchFontSize',
  fontWeight: 'matchFontWeight',
  textColor: 'matchTextColor'
}

/**
 * The "Select matching layers" submenu: one row per property the first selected layer has, each
 * selecting the layers on the page that share it. Null when no property applies.
 */
export function selectMatchingEntry(
  store: EditorStore,
  labels: CanvasMatchingLabels
): MenuEntry | null {
  const criteria = store.matchingCriteria()
  if (criteria.length === 0) return null
  return {
    label: labels.selectMatching,
    testId: CANVAS_SELECT_MATCHING_TEST_ID,
    sub: criteria.map((criterion) => ({
      label: labels[CRITERION_LABEL[criterion]],
      testId: `context-select-matching-${criterion}` satisfies TestId,
      action: () => store.selectMatching(criterion)
    }))
  }
}
