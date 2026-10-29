import { beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { expectDefined } from '#core-tests/helpers/assert'
import { FIXTURES } from '#core-tests/helpers/paths'

import { importClipboardNodes } from '@open-pencil/core/clipboard'
import { parseFigmaClipboard } from '@open-pencil/fig/clipboard'
import { symbolOverridesOf } from '@open-pencil/fig/instance-overrides'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph } from '@open-pencil/scene-graph'

/**
 * An Outer instance of Middle, as Figma copies it. Middle holds an instance of Inner, whose green
 * Swatch has a paint style of its own; Middle gives that Swatch a blue style, and Outer detaches it,
 * which keeps the blue as paints.
 */
const FIXTURE = join(FIXTURES, 'clipboard/cleared-fill-style.html')

/** Outer's Swatch after import; `paintsKept: false` drops the paints its cleared style keeps. */
async function outerSwatch(paintsKept: boolean) {
  const parsed = expectDefined(await parseFigmaClipboard(await Bun.file(FIXTURE).text()))
  // Outer's detach is the fixture's one override that names a fill style.
  if (!paintsKept)
    for (const override of parsed.nodes.flatMap(symbolOverridesOf))
      if ('styleIdForFill' in override) delete override.fillPaints
  const graph = new SceneGraph()
  const [outer] = importClipboardNodes(
    parsed.nodes,
    graph,
    graph.getPages()[0].id,
    0,
    0,
    parsed.blobs
  )
  const swatch = expectDefined(
    [...graph.nodes.values()].find(
      (node) => node.name === 'Swatch' && graph.isDescendant(node.id, outer)
    )
  )
  return { color: swatch.fills[0]?.color, style: swatch.fillStyleId }
}

beforeAll(initCodec)

describe('a fill style an outer instance clears', () => {
  test('keeps the paints Figma wrote with the detach', async () => {
    expect(await outerSwatch(true)).toEqual({ color: { r: 0, g: 0, b: 1, a: 1 }, style: null })
  })

  // Figma draws the record without paints with Inner's green, and with no style.
  test("shows the source layer's fill, without its style, when it wrote no paints", async () => {
    expect(await outerSwatch(false)).toEqual({ color: { r: 0, g: 1, b: 0, a: 1 }, style: null })
  })
})
