import type { Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

/** Makes the scene canvas's frames throw until the returned handle's `restore` runs. */
async function breakSceneFrames(page: Page) {
  return page.evaluateHandle(() => {
    const store = window.openPencil?.getStore?.()
    const renderer = store?.canvasRenderers.find((r) => r.tracksSceneSettlement)
    if (!store || !renderer) throw new Error('Scene unavailable')
    const surface = renderer.surface
    const flush = surface.flush
    surface.flush = () => {
      throw new Error('Simulated lost GPU context')
    }
    let drawn = 0
    store.requestRender()
    return {
      /** Lets frames draw again and counts those that do. */
      restore() {
        surface.flush = (...args) => {
          drawn++
          return flush.apply(surface, args)
        }
      },
      dispose() {
        surface.flush = flush
      },
      drawn: () => drawn
    }
  })
}

test('a canvas whose frames keep failing says so and draws again after Try again', async ({
  page
}) => {
  await page.goto('/?test&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const scene = page.getByTestId('scene-canvas-element')
  const toasts = page.locator('[data-slot="toast"]')

  const failure = await breakSceneFrames(page)
  try {
    await expect(toasts.and(page.locator('[data-tone="warning"]'))).toHaveCount(1)
    await expect(scene).toHaveAttribute('data-render-health', 'disabled', { timeout: 15_000 })
    const stopped = toasts.and(page.locator('[data-tone="error"]'))
    await expect(stopped).toHaveCount(1)

    await failure.evaluate((handle) => handle.restore())
    await canvas.waitForRender()
    expect(await failure.evaluate((handle) => handle.drawn())).toBe(0)
    await stopped.getByRole('button', { name: 'Try again' }).click()
    await expect.poll(() => failure.evaluate((handle) => handle.drawn())).toBeGreaterThan(0)
    await expect(scene).toHaveAttribute('data-render-health', 'healthy')
  } finally {
    await failure.evaluate((handle) => handle.dispose())
    await failure.dispose()
  }
})
