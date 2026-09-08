import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

// jsdom does not implement ResizeObserver / DOMRect.toJSON, both used
// by ReactFlow internals. Provide minimal polyfills so tests that mount
// <ReactFlow> don't crash on commit.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverPolyfill {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  ;(globalThis as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverPolyfill
}

if (typeof globalThis.DOMMatrix === 'undefined') {
  ;(globalThis as { DOMMatrix: unknown }).DOMMatrix = class {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
  }
}
