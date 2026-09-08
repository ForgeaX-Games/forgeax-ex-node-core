// Faithful sidebar smoke test — render the ported BatteryBar and PropertiesPanel
// over a mock-ApiClient-backed store and assert they mount with the real legacy
// CSS classes (BatteryBar's .battery-bar / .bb-body / .battery-row, the
// inspector's .sidebar / .sidebar-tabs) without throwing. The seeded battery
// also appears as a draggable .battery-row, exercising the catalog render path.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { createMockApiClient } from '../../test/mockApiClient.js'
import { configureEditorTransport, createEditorTransport, type EditorTransport } from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import BatteryBar from '../components/sidebar/BatteryBar.js'
import PropertiesPanel from '../components/sidebar/PropertiesPanel.js'
import type { Battery, Pipeline } from '../types.js'

const echoBattery: Battery = {
  id: 'demo.echo',
  name: 'Echo',
  nameEn: 'Echo',
  type: 'ts',
  category: 'base/general',
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
    nodes: [{ id: 'n1', batteryId: 'demo.echo', name: 'Echo', position: { x: 40, y: 40 }, params: { in: 'hi' } }],
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
    batteryOrder: { bigLabels: [], smallLabels: {} },
    currentPipeline: seededPipeline(),
    sessionRestorePending: null,
    pipelineStatus: 'idle',
    selectedNode: null,
    selectedNodeIds: [],
    logs: [],
    compileInfo: null,
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

describe('faithful sidebar smoke', () => {
  it('mounts the BatteryBar catalog with the real legacy CSS classes', () => {
    const { container } = render(<BatteryBar />)

    // Root + body containers from BatteryBar.css.
    const bar = container.querySelector('.battery-bar')
    expect(bar).not.toBeNull()
    expect(bar?.classList.contains('battery-bar--vertical')).toBe(true)
    expect(container.querySelector('.bb-body')).not.toBeNull()
    expect(container.querySelector('.bb-scroller')).not.toBeNull()

    // The seeded battery renders as a draggable .battery-row with its name.
    const row = container.querySelector('.battery-row')
    expect(row).not.toBeNull()
    expect(container.querySelector('.battery-row-name')?.textContent).toBe('Echo')
  })

  it('mounts the PropertiesPanel inspector with the real legacy CSS classes', () => {
    const { container } = render(<PropertiesPanel />)

    // Inspector shell + tab bar from Sidebar.css.
    expect(container.querySelector('.sidebar')).not.toBeNull()
    expect(container.querySelector('.sidebar-header')).not.toBeNull()
    expect(container.querySelectorAll('.sidebar-tab').length).toBe(3)

    // No node selected → the empty-state placeholder renders.
    expect(container.querySelector('.sidebar-empty')).not.toBeNull()
  })
})
