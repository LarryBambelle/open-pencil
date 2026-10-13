/** Smallest byte strings whose headers declare a size, enough for `readImageSize`. */

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

const PNG_SIGNATURE_AND_IHDR = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52
]
const PNG_DEPTH_AND_COLOR = [8, 6, 0, 0, 0]
const JPEG_START_AND_APP0 = [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0]
const GIF89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
const WEBP_VP8X_PREFIX = [
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58
]

export function png(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    ...PNG_SIGNATURE_AND_IHDR,
    ...be32(width),
    ...be32(height),
    ...PNG_DEPTH_AND_COLOR
  ])
}

export function jpeg(width: number, height: number): Uint8Array {
  const startOfFrame = [0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255]
  return Uint8Array.from([...JPEG_START_AND_APP0, ...startOfFrame, 1, 1, 0x11, 0])
}

export function gif(width: number, height: number): Uint8Array {
  const screen = [width & 255, width >> 8, height & 255, height >> 8]
  return Uint8Array.from([...GIF89A, ...screen, 0, 0, 0])
}

/** An extended (VP8X) WEBP header. */
export function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30)
  bytes.set(WEBP_VP8X_PREFIX)
  const w = width - 1
  const h = height - 1
  bytes.set(
    [w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255],
    24
  )
  return bytes
}
