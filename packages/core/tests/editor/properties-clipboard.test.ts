import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { colorToFill } from '@open-pencil/scene-graph/color'

import { getNodeOrThrow } from '../helpers/assert'

const LINK = { type: 'URL', value: 'https://example.com/' } as const

function setup() {
  const editor = createEditor()
  const pageId = editor.graph.getPages()[0].id
  const source = editor.graph.createNode('RECTANGLE', pageId, {
    name: 'Source',
    width: 100,
    height: 40,
    fills: [colorToFill('#ff0000')],
    strokes: [{ ...colorToFill('#0000ff'), weight: 3, align: 'INSIDE' }],
    cornerRadius: 8,
    opacity: 0.5
  })
  const target = editor.graph.createNode('RECTANGLE', pageId, {
    name: 'Target',
    x: 200,
    width: 60,
    height: 60,
    fills: [colorToFill('#00ff00')]
  })
  return { editor, pageId, source, target }
}

describe('copy and paste properties', () => {
  test('moves the look of a layer to another without touching geometry or name', () => {
    const { editor, source, target } = setup()
    editor.select([source.id])
    expect(editor.copySelectedProperties()).toBe(true)
    editor.select([target.id])
    expect(editor.pasteSelectedProperties()).toBe(1)

    const pasted = getNodeOrThrow(editor.graph, target.id)
    expect(pasted.fills[0]?.color).toEqual(source.fills[0]?.color)
    expect(pasted.strokes).toHaveLength(1)
    expect(pasted.cornerRadius).toBe(8)
    expect(pasted.opacity).toBe(0.5)
    expect([pasted.name, pasted.width, pasted.height, pasted.x]).toEqual(['Target', 60, 60, 200])
  })

  test('is a snapshot: editing the source after copying does not change what is pasted', () => {
    const { editor, source, target } = setup()
    editor.select([source.id])
    editor.copySelectedProperties()
    editor.updateNode(source.id, { fills: [colorToFill('#ffffff')] })
    editor.select([target.id])
    editor.pasteSelectedProperties()
    expect(getNodeOrThrow(editor.graph, target.id).fills[0]?.color).toEqual(
      colorToFill('#ff0000').color
    )
  })

  test('pastes onto every selected layer in one undo step', () => {
    const { editor, pageId, source, target } = setup()
    const other = editor.graph.createNode('ELLIPSE', pageId, { fills: [colorToFill('#00ffff')] })
    editor.select([source.id])
    editor.copySelectedProperties()
    editor.select([target.id, other.id])
    expect(editor.pasteSelectedProperties()).toBe(2)

    editor.undoAction()
    expect(getNodeOrThrow(editor.graph, target.id).fills[0]?.color).toEqual(
      colorToFill('#00ff00').color
    )
    expect(getNodeOrThrow(editor.graph, other.id).fills[0]?.color).toEqual(
      colorToFill('#00ffff').color
    )
    editor.redoAction()
    expect(getNodeOrThrow(editor.graph, other.id).fills[0]?.color).toEqual(
      colorToFill('#ff0000').color
    )
  })

  test('copies from exactly one layer', () => {
    const { editor, source, target } = setup()
    editor.select([source.id, target.id])
    expect(editor.copySelectedProperties()).toBe(false)
    editor.clearSelection()
    expect(editor.copySelectedProperties()).toBe(false)
    expect(editor.state.copiedProperties).toBeNull()
  })

  test('pasting without a copy changes nothing and leaves no undo step', () => {
    const { editor, target } = setup()
    editor.select([target.id])
    expect(editor.pasteSelectedProperties()).toBe(0)
    expect(editor.undo.canUndo).toBe(false)
  })

  test('skips locked layers and pages', () => {
    const { editor, pageId, source, target } = setup()
    editor.graph.updateNode(target.id, { locked: true })
    editor.select([source.id])
    editor.copySelectedProperties()
    editor.select([target.id])
    expect(editor.pasteSelectedProperties()).toBe(0)
    expect(getNodeOrThrow(editor.graph, target.id).fills[0]?.color).toEqual(
      colorToFill('#00ff00').color
    )
    editor.select([pageId])
    expect(editor.copySelectedProperties()).toBe(false)
  })

  test('variable bindings of copied fields replace those of the target and keep the rest', () => {
    const { editor, source, target } = setup()
    editor.graph.updateNode(source.id, {
      boundVariables: { 'fills/0/color': 'var-a', width: 'var-w' }
    })
    editor.graph.updateNode(target.id, {
      boundVariables: { 'fills/0/color': 'var-old', height: 'var-h' }
    })
    editor.select([source.id])
    editor.copySelectedProperties()
    editor.select([target.id])
    editor.pasteSelectedProperties()
    expect(getNodeOrThrow(editor.graph, target.id).boundVariables).toEqual({
      'fills/0/color': 'var-a',
      height: 'var-h'
    })
  })
})

describe('copy and paste properties on text', () => {
  function textSetup() {
    const editor = createEditor()
    const pageId = editor.graph.getPages()[0].id
    const styled = editor.graph.createNode('TEXT', pageId, {
      text: 'Styled',
      fontFamily: 'Inter',
      fontSize: 32,
      fontWeight: 700,
      fills: [colorToFill('#ff0000')]
    })
    const plain = editor.graph.createNode('TEXT', pageId, {
      text: 'Plain text',
      fontSize: 12,
      styleRuns: [{ start: 0, length: 5, style: { fontSize: 40, hyperlink: LINK } }]
    })
    const shape = editor.graph.createNode('RECTANGLE', pageId, { cornerRadius: 4 })
    return { editor, styled, plain, shape }
  }

  test('a text style replaces the size overrides of the characters and keeps their links', () => {
    const { editor, styled, plain } = textSetup()
    editor.select([styled.id])
    editor.copySelectedProperties()
    editor.select([plain.id])
    editor.pasteSelectedProperties()

    const pasted = getNodeOrThrow(editor.graph, plain.id)
    expect([pasted.fontSize, pasted.fontWeight]).toEqual([32, 700])
    expect(pasted.styleRuns).toEqual([{ start: 0, length: 5, style: { hyperlink: LINK } }])
  })

  test('a shape gives text its paints but no text style or corner radius', () => {
    const { editor, plain, shape } = textSetup()
    editor.graph.updateNode(shape.id, { fills: [colorToFill('#0000ff')] })
    editor.select([shape.id])
    editor.copySelectedProperties()
    editor.select([plain.id])
    editor.pasteSelectedProperties()

    const pasted = getNodeOrThrow(editor.graph, plain.id)
    expect(pasted.fills[0]?.color).toEqual(colorToFill('#0000ff').color)
    expect(pasted.fontSize).toBe(12)
    expect(pasted.cornerRadius).toBe(0)
  })

  test('a text style pasted onto a shape is ignored', () => {
    const { editor, styled, shape } = textSetup()
    editor.select([styled.id])
    editor.copySelectedProperties()
    editor.select([shape.id])
    editor.pasteSelectedProperties()
    expect(getNodeOrThrow(editor.graph, shape.id)).not.toHaveProperty('fontSize', 32)
  })
})
