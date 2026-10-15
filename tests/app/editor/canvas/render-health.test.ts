import { afterEach, describe, expect, mock, test } from 'bun:test'

import type { RenderHealth } from '@open-pencil/core/canvas'

import { createRenderHealthNotice } from '@/app/editor/canvas/render-health'
import { toast } from '@/app/shell/ui'

import { expectDefined } from '#tests/helpers/assert'

afterEach(() => {
  for (const entry of toast.toasts.value) toast.remove(entry.id)
})

function report(health: RenderHealth) {
  return { health, error: health === 'healthy' ? null : 'lost context' }
}

const variants = () => toast.toasts.value.map((entry) => entry.variant)

describe('render health notice', () => {
  test('warns when a canvas degrades and says so once it recovers', () => {
    const notify = createRenderHealthNotice()
    const retry = mock()
    notify(report('degraded'), retry)
    expect(variants()).toEqual(['warning'])
    notify(report('healthy'), retry)
    expect(variants()).toEqual(['warning', 'default'])
    expect(retry).not.toHaveBeenCalled()
  })

  test('a stopped canvas gets an error whose action retries every stopped canvas', () => {
    const notify = createRenderHealthNotice()
    const scene = mock()
    const overlays = mock()
    const healthy = mock()
    notify(report('degraded'), healthy)
    notify(report('healthy'), healthy)
    notify(report('disabled'), scene)
    notify(report('disabled'), overlays)
    const stopped = toast.toasts.value.filter((entry) => entry.variant === 'error')
    expect(stopped).toHaveLength(1)
    expectDefined(stopped[0].action, 'retry action').run()
    expect(scene).toHaveBeenCalledTimes(1)
    expect(overlays).toHaveBeenCalledTimes(1)
    expect(healthy).not.toHaveBeenCalled()
  })

  test('a retried canvas that draws again does not claim a recovery', () => {
    const notify = createRenderHealthNotice()
    const retry = mock()
    notify(report('disabled'), retry)
    notify(report('healthy'), retry)
    expect(variants()).toEqual(['error'])
  })
})
