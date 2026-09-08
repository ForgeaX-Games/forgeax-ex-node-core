// Faithful canvas smoke test — render the ported Canvas shell over a
// mock-ApiClient-backed store and assert it mounts with the real legacy CSS
// classes (.canvas container + a .react-flow surface + the BatteryNode's
// .battery-node / .node-title) without throwing. jsdom gaps used by ReactFlow
// (ResizeObserver / DOMMatrix) are polyfilled in src/test/setup.ts.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEvent, fireEvent, render } from '@testing-library/react'

import { createMockApiClient } from '../../test/mockApiClient.js'
import { configureEditorTransport, createEditorTransport, type EditorTransport } from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import Canvas from '../components/canvas/Canvas.js'
import type { Battery, Pipeline } from '../types.js'

const echoBattery: Battery = {
  id: 'demo.echo',
  name: 'Echo',
  nameEn: 'Echo',
  type: 'ts',
  category: 'base',
  description: 'echoes its input',
  version: '1.0.0',
  inputs: [{ name: 'in', type: 'string' }],
  outputs: [{ name: 'out', type: 'string' }],
  params: [],
}

function seededPipeline(): Pipeline {
  const now = new Date().toISOString()
  return {
    id: 'p-smoke',
    name: 'smoke',
    description: '',
    nodes: [{ id: 'n1', batteryId: 'demo.echo', name: 'Echo', position: { x: 40, y: 40 }, params: {} }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
}

let transport: EditorTransport

beforeEach(() => {
  const client = createMockApiClient({
    ops: [{ id: 'demo.echo', name: 'Echo', inputs: [], outputs: [], params: [], execute: () => null }],
  })
  transport = createEditorTransport(client)
  configureEditorTransport(transport)
  usePipelineStore.setState({
    batteries: [echoBattery],
    categories: [],
    currentPipeline: seededPipeline(),
    sessionRestorePending: null,
    pipelineStatus: 'idle',
    selectedNode: null,
    selectedNodeIds: [],
    logs: [],
    nodeOutputs: {},
    dynamicOutputPorts: {},
    groupViewStack: [],
  })
  useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
})

afterEach(() => {
  transport.dispose()
  configureEditorTransport(null)
})

describe('faithful Canvas smoke', () => {
  it('mounts the canvas shell with the real legacy CSS classes', () => {
    const { container } = render(<Canvas />)

    // Legacy container class — the .canvas wrapper from Canvas.css.
    const canvasEl = container.querySelector('.canvas')
    expect(canvasEl).not.toBeNull()
    expect(canvasEl).toHaveAttribute('data-selection-dir', 'ltr')

    // ReactFlow mounted its surface.
    expect(container.querySelector('.react-flow')).not.toBeNull()
  })

  it('renders the seeded node via the faithful BatteryNode (real classes)', () => {
    const { container } = render(<Canvas />)

    // BatteryNode root + title from BatteryNode.tsx / BatteryNode.css.
    const node = container.querySelector('.battery-node')
    expect(node).not.toBeNull()
    expect(node).toHaveAttribute('data-battery-type', 'ts')
    expect(container.querySelector('.node-title')?.textContent).toBe('Echo')

    // Port row classes from BatteryNode.css.
    expect(container.querySelector('.node-ports')).not.toBeNull()
    expect(container.querySelector('.input-port')).not.toBeNull()
    expect(container.querySelector('.output-port')).not.toBeNull()
  })

  it('renders a list access marker and access-aware tooltip subtitle for ports', () => {
    usePipelineStore.setState({
      batteries: [{
        ...echoBattery,
        inputs: [{ name: 'nodes', type: 'scene', access: 'list', description: 'child scenes' }],
        outputs: [{ name: 'childPaths', type: 'string', access: 'list' }],
      }],
    })

    const { container } = render(<Canvas />)

    const inputMarker = container.querySelector('.input-port .port-access-marker--input.port-access-marker--list')
    const outputMarker = container.querySelector('.output-port .port-access-marker--output.port-access-marker--list')
    expect(inputMarker).not.toBeNull()
    expect(outputMarker).not.toBeNull()
  })

  it('hides output handles for sink-shaped batteries', () => {
    usePipelineStore.setState({ batteries: [{ ...echoBattery, hideOutputs: true }] })

    const { container } = render(<Canvas />)

    expect(container.querySelector('.input-port')).not.toBeNull()
    expect(container.querySelector('.output-port')).toBeNull()
    expect(container.querySelector('.react-flow__handle-right')).toBeNull()
  })

  it('makes the outer canvas a stable drop target for fast palette drags', () => {
    const { container } = render(<Canvas />)
    const canvasEl = container.querySelector('.canvas')
    expect(canvasEl).not.toBeNull()

    const dragOver = createEvent.dragOver(canvasEl as Element)
    Object.defineProperty(dragOver, 'dataTransfer', {
      value: { dropEffect: 'none' },
    })
    fireEvent(canvasEl as Element, dragOver)
    expect(dragOver.defaultPrevented).toBe(true)

    const drop = createEvent.drop(canvasEl as Element)
    Object.defineProperty(drop, 'dataTransfer', {
      value: { getData: () => '' },
    })
    fireEvent(canvasEl as Element, drop)
    expect(drop.defaultPrevented).toBe(true)
  })
})
