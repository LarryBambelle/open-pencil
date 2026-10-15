import { createSelectionContainerActions } from './selection/container'
import { createSelectionHitTestActions } from './selection/hit-test'
import { availableCriteria, matchingNodeIds, type MatchCriterion } from './selection/matching'
import { createSelectionNavigationActions } from './selection/navigation'
import { createSelectionOverlayActions } from './selection/overlays'
import { createSelectionReadActions } from './selection/read'
import type { EditorContext } from './types'

export function createSelectionActions(ctx: EditorContext) {
  function nested(a: string, b: string) {
    return ctx.graph.isDescendant(a, b) || ctx.graph.isDescendant(b, a)
  }

  /** The outermost of the layers: one inside another listed layer is dropped. */
  function outermost(ids: string[]): Set<string> {
    const listed = new Set(ids)
    return new Set(
      ids.filter((id) => {
        const parentId = ctx.graph.getNode(id)?.parentId
        return !parentId || !ctx.graph.closest(parentId, (node) => listed.has(node.id))
      })
    )
  }

  /**
   * Figma never selects a layer together with one of its ancestors. A plain selection keeps the
   * outermost layers; adding a layer replaces its selected ancestors and descendants.
   */
  function select(ids: string[], additive = false) {
    if (!additive) {
      ctx.setSelectedIds(outermost(ids))
      return
    }
    let next = new Set(ctx.state.selectedIds)
    for (const id of ids) {
      if (next.has(id)) {
        next.delete(id)
        continue
      }
      next = new Set([...next].filter((other) => !nested(other, id)))
      next.add(id)
    }
    ctx.setSelectedIds(next)
  }

  function clearSelection() {
    ctx.setSelectedIds(new Set())
  }

  function selectAll() {
    const children = ctx.graph.getChildren(ctx.state.currentPageId)
    ctx.setSelectedIds(new Set(children.map((n) => n.id)))
  }

  function selectInverse() {
    const children = ctx.graph.getChildren(ctx.state.currentPageId)
    ctx.setSelectedIds(
      new Set(children.filter((node) => !ctx.state.selectedIds.has(node.id)).map((node) => node.id))
    )
  }

  function primarySelectedNode() {
    const first = ctx.state.selectedIds.values().next()
    return first.done ? undefined : ctx.graph.getNode(first.value)
  }

  /** What the first selected layer can be matched on, for a "Select matching layers" menu. */
  function matchingCriteria(): MatchCriterion[] {
    const node = primarySelectedNode()
    return node ? availableCriteria(node) : []
  }

  /**
   * Selects every visible, unlocked layer on the page that shares `criterion` with the first
   * selected layer, and returns how many it selected. The selection is kept when nothing matches.
   */
  function selectMatching(criterion: MatchCriterion): number {
    const node = primarySelectedNode()
    if (!node) return 0
    const ids = matchingNodeIds(ctx.graph, node.id, criterion, ctx.state.currentPageId)
    if (ids.length > 0) select(ids)
    return ids.length
  }

  const containerActions = createSelectionContainerActions(ctx)
  const hitTestActions = createSelectionHitTestActions(ctx, select, clearSelection)
  const navigationActions = createSelectionNavigationActions(ctx, select)
  const overlayActions = createSelectionOverlayActions(ctx)
  const readActions = createSelectionReadActions(ctx)

  return {
    select,
    clearSelection,
    selectAll,
    selectInverse,
    ...navigationActions,
    matchingCriteria,
    selectMatching,
    ...overlayActions,
    ...containerActions,
    ...readActions,
    ...hitTestActions
  }
}
