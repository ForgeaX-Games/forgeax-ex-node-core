// Canvas frame geometry helpers — pure-function tests for the frame bounding-box
// math ported from the legacy editor. No store / ReactFlow needed.
import { describe, expect, it } from 'vitest'
import type { Node } from 'reactflow'

import {
  computeFrameGeometry,
  nearlySameFrameGeometry,
  getRfNodeSize,
} from '../components/canvas/useCanvasFrames.js'

function n(id: string, x: number, y: number, extra: Partial<Node> = {}): Node {
  return { id, position: { x, y }, data: {}, ...extra } as Node
}

describe('getRfNodeSize', () => {
  it('prefers measured width/height', () => {
    expect(getRfNodeSize(n('a', 0, 0, { width: 200, height: 120 }))).toEqual({ width: 200, height: 120 })
  })

  it('falls back to style, then defaults', () => {
    expect(getRfNodeSize(n('a', 0, 0, { style: { width: 240 } }))).toEqual({ width: 240, height: 90 })
    expect(getRfNodeSize(n('a', 0, 0))).toEqual({ width: 180, height: 90 })
  })
})

describe('computeFrameGeometry', () => {
  it('returns null when no members exist on the canvas', () => {
    expect(computeFrameGeometry([n('a', 0, 0)], ['missing'])).toBeNull()
  })

  it('ignores other frame nodes as members', () => {
    const frameNode = n('f', 0, 0, { type: 'frame' })
    expect(computeFrameGeometry([frameNode], ['f'])).toBeNull()
  })

  it('pads the member bounding box', () => {
    // n1 (0,0) 180x90 ; n2 (300,200) 180x90 → bounds 0,0 → 480,290
    // Padding: FRAME_PAD_X=24, FRAME_PAD_TOP=48, FRAME_PAD_BOTTOM=24.
    const nodes = [n('n1', 0, 0, { width: 180, height: 90 }), n('n2', 300, 200, { width: 180, height: 90 })]
    const geo = computeFrameGeometry(nodes, ['n1', 'n2'])
    expect(geo).toEqual({
      position: { x: -24, y: -48 },
      width: 528, // (480 - 0) + 24*2
      height: 362, // (290 - 0) + 48 + 24
    })
  })

  it('enforces the minimum frame size for tiny selections', () => {
    const geo = computeFrameGeometry([n('n1', 0, 0, { width: 10, height: 10 })], ['n1'])
    expect(geo).toEqual({ position: { x: -24, y: -48 }, width: 220, height: 140 })
  })
})

describe('nearlySameFrameGeometry', () => {
  const base = { position: { x: 0, y: 0 }, width: 300, height: 200 }

  it('is true within sub-pixel tolerance', () => {
    expect(nearlySameFrameGeometry(base, { position: { x: 0.3, y: -0.2 }, width: 300.1, height: 199.8 })).toBe(true)
  })

  it('is false once any dimension drifts past 0.5', () => {
    expect(nearlySameFrameGeometry(base, { position: { x: 1, y: 0 }, width: 300, height: 200 })).toBe(false)
    expect(nearlySameFrameGeometry(base, { position: { x: 0, y: 0 }, width: 301, height: 200 })).toBe(false)
  })
})
