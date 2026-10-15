import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test')

function seedTexts(texts: string[]) {
  return editor.page.evaluate((contents) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const ids = contents.map(
      (text, index) =>
        store.graph.createNode('TEXT', store.state.currentPageId, {
          name: `Text ${index + 1}`,
          text,
          x: 100,
          y: 100 + index * 60,
          width: 240,
          height: 24
        }).id
    )
    store.requestRender()
    return ids
  }, texts)
}

function textsOf(ids: string[]) {
  return editor.page.evaluate((nodeIds) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return nodeIds.map((id) => store.graph.getNode(id)?.text)
  }, ids)
}

function selectedIds() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return [...store.state.selectedIds]
  })
}

async function openPanel() {
  await editor.page.keyboard.press('Meta+f')
  const panel = editor.page.getByRole('search')
  await expect(panel).toBeVisible()
  return panel
}

test('Mod+F opens the panel with the query field focused, Escape closes it', async () => {
  const panel = await openPanel()
  await expect(panel.getByRole('textbox').first()).toBeFocused()
  await editor.page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
})

test('Enter walks the matches and selects each layer', async () => {
  const [first, second] = await seedTexts(['Pencil one', 'second PENCIL', 'unrelated'])
  const panel = await openPanel()
  await panel.getByRole('textbox').first().fill('pencil')

  await editor.page.keyboard.press('Enter')
  await expect.poll(selectedIds).toEqual([second])
  await editor.page.keyboard.press('Enter')
  await expect.poll(selectedIds).toEqual([first])
  await editor.page.keyboard.press('Shift+Enter')
  await expect.poll(selectedIds).toEqual([second])
  await editor.page.keyboard.press('Escape')
})

test('match case leaves out the matches in another case', async () => {
  const [first] = await seedTexts(['Pencil one', 'second pencil'])
  const panel = await openPanel()
  await panel.getByRole('textbox').first().fill('Pencil')
  await panel.getByRole('button', { name: 'Match case' }).click()
  const next = panel.getByRole('button', { name: 'Next match' })
  await next.click()
  await expect.poll(selectedIds).toEqual([first])
  await next.click()
  await expect.poll(selectedIds).toEqual([first])
  // The panel keeps its options between openings; leave them as found.
  await panel.getByRole('button', { name: 'Match case' }).click()
  await editor.page.keyboard.press('Escape')
})

test('Replace all rewrites every match and one undo restores them', async () => {
  const ids = await seedTexts(['Pencil and pencil', 'a PENCIL', 'unrelated'])
  const panel = await openPanel()
  await panel.getByRole('textbox').first().fill('pencil')
  await panel.getByRole('textbox').nth(1).fill('pen')
  await panel.getByRole('button', { name: 'Replace all' }).click()

  await expect.poll(() => textsOf(ids)).toEqual(['pen and pen', 'a pen', 'unrelated'])

  await editor.canvas.undo()
  await expect.poll(() => textsOf(ids)).toEqual(['Pencil and pencil', 'a PENCIL', 'unrelated'])
  await editor.page.keyboard.press('Escape')
  editor.canvas.assertNoErrors()
})

test('Replace changes the current match and moves to the next', async () => {
  const [first, second] = await seedTexts(['red one', 'red two'])
  const panel = await openPanel()
  await panel.getByRole('textbox').first().fill('red')
  await panel.getByRole('textbox').nth(1).fill('blue')
  await panel.getByRole('button', { name: 'Replace', exact: true }).click()

  await expect.poll(() => textsOf([first, second])).toEqual(['blue one', 'red two'])
  await expect.poll(selectedIds).toEqual([second])
  await editor.page.keyboard.press('Escape')
})
