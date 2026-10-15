import { describe, expect, test } from 'bun:test'

import { reactive } from 'vue'

import { createEditor } from '@open-pencil/core/editor'

import type { EditorStore } from '@/app/editor/active-store'
import {
  currentHits,
  flattenHits,
  loadDocumentPages,
  replaceAllMatches,
  replaceMatch,
  revealMatch
} from '@/app/editor/find/matches'

import { getNodeOrThrow } from '#tests/helpers/assert'
import { asDouble } from '#tests/helpers/doubles'

function panelState(overrides: Partial<Parameters<typeof currentHits>[1]> = {}) {
  return reactive({
    open: true,
    query: 'pencil',
    replacement: 'pen',
    matchCase: false,
    wholeWord: false,
    scope: 'page' as const,
    index: 0,
    focusRequest: 0,
    ...overrides
  })
}

/** An editor with a text layer on each of two pages; the first page is on screen. */
function twoPages() {
  const editor = createEditor()
  const firstId = editor.state.currentPageId
  const secondId = editor.graph.addPage('Second').id
  const a = editor.graph.createNode('TEXT', firstId, { name: 'A', text: 'Pencil here' })
  const b = editor.graph.createNode('TEXT', secondId, { name: 'B', text: 'pencil there' })
  const prepared: string[] = []
  const store = asDouble<EditorStore>(
    Object.assign(editor, {
      preparePageNodes: (pageId: string) => {
        prepared.push(pageId)
        return Promise.resolve(true)
      }
    })
  )
  return { editor, store, firstId, secondId, a, b, prepared }
}

describe('currentHits', () => {
  test('follows the scope: the page on screen or every page', () => {
    const { store, a, b } = twoPages()
    expect(currentHits(store, panelState()).map((hit) => hit.nodeId)).toEqual([a.id])
    expect(currentHits(store, panelState({ scope: 'document' })).map((hit) => hit.nodeId)).toEqual([
      a.id,
      b.id
    ])
  })

  test('flattening lists a layer once per match', () => {
    const { editor, firstId } = twoPages()
    editor.graph.createNode('TEXT', firstId, { name: 'C', text: 'pencil pencil' })
    const hits = currentHits(asDouble<EditorStore>(editor), panelState())
    expect(flattenHits(hits)).toHaveLength(3)
  })
})

describe('loadDocumentPages', () => {
  function loader(onLoad?: (pageId: string) => void) {
    const { store, firstId, secondId } = twoPages()
    const loaded: string[] = []
    let switches = 0
    const doubled = asDouble<EditorStore>({
      graph: store.graph,
      state: store.state,
      pageSwitchCount: () => switches,
      loadPageNodes: (pageId: string) => {
        loaded.push(pageId)
        onLoad?.(pageId)
        return Promise.resolve()
      }
    })
    return { doubled, loaded, firstId, secondId, switchPage: () => switches++ }
  }

  test('reads every page except the one on screen', async () => {
    const { doubled, loaded, secondId } = loader()
    await loadDocumentPages(doubled)
    expect(loaded).toEqual([secondId])
  })

  test('stops once the person switches page meanwhile', async () => {
    const context = loader()
    const third = context.doubled.graph.addPage('Third')
    let first = true
    const interrupted = asDouble<EditorStore>({
      graph: context.doubled.graph,
      state: context.doubled.state,
      pageSwitchCount: context.doubled.pageSwitchCount,
      loadPageNodes: (pageId: string) => {
        context.loaded.push(pageId)
        if (first) context.switchPage()
        first = false
        return Promise.resolve()
      }
    })
    await loadDocumentPages(interrupted)
    expect(context.loaded).toEqual([context.secondId])
    expect(context.loaded).not.toContain(third.id)
  })
})

describe('replacing', () => {
  test('Replace all prepares the pages it edits and is one undo step', async () => {
    const { editor, store, secondId, a, b, prepared } = twoPages()
    const panel = panelState({ scope: 'document' })
    expect(await replaceAllMatches(store, panel)).toBe(2)
    expect(prepared).toContain(secondId)
    expect(getNodeOrThrow(editor.graph, a.id).text).toBe('pen here')
    expect(getNodeOrThrow(editor.graph, b.id).text).toBe('pen there')

    editor.undo.undo()
    expect(getNodeOrThrow(editor.graph, a.id).text).toBe('Pencil here')
    expect(getNodeOrThrow(editor.graph, b.id).text).toBe('pencil there')
  })

  test('Replace changes only the chosen match', async () => {
    const { editor, store, a } = twoPages()
    editor.graph.updateNode(a.id, { text: 'pencil pencil' })
    const [, second] = flattenHits(currentHits(store, panelState()))
    expect(await replaceMatch(store, second, 'pen')).toBe(1)
    expect(getNodeOrThrow(editor.graph, a.id).text).toBe('pencil pen')
  })
})

describe('revealMatch', () => {
  test('selects the layer and reveals it, switching page first when needed', async () => {
    const calls: string[] = []
    const store = asDouble<EditorStore>({
      state: { currentPageId: 'page-1' },
      switchPage: (pageId: string) => {
        calls.push(`switch ${pageId}`)
        return Promise.resolve()
      },
      select: (ids: string[]) => calls.push(`select ${ids.join(',')}`),
      revealNodes: (ids: string[]) => calls.push(`reveal ${ids.join(',')}`)
    })
    const range = { start: 0, end: 1 }
    await revealMatch(store, {
      hit: { nodeId: 'n1', pageId: 'page-1', ranges: [range], locked: false },
      range
    })
    await revealMatch(store, {
      hit: { nodeId: 'n2', pageId: 'page-2', ranges: [range], locked: false },
      range
    })
    expect(calls).toEqual(['select n1', 'reveal n1', 'switch page-2', 'select n2', 'reveal n2'])
  })
})
