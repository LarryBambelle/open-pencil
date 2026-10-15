import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { clearInMemoryClipboardHTML, setInMemoryClipboardHTML } from '@/app/editor/clipboard/memory'
import { readClipboardHTML } from '@/app/editor/clipboard/read'

import { asDouble } from '#tests/helpers/doubles'

const DESIGN = '<span data-buffer="<!--(figma)AAAA(/figma)-->"></span>'
const LAST_COPY = '<span data-buffer="<!--(figma)BBBB(/figma)-->"></span>'

function stubClipboard(read: () => Promise<ClipboardItem[]>) {
  Object.defineProperty(navigator, 'clipboard', { value: { read }, configurable: true })
}

function item(types: Record<string, string>): ClipboardItem {
  return asDouble<ClipboardItem>({
    types: Object.keys(types),
    getType: async (type: string) => new Blob([types[type] ?? ''], { type })
  })
}

beforeEach(() => setInMemoryClipboardHTML(LAST_COPY))
afterEach(() => {
  clearInMemoryClipboardHTML()
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('readClipboardHTML', () => {
  test('reads design layers from the system clipboard', async () => {
    stubClipboard(async () => [item({ 'text/html': DESIGN })])
    expect(await readClipboardHTML()).toBe(DESIGN)
  })

  test('a readable clipboard without design layers is not replaced by the last copy', async () => {
    stubClipboard(async () => [item({ 'text/plain': 'copied elsewhere' })])
    expect(await readClipboardHTML()).toBeNull()
  })

  test('falls back to the last copy when the clipboard cannot be read', async () => {
    stubClipboard(async () => {
      throw new DOMException('Read permission denied', 'NotAllowedError')
    })
    expect(await readClipboardHTML()).toBe(LAST_COPY)
  })
})
