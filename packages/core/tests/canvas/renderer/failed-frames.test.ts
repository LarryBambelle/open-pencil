import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { SceneGraph } from '@open-pencil/scene-graph'

import { SkiaRenderer, type RenderHealthReport } from '#core/canvas'
import { DEFAULT_FRAME_GUARD_POLICY } from '#core/canvas/renderer/frame-guard'
import { initCanvasKit } from '#core/io'

const ck = await initCanvasKit()

interface Fixture {
  renderer: SkiaRenderer
  graph: SceneGraph
  reports: RenderHealthReport[]
  /** Makes drawing a layer throw `error`, or draw normally again with null. */
  breakDrawing: (error: unknown) => void
  drawAttempts: () => number
}

let fixture: Fixture
let restoreWarn: () => void

beforeEach(() => {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.createNode('RECTANGLE', pageId, { width: 10, height: 10 })
  const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(32, 32), 'surface'))
  renderer.pageId = pageId
  const reports: RenderHealthReport[] = []
  renderer.onRenderHealthChange = (report) => reports.push(report)
  const drawLayer = renderer.renderNode.bind(renderer)
  let failure: unknown = null
  const renderNode = spyOn(renderer, 'renderNode').mockImplementation((...args) => {
    if (failure !== null) throw failure
    drawLayer(...args)
  })
  const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
  restoreWarn = () => warn.mockRestore()
  fixture = {
    renderer,
    graph,
    reports,
    breakDrawing: (error) => {
      failure = error
    },
    drawAttempts: () => renderNode.mock.calls.length
  }
})

afterEach(() => {
  restoreWarn()
  fixture.renderer.destroy()
})

let sceneVersion = 0

function frame(): boolean {
  return fixture.renderer.render(fixture.graph, new Set(), {}, ++sceneVersion, 'full')
}

/** Requests frames, as the host does while a retry is pending, until one tries to draw. */
function nextAttempt(): boolean {
  const before = fixture.drawAttempts()
  for (let i = 0; i <= DEFAULT_FRAME_GUARD_POLICY.maxBackoffFrames; i++) {
    const drawn = frame()
    if (fixture.drawAttempts() > before) return drawn
  }
  throw new Error('no frame tried to draw')
}

describe('render frame guard', () => {
  test('a throwing frame is contained, restores the canvas, and is retried after a backoff', () => {
    const { renderer } = fixture
    fixture.breakDrawing(new Error('lost context'))
    expect(frame()).toBe(false)
    expect(renderer.surface.getCanvas().getSaveCount()).toBe(1)
    expect(renderer.frameGuard.retryPending).toBe(true)
    expect(renderer.frameGuard.health).toBe('healthy')
    const attempts = fixture.drawAttempts()
    expect(frame()).toBe(false)
    expect(fixture.drawAttempts()).toBe(attempts)

    fixture.breakDrawing(null)
    expect(nextAttempt()).toBe(true)
    expect(renderer.frameGuard.retryPending).toBe(false)
    expect(fixture.reports).toEqual([])
  })

  test('repeated failures draw uncached until frames succeed again', () => {
    const { renderer } = fixture
    expect(frame()).toBe(true)
    expect(renderer.scenePicture).not.toBeNull()

    fixture.breakDrawing(new Error('lost context'))
    frame()
    nextAttempt()
    expect(fixture.reports).toEqual([{ health: 'degraded', error: 'lost context' }])
    expect(renderer.scenePicture).toBeNull()

    fixture.breakDrawing(null)
    expect(nextAttempt()).toBe(true)
    expect(renderer.scenePicture).toBeNull()
    for (let i = 1; i < DEFAULT_FRAME_GUARD_POLICY.recoverAfter; i++) expect(frame()).toBe(true)
    expect(fixture.reports.at(-1)).toEqual({ health: 'healthy', error: null })

    expect(frame()).toBe(true)
    expect(renderer.scenePicture).not.toBeNull()
  })

  test('persistent failures stop drawing until the host resets the renderer', () => {
    const { renderer } = fixture
    fixture.breakDrawing(new Error('still broken'))
    frame()
    while (renderer.frameGuard.health !== 'disabled') nextAttempt()
    expect(fixture.reports.map((report) => report.health)).toEqual(['degraded', 'disabled'])
    expect(renderer.frameGuard.retryPending).toBe(false)

    const attempts = fixture.drawAttempts()
    for (let i = 0; i < 100; i++) expect(frame()).toBe(false)
    expect(fixture.drawAttempts()).toBe(attempts)

    fixture.breakDrawing(null)
    renderer.resetRenderHealth()
    expect(fixture.reports.at(-1)).toEqual({ health: 'healthy', error: null })
    expect(frame()).toBe(true)
  })

  test('a WebAssembly trap stops drawing on the first failure', () => {
    const { renderer } = fixture
    fixture.breakDrawing(new WebAssembly.RuntimeError('Out of bounds memory access'))
    expect(frame()).toBe(false)
    expect(fixture.reports).toEqual([{ health: 'disabled', error: 'Out of bounds memory access' }])
    expect(renderer.frameGuard.retryPending).toBe(false)
  })
})
