import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import type { Color, Fill } from '@open-pencil/scene-graph'

const RED: Color = { r: 1, g: 0, b: 0, a: 1 }
const BLUE: Color = { r: 0, g: 0, b: 1, a: 1 }

function solid(color: Color): Fill {
  return { type: 'SOLID', color, opacity: 1, visible: true }
}

function scene() {
  const editor = createEditor()
  const pageId = editor.state.currentPageId
  const frame = editor.graph.createNode('FRAME', pageId, { name: 'Card', width: 400, height: 300 })
  const a = editor.graph.createNode('RECTANGLE', frame.id, {
    name: 'A',
    width: 100,
    height: 40,
    fills: [solid(RED)],
    cornerRadius: 8
  })
  const b = editor.graph.createNode('RECTANGLE', frame.id, {
    name: 'B',
    width: 100,
    height: 40,
    fills: [solid(RED)]
  })
  const c = editor.graph.createNode('RECTANGLE', pageId, {
    name: 'C',
    width: 60,
    height: 60,
    fills: [solid(BLUE)]
  })
  const text = editor.graph.createNode('TEXT', frame.id, {
    name: 'T',
    text: 'Hello',
    fontFamily: 'Inter',
    fontSize: 16,
    fills: [solid(RED)]
  })
  return { editor, pageId, frame, a, b, c, text }
}

describe('select matching layers', () => {
  test('a fill selects every layer with it, wherever it is nested', () => {
    const { editor, a, b, text } = scene()
    editor.select([a.id])
    expect(editor.selectMatching('fill')).toBe(3)
    expect(editor.state.selectedIds).toEqual(new Set([a.id, b.id, text.id]))
  })

  test('size and corner radius narrow differently', () => {
    const { editor, a, b } = scene()
    editor.select([a.id])
    editor.selectMatching('size')
    expect(editor.state.selectedIds).toEqual(new Set([a.id, b.id]))
    editor.select([a.id])
    editor.selectMatching('cornerRadius')
    expect(editor.state.selectedIds).toEqual(new Set([a.id]))
  })

  test('text criteria only match text layers', () => {
    const { editor, frame, text } = scene()
    const other = editor.graph.createNode('TEXT', frame.id, {
      text: 'Two',
      fontFamily: 'Inter',
      fontSize: 24
    })
    editor.select([text.id])
    editor.selectMatching('fontFamily')
    expect(editor.state.selectedIds).toEqual(new Set([text.id, other.id]))
    editor.select([text.id])
    editor.selectMatching('fontSize')
    expect(editor.state.selectedIds).toEqual(new Set([text.id]))
  })

  test('hidden and locked layers are left out', () => {
    const { editor, a, b, c } = scene()
    editor.graph.updateNode(b.id, { locked: true })
    editor.graph.updateNode(c.id, { visible: false, fills: [solid(RED)] })
    editor.select([a.id])
    editor.selectMatching('fill')
    expect(editor.state.selectedIds.has(b.id)).toBe(false)
    expect(editor.state.selectedIds.has(c.id)).toBe(false)
  })

  test('other pages are not searched', () => {
    const { editor, a } = scene()
    const otherPage = editor.graph.addPage('Other')
    editor.graph.createNode('RECTANGLE', otherPage.id, {
      width: 100,
      height: 40,
      fills: [solid(RED)]
    })
    editor.select([a.id])
    expect(editor.selectMatching('fill')).toBe(3)
  })

  test('a criterion the layer has no value for keeps the selection', () => {
    const { editor, a } = scene()
    editor.select([a.id])
    expect(editor.selectMatching('fontFamily')).toBe(0)
    expect(editor.state.selectedIds).toEqual(new Set([a.id]))
  })

  test('matchingCriteria lists what the first selected layer has', () => {
    const { editor, a, text } = scene()
    editor.select([a.id])
    const rectangle = editor.matchingCriteria()
    expect(rectangle).toContain('fill')
    expect(rectangle).toContain('cornerRadius')
    expect(rectangle).not.toContain('fontSize')
    editor.select([text.id])
    expect(editor.matchingCriteria()).toEqual(
      expect.arrayContaining(['fontFamily', 'fontSize', 'textColor'])
    )
    editor.clearSelection()
    expect(editor.matchingCriteria()).toEqual([])
  })
})
