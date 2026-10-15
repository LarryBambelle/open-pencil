import { describe, expect, test } from 'bun:test'

import { FrameGuard, type FrameGuardPolicy } from '#core/canvas/renderer/frame-guard'

const POLICY: FrameGuardPolicy = {
  degradeAfter: 2,
  disableAfter: 4,
  maxBackoffFrames: 3,
  recoverAfter: 2
}

/** Frames skipped before the guard lets the next one draw. */
function skippedFrames(guard: FrameGuard): number {
  let skipped = 0
  while (!guard.shouldDraw()) {
    skipped++
    if (skipped > 100) throw new Error('guard never let a frame draw')
  }
  return skipped
}

function wasmTrap(): unknown {
  return new WebAssembly.RuntimeError('Out of bounds call_indirect')
}

describe('FrameGuard', () => {
  test('draws every frame while nothing fails', () => {
    const guard = new FrameGuard(POLICY)
    expect(guard.shouldDraw()).toBe(true)
    expect(guard.succeed()).toBe(false)
    expect(guard.shouldDraw()).toBe(true)
    expect(guard.report()).toEqual({ health: 'healthy', error: null })
    expect(guard.retryPending).toBe(false)
  })

  test('retries a failed frame after a backoff that doubles up to the policy bound', () => {
    const guard = new FrameGuard({ ...POLICY, degradeAfter: 10, disableAfter: 10 })
    expect(guard.fail(new Error('first'))).toBe(false)
    expect(guard.health).toBe('healthy')
    expect(guard.retryPending).toBe(true)
    expect(skippedFrames(guard)).toBe(2)
    guard.fail(new Error('second'))
    expect(skippedFrames(guard)).toBe(3)
    guard.fail(new Error('third'))
    expect(skippedFrames(guard)).toBe(3)
  })

  test('a frame that draws after one failure ends the backoff without a health change', () => {
    const guard = new FrameGuard(POLICY)
    guard.fail(new Error('once'))
    skippedFrames(guard)
    expect(guard.succeed()).toBe(false)
    expect(guard.retryPending).toBe(false)
    expect(guard.shouldDraw()).toBe(true)
  })

  test('degrades after repeated failures and recovers after enough clean frames', () => {
    const guard = new FrameGuard(POLICY)
    guard.fail(new Error('lost context'))
    expect(guard.fail(new Error('lost context'))).toBe(true)
    expect(guard.report()).toEqual({ health: 'degraded', error: 'lost context' })
    skippedFrames(guard)
    expect(guard.succeed()).toBe(false)
    expect(guard.health).toBe('degraded')
    expect(guard.succeed()).toBe(true)
    expect(guard.report()).toEqual({ health: 'healthy', error: null })
  })

  test('a failure while degraded starts the clean-frame count over', () => {
    const guard = new FrameGuard(POLICY)
    guard.fail(new Error('a'))
    guard.fail(new Error('b'))
    guard.succeed()
    expect(guard.fail(new Error('c'))).toBe(false)
    expect(guard.health).toBe('degraded')
    expect(guard.succeed()).toBe(false)
    expect(guard.succeed()).toBe(true)
  })

  test('stops drawing after persistent failures until reset', () => {
    const guard = new FrameGuard(POLICY)
    const changes = Array.from({ length: POLICY.disableAfter }, () => guard.fail(new Error('x')))
    expect(changes).toEqual([false, true, false, true])
    expect(guard.health).toBe('disabled')
    expect(guard.retryPending).toBe(false)
    for (let i = 0; i < 100; i++) expect(guard.shouldDraw()).toBe(false)
    expect(guard.reset()).toBe(true)
    expect(guard.report()).toEqual({ health: 'healthy', error: null })
    expect(guard.shouldDraw()).toBe(true)
  })

  test('a WebAssembly trap stops drawing at once', () => {
    const guard = new FrameGuard(POLICY)
    expect(guard.fail(wasmTrap())).toBe(true)
    expect(guard.report()).toEqual({ health: 'disabled', error: 'Out of bounds call_indirect' })
    expect(guard.shouldDraw()).toBe(false)
  })

  test('disable and failures never lower the health', () => {
    const guard = new FrameGuard(POLICY)
    expect(guard.disable('recovery failed')).toBe(true)
    expect(guard.disable('again')).toBe(false)
    expect(guard.fail(new Error('later'))).toBe(false)
    expect(guard.health).toBe('disabled')
    expect(guard.report().error).toBe('later')
  })

  test('reset of a healthy guard reports no change', () => {
    expect(new FrameGuard(POLICY).reset()).toBe(false)
  })
})
