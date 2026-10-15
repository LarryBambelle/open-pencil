import { findInDocument, replaceHits } from '@open-pencil/core/editor'
import type { FindHit, TextRange } from '@open-pencil/core/editor'

import type { EditorStore } from '@/app/editor/active-store'

import type { useFindPanel } from './state'

type FindPanelState = ReturnType<typeof useFindPanel>['panel']

/** One match: its layer's hit and the range inside that layer's text. */
export interface FlatMatch {
  hit: FindHit
  range: TextRange
}

export function currentHits(
  store: Pick<EditorStore, 'graph' | 'state'>,
  panel: FindPanelState
): FindHit[] {
  return findInDocument(
    store.graph,
    panel.query,
    { matchCase: panel.matchCase, wholeWord: panel.wholeWord },
    { scope: panel.scope, pageId: store.state.currentPageId }
  )
}

export function flattenHits(hits: readonly FindHit[]): FlatMatch[] {
  return hits.flatMap((hit) => hit.ranges.map((range) => ({ hit, range })))
}

/**
 * Loads the layers of every other page, which a document opened from a file keeps unread until
 * the page is first shown. Stops early when the person switches page meanwhile.
 */
export async function loadDocumentPages(
  store: Pick<EditorStore, 'graph' | 'state' | 'loadPageNodes' | 'pageSwitchCount'>
): Promise<void> {
  const switches = store.pageSwitchCount()
  for (const page of store.graph.getPages()) {
    if (page.id === store.state.currentPageId) continue
    await store.loadPageNodes(page.id)
    if (store.pageSwitchCount() !== switches) return
  }
}

/**
 * Replaces the matches the panel lists as one undo step and returns how many it replaced.
 * Other pages are prepared first, with their fonts and layout, so replaced text measures right.
 */
export async function replaceAllMatches(
  store: Pick<EditorStore, 'graph' | 'state' | 'undo' | 'updateNodeWithUndo' | 'preparePageNodes'>,
  panel: FindPanelState
): Promise<number> {
  for (const pageId of new Set(currentHits(store, panel).map((hit) => hit.pageId))) {
    await store.preparePageNodes(pageId)
  }
  return replaceHits(store, currentHits(store, panel), panel.replacement)
}

/** Replaces one match; its page is prepared first like the pages of Replace all. */
export async function replaceMatch(
  store: Pick<EditorStore, 'graph' | 'undo' | 'updateNodeWithUndo' | 'preparePageNodes'>,
  match: FlatMatch,
  replacement: string
): Promise<number> {
  await store.preparePageNodes(match.hit.pageId)
  return replaceHits(store, [{ ...match.hit, ranges: [match.range] }], replacement)
}

/** Brings a match into view: switches page when needed, selects its layer, and reveals it. */
export async function revealMatch(
  store: Pick<EditorStore, 'state' | 'switchPage' | 'select' | 'revealNodes'>,
  match: FlatMatch
): Promise<void> {
  if (match.hit.pageId !== store.state.currentPageId) await store.switchPage(match.hit.pageId)
  store.select([match.hit.nodeId])
  store.revealNodes([match.hit.nodeId])
}
