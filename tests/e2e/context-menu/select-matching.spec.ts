import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { expectDefined } from '#tests/helpers/assert'

const editor = useEditorSetup()

function selectedCount() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.state.selectedIds.size
  })
}

test('the context menu selects the layers that share a property', async () => {
  await editor.canvas.drawRect(100, 100, 80, 60)
  await editor.canvas.drawRect(260, 100, 80, 60)
  await editor.canvas.drawRect(100, 260, 120, 120)
  await editor.canvas.waitForRender()

  await editor.canvas.click(140, 130)
  await editor.canvas.waitForRender()
  expect(await selectedCount()).toBe(1)

  const box = expectDefined(await editor.canvas.canvas.boundingBox(), 'canvas bounds')
  await editor.page.mouse.click(box.x + 140, box.y + 130, { button: 'right' })
  await editor.page.getByTestId('context-select-matching').click()
  await editor.page.getByTestId('context-select-matching-size').click()
  await editor.canvas.waitForRender()

  expect(await selectedCount()).toBe(2)
})
