import { isDesignClipboardHTML } from '@/app/editor/clipboard/html'
import { getInMemoryClipboardHTML } from '@/app/editor/clipboard/memory'
import { readTauriClipboardText } from '@/app/tauri/clipboard'
import { isTauri } from '@/app/tauri/env'

/** The design layers on the system clipboard, or the last copy made here when it cannot be read. */
export async function readClipboardHTML(): Promise<string | null> {
  if (isTauri()) {
    try {
      const text = await readTauriClipboardText()
      if (isDesignClipboardHTML(text ?? '')) return text
      const memory = getInMemoryClipboardHTML(text ?? '')
      return memory && isDesignClipboardHTML(memory) ? memory : null
    } catch (error) {
      console.warn('Tauri clipboard read failed', error)
      const memory = getInMemoryClipboardHTML()
      return memory && isDesignClipboardHTML(memory) ? memory : null
    }
  }

  if (
    typeof navigator !== 'undefined' &&
    typeof (navigator as Partial<Navigator>).clipboard?.read === 'function'
  ) {
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        if (!item.types.includes('text/html')) continue
        const text = await (await item.getType('text/html')).text()
        if (text && isDesignClipboardHTML(text)) return text
      }
      // A readable clipboard without design layers holds something newer than our last copy.
      return null
    } catch (error) {
      console.warn('System clipboard read failed', error)
    }
  }

  const memory = getInMemoryClipboardHTML()
  return memory && isDesignClipboardHTML(memory) ? memory : null
}
