// Canvas grid hook: drive the .canvas::before grid CSS variables from the
// ReactFlow viewport transform, RAF-throttled to one paint per frame. Extracted
// verbatim from the legacy Canvas.tsx grid logic.
import { useCallback, useEffect, useRef } from 'react'
import type { Viewport } from 'reactflow'

export function useCanvasGrid(containerRef: React.RefObject<HTMLElement>) {
  const pendingViewportRef = useRef<Viewport | null>(null)
  const gridRafRef = useRef<number | null>(null)

  const updateGridVars = useCallback(
    (viewport: Viewport) => {
      pendingViewportRef.current = viewport
      if (gridRafRef.current !== null) return
      gridRafRef.current = requestAnimationFrame(() => {
        gridRafRef.current = null
        const v = pendingViewportRef.current
        pendingViewportRef.current = null
        if (!v) return
        const container = containerRef.current
        if (!container) return
        const { x, y, zoom } = v
        let gridSize = 24 * zoom
        while (gridSize < 12) gridSize *= 2
        while (gridSize > 64) gridSize /= 2
        const majorSize = gridSize * 5
        container.style.setProperty('--grid-size', `${gridSize}px`)
        container.style.setProperty('--grid-size-major', `${majorSize}px`)
        container.style.setProperty('--grid-offset-x', `${x}px`)
        container.style.setProperty('--grid-offset-y', `${y}px`)
      })
    },
    [containerRef],
  )

  // Cancel a pending RAF on unmount; avoids writing style on an unmounted
  // container and stale-viewport reads under StrictMode double-mount.
  useEffect(() => {
    return () => {
      if (gridRafRef.current !== null) {
        cancelAnimationFrame(gridRafRef.current)
        gridRafRef.current = null
      }
      pendingViewportRef.current = null
    }
  }, [])

  return { updateGridVars }
}
