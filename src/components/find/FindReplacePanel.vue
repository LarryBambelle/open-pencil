<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

import { useCommonMessages, useFindMessages, useSceneComputed } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  currentHits,
  flattenHits,
  loadDocumentPages,
  replaceAllMatches,
  replaceMatch,
  revealMatch
} from '@/app/editor/find/matches'
import { useFindPanel } from '@/app/editor/find/state'
import { toast } from '@/app/shell/ui'
import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'
import { floatingSurface } from '@/theme/overlay'

/**
 * Find and replace over the text layers of the page or the document. Typing finds without
 * touching the selection; Enter and the arrows walk the matches and select each layer.
 * Replacing one match, or all of them, is one undo step.
 */
const store = useEditorStore()
const messages = useFindMessages()
const common = useCommonMessages()
const { panel, close } = useFindPanel()
const findInput = useTemplateRef<{ focus: () => void; select: () => void }>('findInput')

const hits = useSceneComputed(() => (panel.open ? currentHits(store, panel) : []))
const matches = computed(() => flattenHits(hits.value))
const total = computed(() => matches.value.length)
const current = computed(() => matches.value.at(panel.index) ?? null)
const hasLocked = computed(() => hits.value.some((hit) => hit.locked))
const loading = ref(false)
const busy = ref(false)

const scopeOptions = computed(() => [
  { value: 'page' as const, label: messages.value.scopePage },
  { value: 'document' as const, label: messages.value.scopeDocument }
])

// A new query, option, or scope starts again from the first match.
watch(
  () => [panel.query, panel.matchCase, panel.wholeWord, panel.scope],
  () => {
    panel.index = 0
  }
)

// Replacing or editing can leave the cursor past the last match.
watch(total, (count) => {
  if (panel.index >= count) panel.index = Math.max(0, count - 1)
})

watch(
  () => panel.focusRequest,
  async () => {
    await nextTick()
    focusFind()
  },
  { immediate: true }
)

// Pages of an opened file load on their first visit; searching them all reads them first.
watch(
  () => [panel.open, panel.scope] as const,
  async ([open, scope]) => {
    if (!open || scope !== 'document') return
    loading.value = true
    try {
      await loadDocumentPages(store)
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

function focusFind() {
  findInput.value?.focus()
  findInput.value?.select()
}

async function goTo(index: number) {
  if (total.value === 0) return
  panel.index = (index + total.value) % total.value
  const match = matches.value.at(panel.index)
  if (match) await revealMatch(store, match)
}

function onFindEnter(event: KeyboardEvent) {
  void goTo(panel.index + (event.shiftKey ? -1 : 1))
}

// The canvas shortcut stands down while a field has focus, so the panel handles its own.
function onKeydown(event: KeyboardEvent) {
  if (event.code !== 'KeyF' || !(event.metaKey || event.ctrlKey)) return
  event.preventDefault()
  focusFind()
}

async function replaceOne() {
  const match = current.value
  if (!match || match.hit.locked || busy.value) return
  busy.value = true
  try {
    await replaceMatch(store, match, panel.replacement)
    // The list shrank, so the next match now sits at this index.
    await nextTick()
    await goTo(panel.index)
  } finally {
    busy.value = false
  }
}

async function replaceAll() {
  if (busy.value) return
  busy.value = true
  try {
    const count = await replaceAllMatches(store, panel)
    toast.info(messages.value.replaced({ count }))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section
    v-if="panel.open"
    data-test-id="find-panel"
    role="search"
    :aria-label="messages.title"
    :class="['absolute top-3 right-3 z-30 flex w-80 flex-col gap-2 p-2', floatingSurface]"
    @keydown.escape.stop.prevent="close"
    @keydown="onKeydown"
  >
    <div class="flex items-center gap-1">
      <AppInput
        ref="findInput"
        v-model="panel.query"
        class="min-w-0 flex-1"
        :aria-label="messages.find"
        :placeholder="messages.find"
        @enter="onFindEnter"
      />
      <span
        class="w-16 shrink-0 text-center text-xs text-muted tabular-nums"
        role="status"
        aria-live="polite"
      >
        <template v-if="panel.query === ''" />
        <template v-else-if="loading">{{ messages.loading }}</template>
        <template v-else-if="total === 0">{{ messages.noMatches }}</template>
        <template v-else>{{ messages.count({ current: panel.index + 1, total }) }}</template>
      </span>
      <IconButton :label="messages.previous" :disabled="total === 0" @click="goTo(panel.index - 1)">
        <icon-lucide-chevron-up class="size-3.5" />
      </IconButton>
      <IconButton :label="messages.next" :disabled="total === 0" @click="goTo(panel.index + 1)">
        <icon-lucide-chevron-down class="size-3.5" />
      </IconButton>
      <IconButton :label="common.close" @click="close">
        <icon-lucide-x class="size-3.5" />
      </IconButton>
    </div>

    <div class="flex items-center gap-1">
      <AppInput
        v-model="panel.replacement"
        class="min-w-0 flex-1"
        :aria-label="messages.replaceWith"
        :placeholder="messages.replaceWith"
        @enter="replaceOne"
      />
      <AppButton
        variant="outline"
        :disabled="!current || current.hit.locked || busy"
        @click="replaceOne"
      >
        {{ messages.replace }}
      </AppButton>
      <AppButton variant="outline" :disabled="total === 0 || loading || busy" @click="replaceAll">
        {{ messages.replaceAll }}
      </AppButton>
    </div>

    <div class="flex items-center gap-1">
      <IconButton
        toggle
        :label="messages.matchCase"
        :active="panel.matchCase"
        @click="panel.matchCase = !panel.matchCase"
      >
        <icon-lucide-case-sensitive class="size-3.5" />
      </IconButton>
      <IconButton
        toggle
        :label="messages.wholeWord"
        :active="panel.wholeWord"
        @click="panel.wholeWord = !panel.wholeWord"
      >
        <icon-lucide-whole-word class="size-3.5" />
      </IconButton>
      <AppSelect
        v-model="panel.scope"
        :options="scopeOptions"
        :label="messages.scope"
        :ui="{ trigger: 'w-auto min-w-0 flex-1' }"
      />
    </div>

    <p v-if="hasLocked" class="m-0 text-xs text-muted">{{ messages.locked }}</p>
  </section>
</template>
