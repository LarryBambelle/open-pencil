import { isValid, toUint8Array } from 'js-base64'
import * as v from 'valibot'

import type { Size } from '@open-pencil/scene-graph/primitives'

import { readImageSize } from '#core/canvas/images/size'
import { BLACK } from '#core/constants'
import type { FigmaNodeProxy } from '#core/figma-api'
import { toolNumber } from '#core/tools/input'
import { defineTool } from '#core/tools/schema'

/** Longest edge, in pixels, of a placed picture when the caller gives no size. */
export const PLACE_IMAGE_MAX_EDGE = 1600
/** Largest width or height, in pixels, of the placed layer. */
export const PLACE_IMAGE_MAX_DIMENSION = 16_384
/** Largest picture accepted, in pixels (64 megapixels). */
export const PLACE_IMAGE_MAX_PIXELS = 64_000_000

const DATA_URI_PREFIX = /^data:[^;,]*(;[^,]*)?,/i

function targetSize(natural: Size, width?: number, height?: number): Size {
  if (width !== undefined && height !== undefined) return { width, height }
  if (width !== undefined) return { width, height: (natural.height * width) / natural.width }
  if (height !== undefined) return { width: (natural.width * height) / natural.height, height }
  const fit = Math.min(1, PLACE_IMAGE_MAX_EDGE / Math.max(natural.width, natural.height))
  return { width: natural.width * fit, height: natural.height * fit }
}

const dimension = (label: string) =>
  v.optional(
    toolNumber(
      v.pipe(
        v.number(),
        v.minValue(1),
        v.maxValue(PLACE_IMAGE_MAX_DIMENSION),
        v.description(`${label} in pixels (max ${PLACE_IMAGE_MAX_DIMENSION})`)
      )
    )
  )

export const placeImage = defineTool({
  name: 'place_image',

  description:
    'Place a raster image on the canvas: creates a rectangle with an image fill sized to the picture. ' +
    'image_data is base64 (PNG, JPEG, WEBP or GIF; a data: URI is accepted). Without width/height the ' +
    `natural size is used, fitted to a ${PLACE_IMAGE_MAX_EDGE} px long edge. Give only one of width/height to ` +
    'keep the ratio. To fill an existing node instead, use set_image_fill.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.strictObject({
    image_data: v.pipe(
      v.string(),
      v.description('Base64-encoded image bytes (PNG, JPEG, WEBP, GIF), or a data: URI')
    ),
    name: v.optional(v.pipe(v.string(), v.description('Layer name (default "Image")'))),
    parent_id: v.optional(v.pipe(v.string(), v.description('Parent node ID to nest inside'))),
    x: v.optional(
      toolNumber(v.pipe(v.number(), v.description('X position in the parent, or on the page')))
    ),
    y: v.optional(
      toolNumber(v.pipe(v.number(), v.description('Y position in the parent, or on the page')))
    ),
    width: dimension('Width'),
    height: dimension('Height'),
    scale_mode: v.optional(
      v.pipe(v.picklist(['FILL', 'FIT', 'CROP', 'TILE']), v.description('Image scale mode')),
      'FILL'
    )
  }),
  execute: (figma, args) => {
    const encoded = args.image_data.replace(DATA_URI_PREFIX, '').replace(/\s+/g, '')
    if (!encoded || !isValid(encoded)) return { error: 'image_data is not valid Base64' }
    const bytes = toUint8Array(encoded)
    const natural = readImageSize(bytes)
    if (!natural) return { error: 'image_data is not a recognised PNG, JPEG, WEBP or GIF image' }
    if (natural.width * natural.height > PLACE_IMAGE_MAX_PIXELS) {
      return { error: `Image is ${natural.width}x${natural.height} px; the limit is 64 megapixels` }
    }

    const fitted = targetSize(natural, args.width, args.height)
    const width = Math.max(1, Math.round(fitted.width))
    const height = Math.max(1, Math.round(fitted.height))
    if (width > PLACE_IMAGE_MAX_DIMENSION || height > PLACE_IMAGE_MAX_DIMENSION) {
      return { error: `Resulting size ${width}x${height} exceeds ${PLACE_IMAGE_MAX_DIMENSION} px` }
    }

    const parent = args.parent_id ? figma.getNodeById(args.parent_id) : null
    if (args.parent_id && !parent) return { error: `Parent node "${args.parent_id}" not found` }

    const image = figma.createImage(bytes)
    const node = figma.createRectangle()
    node.x = args.x ?? 0
    node.y = args.y ?? 0
    node.resize(width, height)
    node.name = args.name?.trim() || 'Image'
    if (parent) parent.appendChild(node)
    // The plugin-typings ImagePaint has no `color`; the scene graph's Fill needs one.
    const paintTarget: FigmaNodeProxy = node
    paintTarget.fills = [
      {
        type: 'IMAGE',
        color: BLACK,
        opacity: 1,
        visible: true,
        imageHash: image.hash,
        imageScaleMode: args.scale_mode
      }
    ]
    return { id: node.id, name: node.name, width, height, imageHash: image.hash }
  }
})
