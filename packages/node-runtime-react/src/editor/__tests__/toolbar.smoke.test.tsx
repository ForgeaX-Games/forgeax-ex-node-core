// Faithful toolbar smoke test — render the ported Toolbar and StatusBar over a
// mock-ApiClient-backed store and assert they mount with the real legacy CSS
// classes, that the generic Run control renders, and that a consumer-injected
// `actions` node appears in the toolbar (non-vacuous assertions).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

import { createMockApiClient } from '../../test/mockApiClient.js'
import { configureEditorTransport, createEditorTransport, type EditorTransport } from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import { useUIStore } from '../stores/uiStore.js'
import Toolbar from '../components/toolbar/Toolbar.js'
import StatusBar from '../components/common/StatusBar.js'
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
  useUIStore.setState({ probeMode: false, langMode: 'en' })
})

afterEach(() => {
  transport.dispose()
  configureEditorTransport(null)
})

describe('faithful toolbar smoke', () => {
  it('mounts the Toolbar with the real legacy CSS classes, a Run control and an injected actions node', () => {
    const { container } = render(
      <Toolbar
        title="Smoke Editor"
        actions={<button className="app-action-probe" data-testid="injected-action">Render</button>}
      />,
    )

    // Toolbar shell + groups from Toolbar.css.
    expect(container.querySelector('.toolbar')).not.toBeNull()
    expect(container.querySelector('.toolbar-left')).not.toBeNull()
    expect(container.querySelector('.toolbar-right')).not.toBeNull()
    expect(container.querySelector('.toolbar-group')).not.toBeNull()

    // Injectable title slot.
    expect(container.querySelector('.logo-text')?.textContent).toBe('Smoke Editor')

    // Generic Run control (idle status → run, not stop).
    const run = container.querySelector('.toolbar-btn-run')
    expect(run).not.toBeNull()
    expect(container.querySelector('.toolbar-btn-stop')).toBeNull()

    // The consumer-injected actions node is present (non-vacuous).
    expect(container.querySelector('[data-testid="injected-action"]')).not.toBeNull()
  })

  it('switches Run -> Stop when the pipeline is running', () => {
    usePipelineStore.setState({ pipelineStatus: 'running' })
    const { container } = render(<Toolbar />)
    expect(container.querySelector('.toolbar-btn-stop')).not.toBeNull()
    expect(container.querySelector('.toolbar-btn-run')).toBeNull()
  })

  it('hides the Run/Stop control (and its divider) when showRunControl is false', () => {
    const { container } = render(<Toolbar showRunControl={false} />)
    expect(container.querySelector('.toolbar-btn-run')).toBeNull()
    expect(container.querySelector('.toolbar-btn-stop')).toBeNull()
    expect(container.querySelector('.toolbar-divider')).toBeNull()
  })

  it('renders a visible probe toolbar button that toggles probe mode', () => {
    const { container, getByTitle } = render(<Toolbar />)

    const probeButton = container.querySelector('.toolbar-btn-probe')
    expect(probeButton).not.toBeNull()
    expect(useUIStore.getState().probeMode).toBe(false)

    fireEvent.click(getByTitle('Data probe on wires'))
    expect(useUIStore.getState().probeMode).toBe(true)
    expect(probeButton).toHaveClass('active')
  })

  it('opens the settings dropdown and renders the status / history / data-types panels', () => {
    const { container, getByTitle } = render(<Toolbar />)
    // Settings menu closed initially.
    expect(container.querySelector('.settings-dropdown')).toBeNull()
    fireEvent.click(getByTitle('Settings'))
    expect(container.querySelector('.settings-dropdown')).not.toBeNull()
    expect(container.querySelector('.settings-info-panel')).not.toBeNull()
    expect(container.querySelector('.settings-history-panel')).not.toBeNull()
    expect(container.querySelector('.settings-data-types-panel')).not.toBeNull()
  })

  it('mounts the StatusBar with the real legacy CSS classes and live counts', () => {
    const { container } = render(<StatusBar />)
    expect(container.querySelector('.statusbar')).not.toBeNull()
    expect(container.querySelector('.connection-indicator')).not.toBeNull()
    // One seeded node, zero edges.
    expect(container.querySelector('.statusbar-right')?.textContent).toContain('Nodes: 1')
    expect(container.querySelector('.statusbar-right')?.textContent).toContain('Edges: 0')
  })
})
