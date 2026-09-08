// CanvasSearchPopover smoke test — render the popover over a battery list and
// assert: it shows all results initially, fuzzy-filters on typing, and picks a
// result on click (firing onPickBattery + onClose).

import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import { CanvasSearchPopover } from '../components/canvas/CanvasSearchPopover.js'
import type { Battery } from '../types.js'

const batteries: Battery[] = [
  { id: 'scene.terrain', name: '地形生成', nameEn: 'Terrain', type: 'ts', category: 'scene', inputs: [], outputs: [], params: [], tags: ['noise'] },
  { id: 'scene.voxelize', name: '体素化', nameEn: 'Voxelize', type: 'ts', category: 'scene', inputs: [], outputs: [], params: [] },
  { id: 'util.merge', name: '合并', nameEn: 'Merge', type: 'ts', category: 'util', inputs: [], outputs: [], params: [] },
]

function renderPopover(overrides: Partial<React.ComponentProps<typeof CanvasSearchPopover>> = {}) {
  const onPickBattery = vi.fn()
  const onClose = vi.fn()
  const utils = render(
    <CanvasSearchPopover
      batteries={batteries}
      langMode="en"
      screenX={100}
      screenY={100}
      onClose={onClose}
      onPickBattery={onPickBattery}
      {...overrides}
    />,
  )
  return { ...utils, onPickBattery, onClose }
}

describe('CanvasSearchPopover smoke', () => {
  it('lists all batteries initially with the real classes', () => {
    const { container } = renderPopover()
    expect(container.querySelector('.canvas-search-popover')).not.toBeNull()
    expect(container.querySelectorAll('.canvas-search-item')).toHaveLength(4)
    expect(container.querySelector('.canvas-search-count')?.textContent).toBe('4')
    expect(container.textContent).toContain('Relay')
  })

  it('fuzzy-filters on query', () => {
    const { container } = renderPopover()
    const input = container.querySelector('input')!
    fireEvent.change(input, { target: { value: 'voxel' } })
    const items = container.querySelectorAll('.canvas-search-item')
    expect(items).toHaveLength(1)
    expect(items[0].textContent).toContain('Voxelize')
  })

  it('picks a result on mousedown (fires onPickBattery + onClose)', () => {
    const { container, onPickBattery, onClose } = renderPopover()
    const input = container.querySelector('input')!
    fireEvent.change(input, { target: { value: 'merge' } })
    fireEvent.mouseDown(container.querySelector('.canvas-search-item')!)
    expect(onPickBattery).toHaveBeenCalledWith(expect.objectContaining({ id: 'util.merge' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('offers a virtual Relay result that creates the kernel relay sentinel', () => {
    const { container, onPickBattery, onClose } = renderPopover()
    const input = container.querySelector('input')!
    fireEvent.change(input, { target: { value: 'relay' } })

    const items = container.querySelectorAll('.canvas-search-item')
    expect(items).toHaveLength(1)
    expect(items[0].textContent).toContain('Relay')

    fireEvent.mouseDown(items[0])
    expect(onPickBattery).toHaveBeenCalledWith(expect.objectContaining({
      id: '__relay__',
      name: 'Relay',
      inputs: [expect.objectContaining({ name: 'input' })],
      outputs: [expect.objectContaining({ name: 'output' })],
    }))
    expect(onClose).toHaveBeenCalled()
  })
})
