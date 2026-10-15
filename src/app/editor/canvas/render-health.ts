import type { RenderHealth, RenderHealthReport } from '@open-pencil/core/canvas'

import { notificationMessages } from '@/app/i18n/notifications'
import { toast } from '@/app/shell/ui'

/**
 * Tells the person when an editor's canvases start drawing without caches after failed frames,
 * stop drawing, or recover from drawing without caches. One notice serves all canvases of the
 * editor, so its Try again action restarts every canvas that stopped.
 */
export function createRenderHealthNotice() {
  // Keyed by each canvas's retry callback, which stays the same for the canvas's lifetime.
  const healthByCanvas = new Map<() => void, RenderHealth>()

  function retryStopped() {
    for (const [retry, health] of healthByCanvas) {
      if (health === 'disabled') retry()
    }
  }

  return (report: RenderHealthReport, retry: () => void) => {
    const previous = healthByCanvas.get(retry) ?? 'healthy'
    healthByCanvas.set(retry, report.health)
    const messages = notificationMessages.get()
    if (report.health === 'disabled') {
      toast.error(messages.canvasRenderingStopped, {
        label: messages.canvasRenderingRetry,
        run: retryStopped
      })
    } else if (report.health === 'degraded') {
      toast.warning(messages.canvasRenderingDegraded)
    } else if (previous === 'degraded') {
      toast.info(messages.canvasRenderingRecovered)
    }
  }
}
