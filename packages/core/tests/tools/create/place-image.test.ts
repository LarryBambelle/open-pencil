import { describe, expect, test } from 'bun:test'

import { gif, jpeg, png } from '#core-tests/canvas/images/headers'
import { expectDefined, expectFills } from '#core-tests/helpers/assert'
import * as v from 'valibot'

import { FigmaAPI } from '@open-pencil/core/figma-api'
import { ALL_TOOLS } from '@open-pencil/core/tools'
import { SceneGraph } from '@open-pencil/scene-graph'

const tool = expectDefined(
  ALL_TOOLS.find((item) => item.name === 'place_image'),
  'place_image tool'
)

interface Placed {
  id: string
  name: string
  width: number
  height: number
  imageHash: string
  error?: string
}

const base64 = (bytes: Uint8Array) => bytes.toBase64()

function setup() {
  const figma = new FigmaAPI(new SceneGraph())
  /** Runs the tool as an adapter does: input parsed by its schema, defaults applied. */
  const place = (args: Record<string, unknown>) =>
    tool.execute(figma, v.parse(tool.input, args)) as Placed
  return { figma, place }
}

function node(figma: FigmaAPI, id: string) {
  const found = figma.getNodeById(id)
  if (!found) throw new Error(`No node ${id}`)
  return found
}

describe('place_image', () => {
  test('creates a rectangle with an image fill at the natural size', () => {
    const { figma, place } = setup()
    const placed = place({ image_data: base64(png(640, 480)), name: 'Logo' })
    expect(placed).toMatchObject({ name: 'Logo', width: 640, height: 480 })
    const created = node(figma, placed.id)
    expect(created.type).toBe('RECTANGLE')
    expect([created.width, created.height]).toEqual([640, 480])
    expect(expectFills(created.fills)[0]).toMatchObject({
      type: 'IMAGE',
      imageHash: placed.imageHash,
      imageScaleMode: 'FILL'
    })
  })

  test('names the layer Image by default and places it at the origin', () => {
    const { figma, place } = setup()
    const placed = place({ image_data: base64(gif(50, 20)) })
    expect(placed.name).toBe('Image')
    const created = node(figma, placed.id)
    expect([created.x, created.y]).toEqual([0, 0])
  })

  test('fits a large picture to a 1600 px long edge', () => {
    const { place } = setup()
    expect(place({ image_data: base64(png(4000, 2000)) })).toMatchObject({
      width: 1600,
      height: 800
    })
    expect(place({ image_data: base64(png(2000, 4000)) })).toMatchObject({
      width: 800,
      height: 1600
    })
  })

  test('one dimension keeps the ratio and two are used as given', () => {
    const { place } = setup()
    expect(place({ image_data: base64(png(400, 200)), width: 100 })).toMatchObject({
      width: 100,
      height: 50
    })
    expect(place({ image_data: base64(png(400, 200)), height: 100 })).toMatchObject({
      width: 200,
      height: 100
    })
    expect(place({ image_data: base64(png(400, 200)), width: 30, height: 40 })).toMatchObject({
      width: 30,
      height: 40
    })
  })

  test('accepts a data URI, a parent, a position and a scale mode', () => {
    const { figma, place } = setup()
    const frame = figma.createFrame()
    const placed = place({
      image_data: `data:image/jpeg;base64,${base64(jpeg(300, 200))}`,
      parent_id: frame.id,
      x: '10',
      y: 20,
      scale_mode: 'FIT'
    })
    const created = node(figma, placed.id)
    expect(created.parent?.id).toBe(frame.id)
    expect([created.x, created.y]).toEqual([10, 20])
    expect(expectFills(created.fills)[0]).toMatchObject({ imageScaleMode: 'FIT' })
  })

  test('the same picture placed twice shares one stored image', () => {
    const { figma, place } = setup()
    const bytes = png(10, 10)
    const first = place({ image_data: base64(bytes) })
    const second = place({ image_data: base64(bytes) })
    expect(second.imageHash).toBe(first.imageHash)
    expect(figma.getNodeById(first.id)?.id).not.toBe(second.id)
  })

  test('limits width and height to 16384 px', () => {
    const { place } = setup()
    expect(v.safeParse(tool.input.entries.width, 16_384).success).toBe(true)
    expect(v.safeParse(tool.input.entries.width, 16_385).success).toBe(false)
    expect(v.safeParse(tool.input.entries.height, 16_385).success).toBe(false)
    expect(place({ image_data: base64(png(100, 10_000)), width: 16_000 }).error).toContain('16384')
  })

  test('refuses pictures over 64 megapixels and accepts exactly 64', () => {
    const { place } = setup()
    expect(place({ image_data: base64(png(9000, 8000)) }).error).toContain('64 megapixels')
    expect(place({ image_data: base64(png(8000, 8000)) }).error).toBeUndefined()
  })

  test('reports invalid Base64, unknown or truncated images, and a missing parent', () => {
    const { figma, place } = setup()
    const before = figma.currentPage.children.length
    expect(place({ image_data: '!!!' }).error).toContain('Base64')
    expect(place({ image_data: base64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])) }).error).toContain(
      'recognised'
    )
    expect(place({ image_data: base64(png(10, 10).subarray(0, 20)) }).error).toContain('recognised')
    expect(place({ image_data: base64(png(5, 5)), parent_id: 'missing' }).error).toContain(
      'not found'
    )
    expect(figma.currentPage.children).toHaveLength(before)
  })
})
