/**
 * Image header sniffing: the pixel size of PNG, JPEG, WEBP and GIF bytes without decoding them,
 * so a caller can size a layer or refuse an oversized picture before CanvasKit allocates pixels.
 */

import type { Size } from '@open-pencil/scene-graph/primitives'

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1]
const u32be = (b: Uint8Array, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n))

const JPEG_NON_FRAME_MARKERS = new Set([0xc4, 0xc8, 0xcc])

function jpegSize(b: Uint8Array): Size | null {
  let o = 2
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) {
      o++
      continue
    }
    const marker = b[o + 1]
    if (marker === 0xff) {
      o++
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2
      continue
    }
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && !JPEG_NON_FRAME_MARKERS.has(marker)
    if (isFrameHeader) return { height: u16be(b, o + 5), width: u16be(b, o + 7) }
    o += 2 + u16be(b, o + 2)
  }
  return null
}

function webpSize(b: Uint8Array): Size | null {
  if (b.length < 30) return null
  const kind = ascii(b, 12, 4)
  if (kind === 'VP8 ') return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  if (kind === 'VP8L') {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (kind === 'VP8X') return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
  return null
}

function sniffSize(b: Uint8Array): Size | null {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && ascii(b, 12, 4) === 'IHDR') {
    return { width: u32be(b, 16), height: u32be(b, 20) }
  }
  if (b.length >= 10 && ascii(b, 0, 3) === 'GIF') return { width: u16le(b, 6), height: u16le(b, 8) }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpegSize(b)
  if (b.length >= 16 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return webpSize(b)
  return null
}

/** Read the pixel size from PNG, JPEG, WEBP or GIF bytes; null when unrecognised or truncated. */
export function readImageSize(bytes: Uint8Array): Size | null {
  const size = sniffSize(bytes)
  return size && size.width > 0 && size.height > 0 ? size : null
}
