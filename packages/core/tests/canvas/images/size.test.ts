import { describe, expect, test } from 'bun:test'

import { gif, jpeg, png, webp } from '#core-tests/canvas/images/headers'

import { readImageSize } from '#core/canvas/images/size'

describe('readImageSize', () => {
  test('reads the size of PNG, JPEG, GIF and WEBP headers', () => {
    expect(readImageSize(png(640, 480))).toEqual({ width: 640, height: 480 })
    expect(readImageSize(jpeg(300, 200))).toEqual({ width: 300, height: 200 })
    expect(readImageSize(gif(50, 20))).toEqual({ width: 50, height: 20 })
    expect(readImageSize(webp(800, 600))).toEqual({ width: 800, height: 600 })
  })

  test('returns null for unrecognised bytes', () => {
    expect(readImageSize(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(readImageSize(new Uint8Array())).toBeNull()
  })

  test('returns null for a zero-sized picture', () => {
    expect(readImageSize(png(0, 10))).toBeNull()
    expect(readImageSize(gif(10, 0))).toBeNull()
  })

  test('returns null when the header is cut short instead of a garbage size', () => {
    expect(readImageSize(png(10, 10).subarray(0, 20))).toBeNull()
    expect(readImageSize(gif(5, 5).subarray(0, 8))).toBeNull()
    expect(readImageSize(jpeg(30, 20).subarray(0, 6))).toBeNull()
    expect(readImageSize(webp(8, 8).subarray(0, 20))).toBeNull()
  })
})
