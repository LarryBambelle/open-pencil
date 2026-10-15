/**
 * How a renderer copes with frames that throw: `healthy` draws normally and retries a failed
 * frame after a backoff; `degraded` drops its caches and draws uncached until frames succeed
 * again; `disabled` stops drawing until the host resets it.
 */
export type RenderHealth = 'healthy' | 'degraded' | 'disabled'

export interface RenderHealthReport {
  health: RenderHealth
  /** Message of the failure behind an unhealthy state, null when healthy. */
  error: string | null
}

export interface FrameGuardPolicy {
  /** Consecutive failed frames after which the renderer draws uncached. */
  degradeAfter: number
  /** Consecutive failed frames after which the renderer stops drawing. */
  disableAfter: number
  /** Upper bound of the backoff, in skipped frames, which doubles with each failure. */
  maxBackoffFrames: number
  /** Frames a degraded renderer must draw without failing before it is healthy again. */
  recoverAfter: number
}

export const DEFAULT_FRAME_GUARD_POLICY: FrameGuardPolicy = {
  degradeAfter: 2,
  disableAfter: 8,
  maxBackoffFrames: 60,
  recoverAfter: 30
}

const HEALTH_RANK: Record<RenderHealth, number> = { healthy: 0, degraded: 1, disabled: 2 }

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  return String(error)
}

/**
 * A WebAssembly trap such as an out-of-bounds access or a bad `call_indirect` can leave the
 * CanvasKit heap corrupted, so drawing again would only fail differently. CanvasKit itself needs
 * WebAssembly, so the global is always there when a renderer exists.
 */
function isWasmTrap(error: unknown): boolean {
  return error instanceof WebAssembly.RuntimeError
}

/** Health state machine for one renderer's frame loop; the pipeline drives it per frame. */
export class FrameGuard {
  health: RenderHealth = 'healthy'
  consecutiveFailures = 0
  lastError: string | null = null
  private backoffFrames = 0
  private cleanFrames = 0

  constructor(readonly policy: FrameGuardPolicy = DEFAULT_FRAME_GUARD_POLICY) {}

  /** Whether to draw this frame. A frame skipped while backing off counts the backoff down. */
  shouldDraw(): boolean {
    if (this.health === 'disabled') return false
    if (this.backoffFrames === 0) return true
    this.backoffFrames--
    return false
  }

  /** Whether the host should keep requesting frames so that a failed frame is retried. */
  get retryPending(): boolean {
    return this.health !== 'disabled' && this.consecutiveFailures > 0
  }

  /** Records a frame that drew. Returns whether the health changed. */
  succeed(): boolean {
    this.consecutiveFailures = 0
    this.backoffFrames = 0
    if (this.health !== 'degraded') return false
    this.cleanFrames++
    if (this.cleanFrames < this.policy.recoverAfter) return false
    this.health = 'healthy'
    this.lastError = null
    this.cleanFrames = 0
    return true
  }

  /** Records a frame that threw. Returns whether the health changed. */
  fail(error: unknown): boolean {
    this.consecutiveFailures++
    this.cleanFrames = 0
    this.lastError = describeError(error)
    this.backoffFrames = Math.min(2 ** this.consecutiveFailures, this.policy.maxBackoffFrames)
    if (isWasmTrap(error) || this.consecutiveFailures >= this.policy.disableAfter)
      return this.escalate('disabled')
    if (this.consecutiveFailures >= this.policy.degradeAfter) return this.escalate('degraded')
    return false
  }

  /** Stops drawing, such as when recovering from a failed frame failed too. */
  disable(error: unknown): boolean {
    this.lastError = describeError(error)
    return this.escalate('disabled')
  }

  /** Starts over as healthy. Returns whether the health changed. */
  reset(): boolean {
    const changed = this.health !== 'healthy'
    this.health = 'healthy'
    this.consecutiveFailures = 0
    this.lastError = null
    this.backoffFrames = 0
    this.cleanFrames = 0
    return changed
  }

  report(): RenderHealthReport {
    return { health: this.health, error: this.health === 'healthy' ? null : this.lastError }
  }

  private escalate(health: RenderHealth): boolean {
    if (HEALTH_RANK[health] <= HEALTH_RANK[this.health]) return false
    this.health = health
    return true
  }
}
