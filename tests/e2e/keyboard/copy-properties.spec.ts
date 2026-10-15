import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { expectDefined } from '#tests/helpers/assert'

const editor = useEditorSetup()

const SOURCE = { x: 100, y: 150, width: 120, height: 80 }
const TARGET = { x: 400, y: 150, width: 120, height: 80 }

function centre(rect: typeof SOURCE) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

async function drawRects() {
  await editor.canvas.drawRect(SOURCE.x, SOURCE.y, SOURCE.width, SOURCE.height)
  const sourceId = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const [id] = store.state.selectedIds
    if (!id) throw new Error('The drawn rectangle was not selected')
    store.updateNode(id, { cornerRadius: 12, opacity: 0.5 })
    return id
  })
  await editor.canvas.drawRect(TARGET.x, TARGET.y, TARGET.width, TARGET.height)
  await editor.canvas.waitForRender()
  return sourceId
}

async function selectAt(rect: typeof SOURCE) {
  const { x, y } = centre(rect)
  await editor.canvas.click(x, y)
  await editor.canvas.waitForRender()
}

function selectedLook() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const [id] = store.state.selectedIds
    const node = id ? store.graph.getNode(id) : undefined
    return node ? { id, cornerRadius: node.cornerRadius, opacity: node.opacity } : null
  })
}

test('Alt+Cmd+C then Alt+Cmd+V moves the look of one layer to another, in one undo step', async () => {
  const sourceId = await drawRects()
  const before = expectDefined(await selectedLook(), 'target look')
  expect(before.cornerRadius).toBe(0)

  await selectAt(SOURCE)
  expect((await selectedLook())?.id).toBe(sourceId)
  await editor.page.keyboard.press('ControlOrMeta+Alt+KeyC')

  await selectAt(TARGET)
  await editor.page.keyboard.press('ControlOrMeta+Alt+KeyV')
  await editor.canvas.waitForRender()
  expect(await selectedLook()).toEqual({ id: before.id, cornerRadius: 12, opacity: 0.5 })

  await editor.page.keyboard.press('ControlOrMeta+KeyZ')
  await editor.canvas.waitForRender()
  expect(await selectedLook()).toEqual(before)
})

test('the canvas menu copies and pastes properties', async () => {
  await drawRects()
  const box = expectDefined(await editor.canvas.canvas.boundingBox(), 'canvas bounds')
  const rightClick = async (rect: typeof SOURCE) => {
    const { x, y } = centre(rect)
    await editor.page.mouse.click(box.x + x, box.y + y, { button: 'right' })
  }

  await rightClick(SOURCE)
  await editor.page.getByTestId('context-copy-properties').click()

  await rightClick(TARGET)
  await editor.page.getByTestId('context-paste-properties').click()
  await editor.canvas.waitForRender()
  expect(await selectedLook()).toMatchObject({ cornerRadius: 12, opacity: 0.5 })
})
