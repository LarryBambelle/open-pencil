import { createGlobalState } from '@vueuse/core'
import { reactive } from 'vue'

import type { FindScope } from '@open-pencil/core/editor'

/**
 * The find and replace panel's state, one for the whole app: the panel follows whichever
 * document is active and keeps its query when the person switches tabs.
 */
export const useFindPanel = createGlobalState(() => {
  const panel = reactive({
    open: false,
    query: '',
    replacement: '',
    matchCase: false,
    wholeWord: false,
    scope: 'page' as FindScope,
    /** Position in the flat list of matches; a layer with two matches counts twice. */
    index: 0,
    /** Advances to move the cursor into the query field, as <kbd>Mod+F</kbd> does when open. */
    focusRequest: 0
  })

  function open() {
    panel.open = true
    panel.focusRequest++
  }

  function close() {
    panel.open = false
  }

  return { panel, open, close }
})
