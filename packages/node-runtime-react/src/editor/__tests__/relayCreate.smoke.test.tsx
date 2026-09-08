import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import type { Node } from 'reactflow'

import {
  RELAY_BATTERY_ID,
  RELAY_INPUT_PORT,
  RELAY_NODE_HEIGHT,
  RELAY_NODE_WIDTH,
  RELAY_OUTPUT_PORT,
} from '../components/canvas/RelayNode.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import type { Battery, Pipeline } from '../types.js'

type UseCanvasDrop = typeof import('../components/canvas/useCanvasDrop.js').useCanvasDrop

function emptyPipeline(): Pipeline {
  const now = new Date().toISOString()
  return {
    id: 'relay-create',
    name: 'relay-create',
    description: '',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
}

const relayBattery: Battery = {
  id: RELAY_BATTERY_ID,
  name: 'Relay',
  nameEn: 'Relay',
  type: 'special',
  category: 'editor',
  description: 'Pass-through wire relay',
  version: '1.0.0',
  inputs: [{ name: RELAY_INPUT_PORT, type: 'any' }],
  outputs: [{ name: RELAY_OUTPUT_PORT, type: 'any' }],
  params: [],
}

function createRelayCreateHarness(useCanvasDrop: UseCanvasDrop) {
  return function RelayCreateHarness() {
    const [rfNodes, setRfNodes] = useState<Node[]>([])
    const { placeBattery } = useCanvasDrop({ reactFlowInstance: null, setNodes: setRfNodes })

    return (
      <>
        <button onClick={() => placeBattery(relayBattery, { x: 12, y: 34 })}>create relay</button>
        <output data-testid="rf-node">{JSON.stringify(rfNodes[0] ?? null)}</output>
      </>
    )
  }
}

describe('relay creation path', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    usePipelineStore.setState({
      batteries: [],
      categories: [],
      currentPipeline: emptyPipeline(),
      sessionRestorePending: null,
      pipelineRevision: 0,
      pipelineStatus: 'idle',
      selectedNode: null,
      selectedNodeIds: [],
      logs: [],
      nodeOutputs: {},
      dynamicOutputPorts: {},
      groupViewStack: [],
      incrementalExecute: vi.fn(),
    })
    useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
  })

  it('creates a relay ReactFlow node and __relay__ pipeline node from the virtual battery', async () => {
    const { useCanvasDrop } = await import('../components/canvas/useCanvasDrop.js')
    const RelayCreateHarness = createRelayCreateHarness(useCanvasDrop)
    const { getByText, getByTestId } = render(<RelayCreateHarness />)
    fireEvent.click(getByText('create relay'))

    const pipelineNode = usePipelineStore.getState().currentPipeline?.nodes[0]
    expect(pipelineNode).toEqual(expect.objectContaining({
      batteryId: RELAY_BATTERY_ID,
      name: 'Relay',
      params: { portType: 'any' },
      position: { x: 12, y: 34 },
    }))

    const rfNode = JSON.parse(getByTestId('rf-node').textContent || 'null')
    expect(rfNode).toEqual(expect.objectContaining({
      type: 'relay',
      position: { x: 12, y: 34 },
      style: { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT },
      data: { portType: 'any' },
    }))
  })
})
