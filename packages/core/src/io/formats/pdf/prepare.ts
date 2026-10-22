import { weightToStyle, type SceneGraph } from '@open-pencil/scene-graph'

import { withTextShaper } from '#core/canvas/text/shape'
import { getCanvasKit } from '#core/canvaskit'
import { populateAllFigPages } from '#core/io/formats/fig'
import type { SVGTextLayout } from '#core/io/formats/svg'
import { computeAllLayouts } from '#core/layout'
import type { DocumentFontStatus } from '#core/text/font/status'
import { fontManager } from '#core/text/fonts'
import { prepareGraphFonts } from '#core/text/prepare'

import type { PDFFontLoader } from './fonts'
import type { PDFPageSpec } from './plan'

/**
 * Loads every font the text of these pages draws with, as the canvas does: the faces, the
 * characters remote fonts must cover, and the script and emoji fallbacks.
 */
export function preparePDFFonts(
  graph: SceneGraph,
  specs: readonly PDFPageSpec[]
): Promise<DocumentFontStatus> {
  return prepareGraphFonts(
    graph,
    specs.flatMap((spec) => spec.nodeIds)
  )
}

/**
 * Design pages other than the open one may still be unread (.fig pages load on demand) and have
 * no layout yet. Read them, load the fonts their text needs, and lay them out, so every PDF page
 * is complete.
 */
export async function preparePagesForPDF(
  graph: SceneGraph,
  specs: readonly PDFPageSpec[]
): Promise<DocumentFontStatus> {
  populateAllFigPages(graph)
  const status = await preparePDFFonts(graph, specs)
  for (const spec of specs) computeAllLayouts(graph, spec.pageId)
  return status
}

/** The font file of a face, from the same font manager the canvas draws with. */
export const loadPDFFont: PDFFontLoader = (face) =>
  fontManager.loadFont(face.family, weightToStyle(face.weight, face.italic))

/**
 * Runs `render` with the line breaks the canvas gives each text node (same paragraph builder and
 * fonts), so a wrapped paragraph stays wrapped in the PDF. Without CanvasKit, `render` gets no
 * layout and each text node is exported on one line.
 */
export async function withPDFTextLayout<T>(
  render: (textLayout: SVGTextLayout | undefined) => Promise<T>
): Promise<T> {
  const ck = await getCanvasKit().catch(() => null)
  if (!ck) return render(undefined)
  return withTextShaper(ck, (shape) =>
    render((node) => {
      const shaped = shape(node)
      if (!shaped?.baselines.length) return null
      return shaped.baselines.map((line) => ({
        start: line.firstCharacter,
        end: line.endCharacter,
        x: line.position.x,
        y: line.position.y,
        width: line.width
      }))
    })
  )
}
